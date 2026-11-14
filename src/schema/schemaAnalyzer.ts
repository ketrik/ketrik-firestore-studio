export interface FieldTypeDistribution {
  type: string;
  count: number;
  percentage: number;
  sampleValues: any[];
}

export interface FieldHealthMetric {
  fieldPath: string;
  occurrenceCount: number;
  presencePercentage: number;
  missingCount: number;
  nullCount: number;
  typeDistributions: FieldTypeDistribution[];
  isPrimaryTypeMixed: boolean;
  isZombieOrOrphan: boolean; // < 5% presence or obsolete
  isNullable: boolean; // has null values
  sampleErrorsOrAnomalies: string[];
}

export interface CollectionHealthReport {
  collectionPath: string;
  connectionId: string;
  connectionName: string;
  sampledCount: number;
  totalUniqueFields: number;
  overallHealthScore: number; // 0 to 100
  fields: FieldHealthMetric[];
  anomaliesCount: number;
  orphanKeysCount: number;
  mixedTypesCount: number;
  generatedAt: string;
  sampledDocIds?: string[];
  excludedDocIds?: string[];
}

export interface DocumentSchemaSnapshot {
  id: string;
  fields: { path: string; type: string }[];
}

/**
 * Detect value type accurately for schema health profiling.
 */
export function detectDetailedValueType(val: any): string {
  if (val === null) return "null";
  if (val === undefined) return "undefined";
  if (typeof val === "boolean") return "boolean";
  if (typeof val === "number") {
    return Number.isInteger(val) ? "integer" : "number";
  }
  if (typeof val === "string") return "string";
  if (Array.isArray(val)) return "array";
  if (typeof val === "object") {
    if (Buffer.isBuffer(val) || val instanceof Uint8Array) {
      return "bytes";
    }
    if (val instanceof Date) {
      return "Date";
    }
    if (val._seconds !== undefined && val._nanoseconds !== undefined) {
      return "Timestamp";
    }
    if (val._latitude !== undefined && val._longitude !== undefined) {
      return "GeoPoint";
    }
    if (
      typeof val.path === "string" &&
      (typeof val.collection === "function" || Boolean(val.firestore) || val.constructor?.name === "DocumentReference")
    ) {
      return "DocumentReference";
    }
    if (Array.isArray(val._values) && typeof val.isEqual === "function") {
      return "VectorValue";
    }
    return "map";
  }
  return typeof val;
}

/**
 * Flatten document keys up to maxDepth (default 2) using dot notation for nested inspection.
 * Computes types in a single pass so binary blobs / large values are never traversed or retained.
 */
export function extractDocumentFieldEntries(
  obj: Record<string, any>,
  prefix = "",
  maxDepth = 2,
  currentDepth = 0,
  results: { path: string; type: string }[] = []
): { path: string; type: string }[] {
  if (!obj || typeof obj !== "object" || Array.isArray(obj) || Buffer.isBuffer(obj) || obj instanceof Uint8Array || currentDepth >= maxDepth) {
    return results;
  }

  for (const key in obj) {
    if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
    if (key === "__id" || key === "__path") continue;
    const val = obj[key];
    const fullPath = prefix ? `${prefix}.${key}` : key;
    const type = detectDetailedValueType(val);
    results.push({ path: fullPath, type });

    // Inspect nested plain map only
    if (type === "map" && currentDepth + 1 < maxDepth) {
      extractDocumentFieldEntries(val, fullPath, maxDepth, currentDepth + 1, results);
    }
  }
  return results;
}

/**
 * Extract a lightweight schema-only snapshot of a document (discards raw values to minimize memory).
 */
export function extractDocumentSchemaSnapshot(docId: string, data: Record<string, any>, maxDepth = 2): DocumentSchemaSnapshot {
  return {
    id: docId,
    fields: extractDocumentFieldEntries(data, "", maxDepth),
  };
}

/**
 * Compute the full collection schema drift and anomaly health report from lightweight document snapshots.
 */
export function analyzeSchemaSnapshots(
  collectionPath: string,
  connectionId: string,
  connectionName: string,
  snapshots: DocumentSchemaSnapshot[],
  excludedDocIds: string[] = []
): CollectionHealthReport {
  const sampledDocIds = snapshots.map((s) => s.id).filter(Boolean);
  const excludedSet = new Set(excludedDocIds);
  const activeDocs = snapshots.filter((s) => !s.id || !excludedSet.has(s.id));

  const sampledCount = activeDocs.length;
  if (sampledCount === 0) {
    return {
      collectionPath,
      connectionId,
      connectionName,
      sampledCount: 0,
      totalUniqueFields: 0,
      overallHealthScore: 100,
      fields: [],
      anomaliesCount: 0,
      orphanKeysCount: 0,
      mixedTypesCount: 0,
      generatedAt: new Date().toISOString(),
      sampledDocIds,
      excludedDocIds,
    };
  }

  // Map from fieldPath to tracker
  const fieldMap = new Map<
    string,
    {
      occurrences: number;
      nulls: number;
      types: Map<string, number>;
    }
  >();

  for (const doc of activeDocs) {
    const seenInDoc = new Set<string>();

    for (const { path, type } of doc.fields) {
      if (seenInDoc.has(path)) continue;
      seenInDoc.add(path);

      let tracker = fieldMap.get(path);
      if (!tracker) {
        tracker = { occurrences: 0, nulls: 0, types: new Map() };
        fieldMap.set(path, tracker);
      }
      tracker.occurrences += 1;

      if (type === "null") {
        tracker.nulls += 1;
      }

      tracker.types.set(type, (tracker.types.get(type) || 0) + 1);
    }
  }

  const fieldMetrics: FieldHealthMetric[] = [];
  let mixedTypesCount = 0;
  let orphanKeysCount = 0;
  let anomaliesCount = 0;
  let otherAnomaliesCount = 0;

  for (const [path, tracker] of fieldMap.entries()) {
    const presencePercentage =
      tracker.occurrences === sampledCount
        ? 100
        : Math.min(99, Math.round((tracker.occurrences / sampledCount) * 100));
    const missingCount = sampledCount - tracker.occurrences;
    const typeDistributions: FieldTypeDistribution[] = [];

    // Filter out null from pure type comparison unless all null
    const nonNullTypes: string[] = [];
    for (const [type, count] of tracker.types.entries()) {
      typeDistributions.push({
        type,
        count,
        percentage: Math.round((count / tracker.occurrences) * 100),
        sampleValues: [],
      });
      if (type !== "null") {
        nonNullTypes.push(type);
      }
    }

    typeDistributions.sort((a, b) => b.count - a.count);

    const isPrimaryTypeMixed = nonNullTypes.length > 1;
    if (isPrimaryTypeMixed) mixedTypesCount += 1;

    // Orphan / zombie key: present in < 5% of documents (or 1 doc if small sample > 3)
    const isZombieOrOrphan = sampledCount >= 10
      ? presencePercentage < 5
      : tracker.occurrences === 1 && sampledCount > 3;
    if (isZombieOrOrphan) orphanKeysCount += 1;

    const anomalies: string[] = [];
    if (isPrimaryTypeMixed) {
      anomalies.push(`Mixed non-null data types: ${nonNullTypes.join(", ")}`);
    }
    if (isZombieOrOrphan) {
      anomalies.push(`Orphan key: Only found in ${tracker.occurrences} of ${sampledCount} sampled docs (${presencePercentage}%)`);
    }
    if (presencePercentage < 50 && !isZombieOrOrphan) {
      anomalies.push(`Low presence: Missing in ${missingCount} documents (${100 - presencePercentage}%)`);
    }
    if (tracker.nulls > 0 && tracker.nulls === tracker.occurrences) {
      anomalies.push(`Dead key: Contains only null values across all occurrences`);
    }

    if (anomalies.length > 0) {
      anomaliesCount += 1;
      if (!isPrimaryTypeMixed && !isZombieOrOrphan) {
        otherAnomaliesCount += 1;
      }
    }

    fieldMetrics.push({
      fieldPath: path,
      occurrenceCount: tracker.occurrences,
      presencePercentage,
      missingCount,
      nullCount: tracker.nulls,
      typeDistributions,
      isPrimaryTypeMixed,
      isZombieOrOrphan,
      isNullable: tracker.nulls > 0,
      sampleErrorsOrAnomalies: anomalies,
    });
  }

  // Sort fields: anomalies & orphans first, then by field name
  fieldMetrics.sort((a, b) => {
    if (a.sampleErrorsOrAnomalies.length !== b.sampleErrorsOrAnomalies.length) {
      return b.sampleErrorsOrAnomalies.length - a.sampleErrorsOrAnomalies.length;
    }
    return a.fieldPath.localeCompare(b.fieldPath);
  });

  // Calculate health score without double-counting mixed/orphan fields in otherAnomaliesCount
  const penalty = Math.min(100, (mixedTypesCount * 15) + (orphanKeysCount * 10) + (otherAnomaliesCount * 5));
  const overallHealthScore = Math.max(0, 100 - penalty);

  return {
    collectionPath,
    connectionId,
    connectionName,
    sampledCount,
    totalUniqueFields: fieldMetrics.length,
    overallHealthScore,
    fields: fieldMetrics,
    anomaliesCount,
    orphanKeysCount,
    mixedTypesCount,
    generatedAt: new Date().toISOString(),
    sampledDocIds,
    excludedDocIds,
  };
}

/**
 * Compute the full collection schema drift and anomaly health report from raw sampled documents.
 */
export function analyzeCollectionSchemaHealth(
  collectionPath: string,
  connectionId: string,
  connectionName: string,
  documents: Record<string, any>[],
  excludedDocIds: string[] = []
): CollectionHealthReport {
  const snapshots = documents.map((d) => extractDocumentSchemaSnapshot(d.__id || d.id || "", d));
  return analyzeSchemaSnapshots(collectionPath, connectionId, connectionName, snapshots, excludedDocIds);
}

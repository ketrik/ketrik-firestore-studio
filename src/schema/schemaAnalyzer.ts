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
    if (val._seconds !== undefined && val._nanoseconds !== undefined) {
      return "Timestamp";
    }
    if (val._latitude !== undefined && val._longitude !== undefined) {
      return "GeoPoint";
    }
    if (val.path && typeof val.path === "string" && (val.firestore || val.id)) {
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
 */
export function extractDocumentFieldEntries(
  obj: Record<string, any>,
  prefix = "",
  maxDepth = 2,
  currentDepth = 0
): { path: string; value: any }[] {
  const results: { path: string; value: any }[] = [];
  if (!obj || typeof obj !== "object" || Array.isArray(obj) || currentDepth >= maxDepth) {
    return results;
  }

  for (const [key, val] of Object.entries(obj)) {
    if (key.startsWith("__") && (key === "__id" || key === "__path")) continue;
    const fullPath = prefix ? `${prefix}.${key}` : key;
    results.push({ path: fullPath, value: val });

    // Inspect nested plain map
    const type = detectDetailedValueType(val);
    if (type === "map" && currentDepth + 1 < maxDepth) {
      const nested = extractDocumentFieldEntries(val, fullPath, maxDepth, currentDepth + 1);
      results.push(...nested);
    }
  }
  return results;
}

/**
 * Compute the full collection schema drift and anomaly health report from sampled documents.
 */
export function analyzeCollectionSchemaHealth(
  collectionPath: string,
  connectionId: string,
  connectionName: string,
  documents: Record<string, any>[]
): CollectionHealthReport {
  const sampledCount = documents.length;
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
    };
  }

  // Map from fieldPath to tracker
  const fieldMap = new Map<
    string,
    {
      occurrences: number;
      nulls: number;
      types: Map<string, { count: number; samples: any[] }>;
    }
  >();

  for (const doc of documents) {
    const entries = extractDocumentFieldEntries(doc);
    const seenInDoc = new Set<string>();

    for (const { path, value } of entries) {
      if (seenInDoc.has(path)) continue;
      seenInDoc.add(path);

      let tracker = fieldMap.get(path);
      if (!tracker) {
        tracker = { occurrences: 0, nulls: 0, types: new Map() };
        fieldMap.set(path, tracker);
      }
      tracker.occurrences += 1;

      const type = detectDetailedValueType(value);
      if (type === "null") {
        tracker.nulls += 1;
      }

      let typeBucket = tracker.types.get(type);
      if (!typeBucket) {
        typeBucket = { count: 0, samples: [] };
        tracker.types.set(type, typeBucket);
      }
      typeBucket.count += 1;
      if (typeBucket.samples.length < 3 && value !== undefined && value !== null) {
        typeBucket.samples.push(value);
      }
    }
  }

  const fieldMetrics: FieldHealthMetric[] = [];
  let mixedTypesCount = 0;
  let orphanKeysCount = 0;
  let anomaliesCount = 0;

  for (const [path, tracker] of fieldMap.entries()) {
    const presencePercentage = Math.round((tracker.occurrences / sampledCount) * 100);
    const missingCount = sampledCount - tracker.occurrences;
    const typeDistributions: FieldTypeDistribution[] = [];

    // Filter out null from pure type comparison unless all null
    const nonNullTypes: string[] = [];
    for (const [type, info] of tracker.types.entries()) {
      typeDistributions.push({
        type,
        count: info.count,
        percentage: Math.round((info.count / tracker.occurrences) * 100),
        sampleValues: info.samples,
      });
      if (type !== "null") {
        nonNullTypes.push(type);
      }
    }

    typeDistributions.sort((a, b) => b.count - a.count);

    const isPrimaryTypeMixed = nonNullTypes.length > 1;
    if (isPrimaryTypeMixed) mixedTypesCount += 1;

    // Orphan / zombie key: present in < 5% of documents (or <= 2 documents if small sample)
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

  // Calculate health score: 100 minus penalties for mixed types and orphan keys
  const penalty = Math.min(100, (mixedTypesCount * 15) + (orphanKeysCount * 10) + (anomaliesCount * 5));
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
  };
}

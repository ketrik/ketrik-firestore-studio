import { WhereFilterOp } from "firebase-admin/firestore";

export type ExtendedFilterOp = WhereFilterOp | "starts-with";

export interface QueryClause {
  field: string;
  op: ExtendedFilterOp;
  value: string;
}

/**
 * Sort table headers according to Ketrik conventions:
 * 1. System Envelope (_key) first
 * 2. Domain content in alphabetical order
 * 3. Operational Protocol (__key) last
 */
export function sortHeaders(headerList: string[]): string[] {
  return [...headerList].sort((a, b) => {
    const isEnvA = a.startsWith("_") && !a.startsWith("__");
    const isEnvB = b.startsWith("_") && !b.startsWith("__");
    const isProtoA = a.startsWith("__");
    const isProtoB = b.startsWith("__");

    // 1. System Envelope (_key) first
    if (isEnvA && !isEnvB) return -1;
    if (!isEnvA && isEnvB) return 1;

    // 2. Operational Protocol (__key) last
    if (isProtoA && !isProtoB) return 1;
    if (!isProtoA && isProtoB) return -1;

    // 3. Domain content in alphabetical order
    return a.localeCompare(b);
  });
}

/**
 * Parse a raw string filter value into appropriate JavaScript / Firestore types.
 * Accepts optional WhereFilterOp to guarantee non-empty arrays for 'in', 'not-in', and 'array-contains-any'.
 */
export function parseFilterValue(valStr: string, op?: WhereFilterOp): any {
  const trimmed = valStr.trim();
  if (trimmed === "true") { return true; }
  if (trimmed === "false") { return false; }
  if (trimmed === "null") { return null; }
  if (!isNaN(Number(trimmed)) && trimmed !== "") {
    return Number(trimmed);
  }
  // Parse ISO date strings (e.g. 2026-10-10 or 2026-10-10T00:00:00Z) into Date
  if (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(trimmed)) {
    const parsedDate = new Date(trimmed);
    if (!isNaN(parsedDate.getTime())) {
      return parsedDate;
    }
  }
  // Try parsing JSON for array/map filters (e.g. [1, 2], ["a", "b"])
  if ((trimmed.startsWith("[") && trimmed.endsWith("]")) || (trimmed.startsWith("{") && trimmed.endsWith("}"))) {
    try {
      const parsedJson = JSON.parse(trimmed);
      return parsedJson;
    } catch {}
  }

  // If operator requires an array ('in', 'not-in', 'array-contains-any'), coerce comma-separated or single values
  if (op === "in" || op === "not-in" || op === "array-contains-any") {
    if (trimmed.includes(",")) {
      return trimmed.split(",").map((s) => parseFilterValue(s.trim()));
    }
    return [trimmed];
  }

  return trimmed;
}

/**
 * In-memory search over record objects with null/undefined safety.
 */
export function filterObjects(items: any[], searchTerm: string, excludedKeys: string[] = ["__path"]): any[] {
  if (!searchTerm || !searchTerm.trim()) {
    return items;
  }
  const term = searchTerm.toLowerCase().trim();
  return items.filter((item) => {
    if (!item || typeof item !== "object") {
      return false;
    }
    return Object.entries(item).some(([key, val]) => {
      if (excludedKeys.includes(key) || val === undefined || val === null) {
        return false;
      }
      if (key === "__id" && (typeof val === "string" || typeof val === "number")) {
        return String(val).toLowerCase().includes(term);
      }
      if (typeof val === "string" || typeof val === "number" || typeof val === "boolean") {
        return String(val).toLowerCase().includes(term);
      }
      if (typeof val === "object") {
        try {
          return JSON.stringify(val).toLowerCase().includes(term);
        } catch {
          return false;
        }
      }
      return false;
    });
  });
}

/**
 * Recursively sanitize Firestore values for JSON serialization in table webviews.
 */
export function sanitizeFirestoreValue(val: any): any {
  if (val === null || val === undefined) return val;
  if (typeof val !== "object") return val;
  if (val instanceof Date) return val.toISOString();
  if (typeof val._seconds === "number" && typeof val._nanoseconds === "number") {
    return { _seconds: val._seconds, _nanoseconds: val._nanoseconds };
  }
  if (typeof val._latitude === "number" && typeof val._longitude === "number") {
    return { _latitude: val._latitude, _longitude: val._longitude };
  }
  if (typeof val.path === "string" && (val._firestore || val.constructor?.name === "DocumentReference")) {
    return `[Ref: ${val.path}]`;
  }
  if (Buffer.isBuffer(val) || val instanceof Uint8Array) {
    return `[Blob: ${val.length} bytes]`;
  }
  if (val.constructor?.name === "VectorValue" || (Array.isArray(val._values) && typeof val.isEqual === "function")) {
    const arr = typeof val.toArray === "function" ? val.toArray() : val._values;
    return {
      __type: "VectorValue",
      values: arr,
      dimensions: arr.length,
    };
  }
  if (Array.isArray(val)) {
    return val.map(sanitizeFirestoreValue);
  }
  const result: Record<string, any> = {};
  for (const k of Object.keys(val)) {
    result[k] = sanitizeFirestoreValue(val[k]);
  }
  return result;
}


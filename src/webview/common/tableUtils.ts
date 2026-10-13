import { WhereFilterOp } from "firebase-admin/firestore";

export interface QueryClause {
  field: string;
  op: WhereFilterOp;
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
 */
export function parseFilterValue(valStr: string): any {
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
  // Try parsing JSON for array filters (e.g. [1, 2], ["a", "b"])
  if ((trimmed.startsWith("[") && trimmed.endsWith("]")) || (trimmed.startsWith("{") && trimmed.endsWith("}"))) {
    try {
      return JSON.parse(trimmed);
    } catch {}
  }
  return trimmed;
}

/**
 * In-memory search over record objects.
 */
export function filterObjects(items: any[], searchTerm: string, excludedKeys: string[] = ["__path"]): any[] {
  const term = searchTerm.toLowerCase();
  return items.filter((item) =>
    Object.entries(item).some(([key, val]) => {
      if (excludedKeys.includes(key)) {
        return false;
      }
      if (key === "__id" && typeof val === "string") {
        return val.toLowerCase().includes(term);
      }
      return typeof val === "string"
        ? val.toLowerCase().includes(term)
        : typeof val === "object" && val !== null
        ? JSON.stringify(val).toLowerCase().includes(term)
        : false;
    })
  );
}

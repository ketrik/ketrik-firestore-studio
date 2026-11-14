import * as vscode from "vscode";
import * as path from "path";
import * as os from "os";
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

  // If operator requires an array ('in', 'not-in', 'array-contains-any'), handle array coercion first
  if (op === "in" || op === "not-in" || op === "array-contains-any") {
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        const parsedJson = JSON.parse(trimmed);
        if (Array.isArray(parsedJson)) return parsedJson;
      } catch {}
    }
    if (trimmed.includes(",")) {
      return trimmed.split(",").map((s) => parseFilterValue(s.trim()));
    }
    return [parseFilterValue(trimmed)];
  }

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

  return trimmed;
}

/**
 * Fast zero-allocation recursive matcher to test if a document's keys or values
 * match an active lowercase search term without allocating large JSON strings.
 */
export function matchesSearchTerm(val: any, term: string, depth = 0): boolean {
  if (val === null || val === undefined || depth > 8) {
    return false;
  }
  if (typeof val === "string") {
    return val.toLowerCase().includes(term);
  }
  if (typeof val === "number" || typeof val === "boolean") {
    return String(val).toLowerCase().includes(term);
  }
  if (Array.isArray(val)) {
    for (let i = 0; i < val.length; i++) {
      if (matchesSearchTerm(val[i], term, depth + 1)) {
        return true;
      }
    }
    return false;
  }
  if (typeof val === "object") {
    for (const k in val) {
      if (Object.prototype.hasOwnProperty.call(val, k)) {
        if (k.toLowerCase().includes(term) || matchesSearchTerm(val[k], term, depth + 1)) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * In-memory search over record objects with null/undefined safety.
 */
export function filterObjects(items: any[], searchTerm: string, excludedKeys: string[] = ["__path"]): any[] {
  if (!searchTerm || !searchTerm.trim()) {
    return items;
  }
  const term = searchTerm.toLowerCase().trim();
  const excludedSet = new Set(excludedKeys);

  return items.filter((item) => {
    if (!item || typeof item !== "object") {
      return false;
    }
    for (const key in item) {
      if (!Object.prototype.hasOwnProperty.call(item, key) || excludedSet.has(key)) {
        continue;
      }
      if (key.toLowerCase().includes(term)) {
        return true;
      }
      if (matchesSearchTerm(item[key], term)) {
        return true;
      }
    }
    return false;
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
  for (const k in val) {
    if (Object.prototype.hasOwnProperty.call(val, k)) {
      result[k] = sanitizeFirestoreValue(val[k]);
    }
  }
  return result;
}

/**
 * Safely anchors a default export file URI to the current workspace root,
 * or the user's home directory if no workspace folder is open.
 * Prevents macOS / Linux root filesystem permission errors (EROFS) when using relative paths.
 */
export function getDefaultExportUri(filename: string): vscode.Uri {
  const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (wsRoot) {
    return vscode.Uri.file(path.join(wsRoot, filename));
  }
  return vscode.Uri.file(path.join(os.homedir(), filename));
}

/**
 * Atomically updates or deletes a nested Firestore field path.
 * If segments contain numeric array indices (e.g. ['items', '0', 'metadata']),
 * this function prevents Firestore from corrupting parent arrays into maps
 * by mutating the parent array in-memory and updating the topmost array field.
 */
export async function safeFirestoreFieldUpdate(
  firestore: any,
  docPath: string,
  segments: string[],
  value: any,
  isDelete: boolean = false
): Promise<void> {
  const hasNumericIndex = segments.some((s) => /^\d+$/.test(s));
  if (!hasNumericIndex) {
    const { FieldPath, FieldValue } = await import("firebase-admin/firestore");
    const docRef = firestore.doc(docPath);
    if (isDelete) {
      await docRef.update(new FieldPath(...segments), FieldValue.delete());
    } else {
      try {
        await docRef.update(new FieldPath(...segments), value);
      } catch (err: any) {
        if (err.code === 5 || (err.message && err.message.includes("NOT_FOUND"))) {
          if (segments.length === 1) {
            await docRef.set({ [segments[0]]: value }, { merge: true });
            return;
          }
        }
        throw err;
      }
    }
    return;
  }

  // Handle array index segments safely
  const docSnap = await firestore.doc(docPath).get();
  const docData = docSnap.exists ? docSnap.data() || {} : {};

  let target: any = docData;
  for (let i = 0; i < segments.length - 1; i++) {
    const key = segments[i];
    const nextKey = segments[i + 1];
    if (!target[key] || typeof target[key] !== "object") {
      target[key] = /^\d+$/.test(nextKey) ? [] : {};
    }
    target = target[key];
  }

  const lastKey = segments[segments.length - 1];
  if (isDelete) {
    if (Array.isArray(target) && /^\d+$/.test(lastKey)) {
      target.splice(parseInt(lastKey, 10), 1);
    } else if (target && typeof target === "object") {
      delete target[lastKey];
    }
  } else {
    if (Array.isArray(target) && /^\d+$/.test(lastKey)) {
      target[parseInt(lastKey, 10)] = value;
    } else {
      target[lastKey] = value;
    }
  }

  const firstNumericIdx = segments.findIndex((s) => /^\d+$/.test(s));
  const arrayParentSegments = firstNumericIdx > 0 ? segments.slice(0, firstNumericIdx) : segments;
  let arrayVal: any = docData;
  for (const seg of arrayParentSegments) {
    arrayVal = arrayVal?.[seg];
  }

  const { FieldPath } = await import("firebase-admin/firestore");
  await firestore.doc(docPath).update(new FieldPath(...arrayParentSegments), arrayVal);
}


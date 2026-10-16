/**
 * Utilities to calculate Firestore document storage size according to Google Cloud Firestore specs:
 * https://firebase.google.com/docs/firestore/storage-size
 *
 * Firestore Document Size Calculation Rules:
 * - Base document overhead: 32 bytes (document name + metadata)
 * - Document path size: 16 additional bytes
 * - String: 1 byte per UTF-8 byte + 1 byte
 * - Integer / Float: 8 bytes
 * - Boolean: 1 byte
 * - Null: 1 byte
 * - Timestamp / Date: 8 bytes
 * - GeoPoint: 16 bytes
 * - Reference: Document path in bytes + 16 bytes
 * - Map: Size of each field name (string) + size of each field value
 * - Array: Sum of the sizes of its values
 */

export interface DocumentSizeInfo {
  bytes: number;
  formatted: string;
  percentageOfLimit: number;
  isWarning: boolean;
  isCritical: boolean;
}

export const FIRESTORE_MAX_DOC_SIZE_BYTES = 1048576; // 1 MiB (1,048,576 bytes)
export const WARNING_THRESHOLD_BYTES = 750 * 1024; // 750 KB (73.2% of 1MB limit)
export const CRITICAL_THRESHOLD_BYTES = 950 * 1024; // 950 KB (92.8% of 1MB limit)


/**
 * Calculates the exact or estimated Firestore document size in bytes for a given data payload and optional document path.
 */
export function calculateDocumentSize(data: any, docPath?: string): number {
  let size = 32; // Document overhead

  if (docPath) {
    size += getUtf8ByteLength(docPath) + 16;
  }

  if (data && typeof data === "object") {
    size += calculateValueSize(data);
  }

  return size;
}

function calculateValueSize(val: any): number {
  if (val === null || val === undefined) {
    return 1;
  }

  if (typeof val === "boolean") {
    return 1;
  }

  if (typeof val === "number") {
    return 8;
  }

  if (typeof val === "string") {
    return getUtf8ByteLength(val) + 1;
  }

  // Firestore Timestamp ({ _seconds, _nanoseconds } or Timestamp instance)
  if (
    (typeof val === "object" && typeof val._seconds === "number" && typeof val._nanoseconds === "number") ||
    val instanceof Date ||
    (val && typeof val.toMillis === "function")
  ) {
    return 8;
  }

  // GeoPoint ({ latitude, longitude })
  if (
    typeof val === "object" &&
    typeof val.latitude === "number" &&
    typeof val.longitude === "number" &&
    Object.keys(val).length === 2
  ) {
    return 16;
  }

  // DocumentReference
  if (val && typeof val === "object" && typeof val.path === "string") {
    return getUtf8ByteLength(val.path) + 16;
  }

  if (Array.isArray(val)) {
    let arraySize = 0;
    for (const item of val) {
      arraySize += calculateValueSize(item);
    }
    return arraySize;
  }

  if (typeof val === "object") {
    let mapSize = 0;
    for (const key of Object.keys(val)) {
      // Each field in a map charges string bytes for the key + value size
      mapSize += getUtf8ByteLength(key) + 1;
      mapSize += calculateValueSize(val[key]);
    }
    return mapSize;
  }

  return 0;
}

/**
 * Calculates the byte length of a string in UTF-8 encoding.
 * Employs a zero-allocation ASCII fast-path to avoid Node.js Buffer C++ bridge overhead.
 */
export function getUtf8ByteLength(str: string): number {
  const len = str.length;
  // Fast-path: Field keys and short strings in Firestore are overwhelmingly ASCII
  let isAscii = true;
  for (let i = 0; i < len; i++) {
    if (str.charCodeAt(i) > 0x7f) {
      isAscii = false;
      break;
    }
  }
  if (isAscii) {
    return len;
  }
  return Buffer.byteLength(str, "utf8");
}

/**
 * Formats bytes into a human-readable string (B, KB, MB).
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Returns comprehensive size info including formatting, percentage of the 1MB limit, and threshold alerts.
 */
export function getDocumentSizeInfo(data: any, docPath?: string): DocumentSizeInfo {
  const bytes = calculateDocumentSize(data, docPath);
  const percentageOfLimit = Math.min(100, (bytes / FIRESTORE_MAX_DOC_SIZE_BYTES) * 100);
  const isWarning = bytes >= WARNING_THRESHOLD_BYTES && bytes < CRITICAL_THRESHOLD_BYTES;
  const isCritical = bytes >= CRITICAL_THRESHOLD_BYTES;

  return {
    bytes,
    formatted: formatBytes(bytes),
    percentageOfLimit: Math.round(percentageOfLimit * 10) / 10,
    isWarning,
    isCritical,
  };
}

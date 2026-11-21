import * as vscode from "vscode";
import { Firestore, CollectionReference, DocumentReference } from "firebase-admin/firestore";
import { CostService } from "../cost/costService";

/**
 * Recursively delete a Firestore collection or document (including all nested subcollections)
 * using a dedicated BulkWriter so actual deleted document counts are tracked and reported to CostService.
 */
export async function recursiveDeleteWithCount(
  firestore: Firestore,
  ref: CollectionReference | DocumentReference,
  connectionId: string,
  onProgress?: (deletedCount: number) => void
): Promise<number> {
  const bulkWriter = firestore.bulkWriter();
  let deletedCount = 0;

  bulkWriter.onWriteResult(() => {
    deletedCount++;
    onProgress?.(deletedCount);
  });

  try {
    await firestore.recursiveDelete(ref, bulkWriter);
  } finally {
    await bulkWriter.close().catch(() => {});
    if (deletedCount > 0) {
      CostService.getInstance().recordOperation(connectionId, "delete", deletedCount);
    }
  }

  return deletedCount;
}

/**
 * Return whether Safe Mode protection for System Envelope ('_') and Operational Protocol ('__') keys is enabled.
 */
export function isProtectSystemKeysEnabled(): boolean {
  return vscode.workspace
    .getConfiguration("ketrik-firestore-studio")
    .get<boolean>("protectSystemKeys", true);
}

/**
 * Check whether any segment in a field path is a System Envelope ('_') or Operational Protocol ('__') key.
 */
export function isSystemFieldPath(fieldPathOrSegments: string | string[]): boolean {
  const segments = Array.isArray(fieldPathOrSegments)
    ? fieldPathOrSegments
    : fieldPathOrSegments.split(".").filter(Boolean);
  return segments.some((seg) => seg.startsWith("_"));
}

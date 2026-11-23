import * as vscode from "vscode";
import { Firestore, CollectionReference, DocumentReference } from "firebase-admin/firestore";
import { CostService } from "../cost/costService";
import { ConnectionManager } from "../connections/ConnectionManager";
import { StorageService } from "../storage/storageService";

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

/**
 * Return whether the target connection is tagged as a Production environment.
 */
export function isProductionConnection(connectionId: string): boolean {
  return ConnectionManager.getInstance().getConnection(connectionId)?.environment === "production";
}

/**
 * Return whether type-to-confirm friction is enabled for Production connections.
 */
export function isProductionTypeToConfirmEnabled(): boolean {
  return vscode.workspace
    .getConfiguration("ketrik-firestore-studio")
    .get<boolean>("requireProductionTypeToConfirm", true);
}

/**
 * Return an attention-grabbing environment banner prefix for destructive confirmation dialogs.
 */
export function getEnvironmentWarningPrefix(connectionId: string): string {
  const connManager = ConnectionManager.getInstance();
  const conn = connManager.getConnection(connectionId);
  if (conn?.environment === "production") {
    const projectId = connManager.getEffectiveProjectId(conn) || conn.projectId;
    const dbPart = conn.databaseId && conn.databaseId !== "(default)" ? ` / db: ${conn.databaseId}` : "";
    const scopePart = projectId ? ` (${projectId}${dbPart})` : dbPart ? ` (${dbPart.trim()})` : "";
    return `🔴 [PRODUCTION: ${conn.name}${scopePart}]\n\n`;
  }
  if (conn?.environment === "staging") {
    return `🟡 [STAGING: ${conn.name}]\n\n`;
  }
  return "";
}

/**
 * Enforce an explicit type-to-confirm prompt before destructive actions on Production connections.
 * Returns true immediately for non-production connections or when the setting is disabled.
 */
export async function confirmProductionAction(params: {
  connectionId: string;
  actionLabel: string;
  targetSummary: string;
  expectedInput: string;
  inputHint?: string;
}): Promise<boolean> {
  if (!isProductionConnection(params.connectionId) || !isProductionTypeToConfirmEnabled()) {
    return true;
  }

  const connManager = ConnectionManager.getInstance();
  const conn = connManager.getConnection(params.connectionId);
  const projectId = conn ? connManager.getEffectiveProjectId(conn) || conn.projectId : undefined;
  const connLabel = conn
    ? projectId
      ? `${conn.name} (${projectId})`
      : conn.name
    : params.connectionId;

  const expected = params.expectedInput.trim() || "DELETE";
  const entered = await vscode.window.showInputBox({
    title: `🔴 PRODUCTION Confirmation: ${params.actionLabel}`,
    prompt: `Target: ${params.targetSummary} on '${connLabel}'. Type "${expected}" to confirm permanent deletion.`,
    placeHolder: params.inputHint || `Type ${expected} to confirm`,
    ignoreFocusOut: true,
    validateInput: (val) =>
      val.trim() === expected
        ? null
        : `Type "${expected}" exactly to proceed, or press Esc to cancel.`,
  });

  return entered !== undefined && entered.trim() === expected;
}

/**
 * Sample up to `maxDocs` documents across a document's immediate subcollections and extract
 * referenced Cloud Storage URL strings immediately without retaining full document payloads in memory.
 */
export async function collectSubcollectionStorageSample(
  docRef: DocumentReference,
  connectionId: string,
  maxDocs = 25
): Promise<{ urls: string[] } | undefined> {
  if (maxDocs <= 0) {
    return undefined;
  }

  try {
    const subcollections = await docRef.listCollections();
    if (!subcollections || subcollections.length === 0) {
      return undefined;
    }

    const storageService = StorageService.getInstance();
    const urlSet = new Set<string>();
    let remaining = maxDocs;

    for (const sub of subcollections) {
      if (remaining <= 0) {
        break;
      }
      const snap = await sub.limit(remaining).get();
      if (snap.size > 0) {
        CostService.getInstance().recordOperation(connectionId, "read", snap.size);
        for (const doc of snap.docs) {
          const found = storageService.extractStorageUrlsFromObject(doc.data());
          for (const ref of found) {
            if (ref.rawUrl) {
              urlSet.add(ref.rawUrl);
            }
          }
        }
        remaining -= snap.size;
      }
    }

    return urlSet.size > 0 ? { urls: Array.from(urlSet) } : undefined;
  } catch {
    return undefined;
  }
}

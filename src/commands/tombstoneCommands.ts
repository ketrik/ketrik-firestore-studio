import * as vscode from "vscode";
import { DocumentFieldItem, CollectionItem } from "../explorer/items";
import ExplorerDataProvider from "../explorer/ExplorerDataProvider";
import { DocumentFileSystemProvider } from "../editor/DocumentFileSystemProvider";
import { ConnectionManager } from "../connections/ConnectionManager";

/**
 * Check if an entry represents a soft-deleted tombstone.
 */
function isTombstoneEntry(val: any): { isTombstone: boolean; reason: string } {
  if (val === null || val === undefined) {
    return { isTombstone: true, reason: "null or undefined value" };
  }

  if (typeof val === "object") {
    // Check direct soft-delete flags
    if (val._deleted === true || val.deleted === true || val.isDeleted === true) {
      return { isTombstone: true, reason: "flagged with delete indicator (_deleted/deleted/isDeleted: true)" };
    }

    // Check protocol inactive state
    if (val.__ && typeof val.__ === "object") {
      if (val.__.active === false || val.__.active === "false") {
        return { isTombstone: true, reason: "protocol __.active is false" };
      }
    }
    if (val["__.active"] === false || val["__.active"] === "false") {
      return { isTombstone: true, reason: "protocol __.active is false" };
    }

    // Check deletedAt timestamp / date in the past
    const deletedAt = val.deletedAt || val._deletedAt;
    if (deletedAt) {
      let ms: number | null = null;
      if (typeof deletedAt === "number") {
        ms = deletedAt < 1e11 ? deletedAt * 1000 : deletedAt;
      } else if (typeof deletedAt === "string") {
        const parsed = Date.parse(deletedAt);
        if (!isNaN(parsed)) ms = parsed;
      } else if (typeof deletedAt === "object" && deletedAt._seconds !== undefined) {
        ms = deletedAt._seconds * 1000;
      }
      if (ms !== null && ms <= Date.now()) {
        return { isTombstone: true, reason: `deletedAt is set (${new Date(ms).toISOString()})` };
      }
    }
  }

  return { isTombstone: false, reason: "" };
}

/**
 * Purge soft-deleted tombstones inside a Map or Array field in a document.
 */
export async function purgeFieldTombstonesCommand(
  item: DocumentFieldItem,
  explorerDataProvider: ExplorerDataProvider,
  documentFileSystemProvider: DocumentFileSystemProvider
) {
  if (!item?.parentDocRef || !item?.fieldName) {
    vscode.window.showErrorMessage("No field selected for tombstone purge.");
    return;
  }

  const rawValue = item.value;
  if (!rawValue || typeof rawValue !== "object") {
    vscode.window.showErrorMessage(
      `Field '${item.fieldName}' is neither a Map nor an Array. Tombstones can only be purged from Maps or Arrays.`
    );
    return;
  }

  const isArray = Array.isArray(rawValue);
  const tombstones: Array<{ key: string; reason: string; data: any }> = [];

  if (isArray) {
    (rawValue as any[]).forEach((entry, idx) => {
      const check = isTombstoneEntry(entry);
      if (check.isTombstone) {
        tombstones.push({
          key: `[${idx}]`,
          reason: check.reason,
          data: entry,
        });
      }
    });
  } else {
    Object.entries(rawValue as Record<string, any>).forEach(([k, entry]) => {
      const check = isTombstoneEntry(entry);
      if (check.isTombstone) {
        tombstones.push({
          key: k,
          reason: check.reason,
          data: entry,
        });
      }
    });
  }

  if (tombstones.length === 0) {
    vscode.window.showInformationMessage(
      `No tombstones detected in '${item.fieldName}'. The field is clean!`
    );
    return;
  }

  // Pre-flight decision dialog
  const promptChoice = await vscode.window.showWarningMessage(
    `Found ${tombstones.length} tombstone(s) in '${item.fieldName}' out of ${
      isArray ? (rawValue as any[]).length : Object.keys(rawValue).length
    } total entries.`,
    { modal: true },
    "Purge Tombstones",
    "Preview Tombstones (JSON)",
    "Cancel"
  );

  if (promptChoice === "Preview Tombstones (JSON)") {
    const doc = await vscode.workspace.openTextDocument({
      language: "json",
      content: JSON.stringify(tombstones, null, 2),
    });
    await vscode.window.showTextDocument(doc);
    return;
  }

  if (promptChoice !== "Purge Tombstones") {
    return;
  }

  try {
    let cleanedData: any;
    if (isArray) {
      cleanedData = (rawValue as any[]).filter((entry) => !isTombstoneEntry(entry).isTombstone);
    } else {
      cleanedData = {};
      Object.entries(rawValue as Record<string, any>).forEach(([k, entry]) => {
        if (!isTombstoneEntry(entry).isTombstone) {
          cleanedData[k] = entry;
        }
      });
    }

    await item.parentDocRef.update({
      [item.fieldName]: cleanedData,
    });

    documentFileSystemProvider.invalidateAndNotify(item.connectionId, item.parentDocRef.path);
    explorerDataProvider.refresh();

    vscode.window.showInformationMessage(
      `Successfully purged ${tombstones.length} tombstone(s) from '${item.fieldName}'.`
    );
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to purge tombstones: ${err.message}`);
  }
}

/**
 * Purge soft-deleted documents from an entire Firestore Collection.
 */
export async function purgeCollectionTombstonesCommand(
  item: CollectionItem,
  explorerDataProvider: ExplorerDataProvider,
  documentFileSystemProvider: DocumentFileSystemProvider
) {
  if (!item?.reference) {
    vscode.window.showErrorMessage("No collection selected for tombstone purge.");
    return;
  }

  // Filter mode selection
  const criteriaPick = await vscode.window.showQuickPick(
    [
      {
        label: "$(trash) Standard Soft-Delete Flags",
        description: "Documents with _deleted == true, deleted == true, or isDeleted == true",
        filter: "flags",
      },
      {
        label: "$(history) Inactive Protocol State",
        description: "Documents where __.active == false or expired past current time",
        filter: "protocol",
      },
      {
        label: "$(clock) Explicit deletedAt Timestamp",
        description: "Documents with deletedAt / _deletedAt timestamp set",
        filter: "timestamp",
      },
      {
        label: "$(flame) Comprehensive Purge",
        description: "Match any of the above criteria (Flags, Inactive Protocol, or deletedAt)",
        filter: "all",
      },
    ],
    { placeHolder: `Select tombstone identification criteria for '${item.collectionId}':` }
  );

  if (!criteriaPick) {
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Scanning collection '${item.collectionId}' for tombstones...`,
      cancellable: false,
    },
    async (progress) => {
      try {
        const firestore = await ConnectionManager.getInstance().getFirestore(item.connectionId);
        const collRef = item.reference;

        // Bounded safety read of up to 500 documents
        const snapshot = await collRef.limit(500).get();
        if (snapshot.empty) {
          vscode.window.showInformationMessage(`Collection '${item.collectionId}' is empty.`);
          return;
        }

        const tombstones: Array<{ id: string; ref: any; reason: string; data: any }> = [];

        snapshot.docs.forEach((doc) => {
          const data = doc.data() || {};
          let isMatch = false;
          let matchReason = "";

          if (criteriaPick.filter === "flags" || criteriaPick.filter === "all") {
            if (data._deleted === true || data.deleted === true || data.isDeleted === true) {
              isMatch = true;
              matchReason = "Soft-delete flag is true";
            }
          }

          if (criteriaPick.filter === "protocol" || criteriaPick.filter === "all") {
            const proto = data.__ && typeof data.__ === "object" ? data.__ : {};
            const active = proto.active !== undefined ? proto.active : data["__.active"];
            const exp = proto.exp !== undefined ? proto.exp : data["__.exp"];
            if (active === false || active === "false") {
              isMatch = true;
              matchReason = "Protocol __.active is false";
            } else if (exp) {
              let expMs: number | null = null;
              if (typeof exp === "number") expMs = exp < 1e11 ? exp * 1000 : exp;
              else if (typeof exp === "string") {
                const p = Date.parse(exp);
                if (!isNaN(p)) expMs = p;
              } else if (typeof exp === "object" && exp._seconds !== undefined) {
                expMs = exp._seconds * 1000;
              }
              if (expMs !== null && expMs <= Date.now()) {
                isMatch = true;
                matchReason = `Protocol __.exp has expired (${new Date(expMs).toISOString()})`;
              }
            }
          }

          if (criteriaPick.filter === "timestamp" || criteriaPick.filter === "all") {
            const delAt = data.deletedAt || data._deletedAt;
            if (delAt) {
              isMatch = true;
              matchReason = "deletedAt timestamp present";
            }
          }

          if (isMatch) {
            tombstones.push({
              id: doc.id,
              ref: doc.ref,
              reason: matchReason,
              data,
            });
          }
        });

        if (tombstones.length === 0) {
          vscode.window.showInformationMessage(
            `No matching tombstones found in the first ${snapshot.size} document(s) of '${item.collectionId}'.`
          );
          return;
        }

        // Decision confirmation dialog
        const confirm = await vscode.window.showWarningMessage(
          `Found ${tombstones.length} tombstone document(s) in '${item.collectionId}' (scanned ${snapshot.size} docs). Purge them from Firestore?`,
          { modal: true },
          "Purge Documents",
          "Preview Tombstones (JSON)",
          "Cancel"
        );

        if (confirm === "Preview Tombstones (JSON)") {
          const previewDoc = await vscode.workspace.openTextDocument({
            language: "json",
            content: JSON.stringify(
              tombstones.map((t) => ({ id: t.id, reason: t.reason, data: t.data })),
              null,
              2
            ),
          });
          await vscode.window.showTextDocument(previewDoc);
          return;
        }

        if (confirm !== "Purge Documents") {
          return;
        }

        // Batch delete in chunks of 400
        const BATCH_SIZE = 400;
        let deletedCount = 0;

        for (let i = 0; i < tombstones.length; i += BATCH_SIZE) {
          const chunk = tombstones.slice(i, i + BATCH_SIZE);
          const batch = firestore.batch();
          for (const item of chunk) {
            batch.delete(item.ref);
          }
          await batch.commit();
          for (const item of chunk) {
            documentFileSystemProvider.invalidateAndNotify(item.ref.firestore.projectId, item.ref.path);
          }
          deletedCount += chunk.length;
          progress.report({
            message: `Deleted ${deletedCount} of ${tombstones.length} documents...`,
          });
        }

        explorerDataProvider.refresh();
        vscode.window.showInformationMessage(
          `Successfully purged ${tombstones.length} tombstone document(s) from collection '${item.collectionId}'.`
        );
      } catch (err: any) {
        vscode.window.showErrorMessage(`Collection tombstone purge failed: ${err.message}`);
      }
    }
  );
}

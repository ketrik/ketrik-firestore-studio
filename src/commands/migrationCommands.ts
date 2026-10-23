import * as vscode from "vscode";
import { DocumentFieldItem, CollectionItem } from "../explorer/items";
import ExplorerDataProvider from "../explorer/ExplorerDataProvider";
import { DocumentFileSystemProvider } from "../editor/DocumentFileSystemProvider";
import { ConnectionManager } from "../connections/ConnectionManager";
import { FieldPath, FieldValue } from "firebase-admin/firestore";
import { LocalJsonService } from "../services/LocalJsonService";
import { CostService } from "../cost/costService";
import openPath from "./openPath";

export interface ExplodeFieldOptions {
  item: DocumentFieldItem;
  targetCollectionName: string;
  isSubcollection: boolean;
  deleteSourceField: boolean;
}

export interface ConsolidateCollectionOptions {
  item: CollectionItem;
  targetDocPath: string;
  targetFieldName: string;
  asArray: boolean;
  deleteSourceCollection: boolean;
}

/**
 * Explode a Document Field (Map or Array) into a Collection / Subcollection.
 *
 * - If Record<string, T> (Keyed Map): Dictionary keys become Document IDs in the new collection.
 * - If T[] (Array / Sequence): Array entries become Documents (using item.id or index as ID).
 * - Writes in batches of 400 to observe Firestore's 500-write limit.
 * - Optionally deletes the original map/array field to free document space.
 */
export async function explodeFieldCommand(
  item: DocumentFieldItem,
  explorerDataProvider: ExplorerDataProvider,
  documentFileSystemProvider: DocumentFileSystemProvider
) {
  if (!item?.parentDocRef || !item?.fieldName) {
    vscode.window.showErrorMessage("No field selected to explode.");
    return;
  }

  const rawValue = item.value;
  if (!rawValue || typeof rawValue !== "object") {
    vscode.window.showErrorMessage(
      `Field '${item.fieldName}' is neither a Map nor an Array. Only Maps and Arrays can be exploded into a collection.`
    );
    return;
  }

  const isArray = Array.isArray(rawValue);
  const entryCount = isArray ? rawValue.length : Object.keys(rawValue).length;

  if (entryCount === 0) {
    vscode.window.showWarningMessage(`Field '${item.fieldName}' is empty. Nothing to explode.`);
    return;
  }

  // 1. Target Destination Selection: Subcollection vs Root Collection
  const destinationType = await vscode.window.showQuickPick(
    [
      {
        label: "$(folder) Subcollection under current Document",
        description: `${item.parentDocRef.path}/<collectionId>`,
        isSub: true,
      },
      {
        label: "$(root-folder) Root Collection in database",
        description: `/<collectionId>`,
        isSub: false,
      },
    ],
    { placeHolder: `Explode '${item.fieldName}' (${entryCount} entries) into:` }
  );

  if (!destinationType) {
    return;
  }

  // 2. Collection ID Input
  const targetCollectionName = await vscode.window.showInputBox({
    prompt: `Enter name for the new ${destinationType.isSub ? "subcollection" : "root collection"}`,
    value: item.fieldName,
    validateInput: (v) => {
      const trimmed = v.trim();
      if (!trimmed) return "Collection name cannot be empty";
      if (trimmed.includes("/")) return "Collection name cannot contain '/'";
      return undefined;
    },
  });

  if (!targetCollectionName) {
    return;
  }

  // 3. Delete source field option
  const deleteSource = await vscode.window.showQuickPick(
    [
      {
        label: "$(trash) Yes, delete source field after explode",
        description: `Removes '${item.fieldName}' from ${item.parentDocRef.id} to save document memory`,
        value: true,
      },
      {
        label: "$(save) No, keep source field as backup",
        description: `Keeps '${item.fieldName}' intact in the original document`,
        value: false,
      },
    ],
    { placeHolder: "Delete original field after successful explosion?" }
  );

  if (!deleteSource) {
    return;
  }

  // 4. Confirmation dialog
  const confirmMsg = destinationType.isSub
    ? `Explode ${entryCount} item(s) from '${item.fieldName}' into subcollection '${item.parentDocRef.path}/${targetCollectionName}'?`
    : `Explode ${entryCount} item(s) from '${item.fieldName}' into root collection '/${targetCollectionName}'?`;

  const confirm = await vscode.window.showWarningMessage(
    confirmMsg,
    { modal: true },
    "Proceed with Explode"
  );

  if (confirm !== "Proceed with Explode") {
    return;
  }

  // 5. Execute Migration with Progress notification
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Exploding '${item.fieldName}' into collection '${targetCollectionName}'...`,
      cancellable: false,
    },
    async (progress) => {
      try {
        const firestore = await ConnectionManager.getInstance().getFirestore(item.connectionId);
        const targetCollRef = destinationType.isSub
          ? item.parentDocRef.collection(targetCollectionName.trim())
          : firestore.collection(targetCollectionName.trim());

        // Prepare entries: Array of [docId, docData]
        const entries: Array<{ id: string; data: any }> = [];

        if (isArray) {
          (rawValue as any[]).forEach((val, idx) => {
            let docId = String(idx);
            let docData: any = {};
            if (val !== null && typeof val === "object" && !Array.isArray(val)) {
              docData = { ...val };
              if ("id" in val && (typeof val.id === "string" || typeof val.id === "number")) {
                docId = String(val.id);
              }
            } else {
              docData = { value: val };
            }
            entries.push({ id: docId, data: docData });
          });
        } else {
          Object.entries(rawValue as Record<string, any>).forEach(([key, val]) => {
            let docData: any = {};
            if (val !== null && typeof val === "object" && !Array.isArray(val)) {
              docData = { ...val };
            } else {
              docData = { value: val };
            }
            entries.push({ id: key, data: docData });
          });
        }

        // Commit in chunks of 400 writes
        const BATCH_SIZE = 400;
        let committedCount = 0;

        for (let i = 0; i < entries.length; i += BATCH_SIZE) {
          const chunk = entries.slice(i, i + BATCH_SIZE);
          const batch = firestore.batch();

          for (const entry of chunk) {
            const docRef = targetCollRef.doc(entry.id);
            batch.set(docRef, entry.data, { merge: true });
          }

          await batch.commit();
          committedCount += chunk.length;
          progress.report({
            message: `${committedCount} of ${entries.length} documents written...`,
            increment: (chunk.length / entries.length) * 100,
          });
        }

        // 6. Delete source field if requested
        if (deleteSource.value) {
          const segments = item.pathSegments && item.pathSegments.length > 0 ? item.pathSegments : [item.fieldName];
          const fullFieldPath = item.fullFieldPath || segments.join(".");
          const conn = ConnectionManager.getInstance().getConnection(item.connectionId);
          if (conn?.isLocalJson) {
            LocalJsonService.getInstance().updateField(conn, item.parentDocRef.path, fullFieldPath, undefined, true);
          } else {
            await item.parentDocRef.update(new FieldPath(...segments), FieldValue.delete());
            CostService.getInstance().recordOperation(item.connectionId, "write", 1);
          }
          documentFileSystemProvider.invalidateAndNotifyFieldDeleted(
            item.connectionId,
            item.parentDocRef.path,
            [fullFieldPath, item.fieldName]
          );
        }

        vscode.window.showInformationMessage(
          `Successfully exploded ${entries.length} document(s) into collection '${targetCollectionName}'!`
        );

        explorerDataProvider.refresh();
      } catch (err: any) {
        vscode.window.showErrorMessage(`Explosion migration failed: ${err.message}`);
      }
    }
  );
}

/**
 * Consolidate a small Collection into a single aggregate Map or Array in a target document.
 *
 * - Reduces read billing by compressing many small documents into a single dictionary substrate.
 * - Prompts for target document (or creates one).
 * - Prompts for target field name (defaults to source collection ID).
 * - Optionally deletes the source documents after consolidation.
 */
export async function consolidateCollectionCommand(
  item: CollectionItem,
  explorerDataProvider: ExplorerDataProvider,
  documentFileSystemProvider: DocumentFileSystemProvider
) {
  if (!item?.reference) {
    vscode.window.showErrorMessage("No collection selected to consolidate.");
    return;
  }

  // 1. Ask for Target Document Path
  const targetDocPath = await vscode.window.showInputBox({
    prompt: `Enter target Document Path to store consolidated collection '${item.collectionId}'`,
    placeHolder: "parentCollection/targetDocId",
    validateInput: (v) => {
      const trimmed = v.trim();
      if (!trimmed) return "Document path cannot be empty";
      const parts = trimmed.split("/").filter(Boolean);
      if (parts.length % 2 !== 0) {
        return "Must be a document path with an even number of segments (e.g. coll/doc)";
      }
      return undefined;
    },
  });

  if (!targetDocPath) {
    return;
  }

  // 2. Ask for Target Field Name
  const targetFieldName = await vscode.window.showInputBox({
    prompt: "Enter field name to store the consolidated data in the target document",
    value: item.collectionId,
    validateInput: (v) => (v.trim() ? undefined : "Field name cannot be empty"),
  });

  if (!targetFieldName) {
    return;
  }

  // 3. Substrate format: Map (Keyed Registry) vs Array (Sequence)
  const formatPick = await vscode.window.showQuickPick(
    [
      {
        label: "$(symbol-structure) Keyed Map (Registry)",
        description: `Store as Record<string, T> where doc.id is the key`,
        asArray: false,
      },
      {
        label: "$(list-ordered) Array (Sequence)",
        description: `Store as T[] list of document objects`,
        asArray: true,
      },
    ],
    { placeHolder: "Select consolidation data structure:" }
  );

  if (!formatPick) {
    return;
  }

  // 4. Source collection cleanup option
  const deleteSource = await vscode.window.showQuickPick(
    [
      {
        label: "$(trash) Yes, delete source collection documents after consolidation",
        description: "Removes original documents from Firestore once consolidated",
        value: true,
      },
      {
        label: "$(save) No, keep source collection intact",
        description: "Leaves original collection documents unchanged",
        value: false,
      },
    ],
    { placeHolder: "Delete original collection documents after consolidation?" }
  );

  if (!deleteSource) {
    return;
  }

  // 5. Confirmation
  const confirm = await vscode.window.showWarningMessage(
    `Consolidate collection '${item.collectionId}' into '${targetDocPath}.${targetFieldName.trim()}'?`,
    { modal: true },
    "Proceed with Consolidation"
  );

  if (confirm !== "Proceed with Consolidation") {
    return;
  }

  // 6. Execute Consolidation with Progress
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Consolidating collection '${item.collectionId}' into '${targetDocPath}'...`,
      cancellable: false,
    },
    async (progress) => {
      try {
        const firestore = await ConnectionManager.getInstance().getFirestore(item.connectionId);
        const sourceColl = item.reference;
        const targetDocRef = firestore.doc(targetDocPath.trim());

        // Fetch all documents from the collection (with safety limit 500)
        progress.report({ message: "Reading collection documents..." });
        const snapshot = await sourceColl.limit(500).get();

        if (snapshot.empty) {
          vscode.window.showInformationMessage(`Collection '${item.collectionId}' has no documents.`);
          return;
        }

        let consolidatedData: any;
        if (formatPick.asArray) {
          consolidatedData = snapshot.docs.map((d) => ({
            id: d.id,
            ...d.data(),
          }));
        } else {
          consolidatedData = {};
          snapshot.docs.forEach((d) => {
            consolidatedData[d.id] = d.data();
          });
        }

        progress.report({ message: "Writing consolidated document..." });
        await targetDocRef.set(
          {
            [targetFieldName.trim()]: consolidatedData,
          },
          { merge: true }
        );

        // Delete source docs if requested (in batches of 400 to respect Firestore limit)
        if (deleteSource.value) {
          progress.report({ message: "Cleaning up source documents..." });
          const DELETE_BATCH_SIZE = 400;
          for (let i = 0; i < snapshot.docs.length; i += DELETE_BATCH_SIZE) {
            const chunk = snapshot.docs.slice(i, i + DELETE_BATCH_SIZE);
            const batch = firestore.batch();
            chunk.forEach((d) => {
              batch.delete(d.ref);
            });
            await batch.commit();
            chunk.forEach((d) => {
              documentFileSystemProvider.invalidateAndNotify(item.connectionId, d.ref.path);
            });
          }
        }

        documentFileSystemProvider.invalidateAndNotify(item.connectionId, targetDocRef.path);

        vscode.window.showInformationMessage(
          `Successfully consolidated ${snapshot.size} document(s) into '${targetDocPath}.${targetFieldName.trim()}'!`
        );

        await openPath(targetDocRef.path, item.connectionId, targetFieldName.trim());
        explorerDataProvider.refresh();
      } catch (err: any) {
        vscode.window.showErrorMessage(`Consolidation failed: ${err.message}`);
      }
    }
  );
}

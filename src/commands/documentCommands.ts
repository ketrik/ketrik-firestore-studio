import * as vscode from "vscode";
import { CollectionItem, DocumentFieldItem, DocumentItem } from "../explorer/items";
import openPath from "./openPath";
import ExplorerDataProvider from "../explorer/ExplorerDataProvider";
import { DocumentFileSystemProvider } from "../editor/DocumentFileSystemProvider";
import { ConnectionManager } from "../connections/ConnectionManager";
import { DocumentClipboard } from "../services/DocumentClipboard";
import { TemplateService } from "../services/TemplateService";
import { LocalJsonService } from "../services/LocalJsonService";
import { CostService } from "../cost/costService";
import { promptAndCleanupOrphanStorageFiles } from "../storage/storageCommands";
import { FieldPath, FieldValue } from "firebase-admin/firestore";
import { openDocumentAsTable } from "../webview/openDocumentAsTable";
import { SnapshotSyncService } from "../services/SnapshotSyncService";

/**
 * Direct 1-read document ID lookup.
 */
export async function jumpToDocumentCommand(
  item: CollectionItem,
  explorerDataProvider: ExplorerDataProvider
) {
  if (!item?.collectionId) {
    vscode.window.showErrorMessage("No collection selected.");
    return;
  }

  const docId = await vscode.window.showInputBox({
    prompt: `Jump to Document ID in '${item.collectionId}'`,
    placeHolder: "Enter Document ID (e.g. user_123, msg_abc)",
    validateInput: (v) => (v.trim() ? undefined : "Document ID cannot be empty"),
  });

  if (!docId) {
    return;
  }

  const trimmedId = docId.trim();
  const conn = ConnectionManager.getInstance().getConnection(item.connectionId);

  if (conn?.isLocalJson) {
    const colPath = item.reference?.path || item.collectionId;
    const docPath = `${colPath}/${trimmedId}`;
    const doc = LocalJsonService.getInstance().getDocument(conn, docPath);
    if (!doc) {
      const createChoice = await vscode.window.showWarningMessage(
        `Document '${trimmedId}' does not exist in local collection '${colPath}'. Would you like to create it?`,
        "Create",
        "Cancel"
      );
      if (createChoice === "Create") {
        LocalJsonService.getInstance().setDocument(conn, docPath, {});
        DocumentFileSystemProvider.getInstance().invalidateAndNotify(item.connectionId, docPath);
        await openPath(docPath, item.connectionId);
        explorerDataProvider.refreshNode(item);
      }
      return;
    }
    await openPath(docPath, item.connectionId);
    return;
  }

  try {
    const docRef = item.reference.doc(trimmedId);
    const snapshot = await docRef.get();
    if (!snapshot.exists) {
      try {
        const subcollections = await docRef.listCollections();
        if (subcollections.length > 0) {
          await openPath(docRef.path, item.connectionId);
          return;
        }
      } catch {}

      const createChoice = await vscode.window.showWarningMessage(
        `Document '${trimmedId}' does not exist in collection '${item.collectionId}'. Would you like to create it?`,
        "Create",
        "Cancel"
      );
      if (createChoice === "Create") {
        await docRef.set({});
        DocumentFileSystemProvider.getInstance().invalidateAndNotify(item.connectionId, docRef.path);
        await openPath(docRef.path, item.connectionId);
        explorerDataProvider.refreshNode(item);
      }
      return;
    }

    await openPath(docRef.path, item.connectionId);
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to retrieve document: ${err.message}`);
  }
}

/**
 * Create a new document in the collection using templates or manual JSON.
 */
export async function createDocumentCommand(
  item: CollectionItem,
  explorerDataProvider: ExplorerDataProvider
) {
  if (!item?.collectionId) {
    vscode.window.showErrorMessage("No collection selected.");
    return;
  }

  const docId = await vscode.window.showInputBox({
    prompt: "Enter Document ID (leave blank for auto-generated ID)",
    placeHolder: "Document ID",
  });

  const templates = TemplateService.getInstance().getTemplates();
  let data: any;

  if (templates.length > 0) {
    const picked = await vscode.window.showQuickPick(
      templates.map((t) => t.label),
      { placeHolder: "Select a template or ESC to enter JSON manually" }
    );

    if (picked) {
      data = templates.find((t) => t.label === picked)?.data;
    }
  }

  if (!data) {
    const json = await vscode.window.showInputBox({
      prompt: "Enter document data as JSON (press Enter to create empty document)",
      placeHolder: "{}",
      value: "{}",
    });

    if (json === undefined) {
      return;
    }

    const trimmed = json.trim();
    if (!trimmed || trimmed === "{}") {
      data = {};
    } else {
      try {
        data = JSON.parse(trimmed);
      } catch {
        vscode.window.showErrorMessage("Invalid JSON.");
        return;
      }
    }
  }

  const conn = ConnectionManager.getInstance().getConnection(item.connectionId);
  if (conn?.isLocalJson) {
    const finalDocId = docId && docId.trim() ? docId.trim() : `doc_${Date.now()}`;
    const colPath = item.reference?.path || item.collectionId;
    const docPath = `${colPath}/${finalDocId}`;
    try {
      LocalJsonService.getInstance().setDocument(conn, docPath, data);
      DocumentFileSystemProvider.getInstance().invalidateAndNotify(item.connectionId, docPath);
      await openPath(docPath, item.connectionId);
      vscode.window.showInformationMessage("Local document created!");
      explorerDataProvider.refreshNode(item);
    } catch (err: any) {
      vscode.window.showErrorMessage("Failed to create local document: " + err.message);
    }
    return;
  }

  try {
    const ref = docId ? item.reference.doc(docId) : item.reference.doc();
    await ref.set(data);
    CostService.getInstance().recordOperation(item.connectionId, "write", 1);
    DocumentFileSystemProvider.getInstance().invalidateAndNotify(item.connectionId, ref.path);
    await openPath(ref.path, item.connectionId);
    vscode.window.showInformationMessage("Document created!");
    explorerDataProvider.refreshNode(item);
  } catch (err: any) {
    vscode.window.showErrorMessage("Failed to create document: " + err.message);
  }
}

/**
 * Delete a document with optional Deep Delete of subcollections.
 */
export async function deleteDocumentCommand(
  item: DocumentItem,
  explorerDataProvider: ExplorerDataProvider
) {
  if (!item?.documentId) {
    return;
  }

  const conn = ConnectionManager.getInstance().getConnection(item.connectionId);
  if (conn?.isLocalJson) {
    const confirm = await vscode.window.showWarningMessage(
      `Are you sure you want to delete local document "${item.documentId}"?`,
      { modal: true },
      "Delete",
      "Cancel"
    );
    if (confirm !== "Delete") return;

    try {
      LocalJsonService.getInstance().deleteDocument(conn, item.reference.path);
      DocumentFileSystemProvider.getInstance().invalidateAndNotifyDocumentDeleted(item.connectionId, item.reference.path);
      vscode.window.showInformationMessage(`Deleted local document "${item.documentId}".`);
      const lastSlash = item.reference.path.lastIndexOf("/");
      const collPath = lastSlash > 0 ? item.reference.path.substring(0, lastSlash) : item.reference.path;
      const collId = collPath.split("/").pop() || collPath;
      const parentItem = new CollectionItem(collId, { id: collId, path: collPath } as any, item.connectionId);
      explorerDataProvider.refreshNode(parentItem);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to delete local document: ${err.message}`);
    }
    return;
  }

  const subcollections = await item.reference.listCollections();
  const hasSubcollections = subcollections.length > 0;

  let confirm: string | undefined;

  if (hasSubcollections) {
    confirm = await vscode.window.showWarningMessage(
      `Document "${item.label}" has ${subcollections.length} subcollection(s) (${subcollections.map((s) => s.id).join(", ")}). How would you like to delete it?`,
      { modal: true },
      "Deep Delete (Doc + Subcollections)",
      "Delete Document Only",
      "Cancel"
    );
  } else {
    confirm = await vscode.window.showWarningMessage(
      `Are you sure you want to delete the document "${item.label}"?`,
      { modal: true },
      "Delete",
      "Cancel"
    );
  }

  if (!confirm || confirm === "Cancel") {
    return;
  }

  if (confirm === "Deep Delete (Doc + Subcollections)") {
    try {
      const snap = await item.reference.get();
      if (snap.exists) {
        await promptAndCleanupOrphanStorageFiles(item.connectionId, snap.data(), item.label as string);
      }
    } catch {}

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Deep deleting document "${item.label}" and all subcollections...`,
        cancellable: false,
      },
      async () => {
        try {
          const firestore = await ConnectionManager.getInstance().getFirestore(item.connectionId);
          await firestore.recursiveDelete(item.reference);
          DocumentFileSystemProvider.getInstance().invalidateAndNotifyDocumentDeleted(item.connectionId, item.reference.path);
          vscode.window.showInformationMessage(`Deleted document "${item.label}" and all nested subcollections.`);
          const parentItem = new CollectionItem(item.reference.parent.id, item.reference.parent, item.connectionId);
          explorerDataProvider.refreshNode(parentItem);
        } catch (err: any) {
          vscode.window.showErrorMessage(`Failed deep delete: ${err.message}`);
        }
      }
    );
  } else if (confirm === "Delete" || confirm === "Delete Document Only") {
    try {
      const snap = await item.reference.get();
      if (snap.exists) {
        await promptAndCleanupOrphanStorageFiles(item.connectionId, snap.data(), item.label as string);
      }
    } catch {}

    try {
      await item.reference.delete();
      CostService.getInstance().recordOperation(item.connectionId, "delete", 1);
      DocumentFileSystemProvider.getInstance().invalidateAndNotifyDocumentDeleted(item.connectionId, item.reference.path);
      vscode.window.showInformationMessage("Document deleted!");
      const parentItem = new CollectionItem(item.reference.parent.id, item.reference.parent, item.connectionId);
      explorerDataProvider.refreshNode(parentItem);
    } catch (err: any) {
      vscode.window.showErrorMessage("Failed to delete document: " + err.message);
    }
  }
}

/**
 * Duplicate a document inside its parent collection.
 */
export async function duplicateDocumentCommand(
  item: DocumentItem,
  explorerDataProvider: ExplorerDataProvider
) {
  if (!item?.documentId) {
    vscode.window.showErrorMessage("No document selected.");
    return;
  }

  const conn = ConnectionManager.getInstance().getConnection(item.connectionId);
  const newDocId = await vscode.window.showInputBox({
    prompt: `Duplicate document "${item.documentId}"`,
    value: `${item.documentId}_copy`,
    placeHolder: "Enter new Document ID (or leave blank to auto-generate)",
  });

  if (newDocId === undefined) {
    return; // User cancelled
  }

  if (conn?.isLocalJson) {
    const lastSlash = item.reference.path.lastIndexOf("/");
    const collPath = lastSlash > 0 ? item.reference.path.substring(0, lastSlash) : item.reference.path;
    const collId = collPath.split("/").pop() || collPath;
    const finalDocId = newDocId.trim() || `doc_${Date.now()}`;
    const targetDocPath = `${collPath}/${finalDocId}`;
    try {
      const data = LocalJsonService.getInstance().getDocument(conn, item.reference.path) || {};
      LocalJsonService.getInstance().setDocument(conn, targetDocPath, JSON.parse(JSON.stringify(data)));
      DocumentFileSystemProvider.getInstance().invalidateAndNotify(item.connectionId, targetDocPath);
      vscode.window.showInformationMessage(`Local document duplicated as "${finalDocId}"!`);
      await openPath(targetDocPath, item.connectionId);
      const parentItem = new CollectionItem(collId, { id: collId, path: collPath } as any, item.connectionId);
      explorerDataProvider.refreshNode(parentItem);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to duplicate local document: ${err.message}`);
    }
    return;
  }

  const snapshot = await item.reference.get();
  if (!snapshot.exists) {
    vscode.window.showErrorMessage(`Document "${item.documentId}" does not exist.`);
    return;
  }

  try {
    const targetRef = newDocId.trim()
      ? item.reference.parent.doc(newDocId.trim())
      : item.reference.parent.doc();

    await targetRef.set(snapshot.data() || {});
    CostService.getInstance().recordOperation(item.connectionId, "write", 1);
    DocumentFileSystemProvider.getInstance().invalidateAndNotify(item.connectionId, targetRef.path);
    vscode.window.showInformationMessage(`Document duplicated as "${targetRef.id}"!`);
    await openPath(targetRef.path, item.connectionId);
    const parentItem = new CollectionItem(item.reference.parent.id, item.reference.parent, item.connectionId);
    explorerDataProvider.refreshNode(parentItem);
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to duplicate document: ${err.message}`);
  }
}

/**
 * Copy document to internal studio clipboard buffer.
 */
export async function copyDocumentCommand(item: DocumentItem) {
  if (!item?.documentId) {
    vscode.window.showErrorMessage("No document selected.");
    return;
  }

  const conn = ConnectionManager.getInstance().getConnection(item.connectionId);
  if (conn?.isLocalJson) {
    const data = LocalJsonService.getInstance().getDocument(conn, item.reference.path);
    if (!data) {
      vscode.window.showErrorMessage(`Local document "${item.documentId}" does not exist.`);
      return;
    }

    DocumentClipboard.getInstance().set({
      sourceDocId: item.documentId,
      sourcePath: item.reference.path,
      sourceConnectionId: item.connectionId,
      data: JSON.parse(JSON.stringify(data)),
    });

    vscode.window.showInformationMessage(
      `Local document "${item.documentId}" copied to Firestore Studio clipboard.`
    );
    return;
  }

  try {
    const snapshot = await item.reference.get();
    if (!snapshot.exists) {
      vscode.window.showErrorMessage(`Document "${item.documentId}" does not exist.`);
      return;
    }

    DocumentClipboard.getInstance().set({
      sourceDocId: item.documentId,
      sourcePath: item.reference.path,
      sourceConnectionId: item.connectionId,
      data: snapshot.data() || {},
    });

    vscode.window.showInformationMessage(
      `Document "${item.documentId}" copied to Firestore Studio clipboard.`
    );
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to copy document: ${err.message}`);
  }
}

/**
 * Paste copied document into a target collection or into a Map/Array field.
 */
export async function pasteDocumentCommand(
  item: CollectionItem | DocumentFieldItem,
  explorerDataProvider: ExplorerDataProvider,
  documentFileSystemProvider: DocumentFileSystemProvider
) {
  if (!item) {
    vscode.window.showErrorMessage("No target selected.");
    return;
  }

  const clipboard = DocumentClipboard.getInstance().get();
  if (!clipboard) {
    vscode.window.showWarningMessage(
      "No document in Firestore Studio clipboard. Copy a document first."
    );
    return;
  }

  // Case A: Pasting into an in-document Map/Array field (Dual-Contract cross-substrate paste)
  if (item instanceof DocumentFieldItem) {
    if (!item.parentDocRef || !item.fieldName) {
      return;
    }

    const isArray = Array.isArray(item.value);
    const prompt = `Paste document as entry into Map "${item.fieldName}"`;

    const entryKey = isArray
      ? undefined
      : await vscode.window.showInputBox({
          prompt,
          value: clipboard.sourceDocId,
          placeHolder: "Enter key / ID for this entry",
        });

    if (!isArray && entryKey === undefined) {
      return; // cancelled
    }

    const segments = item.pathSegments && item.pathSegments.length > 0 ? item.pathSegments : [item.fieldName];
    const fullFieldPath = item.fullFieldPath || segments.join(".");

    const conn = ConnectionManager.getInstance().getConnection(item.connectionId);
    if (conn?.isLocalJson) {
      const key = entryKey?.trim() || clipboard.sourceDocId;
      const currentDoc = LocalJsonService.getInstance().getDocument(conn, item.parentDocRef.path) || {};
      let cur = currentDoc;
      for (const p of segments) {
        cur = cur?.[p];
      }
      if (isArray) {
        const arr = Array.isArray(cur) ? cur : [];
        arr.push(clipboard.data);
        LocalJsonService.getInstance().updateField(conn, item.parentDocRef.path, fullFieldPath, arr);
        vscode.window.showInformationMessage(`Appended document to local Array "${fullFieldPath}"!`);
      } else {
        const map = cur && typeof cur === "object" ? cur : {};
        map[key] = clipboard.data;
        LocalJsonService.getInstance().updateField(conn, item.parentDocRef.path, fullFieldPath, map);
        vscode.window.showInformationMessage(`Pasted document as key "${key}" into local Map "${fullFieldPath}"!`);
      }
      documentFileSystemProvider.invalidateAndNotify(item.connectionId, item.parentDocRef.path);
      explorerDataProvider.refreshNode(item);
      return;
    }

    try {
      const key = entryKey?.trim() || clipboard.sourceDocId;
      if (isArray) {
        await item.parentDocRef.update(
          new FieldPath(...segments),
          FieldValue.arrayUnion(clipboard.data)
        );
        CostService.getInstance().recordOperation(item.connectionId, "write", 1);
        vscode.window.showInformationMessage(
          `Appended document to Array "${fullFieldPath}"!`
        );
      } else {
        await item.parentDocRef.update(
          new FieldPath(...segments, key),
          clipboard.data
        );
        CostService.getInstance().recordOperation(item.connectionId, "write", 1);
        vscode.window.showInformationMessage(
          `Pasted document as key "${key}" into Map "${fullFieldPath}"!`
        );
      }

      documentFileSystemProvider.invalidateAndNotify(item.connectionId, item.parentDocRef.path);
      explorerDataProvider.refreshNode(item);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to paste into field: ${err.message}`);
    }
    return;
  }

  // Case B: Pasting into a discrete Collection
  if (!item.collectionId) {
    vscode.window.showErrorMessage("No target collection selected.");
    return;
  }

  const targetDocId = await vscode.window.showInputBox({
    prompt: `Paste document into collection "${item.collectionId}"`,
    value: clipboard.sourceDocId,
    placeHolder: "Enter Document ID (or leave blank for auto-generated ID)",
  });

  if (targetDocId === undefined) {
    return; // User cancelled
  }

  const conn = ConnectionManager.getInstance().getConnection(item.connectionId);
  const colPath = item.reference?.path || item.collectionId;
  if (conn?.isLocalJson) {
    const finalDocId = targetDocId.trim() || `doc_${Date.now()}`;
    const docPath = `${colPath}/${finalDocId}`;
    try {
      LocalJsonService.getInstance().setDocument(conn, docPath, clipboard.data);
      documentFileSystemProvider.invalidateAndNotify(item.connectionId, docPath);
      vscode.window.showInformationMessage(
        `Pasted local document "${finalDocId}" into "${colPath}"!`
      );
      await openPath(docPath, item.connectionId);
      explorerDataProvider.refreshNode(item);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to paste local document: ${err.message}`);
    }
    return;
  }

  try {
    const targetRef = targetDocId.trim()
      ? item.reference.doc(targetDocId.trim())
      : item.reference.doc();

    await targetRef.set(clipboard.data);
    CostService.getInstance().recordOperation(item.connectionId, "write", 1);
    DocumentFileSystemProvider.getInstance().invalidateAndNotify(item.connectionId, targetRef.path);
    vscode.window.showInformationMessage(
      `Pasted document "${targetRef.id}" into "${item.collectionId}"!`
    );
    await openPath(targetRef.path, item.connectionId);
    explorerDataProvider.refreshNode(item);
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to paste document: ${err.message}`);
  }
}

/**
 * Copy formatted JSON of a document straight to the OS clipboard.
 */
export async function copyDocumentJsonCommand(item: DocumentItem) {
  if (!item?.documentId) {
    vscode.window.showErrorMessage("No document selected.");
    return;
  }

  const conn = ConnectionManager.getInstance().getConnection(item.connectionId);
  if (conn?.isLocalJson) {
    const data = LocalJsonService.getInstance().getDocument(conn, item.reference.path) || {};
    const jsonText = JSON.stringify(data, null, 2);
    await vscode.env.clipboard.writeText(jsonText);
    vscode.window.showInformationMessage(`Copied local document JSON to clipboard.`);
    return;
  }

  try {
    const snapshot = await item.reference.get();
    if (!snapshot.exists) {
      try {
        const subcollections = await item.reference.listCollections();
        if (subcollections.length === 0) {
          vscode.window.showErrorMessage(`Document "${item.documentId}" does not exist.`);
          return;
        }
      } catch {
        vscode.window.showErrorMessage(`Document "${item.documentId}" does not exist.`);
        return;
      }
    }

    const jsonText = JSON.stringify(snapshot.exists ? snapshot.data() || {} : {}, null, 2);
    await vscode.env.clipboard.writeText(jsonText);
    vscode.window.showInformationMessage(`Copied document JSON to clipboard.`);
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to copy JSON: ${err.message}`);
  }
}

/**
 * Prompt to filter documents in a collection by ID prefix/substring or keyword.
 */
export async function filterCollectionCommand(
  item: CollectionItem,
  explorerDataProvider: ExplorerDataProvider
) {
  if (!item?.collectionId || !item?.reference?.path) {
    vscode.window.showErrorMessage("No collection selected.");
    return;
  }

  const currentFilter = explorerDataProvider.getCollectionFilter(item.connectionId, item.reference.path) || "";
  const input = await vscode.window.showInputBox({
    prompt: `Filter documents in collection '${item.collectionId}'`,
    value: currentFilter,
    placeHolder: "Enter Doc ID prefix/substring or keyword (leave blank to clear)...",
  });

  if (input === undefined) {
    return;
  }

  const trimmed = input.trim();
  if (!trimmed) {
    explorerDataProvider.clearCollectionFilter(item.connectionId, item.reference.path);
    vscode.window.showInformationMessage(`Filter cleared for collection '${item.collectionId}'`);
  } else {
    explorerDataProvider.setCollectionFilter(item.connectionId, item.reference.path, trimmed);
    vscode.window.showInformationMessage(`Filtered '${item.collectionId}' by "${trimmed}"`);
  }
  explorerDataProvider.refreshNode(item);
}

/**
 * Clear any active filter on a collection.
 */
export async function clearCollectionFilterCommand(
  item: CollectionItem,
  explorerDataProvider: ExplorerDataProvider
) {
  if (!item?.reference?.path) {
    return;
  }

  explorerDataProvider.clearCollectionFilter(item.connectionId, item.reference.path);
  vscode.window.showInformationMessage(`Filter cleared for collection '${item.collectionId || item.reference.path}'`);
  explorerDataProvider.refreshNode(item);
}

/**
 * Open a Document as an interactive Table webview.
 */
export async function openDocumentAsTableCommand(
  itemOrUri?: DocumentItem | vscode.Uri | any,
  explorerDataProvider?: ExplorerDataProvider
) {
  if (itemOrUri instanceof DocumentItem) {
    await openDocumentAsTable(itemOrUri, explorerDataProvider);
    return;
  }

  if (itemOrUri instanceof vscode.Uri) {
    if (itemOrUri.scheme === "file" || itemOrUri.fsPath) {
      const binding = SnapshotSyncService.getInstance().getBinding(itemOrUri.fsPath);
      if (binding) {
        await openDocumentAsTable({ connectionId: binding.connectionId, docPath: binding.docPath }, explorerDataProvider);
        return;
      }
    }
    if (itemOrUri.scheme === "ketrik-firestore-studio") {
      const parsed = DocumentFileSystemProvider.getInstance().parseUri(itemOrUri);
      await openDocumentAsTable({ connectionId: parsed.connectionId, docPath: parsed.docPath }, explorerDataProvider);
      return;
    }
    const connectionId = itemOrUri.authority || "default";
    let rawPath = itemOrUri.path.replace(/^\//, "");
    if (rawPath.endsWith(".json")) {
      rawPath = rawPath.slice(0, -5);
    }
    await openDocumentAsTable({ connectionId, docPath: rawPath }, explorerDataProvider);
    return;
  }

  if (itemOrUri && typeof itemOrUri === "object" && itemOrUri.reference?.path) {
    await openDocumentAsTable(itemOrUri, explorerDataProvider);
    return;
  }

  // Check active text editor
  const activeEditor = vscode.window.activeTextEditor;
  if (activeEditor) {
    const uri = activeEditor.document.uri;
    if (uri.scheme === "ketrik-firestore-studio") {
      const parsed = DocumentFileSystemProvider.getInstance().parseUri(uri);
      await openDocumentAsTable({ connectionId: parsed.connectionId, docPath: parsed.docPath }, explorerDataProvider);
      return;
    }
    const binding = SnapshotSyncService.getInstance().getBinding(uri.fsPath);
    if (binding) {
      await openDocumentAsTable({ connectionId: binding.connectionId, docPath: binding.docPath }, explorerDataProvider);
      return;
    }
  }

  // Prompt user for connection and document path
  const connectionManager = ConnectionManager.getInstance();
  const connections = connectionManager.getConnections();
  if (connections.length === 0) {
    vscode.window.showWarningMessage("No Firestore connections configured.");
    return;
  }

  let connectionId = connections[0].id;
  if (connections.length > 1) {
    const pick = await vscode.window.showQuickPick(
      connections.map((c) => ({ label: c.name, description: c.id, connectionId: c.id })),
      { placeHolder: "Select Firestore connection" }
    );
    if (!pick) return;
    connectionId = pick.connectionId;
  }

  const pathInput = await vscode.window.showInputBox({
    prompt: "Enter Firestore document path to open as table",
    placeHolder: "e.g. users/alice or dashboard/navigation/board/metadata",
    validateInput: (v) => {
      const parts = v.trim().replace(/^\//, "").split("/").filter(Boolean);
      if (parts.length === 0) return "Document path cannot be empty";
      if (parts.length % 2 !== 0) return "Document path must have an even number of segments (collection/doc)";
      return undefined;
    },
  });

  if (!pathInput) return;
  const cleanPath = pathInput.trim().replace(/^\//, "");
  await openDocumentAsTable({ connectionId, docPath: cleanPath }, explorerDataProvider);
}



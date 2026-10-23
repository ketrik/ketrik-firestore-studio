import * as vscode from "vscode";
import { CollectionItem, ConnectionTreeItem, DocumentItem } from "../explorer/items";
import openPath from "./openPath";
import { openCollectionAsTable } from "../webview/openCollectionAsTable.js";
import { openGraphCanvas } from "../webview/openGraphCanvas.js";
import { ConnectionManager } from "../connections/ConnectionManager";
import { DocumentFileSystemProvider } from "../editor/DocumentFileSystemProvider";
import ExplorerDataProvider from "../explorer/ExplorerDataProvider";
import { LocalJsonService } from "../services/LocalJsonService";

/**
 * Open collection in table view.
 */
export async function openCollectionAsTableCommand(
  item?: CollectionItem | ConnectionTreeItem,
  explorerDataProvider?: ExplorerDataProvider
) {
  if (item instanceof CollectionItem) {
    await openCollectionAsTable(item, false, explorerDataProvider);
    return;
  }
  if (item && (item as any).collectionId && (item as any).connectionId) {
    await openCollectionAsTable(item as any, false, explorerDataProvider);
    return;
  }

  let connectionId: string;
  if (item instanceof ConnectionTreeItem) {
    connectionId = item.config.id;
  } else {
    const connections = ConnectionManager.getInstance().getConnections();
    if (connections.length === 0) {
      vscode.window.showInformationMessage("No connections configured. Please add a connection first.");
      return;
    }
    if (connections.length === 1) {
      connectionId = connections[0].id;
    } else {
      const picked = await vscode.window.showQuickPick(
        connections.map((c) => ({ label: c.name, description: c.id, connection: c })),
        { placeHolder: "Select connection to open collection table" }
      );
      if (!picked) return;
      connectionId = picked.connection.id;
    }
  }

  let collections: string[] = [];
  try {
    const firestore = await ConnectionManager.getInstance().getFirestore(connectionId);
    const colRefs = await firestore.listCollections();
    collections = colRefs.map((c) => c.id);
  } catch {}

  let targetCollection: string | undefined;
  if (collections.length > 0) {
    const pickItems = [
      ...collections.map((c) => ({ label: `📁 ${c}`, collectionId: c })),
      { label: "$(edit) Enter custom collection or subcollection path...", collectionId: "__custom__" },
    ];
    const picked = await vscode.window.showQuickPick(pickItems, {
      placeHolder: "Select collection to open as table",
    });
    if (!picked) return;
    if (picked.collectionId === "__custom__") {
      targetCollection = await vscode.window.showInputBox({
        title: "Open Collection as Table",
        prompt: "Enter collection or subcollection path (e.g. users, or users/123/orders)",
        placeHolder: "users",
        validateInput: (v) => (v && v.trim() ? null : "Collection path is required"),
      });
    } else {
      targetCollection = picked.collectionId;
    }
  } else {
    targetCollection = await vscode.window.showInputBox({
      title: "Open Collection as Table",
      prompt: "Enter collection or subcollection path (e.g. users, or users/123/orders)",
      placeHolder: "users",
      validateInput: (v) => (v && v.trim() ? null : "Collection path is required"),
    });
  }

  if (!targetCollection || !targetCollection.trim()) return;

  const trimmed = targetCollection.trim();
  const collId = trimmed.includes("/") ? trimmed.split("/").pop()! : trimmed;

  await openCollectionAsTable(
    {
      connectionId,
      collectionId: collId,
      collectionPath: trimmed,
    },
    false,
    explorerDataProvider
  );
}

/**
 * Open Collection Group in table view across all matching subcollections.
 */
export async function queryCollectionGroupCommand(
  item?: ConnectionTreeItem | CollectionItem,
  explorerDataProvider?: ExplorerDataProvider
): Promise<void> {
  let connectionId: string;
  let defaultCollectionId = "";

  if (item instanceof CollectionItem) {
    connectionId = item.connectionId;
    defaultCollectionId = item.collectionId;
  } else if (item instanceof ConnectionTreeItem) {
    connectionId = item.config.id;
  } else {
    const connections = ConnectionManager.getInstance().getConnections();
    if (connections.length === 0) {
      vscode.window.showInformationMessage("No connections configured. Please add a connection first.");
      return;
    }
    if (connections.length === 1) {
      connectionId = connections[0].id;
    } else {
      const picked = await vscode.window.showQuickPick(
        connections.map((c) => ({ label: c.name, description: c.id, connection: c })),
        { placeHolder: "Select connection to query collection group" }
      );
      if (!picked) return;
      connectionId = picked.connection.id;
    }
  }

  const collectionId = await vscode.window.showInputBox({
    title: "Query Collection Group Across All Subcollections",
    prompt: "Enter Collection Group ID (e.g. orders, comments, messages, items)",
    value: defaultCollectionId,
    placeHolder: "orders",
    validateInput: (v) => (v && v.trim().length > 0 ? null : "Collection Group ID cannot be empty"),
  });

  if (!collectionId) {
    return;
  }

  await openCollectionAsTable(
    {
      connectionId,
      collectionId: collectionId.trim(),
      isCollectionGroup: true,
    },
    true,
    explorerDataProvider
  );
}

/**
 * Add a new collection under a connection or document.
 */
export async function addCollectionCommand(
  item: ConnectionTreeItem | DocumentItem,
  explorerDataProvider: ExplorerDataProvider
) {
  let firestore: import("firebase-admin/firestore").Firestore;
  let connectionId: string;
  let parentPath: string | null;

  try {
    if (item instanceof ConnectionTreeItem) {
      firestore = await ConnectionManager.getInstance().getFirestore(item.config.id);
      connectionId = item.config.id;
      parentPath = null;
    } else if (item instanceof DocumentItem) {
      firestore = await ConnectionManager.getInstance().getFirestore(item.connectionId);
      connectionId = item.connectionId;
      parentPath = item.reference.path;
    } else {
      vscode.window.showErrorMessage("Select a connection or a document to add a collection under.");
      return;
    }
  } catch (err: any) {
    vscode.window.showErrorMessage("Failed to connect: " + err.message);
    return;
  }

  const collectionId = await vscode.window.showInputBox({
    prompt: "Enter Collection ID",
    placeHolder: "my-collection",
    validateInput: (v) => (v.trim() ? undefined : "Collection ID cannot be empty"),
  });
  if (!collectionId) {
    return;
  }

  const docId = await vscode.window.showInputBox({
    prompt: "Enter initial Document ID (leave blank for auto-generated ID)",
    placeHolder: "Document ID",
  });
  if (docId === undefined) {
    return;
  }

  const json = await vscode.window.showInputBox({
    prompt: "Enter initial document data as JSON",
    placeHolder: '{"field1": "value1"}',
    value: "{}",
  });
  if (json === undefined) {
    return;
  }

  let data: any;
  try {
    data = JSON.parse(json || "{}");
  } catch {
    vscode.window.showErrorMessage("Invalid JSON.");
    return;
  }

  try {
    const collRef = parentPath
      ? firestore.doc(parentPath).collection(collectionId.trim())
      : firestore.collection(collectionId.trim());
    const docRef = docId.trim() ? collRef.doc(docId.trim()) : collRef.doc();
    await docRef.set(data);
    DocumentFileSystemProvider.getInstance().invalidateAndNotify(connectionId, docRef.path);
    vscode.window.showInformationMessage(`Collection '${collectionId.trim()}' created!`);
    await openPath(docRef.path, connectionId);
    explorerDataProvider.refreshNode(item);
  } catch (err: any) {
    vscode.window.showErrorMessage("Failed to create collection: " + err.message);
  }
}

/**
 * Open interactive Data Graph Canvas for a collection or document.
 */
export async function openDataGraphCommand(item?: any) {
  await openGraphCanvas(item);
}

/**
 * Permanently delete a collection and all documents / subcollections within it.
 */
export async function deleteCollectionCommand(
  item: CollectionItem,
  explorerDataProvider: ExplorerDataProvider
): Promise<void> {
  if (!item?.collectionId) {
    return;
  }

  const connectionManager = ConnectionManager.getInstance();
  const conn = connectionManager.getConnection(item.connectionId);
  const connName = conn?.name || item.connectionId;
  const collPath = item.reference?.path || item.collectionId;

  const confirm = await vscode.window.showWarningMessage(
    `Are you sure you want to permanently delete collection "${item.collectionId}" and all its documents from "${connName}"?\n\nPath: ${collPath}\n\n⚠️ This action is irreversible!`,
    { modal: true },
    "Delete Collection",
    "Cancel"
  );

  if (confirm !== "Delete Collection") {
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Deleting collection "${item.collectionId}" from "${connName}"...`,
      cancellable: false,
    },
    async () => {
      try {
        if (conn?.isLocalJson) {
          LocalJsonService.getInstance().deleteCollection(conn, item.collectionId);
        } else {
          const firestore = await connectionManager.getFirestore(item.connectionId);
          await firestore.recursiveDelete(item.reference);
        }

        DocumentFileSystemProvider.getInstance().invalidateAndNotifyCollectionDeleted(item.connectionId, collPath);
        vscode.window.showInformationMessage(`Successfully deleted collection "${item.collectionId}".`);
        explorerDataProvider.refresh();
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to delete collection: ${err.message}`);
      }
    }
  );
}

/**
 * Select and batch-delete multiple collections from a connection.
 */
export async function deleteMultipleCollectionsCommand(
  item?: ConnectionTreeItem | CollectionItem,
  explorerDataProvider?: ExplorerDataProvider
): Promise<void> {
  const connectionManager = ConnectionManager.getInstance();
  const connections = connectionManager.getConnections();

  if (connections.length === 0) {
    vscode.window.showWarningMessage("No connections configured.");
    return;
  }

  let connectionId: string | undefined;
  let preSelectedColl: string | undefined;

  if (item instanceof ConnectionTreeItem) {
    connectionId = item.config.id;
  } else if (item instanceof CollectionItem) {
    connectionId = item.connectionId;
    preSelectedColl = item.collectionId;
  } else {
    const pick = await vscode.window.showQuickPick(
      connections.map((c) => ({
        label: `$(database) ${c.name}`,
        description: c.isLocalJson ? "Local JSON" : c.isEmulator ? "Emulator" : c.projectId || "Cloud",
        config: c,
      })),
      { title: "Select Connection to Delete Collections From" }
    );
    if (!pick) return;
    connectionId = pick.config.id;
  }

  const conn = connectionManager.getConnection(connectionId);
  if (!conn) {
    vscode.window.showErrorMessage("Connection not found.");
    return;
  }

  let collections: string[] = [];
  if (conn.isLocalJson) {
    collections = LocalJsonService.getInstance().listCollections(conn);
  } else {
    try {
      const firestore = await connectionManager.getFirestore(conn.id);
      const refs = await firestore.listCollections();
      collections = refs.map((r) => r.id);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to list collections: ${err.message}`);
      return;
    }
  }

  if (collections.length === 0) {
    vscode.window.showInformationMessage(`No collections found in "${conn.name}".`);
    return;
  }

  const picks = await vscode.window.showQuickPick(
    collections.map((id) => ({
      label: `$(folder) ${id}`,
      description: "Collection",
      collectionId: id,
      picked: preSelectedColl ? id === preSelectedColl : false,
    })),
    {
      title: `Select Collections to Permanently Delete from '${conn.name}'`,
      placeHolder: "Choose one or more collections to delete (Space to toggle)",
      canPickMany: true,
    }
  );

  if (!picks || picks.length === 0) {
    return;
  }

  const selectedIds = picks.map((p) => p.collectionId);
  const collListStr = selectedIds.join(", ");

  const confirm = await vscode.window.showWarningMessage(
    `Are you sure you want to permanently delete ${selectedIds.length} collection(s) (${collListStr}) from "${conn.name}"?\n\n⚠️ ALL DOCUMENTS AND SUBCOLLECTIONS WILL BE DESTROYED! This action cannot be undone.`,
    { modal: true },
    `Delete ${selectedIds.length} Collection(s)`,
    "Cancel"
  );

  if (confirm !== `Delete ${selectedIds.length} Collection(s)`) {
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Deleting ${selectedIds.length} collection(s) from "${conn.name}"...`,
      cancellable: false,
    },
    async (progress) => {
      try {
        let deletedCount = 0;
        const total = selectedIds.length;

        if (conn.isLocalJson) {
          for (let i = 0; i < total; i++) {
            const collId = selectedIds[i];
            progress.report({
              message: `[${i + 1}/${total}] Deleting '${collId}'...`,
              increment: (1 / total) * 100,
            });
            LocalJsonService.getInstance().deleteCollection(conn, collId);
            DocumentFileSystemProvider.getInstance().invalidateAndNotifyCollectionDeleted(conn.id, collId);
            deletedCount++;
          }
        } else {
          const firestore = await connectionManager.getFirestore(conn.id);
          for (let i = 0; i < total; i++) {
            const collId = selectedIds[i];
            progress.report({
              message: `[${i + 1}/${total}] Deleting '${collId}'...`,
              increment: (1 / total) * 100,
            });
            const collRef = firestore.collection(collId);
            await firestore.recursiveDelete(collRef);
            DocumentFileSystemProvider.getInstance().invalidateAndNotifyCollectionDeleted(conn.id, collId);
            deletedCount++;
          }
        }

        vscode.window.showInformationMessage(
          `Successfully deleted ${deletedCount} collection(s) from "${conn.name}".`
        );
        if (explorerDataProvider) {
          explorerDataProvider.refresh();
        }
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to delete collections: ${err.message}`);
      }
    }
  );
}

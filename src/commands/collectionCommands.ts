import * as vscode from "vscode";
import { CollectionItem, ConnectionTreeItem, DocumentItem } from "../explorer/items";
import openPath from "./openPath";
import { openCollectionAsTable } from "../webview/openCollectionAsTable.js";
import { openGraphCanvas } from "../webview/openGraphCanvas.js";
import { ConnectionManager } from "../connections/ConnectionManager";
import { DocumentFileSystemProvider } from "../editor/DocumentFileSystemProvider";
import ExplorerDataProvider from "../explorer/ExplorerDataProvider";
import { LocalJsonService } from "../services/LocalJsonService";
import { CostService } from "../cost/costService";
import {
  confirmProductionAction,
  getEnvironmentWarningPrefix,
  recursiveDeleteWithCount,
} from "../utils/deleteUtils";

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
  let connectionId: string;
  let parentPath: string | null;

  if (item instanceof ConnectionTreeItem) {
    connectionId = item.config.id;
    parentPath = null;
  } else if (item instanceof DocumentItem) {
    connectionId = item.connectionId;
    parentPath = item.reference.path;
  } else {
    vscode.window.showErrorMessage("Select a connection or a document to add a collection under.");
    return;
  }

  if (!ConnectionManager.getInstance().ensureWritable(connectionId, "create collections")) {
    return;
  }
  const conn = ConnectionManager.getInstance().getConnection(connectionId);

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

  if (conn?.isLocalJson) {
    const collId = collectionId.trim();
    const finalDocId = docId.trim() || `doc_${Date.now()}`;
    const fullCollPath = parentPath ? `${parentPath}/${collId}` : collId;
    const docPath = `${fullCollPath}/${finalDocId}`;
    try {
      LocalJsonService.getInstance().setDocument(conn, docPath, data);
      DocumentFileSystemProvider.getInstance().invalidateAndNotify(connectionId, docPath);
      vscode.window.showInformationMessage(`Collection '${collId}' created!`);
      await openPath(docPath, connectionId);
      explorerDataProvider.refreshNode(item);
    } catch (err: any) {
      vscode.window.showErrorMessage("Failed to create local collection: " + err.message);
    }
    return;
  }

  try {
    const firestore = await ConnectionManager.getInstance().getFirestore(connectionId);
    const collRef = parentPath
      ? firestore.doc(parentPath).collection(collectionId.trim())
      : firestore.collection(collectionId.trim());
    const docRef = docId.trim() ? collRef.doc(docId.trim()) : collRef.doc();
    await docRef.set(data);
    CostService.getInstance().recordOperation(connectionId, "write", 1);
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
  if (!connectionManager.ensureWritable(item.connectionId, "delete collections")) {
    return;
  }
  const conn = connectionManager.getConnection(item.connectionId);
  const connName = conn?.name || item.connectionId;
  const collPath = item.reference?.path || item.collectionId;
  const envPrefix = getEnvironmentWarningPrefix(item.connectionId);

  let preflightCount: number | undefined;
  try {
    if (conn?.isLocalJson) {
      preflightCount = LocalJsonService.getInstance().listDocuments(conn, collPath).length;
    } else if (item.reference) {
      const snap = await item.reference.count().get();
      preflightCount = snap.data().count;
      CostService.getInstance().recordOperation(
        item.connectionId,
        "read",
        Math.max(1, Math.ceil(preflightCount / 1000))
      );
    }
  } catch {
    preflightCount = undefined;
  }

  const countLine =
    preflightCount !== undefined
      ? `\nTop-level documents: ~${preflightCount.toLocaleString()}`
      : "";
  const storageNote = !conn?.isLocalJson
    ? "\nNote: Cloud Storage files referenced inside this collection are not automatically deleted."
    : "";

  const confirm = await vscode.window.showWarningMessage(
    `${envPrefix}Are you sure you want to permanently delete collection "${item.collectionId}" and all its documents from "${connName}"?\n\nPath: ${collPath}${countLine}${storageNote}\n\n⚠️ This action is irreversible!`,
    { modal: true },
    "Delete Collection",
    "Cancel"
  );

  if (confirm !== "Delete Collection") {
    return;
  }

  const confirmedProd = await confirmProductionAction({
    connectionId: item.connectionId,
    actionLabel: "Delete Collection",
    targetSummary: `collection '${collPath}'`,
    expectedInput: item.collectionId,
  });
  if (!confirmedProd) {
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Deleting collection "${item.collectionId}" from "${connName}"...`,
      cancellable: false,
    },
    async (progress) => {
      try {
        let deletedCount = 0;
        if (conn?.isLocalJson) {
          LocalJsonService.getInstance().deleteCollection(conn, collPath);
        } else {
          const firestore = await connectionManager.getFirestore(item.connectionId);
          deletedCount = await recursiveDeleteWithCount(
            firestore,
            item.reference,
            item.connectionId,
            (count) => {
              if (count === 1 || count % 10 === 0) {
                progress.report({
                  message: `Deleted ${count.toLocaleString()} document(s)...`,
                });
              }
            }
          );
        }

        DocumentFileSystemProvider.getInstance().invalidateAndNotifyCollectionDeleted(item.connectionId, collPath);
        explorerDataProvider.clearCollectionMetadata(item.connectionId, collPath);
        vscode.window.showInformationMessage(
          conn?.isLocalJson
            ? `Successfully deleted collection "${item.collectionId}".`
            : `Successfully deleted collection "${item.collectionId}" (${deletedCount} doc(s)).`
        );
        if (item.reference?.parent) {
          explorerDataProvider.refreshNode(
            new DocumentItem(item.reference.parent.id, item.reference.parent, item.connectionId)
          );
        } else if (conn) {
          explorerDataProvider.refreshNode(new ConnectionTreeItem(conn));
        } else {
          explorerDataProvider.refresh();
        }
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
    const collPath = item.reference?.path || item.collectionId;
    if (!collPath.includes("/")) {
      preSelectedColl = item.collectionId;
    }
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
  if (!connectionManager.ensureWritable(conn.id, "delete collections")) {
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
  const envPrefix = getEnvironmentWarningPrefix(conn.id);

  let preflightTotal: number | undefined;
  if (selectedIds.length <= 20) {
    try {
      if (conn.isLocalJson) {
        preflightTotal = selectedIds.reduce(
          (sum, id) => sum + LocalJsonService.getInstance().listDocuments(conn, id).length,
          0
        );
      } else {
        const firestore = await connectionManager.getFirestore(conn.id);
        const counts = await Promise.all(
          selectedIds.map(async (id) => {
            const snap = await firestore.collection(id).count().get();
            const c = snap.data().count;
            CostService.getInstance().recordOperation(
              conn.id,
              "read",
              Math.max(1, Math.ceil(c / 1000))
            );
            return c;
          })
        );
        preflightTotal = counts.reduce((sum, c) => sum + c, 0);
      }
    } catch {
      preflightTotal = undefined;
    }
  }

  const totalLine =
    preflightTotal !== undefined
      ? `\nEstimated top-level documents: ~${preflightTotal.toLocaleString()}`
      : "";
  const storageNote = !conn.isLocalJson
    ? "\nNote: Cloud Storage files referenced inside these collections are not automatically deleted."
    : "";

  const confirm = await vscode.window.showWarningMessage(
    `${envPrefix}Are you sure you want to permanently delete ${selectedIds.length} collection(s) (${collListStr}) from "${conn.name}"?${totalLine}${storageNote}\n\n⚠️ ALL DOCUMENTS AND SUBCOLLECTIONS WILL BE DESTROYED! This action cannot be undone.`,
    { modal: true },
    `Delete ${selectedIds.length} Collection(s)`,
    "Cancel"
  );

  if (confirm !== `Delete ${selectedIds.length} Collection(s)`) {
    return;
  }

  const confirmedProd = await confirmProductionAction({
    connectionId: conn.id,
    actionLabel: `Delete ${selectedIds.length} Collection(s)`,
    targetSummary: `${selectedIds.length} collection(s) (${collListStr})`,
    expectedInput: selectedIds.length === 1 ? selectedIds[0] : `DELETE ${selectedIds.length}`,
  });
  if (!confirmedProd) {
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Deleting ${selectedIds.length} collection(s) from "${conn.name}"...`,
      cancellable: false,
    },
    async (progress) => {
      let deletedCount = 0;
      let totalDocsDeleted = 0;
      try {
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
            explorerDataProvider?.clearCollectionMetadata(conn.id, collId);
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
            const collDeleted = await recursiveDeleteWithCount(
              firestore,
              collRef,
              conn.id,
              (count) => {
                if (count === 1 || count % 10 === 0) {
                  progress.report({
                    message: `[${i + 1}/${total}] Deleting '${collId}' (${count.toLocaleString()} doc(s))...`,
                  });
                }
              }
            );
            totalDocsDeleted += collDeleted;
            DocumentFileSystemProvider.getInstance().invalidateAndNotifyCollectionDeleted(conn.id, collId);
            explorerDataProvider?.clearCollectionMetadata(conn.id, collId);
            deletedCount++;
          }
        }

        vscode.window.showInformationMessage(
          conn.isLocalJson
            ? `Successfully deleted ${deletedCount} collection(s) from "${conn.name}".`
            : `Successfully deleted ${deletedCount} collection(s) (${totalDocsDeleted.toLocaleString()} doc(s)) from "${conn.name}".`
        );
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to delete collections: ${err.message}`);
      } finally {
        if (deletedCount > 0 && explorerDataProvider) {
          explorerDataProvider.refresh();
        }
      }
    }
  );
}

/**
 * Count documents in a collection using server-side aggregation (or local scan for Local JSON)
 * and cache the count badge directly on the Explorer tree item.
 */
export async function countCollectionDocumentsCommand(
  item: CollectionItem | undefined,
  explorerDataProvider: ExplorerDataProvider
): Promise<void> {
  if (!item?.collectionId) {
    vscode.window.showErrorMessage("No collection selected.");
    return;
  }

  const conn = ConnectionManager.getInstance().getConnection(item.connectionId);
  const collPath = item.reference?.path || item.collectionId;

  let count = 0;
  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Counting documents in '${item.collectionId}'...`,
        cancellable: false,
      },
      async () => {
        if (conn?.isLocalJson) {
          count = LocalJsonService.getInstance().listDocuments(conn, collPath).length;
        } else {
          const snap = await item.reference.count().get();
          count = snap.data().count;
          CostService.getInstance().recordOperation(
            item.connectionId,
            "read",
            Math.max(1, Math.ceil(count / 1000))
          );
        }
        explorerDataProvider.setCollectionCount(item.connectionId, collPath, count);
      }
    );

    const label = conn?.isLocalJson ? "Local collection" : "Collection";
    const choice = await vscode.window.showInformationMessage(
      `${label} '${collPath}' has ${count.toLocaleString()} document(s).`,
      "Open as Table"
    );
    if (choice === "Open as Table") {
      await openCollectionAsTableCommand(item, explorerDataProvider);
    }
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to count documents in '${collPath}': ${err.message}`);
  }
}

/**
 * Open a Collection Table with Real-Time Live Watch mode automatically enabled.
 */
export async function openCollectionLiveWatchCommand(
  item?: CollectionItem,
  explorerDataProvider?: ExplorerDataProvider
): Promise<void> {
  if (!item?.collectionId) {
    vscode.window.showErrorMessage("No collection selected.");
    return;
  }

  const conn = ConnectionManager.getInstance().getConnection(item.connectionId);
  if (conn?.isLocalJson) {
    vscode.window.showWarningMessage(
      "Live Watch is only supported for Cloud Firestore and Firebase Emulator connections."
    );
    return;
  }

  await openCollectionAsTable(
    {
      connectionId: item.connectionId,
      collectionId: item.collectionId,
      collectionPath: item.reference?.path || item.collectionId,
      reference: item.reference,
      autoStartLiveWatch: true,
    },
    false,
    explorerDataProvider
  );
}

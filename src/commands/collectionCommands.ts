import * as vscode from "vscode";
import { CollectionItem, ConnectionTreeItem, DocumentItem } from "../explorer/items";
import openPath from "./openPath";
import { openCollectionAsTable } from "../webview/openCollectionAsTable.js";
import { openGraphCanvas } from "../webview/openGraphCanvas.js";
import { ConnectionManager } from "../connections/ConnectionManager";
import { DocumentFileSystemProvider } from "../editor/DocumentFileSystemProvider";
import ExplorerDataProvider from "../explorer/ExplorerDataProvider";

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

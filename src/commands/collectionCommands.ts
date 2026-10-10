import * as vscode from "vscode";
import { CollectionItem, ConnectionTreeItem, DocumentItem } from "../explorer/items";
import openPath from "./openPath";
import { openCollectionAsTable } from "../webview/openCollectionAsTable";
import { ConnectionManager } from "../connections/ConnectionManager";
import ExplorerDataProvider from "../explorer/ExplorerDataProvider";

/**
 * Open collection in table view.
 */
export function openCollectionAsTableCommand(item: CollectionItem) {
  openCollectionAsTable(item);
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
    vscode.window.showInformationMessage(`Collection '${collectionId.trim()}' created!`);
    await openPath(docRef.path, connectionId);
    explorerDataProvider.refresh();
  } catch (err: any) {
    vscode.window.showErrorMessage("Failed to create collection: " + err.message);
  }
}

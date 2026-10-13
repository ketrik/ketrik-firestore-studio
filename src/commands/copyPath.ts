import * as vscode from "vscode";
import { AuthUserItem, ConnectionTreeItem, DocumentFieldItem, Item } from "../explorer/items";

/**
 * Copy the Tree View item path to the clipboard.
 */
export default async function copyPath(item: Item) {
  if (item instanceof DocumentFieldItem) {
    const fullPath = `${item.reference.path}/${item.fieldName}`;
    await vscode.env.clipboard.writeText(fullPath);
    vscode.window.showInformationMessage(`Copied field path: ${fullPath}`);
    return;
  }

  if (item instanceof AuthUserItem) {
    const userPath = `users/${item.user.uid}`;
    await vscode.env.clipboard.writeText(userPath);
    vscode.window.showInformationMessage(`Copied user path: ${userPath}`);
    return;
  }

  if (item instanceof ConnectionTreeItem) {
    const connLabel = item.config.id;
    await vscode.env.clipboard.writeText(connLabel);
    vscode.window.showInformationMessage(`Copied connection ID: ${connLabel}`);
    return;
  }

  if (item.reference) {
    await vscode.env.clipboard.writeText(item.reference.path);
    vscode.window.showInformationMessage(`Copied path: ${item.reference.path}`);
  }
}
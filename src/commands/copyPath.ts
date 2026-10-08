import * as vscode from "vscode";
import { DocumentFieldItem, Item } from "../explorer/items";

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

  if (item.reference) {
    await vscode.env.clipboard.writeText(item.reference.path);
    vscode.window.showInformationMessage(`Copied path: ${item.reference.path}`);
  }
}
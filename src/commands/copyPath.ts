import * as vscode from "vscode";
import { Item } from "../explorer/items";

/**
 * Copy the Tree View item path to the clipboard.
 */
export default async function copyPath(item: Item) {
  if (item.reference) {
    await vscode.env.clipboard.writeText(item.reference.path);
    vscode.window.showInformationMessage(`Copied path: ${item.reference.path}`);
  }
}
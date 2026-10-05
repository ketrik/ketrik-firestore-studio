import * as vscode from "vscode";

/**
 * Open the workspace settings at the Firestore connections configuration.
 */
export default async function openServiceAccountSettings(): Promise<void> {
  await vscode.commands.executeCommand(
    "workbench.action.openSettings",
    "ketrik-firestore-studio.connections"
  );
}
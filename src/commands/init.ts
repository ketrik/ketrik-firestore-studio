import * as vscode from "vscode";
import { addConnectionCommand } from "./connectionCommands";
import { ConnectionManager } from "../connections/ConnectionManager";

/**
 * Initialize Firestore connection or open connection settings.
 */
export default async function init(): Promise<void> {
  const connections = ConnectionManager.getInstance().getConnections();
  if (connections.length === 0) {
    await addConnectionCommand();
  } else {
    await vscode.commands.executeCommand(
      "workbench.action.openSettings",
      "ketrik-firestore-studio.connections"
    );
  }
}
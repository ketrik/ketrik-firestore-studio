import * as vscode from "vscode";
import { ConnectionManager } from "../connections/ConnectionManager";
import { openDocument } from "./openDocument";

/**
 * Open a generic Firestore path. If the path is a document, it will be opened in the editor.
 */
export default async function openPath(path?: string, connectionId?: string): Promise<void> {
  const connectionManager = ConnectionManager.getInstance();
  const connections = connectionManager.getConnections();

  if (connections.length === 0) {
    vscode.window.showWarningMessage("No Firestore connections configured. Please add one first.");
    return;
  }

  if (!connectionId && !path && connections.length > 1) {
    const picked = await vscode.window.showQuickPick(
      connections.map((c) => ({
        label: c.name,
        description: c.id,
        connectionId: c.id,
      })),
      { placeHolder: "Select Firestore connection" }
    );
    if (!picked) {
      return;
    }
    connectionId = picked.connectionId;
  }

  connectionId = connectionId || connections[0]?.id || "default";

  path =
    path ??
    (await vscode.window.showInputBox({
      placeHolder: "Firestore Path (e.g., users/user123)",
      prompt: `Open path in connection '${connectionManager.getConnection(connectionId)?.name || connectionId}'`,
    }));

  if (path !== undefined && path.trim() !== "") {
    try {
      const cleanPath = path.trim().replace(/^\//, "");
      const parts = cleanPath.split("/");
      if (parts.length % 2 === 0) {
        const firestore = await connectionManager.getFirestore(connectionId);
        const doc = firestore.doc(cleanPath);
        await openDocument(doc, connectionId);
      } else {
        vscode.window.showErrorMessage("Only document paths are supported (e.g. collection/docId)");
      }
    } catch (e: any) {
      vscode.window.showErrorMessage(`Invalid path or error opening document: ${e.message}`);
    }
  }
}

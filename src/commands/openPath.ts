import * as vscode from "vscode";
import { ConnectionManager } from "../connections/ConnectionManager";
import { openDocument } from "./openDocument";

/**
 * Open a generic Firestore path. If the path is a document, it will be opened in the editor.
 */
export default async function openPath(
  path?: string,
  connectionId?: string,
  fieldPath?: string
): Promise<void> {
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
      placeHolder: "Firestore Path (e.g., users/user123 or users/user123:profile)",
      prompt: `Open path in connection '${connectionManager.getConnection(connectionId)?.name || connectionId}'`,
    }));

  if (path !== undefined && path.trim() !== "") {
    try {
      let cleanPath = path.trim().replace(/^\//, "");
      let targetField = fieldPath;

      // Also support users/user123:profile or users/user123#profile syntax from prompt
      if (!targetField && (cleanPath.includes(":") || cleanPath.includes("#"))) {
        const separator = cleanPath.includes(":") ? ":" : "#";
        const parts = cleanPath.split(separator);
        cleanPath = parts[0];
        targetField = parts[1];
      }

      const parts = cleanPath.split("/").filter(Boolean);
      // If path has an odd number >= 3 (e.g. users/user123/profile), trailing segment is fieldPath
      if (!targetField && parts.length % 2 === 1 && parts.length >= 3) {
        targetField = parts.pop();
        cleanPath = parts.join("/");
      }

      if (parts.length % 2 === 0) {
        const firestore = await connectionManager.getFirestore(connectionId);
        const doc = firestore.doc(cleanPath);
        await openDocument(doc, connectionId, targetField);
      } else {
        vscode.window.showErrorMessage("Only document paths are supported (e.g. collection/docId or collection/docId/field)");
      }
    } catch (e: any) {
      vscode.window.showErrorMessage(`Invalid path or error opening document: ${e.message}`);
    }
  }
}

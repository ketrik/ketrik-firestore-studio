import { DocumentReference } from "firebase-admin/firestore";
import * as vscode from "vscode";
import { scheme } from "../constants";

/**
 * Open a Firestore document in the editor with connection awareness and JSON syntax highlighting.
 */
export async function openDocument(
  documentReference: DocumentReference,
  connectionId?: string,
  fieldPath?: string
): Promise<void> {
  const authority = connectionId || "default";
  const targetPath = fieldPath
    ? `/${documentReference.path}/${encodeURIComponent(fieldPath)}.json`
    : `/${documentReference.path}.json`;

  const config = vscode.workspace.getConfiguration("ketrik-firestore-studio");
  const openMode = config.get<string>("openMode", "virtual");
  const hasWorkspace = !!vscode.workspace.workspaceFolders?.length;

  if (openMode === "workspace" && hasWorkspace) {
    if (fieldPath) {
      await vscode.commands.executeCommand("ketrik-firestore-studio.openAiScratchpad", {
        connectionId: connectionId || "default",
        parentDocRef: documentReference,
        fieldName: fieldPath,
        fullFieldPath: fieldPath,
      });
    } else {
      await vscode.commands.executeCommand("ketrik-firestore-studio.openAiScratchpad", {
        connectionId: connectionId || "default",
        reference: documentReference,
      });
    }
    return;
  }

  const uri = vscode.Uri.from({
    scheme,
    authority,
    path: targetPath,
  });

  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.languages.setTextDocumentLanguage(doc, "json");
  await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: true });

  const foldLevel = vscode.workspace
    .getConfiguration("ketrik-firestore-studio")
    .get<number>("initialFoldLevel", 0);

  if (foldLevel > 0) {
    try {
      await vscode.commands.executeCommand(`editor.foldLevel${foldLevel}`);
    } catch {}
  }
}

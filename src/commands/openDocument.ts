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

  const uri = vscode.Uri.from({
    scheme,
    authority,
    path: targetPath,
  });

  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.languages.setTextDocumentLanguage(doc, "json");
  await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: true });
}

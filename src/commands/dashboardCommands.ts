import * as vscode from "vscode";
import {
  decompileDashboard,
  compileDashboard,
  isRuntimeDashboard,
  isDryDashboard,
  DryDashboardDocument,
} from "../services/dashboardTranspiler";
import { DocumentItem } from "../explorer/items";
import { scheme } from "../constants";

/**
 * Command to convert between verbose runtime dashboard JSON and compact DRY format.
 */
export async function convertDashboardFormatCommand(arg?: DocumentItem | vscode.Uri) {
  let text = "";
  let targetUri: vscode.Uri | undefined;
  const activeEditor = vscode.window.activeTextEditor;

  if (arg instanceof DocumentItem) {
    targetUri = vscode.Uri.from({
      scheme,
      authority: arg.connectionId || "default",
      path: `/${arg.reference.path}.json`,
    });
    const doc = await vscode.workspace.openTextDocument(targetUri);
    text = doc.getText();
  } else if (arg instanceof vscode.Uri) {
    targetUri = arg;
    const doc = await vscode.workspace.openTextDocument(targetUri);
    text = doc.getText();
  } else if (activeEditor) {
    targetUri = activeEditor.document.uri;
    text = activeEditor.document.getText();
  } else {
    vscode.window.showWarningMessage("No active document found to convert.");
    return;
  }

  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to parse document JSON: ${err.message}`);
    return;
  }

  // Determine direction: Runtime -> DRY or DRY -> Runtime
  if (isDryDashboard(parsed)) {
    // DRY -> Runtime
    try {
      const compiled = compileDashboard(parsed as DryDashboardDocument);
      const formattedJson = JSON.stringify(compiled, null, 2);

      const action = await vscode.window.showQuickPick(
        [
          {
            label: "$(check) Replace in Current Document",
            description: "Update the open document with the compiled runtime JSON (Save to persist to Firestore)",
            action: "replace",
          },
          {
            label: "$(split-horizontal) Open in New Editor (Side-by-Side)",
            description: "View the compiled runtime JSON in a new untitled tab",
            action: "newTab",
          },
        ],
        {
          title: "Compile DRY Dashboard ➔ Runtime JSON",
          placeHolder: "Choose how to view the compiled document",
        }
      );

      if (!action) return;

      if (action.action === "replace" && activeEditor && targetUri && activeEditor.document.uri.toString() === targetUri.toString()) {
        const fullRange = new vscode.Range(
          activeEditor.document.positionAt(0),
          activeEditor.document.positionAt(text.length)
        );
        await activeEditor.edit((editBuilder) => {
          editBuilder.replace(fullRange, formattedJson);
        });
        vscode.window.showInformationMessage("Dashboard compiled to runtime JSON. Save file (Cmd+S) to commit to Firestore.");
      } else {
        const doc = await vscode.workspace.openTextDocument({
          language: "json",
          content: formattedJson,
        });
        await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside });
        vscode.window.showInformationMessage("Opened compiled runtime JSON in side editor.");
      }
    } catch (err: any) {
      vscode.window.showErrorMessage(`Compilation failed: ${err.message}`);
    }
  } else if (isRuntimeDashboard(parsed)) {
    // Runtime -> DRY
    try {
      const dry = decompileDashboard(parsed);
      const originalLines = text.split("\n").length;
      const formattedDry = JSON.stringify(dry, null, 2);
      const newLines = formattedDry.split("\n").length;

      const action = await vscode.window.showQuickPick(
        [
          {
            label: "$(split-horizontal) Open in New Editor (Side-by-Side)",
            description: `Review the compact DRY version (~${newLines} lines vs ~${originalLines} lines)`,
            action: "newTab",
          },
          {
            label: "$(replace) Replace in Current Document",
            description: "Replace the active editor buffer with the compact DRY format",
            action: "replace",
          },
        ],
        {
          title: `Convert to DRY Dashboard (${originalLines} lines ➔ ~${newLines} lines)`,
          placeHolder: "Choose how to view the decompiled format",
        }
      );

      if (!action) return;

      if (action.action === "replace" && activeEditor && targetUri && activeEditor.document.uri.toString() === targetUri.toString()) {
        const fullRange = new vscode.Range(
          activeEditor.document.positionAt(0),
          activeEditor.document.positionAt(text.length)
        );
        await activeEditor.edit((editBuilder) => {
          editBuilder.replace(fullRange, formattedDry);
        });
        vscode.window.showInformationMessage(`Converted to compact DRY format (${originalLines} ➔ ${newLines} lines).`);
      } else {
        const doc = await vscode.workspace.openTextDocument({
          language: "json",
          content: formattedDry,
        });
        await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside });
        vscode.window.showInformationMessage(`Decompiled dashboard format (${originalLines} lines ➔ ${newLines} lines).`);
      }
    } catch (err: any) {
      vscode.window.showErrorMessage(`Decompilation failed: ${err.message}`);
    }
  } else {
    vscode.window.showWarningMessage(
      "Document structure is not recognized as a dashboard format (expected groups with cardConfig, chart, or Plotly widgets)."
    );
  }
}

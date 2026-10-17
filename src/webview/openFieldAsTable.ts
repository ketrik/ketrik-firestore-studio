import * as vscode from "vscode";
import { DocumentFieldItem } from "../explorer/items";
import openPath from "../commands/openPath";
import { sortHeaders } from "./common/tableUtils";
import { getFieldTableHtml } from "./fieldTable/fieldTableHtml";

/**
 * Open a DocumentFieldItem (Record<string, T> or T[]) as an interactive virtual Collection Table.
 *
 * Implements the Dual-Contract perspective:
 * - If Record<string, T> (Keyed Map / Registry): Dictionary keys become Row IDs.
 * - If T[] (Sequence / Array): Array indices or item.id become Row IDs.
 */
// Active field table panels registry to avoid duplicate webviews and memory retention
const activeFieldPanels = new Map<string, vscode.WebviewPanel>();

export async function openFieldAsTable(item: DocumentFieldItem) {
  const panelKey = `${item.connectionId}:${item.parentDocRef.path}:${item.fieldName}`;
  const existingPanel = activeFieldPanels.get(panelKey);
  if (existingPanel) {
    existingPanel.reveal(vscode.ViewColumn.One);
    return;
  }

  const isArray = Array.isArray(item.value);
  const panelTitle = isArray
    ? `Array: ${item.fieldName} [${item.value?.length ?? 0}]`
    : `Registry: ${item.fieldName}`;

  const panel = vscode.window.createWebviewPanel(
    "firestoreFieldTable",
    panelTitle,
    vscode.ViewColumn.One,
    {
      enableScripts: true,
    }
  );
  activeFieldPanels.set(panelKey, panel);

  let rawData = item.value;
  let rows: any[] = [];
  let headers: string[] = [];

  function parseRows(data: any): { rows: any[]; headers: string[] } {
    const parsedRows: any[] = [];
    const headerSet = new Set<string>();

    if (Array.isArray(data)) {
      data.forEach((entry, index) => {
        let rowObj: any = {};
        let rowId = String(index);

        if (entry !== null && typeof entry === "object") {
          if (Buffer.isBuffer(entry) || entry instanceof Uint8Array) {
            rowObj = { value: `[Blob: ${entry.length} bytes]` };
          } else {
            rowObj = { ...entry };
            if ("id" in entry && (typeof entry.id === "string" || typeof entry.id === "number")) {
              rowId = String(entry.id);
            }
          }
        } else {
          rowObj = { value: entry };
        }

        rowObj.__id = rowId;
        rowObj.__index = index;
        rowObj.__path = `${item.parentDocRef.path}/${item.fieldName}`;

        Object.keys(rowObj).forEach((k) => {
          if (k !== "__id" && k !== "__index" && k !== "__path") {
            headerSet.add(k);
          }
        });

        parsedRows.push(rowObj);
      });
    } else if (data !== null && typeof data === "object") {
      Object.entries(data).forEach(([key, val]) => {
        let rowObj: any = {};
        if (val !== null && typeof val === "object" && !Array.isArray(val)) {
          if (Buffer.isBuffer(val) || val instanceof Uint8Array) {
            rowObj = { value: `[Blob: ${val.length} bytes]` };
          } else {
            rowObj = { ...val };
          }
        } else {
          rowObj = { value: val };
        }

        rowObj.__id = key;
        rowObj.__path = `${item.parentDocRef.path}/${item.fieldName}`;

        Object.keys(rowObj).forEach((k) => {
          if (k !== "__id" && k !== "__path") {
            headerSet.add(k);
          }
        });

        parsedRows.push(rowObj);
      });
    }

    return {
      rows: parsedRows,
      headers: sortHeaders(Array.from(headerSet)),
    };
  }

  const parsed = parseRows(rawData);
  rows = parsed.rows;
  headers = parsed.headers;

  panel.webview.html = getFieldTableHtml({
    panelTitle,
    fieldName: item.fieldName,
    connectionId: item.connectionId,
    docPath: item.parentDocRef.path,
    isArray,
  });

  const messageSubscription = panel.webview.onDidReceiveMessage(async (message) => {
    if (message.command === "ready" || message.command === "clearSearch") {
      panel.webview.postMessage({
        type: "init",
        headers,
        rows,
      });
      return;
    }

    if (message.command === "openFieldInEditor") {
      openPath(item.parentDocRef.path, item.connectionId, item.fieldName);
      return;
    }

    if (message.command === "openParentDoc") {
      openPath(item.parentDocRef.path, item.connectionId);
      return;
    }

    if (message.command === "exportJson") {
      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(`${item.fieldName}_export.json`),
        filters: { JSON: ["json"] },
      });
      if (uri) {
        try {
          await vscode.workspace.fs.writeFile(
            uri,
            Buffer.from(JSON.stringify(message.data, null, 2))
          );
          vscode.window.showInformationMessage("Exported JSON successfully!");
        } catch (err: any) {
          vscode.window.showErrorMessage(`Failed to export JSON: ${err.message}`);
        }
      }
      return;
    }
  });

  panel.onDidDispose(() => {
    activeFieldPanels.delete(panelKey);
    messageSubscription.dispose();
    rows = [];
    headers = [];
    rawData = null;
  });
}

import * as vscode from "vscode";
import { DocumentFieldItem } from "../explorer/items";
import openPath from "../commands/openPath";
import { sortHeaders, sanitizeFirestoreValue } from "./common/tableUtils";
import { getFieldTableHtml } from "./fieldTable/fieldTableHtml";
import { ConnectionManager } from "../connections/ConnectionManager";
import { CostService } from "../cost/costService";
import { LocalJsonService } from "../services/LocalJsonService";
import { DocumentFileSystemProvider } from "../editor/DocumentFileSystemProvider";
import { FieldPath } from "firebase-admin/firestore";

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
  const targetFieldPath = item.fullFieldPath || item.fieldName;
  const fieldSegments =
    item.pathSegments && item.pathSegments.length > 0
      ? item.pathSegments
      : [item.fieldName];

  const panelKey = `${item.connectionId}:${item.parentDocRef.path}:${targetFieldPath}`;
  const existingPanel = activeFieldPanels.get(panelKey);
  if (existingPanel) {
    existingPanel.reveal(vscode.ViewColumn.One);
    return;
  }

  const isArray = Array.isArray(item.value);
  const panelTitle = isArray
    ? `Array: ${targetFieldPath} [${item.value?.length ?? 0}]`
    : `Registry: ${targetFieldPath}`;

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
  // If item.value is undefined or needs fresh data from parent doc, fetch snapshot
  if (rawData === undefined && item.parentDocRef) {
    try {
      const conn = ConnectionManager.getInstance().getConnection(item.connectionId);
      if (conn?.isLocalJson) {
        const localDoc = LocalJsonService.getInstance().getDocument(conn, item.parentDocRef.path);
        if (localDoc) {
          let cur: any = localDoc;
          for (const seg of fieldSegments) {
            if (cur && typeof cur === "object" && seg in cur) {
              cur = cur[seg];
            } else {
              cur = undefined;
              break;
            }
          }
          rawData = cur;
        }
      } else {
        const firestore = await ConnectionManager.getInstance().getFirestore(item.connectionId);
        const docSnap = await firestore.doc(item.parentDocRef.path).get();
        if (docSnap.exists) {
          const docData = docSnap.data() || {};
          let cur: any = docData;
          for (const seg of fieldSegments) {
            if (cur && typeof cur === "object" && seg in cur) {
              cur = cur[seg];
            } else {
              cur = undefined;
              break;
            }
          }
          rawData = cur;
        }
      }
    } catch {}
  }

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
        rowObj.__path = `${item.parentDocRef.path}/${targetFieldPath}`;

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
        rowObj.__path = `${item.parentDocRef.path}/${targetFieldPath}`;

        Object.keys(rowObj).forEach((k) => {
          if (k !== "__id" && k !== "__path") {
            headerSet.add(k);
          }
        });

        parsedRows.push(rowObj);
      });
    }

    // Fallback: If rows exist but no properties were found (e.g. array of empty objects [{}]), add a placeholder header
    if (parsedRows.length > 0 && headerSet.size === 0) {
      headerSet.add("value");
    }

    return {
      rows: parsedRows,
      headers: sortHeaders(Array.from(headerSet)),
    };
  }

  const parsed = parseRows(rawData);
  rows = parsed.rows;
  headers = parsed.headers;

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
      openPath(item.parentDocRef.path, item.connectionId, targetFieldPath);
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

    if (message.command === "updateFieldEntry") {
      const { rowId, field, value, index } = message;
      try {
        let writeVal: any = value;
        if (
          value &&
          typeof value === "object" &&
          typeof value._seconds === "number" &&
          typeof value._nanoseconds === "number"
        ) {
          const { Timestamp } = await import("firebase-admin/firestore");
          writeVal = new Timestamp(value._seconds, value._nanoseconds);
        }

        const conn = ConnectionManager.getInstance().getConnection(item.connectionId);

        if (isArray) {
          const idx = index !== undefined ? index : Number(rowId);
          let currentArr: any[] = Array.isArray(rawData) ? [...rawData] : [];
          if (idx >= 0 && idx < currentArr.length) {
            if (typeof currentArr[idx] === "object" && currentArr[idx] !== null && field !== "value") {
              currentArr[idx] = { ...currentArr[idx], [field]: writeVal };
            } else {
              currentArr[idx] = writeVal;
            }
          }
          if (conn?.isLocalJson) {
            LocalJsonService.getInstance().updateField(
              conn,
              item.parentDocRef.path,
              fieldSegments.join("."),
              currentArr
            );
          } else {
            const firestore = await ConnectionManager.getInstance().getFirestore(item.connectionId);
            await firestore.doc(item.parentDocRef.path).update(new FieldPath(...fieldSegments), currentArr);
            CostService.getInstance().recordOperation(item.connectionId, "write", 1);
          }
          rawData = currentArr;
        } else {
          // Map
          let targetSegments: string[];
          if (field === "value" && headers.length === 1 && headers[0] === "value") {
            targetSegments = [...fieldSegments, rowId];
          } else {
            targetSegments = [...fieldSegments, rowId, field];
          }

          if (conn?.isLocalJson) {
            LocalJsonService.getInstance().updateField(
              conn,
              item.parentDocRef.path,
              targetSegments.join("."),
              writeVal
            );
          } else {
            const firestore = await ConnectionManager.getInstance().getFirestore(item.connectionId);
            await firestore.doc(item.parentDocRef.path).update(new FieldPath(...targetSegments), writeVal);
            CostService.getInstance().recordOperation(item.connectionId, "write", 1);
          }

          if (rawData && typeof rawData === "object") {
            if (field === "value" && (typeof rawData[rowId] !== "object" || rawData[rowId] === null)) {
              rawData[rowId] = writeVal;
            } else if (rawData[rowId] && typeof rawData[rowId] === "object") {
              rawData[rowId][field] = writeVal;
            }
          }
        }

        DocumentFileSystemProvider.getInstance().invalidateAndNotify(item.connectionId, item.parentDocRef.path);

        const updatedParsed = parseRows(rawData);
        rows = updatedParsed.rows;
        headers = updatedParsed.headers;

        panel.webview.postMessage({
          type: "fieldEntryUpdated",
          rowId,
          field,
          value: sanitizeFirestoreValue(writeVal),
        });
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to update entry '${rowId}': ${err.message}`);
      }
      return;
    }

    if (message.command === "deleteFieldEntry") {
      const { rowId, index } = message;
      const confirm = await vscode.window.showWarningMessage(
        `Are you sure you want to delete entry '${rowId}' from '${targetFieldPath}'?`,
        { modal: true },
        "Delete Entry",
        "Cancel"
      );
      if (confirm !== "Delete Entry") {
        return;
      }

      try {
        const conn = ConnectionManager.getInstance().getConnection(item.connectionId);
        if (isArray) {
          const idx = index !== undefined ? index : Number(rowId);
          let currentArr: any[] = Array.isArray(rawData) ? [...rawData] : [];
          if (idx >= 0 && idx < currentArr.length) {
            currentArr.splice(idx, 1);
          }
          if (conn?.isLocalJson) {
            LocalJsonService.getInstance().updateField(
              conn,
              item.parentDocRef.path,
              fieldSegments.join("."),
              currentArr
            );
          } else {
            const firestore = await ConnectionManager.getInstance().getFirestore(item.connectionId);
            await firestore.doc(item.parentDocRef.path).update(new FieldPath(...fieldSegments), currentArr);
            CostService.getInstance().recordOperation(item.connectionId, "write", 1);
          }
          rawData = currentArr;
        } else {
          // Map
          const targetSegments = [...fieldSegments, rowId];
          if (conn?.isLocalJson) {
            LocalJsonService.getInstance().updateField(
              conn,
              item.parentDocRef.path,
              targetSegments.join("."),
              undefined,
              true
            );
          } else {
            const firestore = await ConnectionManager.getInstance().getFirestore(item.connectionId);
            const { FieldValue } = await import("firebase-admin/firestore");
            await firestore
              .doc(item.parentDocRef.path)
              .update(new FieldPath(...targetSegments), FieldValue.delete());
            CostService.getInstance().recordOperation(item.connectionId, "write", 1);
          }
          if (rawData && typeof rawData === "object") {
            delete rawData[rowId];
          }
        }

        DocumentFileSystemProvider.getInstance().invalidateAndNotify(item.connectionId, item.parentDocRef.path);

        const updatedParsed = parseRows(rawData);
        rows = updatedParsed.rows;
        headers = updatedParsed.headers;

        panel.webview.postMessage({
          type: "init",
          headers,
          rows,
        });
        vscode.window.showInformationMessage(`Entry '${rowId}' deleted!`);
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to delete entry '${rowId}': ${err.message}`);
      }
      return;
    }

    if (message.command === "addFieldEntry") {
      try {
        let entryKey = "";
        if (!isArray) {
          const keyInput = await vscode.window.showInputBox({
            prompt: `Enter new key name for '${targetFieldPath}'`,
            validateInput: (v) => {
              const trimmed = v.trim();
              if (!trimmed) return "Key name cannot be empty";
              if (trimmed.includes("/")) return "Key name cannot contain '/'";
              if (rawData && typeof rawData === "object" && trimmed in rawData) {
                return `Key '${trimmed}' already exists`;
              }
              return undefined;
            },
          });
          if (!keyInput) return;
          entryKey = keyInput.trim();
        }

        const typePick = await vscode.window.showQuickPick(
          [
            { label: "$(symbol-string) String", type: "string" },
            { label: "$(symbol-number) Number", type: "number" },
            { label: "$(symbol-boolean) Boolean", type: "boolean" },
            { label: "$(calendar) Timestamp (Now)", type: "timestamp" },
            { label: "$(symbol-namespace) Object / Map ({})", type: "object" },
            { label: "$(symbol-array) Array ([])", type: "array" },
            { label: "$(json) Custom JSON", type: "json" },
          ],
          { placeHolder: `Select value type for new entry` }
        );
        if (!typePick) return;

        let entryVal: any;
        switch (typePick.type) {
          case "string": {
            const strVal = await vscode.window.showInputBox({ prompt: "Enter string value" });
            if (strVal === undefined) return;
            entryVal = strVal;
            break;
          }
          case "number": {
            const numVal = await vscode.window.showInputBox({
              prompt: "Enter numeric value",
              validateInput: (v) => (isNaN(Number(v)) ? "Must be a valid number" : undefined),
            });
            if (numVal === undefined) return;
            entryVal = Number(numVal);
            break;
          }
          case "boolean": {
            const boolPick = await vscode.window.showQuickPick([{ label: "true" }, { label: "false" }]);
            if (!boolPick) return;
            entryVal = boolPick.label === "true";
            break;
          }
          case "timestamp": {
            const { Timestamp } = await import("firebase-admin/firestore");
            entryVal = Timestamp.now();
            break;
          }
          case "object": {
            entryVal = {};
            break;
          }
          case "array": {
            entryVal = [];
            break;
          }
          case "json": {
            const jsonStr = await vscode.window.showInputBox({
              prompt: "Enter raw JSON",
              placeHolder: '{"key": "value"}',
            });
            if (jsonStr === undefined) return;
            try {
              entryVal = JSON.parse(jsonStr || "null");
            } catch {
              vscode.window.showErrorMessage("Invalid JSON value entered.");
              return;
            }
            break;
          }
        }

        const conn = ConnectionManager.getInstance().getConnection(item.connectionId);
        if (isArray) {
          let currentArr: any[] = Array.isArray(rawData) ? [...rawData] : [];
          currentArr.push(entryVal);
          if (conn?.isLocalJson) {
            LocalJsonService.getInstance().updateField(
              conn,
              item.parentDocRef.path,
              fieldSegments.join("."),
              currentArr
            );
          } else {
            const firestore = await ConnectionManager.getInstance().getFirestore(item.connectionId);
            await firestore.doc(item.parentDocRef.path).update(new FieldPath(...fieldSegments), currentArr);
            CostService.getInstance().recordOperation(item.connectionId, "write", 1);
          }
          rawData = currentArr;
        } else {
          const targetSegments = [...fieldSegments, entryKey];
          if (conn?.isLocalJson) {
            LocalJsonService.getInstance().updateField(
              conn,
              item.parentDocRef.path,
              targetSegments.join("."),
              entryVal
            );
          } else {
            const firestore = await ConnectionManager.getInstance().getFirestore(item.connectionId);
            await firestore.doc(item.parentDocRef.path).update(new FieldPath(...targetSegments), entryVal);
            CostService.getInstance().recordOperation(item.connectionId, "write", 1);
          }
          if (rawData && typeof rawData === "object") {
            rawData[entryKey] = entryVal;
          }
        }

        DocumentFileSystemProvider.getInstance().invalidateAndNotify(item.connectionId, item.parentDocRef.path);

        const updatedParsed = parseRows(rawData);
        rows = updatedParsed.rows;
        headers = updatedParsed.headers;

        panel.webview.postMessage({
          type: "init",
          headers,
          rows,
        });
        vscode.window.showInformationMessage(
          isArray ? `Item added to array!` : `Entry '${entryKey}' added to map!`
        );
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to add entry: ${err.message}`);
      }
      return;
    }
  });

  panel.webview.html = getFieldTableHtml({
    panelTitle,
    fieldName: targetFieldPath,
    connectionId: item.connectionId,
    docPath: item.parentDocRef.path,
    isArray,
  });

  // Immediate postMessage fallback in case client is already active
  panel.webview.postMessage({
    type: "init",
    headers,
    rows,
  });

  panel.onDidDispose(() => {
    activeFieldPanels.delete(panelKey);
    messageSubscription.dispose();
    rows = [];
    headers = [];
    rawData = null;
  });
}

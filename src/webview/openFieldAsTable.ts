import * as vscode from "vscode";
import { DocumentFieldItem } from "../explorer/items";
import openPath from "../commands/openPath";
import { sortHeaders, sanitizeFirestoreValue, getDefaultExportUri, safeFirestoreFieldUpdate } from "./common/tableUtils";
import { getFieldTableHtml } from "./fieldTable/fieldTableHtml";
import { ConnectionManager } from "../connections/ConnectionManager";
import { CostService } from "../cost/costService";
import { LocalJsonService } from "../services/LocalJsonService";
import { DocumentFileSystemProvider } from "../editor/DocumentFileSystemProvider";

interface FieldPanelContext {
  panel: vscode.WebviewPanel;
  headers: string[];
  rows: any[];
  rawData: any;
  isArray: boolean;
  messageSubscription?: vscode.Disposable;
}

// Active field table panels registry to avoid duplicate webviews and memory retention
const activeFieldPanels = new Map<string, FieldPanelContext>();

/**
 * Robust nested field extraction from an object hierarchy.
 */
function extractNestedValue(docData: any, targetFieldPath: string, segments: string[]): any {
  if (!docData || typeof docData !== "object") return undefined;
  if (targetFieldPath in docData) return docData[targetFieldPath];

  // 1. Try normalizedSegments
  let cur: any = docData;
  let found = true;
  for (const seg of segments) {
    if (cur && typeof cur === "object" && seg in cur) {
      cur = cur[seg];
    } else {
      found = false;
      break;
    }
  }
  if (found && cur !== undefined) return cur;

  // 2. Try dot path split if not already tried
  if (targetFieldPath.includes(".")) {
    const parts = targetFieldPath.split(".");
    let cur2: any = docData;
    let found2 = true;
    for (const p of parts) {
      if (cur2 && typeof cur2 === "object" && p in cur2) {
        cur2 = cur2[p];
      } else {
        found2 = false;
        break;
      }
    }
    if (found2 && cur2 !== undefined) return cur2;
  }

  return undefined;
}

/**
 * Open a DocumentFieldItem (Record<string, T> or T[]) as an interactive virtual Collection Table.
 *
 * Implements the Dual-Contract perspective:
 * - If Record<string, T> (Keyed Map / Registry): Dictionary keys become Row IDs.
 * - If T[] (Sequence / Array): Array indices or item.id become Row IDs.
 */
export async function openFieldAsTable(item: DocumentFieldItem) {
  const fieldSegments =
    item.pathSegments && item.pathSegments.length > 0
      ? item.pathSegments
      : [item.fieldName];
  const targetFieldPath =
    typeof item.fullFieldPath === "string" && item.fullFieldPath
      ? item.fullFieldPath
      : fieldSegments.join(".");
  const normalizedSegments = targetFieldPath.includes(".")
    ? targetFieldPath.split(".")
    : fieldSegments;

  let rawData = item.value;
  let fetchError = "";

  // Attempt JSON parse if rawData is a string
  if (typeof rawData === "string") {
    const trimmed = rawData.trim();
    if (
      (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
      (trimmed.startsWith("{") && trimmed.endsWith("}"))
    ) {
      try {
        rawData = JSON.parse(trimmed);
      } catch {}
    }
  }

  // If rawData is empty or missing, fetch fresh snapshot from Local JSON or Firestore
  const isDataEmpty =
    rawData === undefined ||
    rawData === null ||
    (Array.isArray(rawData) && rawData.length === 0) ||
    (typeof rawData === "object" && Object.keys(rawData).length === 0);

  if (isDataEmpty && item.parentDocRef) {
    try {
      const conn = ConnectionManager.getInstance().getConnection(item.connectionId);
      if (conn?.isLocalJson) {
        const localDoc = LocalJsonService.getInstance().getDocument(conn, item.parentDocRef.path);
        if (localDoc) {
          const extracted = extractNestedValue(localDoc, targetFieldPath, normalizedSegments);
          if (extracted !== undefined) {
            rawData = extracted;
          }
        }
      } else {
        let docData: any;
        // Check snapshot cache first to avoid unnecessary remote reads
        try {
          const cachedSnap = await DocumentFileSystemProvider.getInstance().getCachedSnapshot(
            item.connectionId,
            item.parentDocRef.path
          );
          if (cachedSnap?.exists) {
            docData = cachedSnap.data();
          }
        } catch {}

        if (!docData) {
          const firestore = await ConnectionManager.getInstance().getFirestore(item.connectionId);
          const docSnap = await firestore.doc(item.parentDocRef.path).get();
          if (docSnap.exists) {
            docData = docSnap.data() || {};
          }
        }

        if (docData) {
          const extracted = extractNestedValue(docData, targetFieldPath, normalizedSegments);
          if (extracted !== undefined) {
            rawData = extracted;
          }
        }
      }

      // If fetched string was JSON, parse it
      if (typeof rawData === "string") {
        const trimmed = rawData.trim();
        if (
          (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
          (trimmed.startsWith("{") && trimmed.endsWith("}"))
        ) {
          try {
            rawData = JSON.parse(trimmed);
          } catch {}
        }
      }
    } catch (err: any) {
      console.warn("Could not fetch fresh document snapshot for field table:", err);
      fetchError = `Could not fetch fresh snapshot: ${err.message}`;
    }
  }

  function parseRows(data: any): { rows: any[]; headers: string[]; error?: string } {
    let targetData = data;
    let parseErr = "";
    if (typeof targetData === "string") {
      const trimmed = targetData.trim();
      if (
        (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
        (trimmed.startsWith("{") && trimmed.endsWith("}"))
      ) {
        try {
          targetData = JSON.parse(trimmed);
        } catch (err: any) {
          parseErr = `JSON Parse Error: ${err.message}`;
        }
      }
    }

    const parsedRows: any[] = [];
    const headerSet = new Set<string>();
    const safeData = sanitizeFirestoreValue(targetData);

    if (Array.isArray(safeData)) {
      for (let index = 0; index < safeData.length; index++) {
        const entry = safeData[index];
        let rowObj: any = {};
        let rowId = String(index);

        if (entry !== null && typeof entry === "object" && !Array.isArray(entry)) {
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
        rowObj.__path = `${item.parentDocRef?.path || ""}/${targetFieldPath}`;

        Object.keys(rowObj).forEach((k) => {
          if (k !== "__id" && k !== "__index" && k !== "__path") {
            headerSet.add(k);
          }
        });

        parsedRows.push(rowObj);
      }
    } else if (safeData !== null && typeof safeData === "object") {
      Object.entries(safeData).forEach(([key, val]) => {
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
        rowObj.__path = `${item.parentDocRef?.path || ""}/${targetFieldPath}`;

        Object.keys(rowObj).forEach((k) => {
          if (k !== "__id" && k !== "__path") {
            headerSet.add(k);
          }
        });

        parsedRows.push(rowObj);
      });
    } else if (safeData !== undefined && safeData !== null) {
      parsedRows.push({
        __id: "0",
        value: safeData,
        __path: `${item.parentDocRef?.path || ""}/${targetFieldPath}`,
      });
      headerSet.add("value");
    }

    // Fallback: If rows exist but no properties were found (e.g. array of empty objects [{}]), add a placeholder header
    if (parsedRows.length > 0 && headerSet.size === 0) {
      headerSet.add("value");
    }

    return {
      rows: parsedRows,
      headers: sortHeaders(Array.from(headerSet)),
      error: parseErr || undefined,
    };
  }

  const parsed = parseRows(rawData);
  const rows = parsed.rows;
  const headers = parsed.headers;
  const initialErrorMessage = fetchError || parsed.error;

  const panelKey = `${item.connectionId}:${item.parentDocRef?.path || ""}:${targetFieldPath}`;
  const isArray = Array.isArray(rawData);
  const count = isArray ? (Array.isArray(rawData) ? rawData.length : 0) : rawData && typeof rawData === "object" ? Object.keys(rawData).length : 0;
  const panelTitle = isArray
    ? `Array: ${targetFieldPath} [${count}]`
    : `Registry: ${targetFieldPath}`;

  const existingCtx = activeFieldPanels.get(panelKey);
  if (existingCtx) {
    existingCtx.headers = headers;
    existingCtx.rows = rows;
    existingCtx.rawData = rawData;
    existingCtx.isArray = isArray;
    existingCtx.panel.title = panelTitle;
    existingCtx.panel.reveal(vscode.ViewColumn.One);
    existingCtx.panel.webview.postMessage({
      type: "init",
      headers,
      rows,
    });
    return;
  }

  const config = vscode.workspace.getConfiguration("ketrik-firestore-studio");
  const retainContextWhenHidden = config.get<boolean>("retainWebviewTabs", true);

  const panel = vscode.window.createWebviewPanel(
    "firestoreFieldTable",
    panelTitle,
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden,
    }
  );

  const ctx: FieldPanelContext = {
    panel,
    headers,
    rows,
    rawData,
    isArray,
  };
  activeFieldPanels.set(panelKey, ctx);

  const messageSubscription = panel.webview.onDidReceiveMessage(async (message) => {
    if (message.command === "ready" || message.command === "clearSearch") {
      panel.webview.postMessage({
        type: "init",
        headers: ctx.headers,
        rows: ctx.rows,
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
        defaultUri: getDefaultExportUri(`${item.fieldName}_export.json`),
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

        if (ctx.isArray) {
          const idx = index !== undefined ? index : Number(rowId);
          let currentArr: any[] = Array.isArray(ctx.rawData) ? [...ctx.rawData] : [];
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
            await safeFirestoreFieldUpdate(firestore, item.parentDocRef.path, fieldSegments, currentArr);
            CostService.getInstance().recordOperation(item.connectionId, "write", 1);
          }
          ctx.rawData = currentArr;
        } else {
          // Map
          let targetSegments: string[];
          if (field === "value" && ctx.headers.length === 1 && ctx.headers[0] === "value") {
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
            await safeFirestoreFieldUpdate(firestore, item.parentDocRef.path, targetSegments, writeVal);
            CostService.getInstance().recordOperation(item.connectionId, "write", 1);
          }

          if (ctx.rawData && typeof ctx.rawData === "object") {
            if (field === "value" && (typeof ctx.rawData[rowId] !== "object" || ctx.rawData[rowId] === null)) {
              ctx.rawData[rowId] = writeVal;
            } else if (ctx.rawData[rowId] && typeof ctx.rawData[rowId] === "object") {
              ctx.rawData[rowId][field] = writeVal;
            }
          }
        }

        DocumentFileSystemProvider.getInstance().invalidateAndNotify(item.connectionId, item.parentDocRef.path);

        const updatedParsed = parseRows(ctx.rawData);
        ctx.rows = updatedParsed.rows;
        ctx.headers = updatedParsed.headers;

        panel.webview.postMessage({
          type: "fieldEntryUpdated",
          rowId,
          field,
          value: sanitizeFirestoreValue(writeVal),
        });
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to update entry '${rowId}': ${err.message}`);
        panel.webview.postMessage({
          type: "error",
          message: `Failed to update entry '${rowId}': ${err.message}`,
        });
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
        if (ctx.isArray) {
          const idx = index !== undefined ? index : Number(rowId);
          let currentArr: any[] = Array.isArray(ctx.rawData) ? [...ctx.rawData] : [];
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
            await safeFirestoreFieldUpdate(firestore, item.parentDocRef.path, fieldSegments, currentArr);
            CostService.getInstance().recordOperation(item.connectionId, "write", 1);
          }
          ctx.rawData = currentArr;
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
            await safeFirestoreFieldUpdate(firestore, item.parentDocRef.path, targetSegments, undefined, true);
            CostService.getInstance().recordOperation(item.connectionId, "write", 1);
          }
          if (ctx.rawData && typeof ctx.rawData === "object") {
            delete ctx.rawData[rowId];
          }
        }

        DocumentFileSystemProvider.getInstance().invalidateAndNotify(item.connectionId, item.parentDocRef.path);

        const updatedParsed = parseRows(ctx.rawData);
        ctx.rows = updatedParsed.rows;
        ctx.headers = updatedParsed.headers;

        panel.webview.postMessage({
          type: "init",
          headers: ctx.headers,
          rows: ctx.rows,
        });
        vscode.window.showInformationMessage(`Entry '${rowId}' deleted!`);
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to delete entry '${rowId}': ${err.message}`);
        panel.webview.postMessage({
          type: "error",
          message: `Failed to delete entry '${rowId}': ${err.message}`,
        });
      }
      return;
    }

    if (message.command === "addFieldEntry") {
      try {
        let entryKey = "";
        if (!ctx.isArray) {
          const keyInput = await vscode.window.showInputBox({
            prompt: `Enter new key name for '${targetFieldPath}'`,
            validateInput: (v) => {
              const trimmed = v.trim();
              if (!trimmed) return "Key name cannot be empty";
              if (trimmed.includes("/")) return "Key name cannot contain '/'";
              if (ctx.rawData && typeof ctx.rawData === "object" && trimmed in ctx.rawData) {
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
              prompt: "Enter valid JSON",
              validateInput: (v) => {
                try {
                  JSON.parse(v);
                  return undefined;
                } catch {
                  return "Invalid JSON syntax";
                }
              },
            });
            if (jsonStr === undefined) return;
            entryVal = JSON.parse(jsonStr);
            break;
          }
        }

        const conn = ConnectionManager.getInstance().getConnection(item.connectionId);
        if (ctx.isArray) {
          const currentArr: any[] = Array.isArray(ctx.rawData) ? [...ctx.rawData] : [];
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
            await safeFirestoreFieldUpdate(firestore, item.parentDocRef.path, fieldSegments, currentArr);
            CostService.getInstance().recordOperation(item.connectionId, "write", 1);
          }
          ctx.rawData = currentArr;
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
            await safeFirestoreFieldUpdate(firestore, item.parentDocRef.path, targetSegments, entryVal);
            CostService.getInstance().recordOperation(item.connectionId, "write", 1);
          }
          if (ctx.rawData && typeof ctx.rawData === "object") {
            ctx.rawData[entryKey] = entryVal;
          }
        }

        DocumentFileSystemProvider.getInstance().invalidateAndNotify(item.connectionId, item.parentDocRef.path);

        const updatedParsed = parseRows(ctx.rawData);
        ctx.rows = updatedParsed.rows;
        ctx.headers = updatedParsed.headers;

        panel.webview.postMessage({
          type: "init",
          headers: ctx.headers,
          rows: ctx.rows,
        });
        vscode.window.showInformationMessage(
          ctx.isArray ? `Item added to array!` : `Entry '${entryKey}' added to map!`
        );
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to add entry: ${err.message}`);
        panel.webview.postMessage({
          type: "error",
          message: `Failed to add entry: ${err.message}`,
        });
      }
      return;
    }
  });
  ctx.messageSubscription = messageSubscription;

  panel.webview.html = getFieldTableHtml({
    panelTitle,
    fieldName: targetFieldPath,
    connectionId: item.connectionId,
    docPath: item.parentDocRef.path,
    isArray,
    initialData: { headers, rows },
    errorMessage: initialErrorMessage,
  });

  // Immediate postMessage fallback in case client is already active
  panel.webview.postMessage({
    type: "init",
    headers,
    rows,
  });

  // Listen to file changes from DocumentFileSystemProvider to keep open field table in live sync
  let fileChangeDebounce: NodeJS.Timeout | undefined;
  const parentDocPath = item.parentDocRef?.path || "";
  const fileChangeSubscription = DocumentFileSystemProvider.getInstance().onDidChangeFile((events) => {
    for (const ev of events) {
      if (ev.type === vscode.FileChangeType.Changed && ev.uri.scheme === "ketrik-firestore-studio" && ev.uri.authority === item.connectionId) {
        const parsed = DocumentFileSystemProvider.getInstance().parseUri(ev.uri);
        if (parsed.docPath === parentDocPath) {
          if (fileChangeDebounce) clearTimeout(fileChangeDebounce);
          fileChangeDebounce = setTimeout(async () => {
            try {
              const conn = ConnectionManager.getInstance().getConnection(item.connectionId);
              let freshRawData: any;
              if (conn?.isLocalJson) {
                const localDoc = LocalJsonService.getInstance().getDocument(conn, parentDocPath);
                if (localDoc) {
                  freshRawData = extractNestedValue(localDoc, targetFieldPath, normalizedSegments);
                }
              } else {
                const firestore = await ConnectionManager.getInstance().getFirestore(item.connectionId);
                const snap = await firestore.doc(parentDocPath).get();
                if (snap.exists) {
                  freshRawData = extractNestedValue(snap.data() || {}, targetFieldPath, normalizedSegments);
                }
              }
              if (freshRawData !== undefined) {
                ctx.rawData = freshRawData;
                const freshParsed = parseRows(freshRawData);
                ctx.rows = freshParsed.rows;
                ctx.headers = freshParsed.headers;
                panel.webview.postMessage({
                  type: "init",
                  headers: ctx.headers,
                  rows: ctx.rows,
                });
              }
            } catch {}
          }, 150);
        }
      }
    }
  });

  panel.onDidDispose(() => {
    activeFieldPanels.delete(panelKey);
    messageSubscription.dispose();
    fileChangeSubscription.dispose();
    if (fileChangeDebounce) {
      clearTimeout(fileChangeDebounce);
      fileChangeDebounce = undefined;
    }
    ctx.rows = [];
    ctx.headers = [];
    ctx.rawData = null;
  });
}

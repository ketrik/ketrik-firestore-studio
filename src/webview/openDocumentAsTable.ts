import * as vscode from "vscode";
import { DocumentItem, DocumentFieldItem } from "../explorer/items";
import ExplorerDataProvider from "../explorer/ExplorerDataProvider";
import openPath from "../commands/openPath";
import { ConnectionManager } from "../connections/ConnectionManager";
import { CostService } from "../cost/costService";
import { LocalJsonService } from "../services/LocalJsonService";
import { DocumentFileSystemProvider } from "../editor/DocumentFileSystemProvider";
import { getDocumentSizeInfo } from "../utils/documentSizeUtils";
import { sanitizeFirestoreValue, getDefaultExportUri } from "./common/tableUtils";
import { openFieldAsTable } from "./openFieldAsTable";
import { openCollectionAsTable } from "./openCollectionAsTable";
import {
  getDocumentTableHtml,
  getValType,
  DocumentFieldInfo,
} from "./documentTable/documentTableHtml";
import { FieldPath } from "firebase-admin/firestore";

export interface DocumentTableTarget {
  connectionId: string;
  docPath: string;
  documentId?: string;
  reference?: any;
  docData?: any;
}

interface DocumentPanelContext {
  panel: vscode.WebviewPanel;
  docData: any;
  fields: DocumentFieldInfo[];
  messageSubscription?: vscode.Disposable;
}

const activeDocumentPanels = new Map<string, DocumentPanelContext>();

function parseFields(data: any): DocumentFieldInfo[] {
  if (!data || typeof data !== "object") return [];
  const keys = Object.keys(data).sort((a, b) => a.localeCompare(b));
  return keys.map((key) => {
    const val = data[key];
    return {
      field: key,
      type: getValType(val),
      value: sanitizeFirestoreValue(val),
    };
  });
}

/**
 * Open a Firestore Document as an interactive, dual-view Table webview.
 *
 * Supports:
 * - Fields View: Vertical Property Sheet (Field Name, Type, Value, Actions)
 * - Record View: Horizontal Single-Row (Doc ID + columns)
 * - In-cell inline editing with atomic writes
 * - Drill-down to Field Tables (openFieldAsTable) for Maps and Arrays
 * - Breadcrumb navigation to parent collection (openCollectionAsTable)
 */
export async function openDocumentAsTable(
  target: DocumentItem | DocumentTableTarget,
  explorerDataProvider?: ExplorerDataProvider
) {
  let connectionId: string;
  let docPath: string;
  let documentId: string;

  if (target instanceof DocumentItem) {
    connectionId = target.connectionId;
    docPath = target.reference.path;
    documentId = target.documentId;
  } else {
    connectionId = target.connectionId;
    docPath = target.docPath;
    documentId =
      target.documentId ||
      docPath.substring(docPath.lastIndexOf("/") + 1) ||
      "document";
  }

  // Normalize path
  docPath = docPath.replace(/^\//, "").replace(/\.json$/, "");
  const pathSegments = docPath.split("/").filter(Boolean);
  if (!documentId || documentId.endsWith(".json")) {
    documentId = pathSegments[pathSegments.length - 1] || "document";
  }
  const parentCollectionPath =
    pathSegments.length > 1
      ? pathSegments.slice(0, pathSegments.length - 1).join("/")
      : "";

  const panelKey = `${connectionId}:${docPath}`;
  const existingCtx = activeDocumentPanels.get(panelKey);
  if (existingCtx) {
    existingCtx.panel.reveal(vscode.ViewColumn.One);
    if ((target as any).docData) {
      existingCtx.docData = (target as any).docData;
      existingCtx.fields = parseFields(existingCtx.docData);
      existingCtx.panel.webview.postMessage({
        type: "init",
        documentId,
        docPath,
        parentCollectionPath,
        fields: existingCtx.fields,
      });
    }
    return;
  }

  // Fetch document data
  let docData: any = (target as any).docData;
  let fetchError = "";

  if (!docData) {
    try {
      const conn = ConnectionManager.getInstance().getConnection(connectionId);
      if (conn?.isLocalJson) {
        const localDoc = LocalJsonService.getInstance().getDocument(conn, docPath);
        if (localDoc) {
          docData = localDoc;
        } else {
          docData = {};
        }
      } else {
        // Check snapshot cache first
        try {
          const cachedSnap = await DocumentFileSystemProvider.getInstance().getCachedSnapshot(
            connectionId,
            docPath
          );
          if (cachedSnap?.exists) {
            docData = cachedSnap.data() || {};
          }
        } catch {}

        if (!docData) {
          const firestore = await ConnectionManager.getInstance().getFirestore(connectionId);
          const docSnap = await firestore.doc(docPath).get();
          CostService.getInstance().recordOperation(connectionId, "read", 1);
          if (docSnap.exists) {
            docData = docSnap.data() || {};
          } else {
            docData = {};
          }
        }
      }
    } catch (err: any) {
      console.warn("Could not fetch document for table view:", err);
      fetchError = `Failed to load document: ${err.message}`;
      docData = {};
    }
  }

  let fields = parseFields(docData);
  let sizeInfo: any;
  try {
    sizeInfo = getDocumentSizeInfo(docData, docPath);
  } catch {}

  const config = vscode.workspace.getConfiguration("ketrik-firestore-studio");
  const retainContextWhenHidden = config.get<boolean>("retainWebviewTabs", true);

  const panel = vscode.window.createWebviewPanel(
    "firestoreDocumentTable",
    `Document: ${documentId}`,
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden,
    }
  );

  const ctx: DocumentPanelContext = {
    panel,
    docData: docData || {},
    fields,
  };
  activeDocumentPanels.set(panelKey, ctx);
  let suppressNextFileChange = false;

  async function getDocRef() {
    const conn = ConnectionManager.getInstance().getConnection(connectionId);
    if (conn?.isLocalJson) {
      return { path: docPath } as any;
    }
    const firestore = await ConnectionManager.getInstance().getFirestore(connectionId);
    return firestore.doc(docPath);
  }

  const messageSubscription = panel.webview.onDidReceiveMessage(async (message) => {
    if (message.command === "ready") {
      panel.webview.postMessage({
        type: "init",
        documentId,
        docPath,
        parentCollectionPath,
        fields: ctx.fields,
      });
      return;
    }

    if (message.command === "refresh") {
      try {
        const conn = ConnectionManager.getInstance().getConnection(connectionId);
        let freshData: any = {};
        if (conn?.isLocalJson) {
          freshData = LocalJsonService.getInstance().getDocument(conn, docPath) || {};
        } else {
          const firestore = await ConnectionManager.getInstance().getFirestore(connectionId);
          const snap = await firestore.doc(docPath).get();
          CostService.getInstance().recordOperation(connectionId, "read", 1);
          if (snap.exists) {
            freshData = snap.data() || {};
          }
        }
        ctx.docData = freshData;
        ctx.fields = parseFields(freshData);
        panel.webview.postMessage({
          type: "init",
          documentId,
          docPath,
          parentCollectionPath,
          fields: ctx.fields,
        });
        vscode.window.showInformationMessage(`Refreshed document '${documentId}'!`);
      } catch (err: any) {
        panel.webview.postMessage({
          type: "error",
          message: `Refresh failed: ${err.message}`,
        });
      }
      return;
    }

    if (message.command === "openInEditor") {
      await openPath(docPath, connectionId);
      return;
    }

    if (message.command === "copyPath") {
      const pathToCopy = message.path || docPath;
      await vscode.env.clipboard.writeText(pathToCopy);
      vscode.window.showInformationMessage(`Copied document path to clipboard: ${pathToCopy}`);
      return;
    }

    if (message.command === "openParentCollection" && parentCollectionPath) {
      try {
        const collectionId =
          parentCollectionPath.substring(parentCollectionPath.lastIndexOf("/") + 1) ||
          parentCollectionPath;
        const conn = ConnectionManager.getInstance().getConnection(connectionId);
        let colRef: any = { path: parentCollectionPath };
        if (!conn?.isLocalJson) {
          const firestore = await ConnectionManager.getInstance().getFirestore(connectionId);
          colRef = firestore.collection(parentCollectionPath);
        }
        await openCollectionAsTable(
          {
            collectionId,
            connectionId,
            collectionPath: parentCollectionPath,
            reference: colRef,
          } as any,
          false,
          explorerDataProvider
        );
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to open collection: ${err.message}`);
      }
      return;
    }

    if (message.command === "openFieldAsTable" && message.field) {
      try {
        const docRef = await getDocRef();
        const fieldItem = new DocumentFieldItem(
          message.field,
          ctx.docData[message.field],
          docRef,
          connectionId,
          [message.field]
        );
        await openFieldAsTable(fieldItem);
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to open field table: ${err.message}`);
      }
      return;
    }

    if (message.command === "exportJson") {
      const uri = await vscode.window.showSaveDialog({
        defaultUri: getDefaultExportUri(`${documentId}.json`),
        filters: { JSON: ["json"] },
      });
      if (uri) {
        try {
          await vscode.workspace.fs.writeFile(
            uri,
            Buffer.from(JSON.stringify(message.data || ctx.docData, null, 2))
          );
          vscode.window.showInformationMessage("Exported document JSON successfully!");
        } catch (err: any) {
          vscode.window.showErrorMessage(`Failed to export JSON: ${err.message}`);
        }
      }
      return;
    }

    if (message.command === "updateField") {
      const conn = ConnectionManager.getInstance().getConnection(connectionId);
      if (conn?.readOnly) {
        vscode.window.showErrorMessage(
          `Connection '${conn.name}' is in Read-Only mode. Unlock it from the connection context menu to edit fields.`
        );
        panel.webview.postMessage({
          type: "error",
          message: `Connection '${conn.name}' is in Read-Only mode.`,
        });
        return;
      }
      const { field, value } = message;
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

        const conn = ConnectionManager.getInstance().getConnection(connectionId);
        if (conn?.isLocalJson) {
          LocalJsonService.getInstance().updateField(conn, docPath, field, writeVal);
        } else {
          const firestore = await ConnectionManager.getInstance().getFirestore(connectionId);
          const docRef = firestore.doc(docPath);
          try {
            await docRef.update(new FieldPath(field), writeVal);
          } catch (updateErr: any) {
            if (updateErr.code === 5 || (updateErr.message && updateErr.message.includes("NOT_FOUND"))) {
              await docRef.set({ [field]: writeVal }, { merge: true });
            } else {
              throw updateErr;
            }
          }
          CostService.getInstance().recordOperation(connectionId, "write", 1);
        }

        ctx.docData[field] = writeVal;
        ctx.fields = parseFields(ctx.docData);

        suppressNextFileChange = true;
        DocumentFileSystemProvider.getInstance().invalidateAndNotify(connectionId, docPath);

        panel.webview.postMessage({
          type: "fieldUpdated",
          field,
          value: sanitizeFirestoreValue(writeVal),
        });
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to update field '${field}': ${err.message}`);
        panel.webview.postMessage({
          type: "error",
          message: `Failed to update field '${field}': ${err.message}`,
        });
      }
      return;
    }

    if (message.command === "deleteField") {
      const conn = ConnectionManager.getInstance().getConnection(connectionId);
      if (conn?.readOnly) {
        vscode.window.showErrorMessage(
          `Connection '${conn.name}' is in Read-Only mode. Unlock it from the connection context menu to delete fields.`
        );
        return;
      }
      const { field } = message;
      const confirm = await vscode.window.showWarningMessage(
        `Are you sure you want to delete field '${field}' from '${docPath}'?`,
        { modal: true },
        "Delete Field",
        "Cancel"
      );
      if (confirm !== "Delete Field") return;

      try {
        const conn = ConnectionManager.getInstance().getConnection(connectionId);
        if (conn?.isLocalJson) {
          LocalJsonService.getInstance().updateField(conn, docPath, field, undefined, true);
        } else {
          const firestore = await ConnectionManager.getInstance().getFirestore(connectionId);
          const { FieldValue } = await import("firebase-admin/firestore");
          await firestore.doc(docPath).update(new FieldPath(field), FieldValue.delete());
          CostService.getInstance().recordOperation(connectionId, "write", 1);
        }

        delete ctx.docData[field];
        ctx.fields = parseFields(ctx.docData);

        suppressNextFileChange = true;
        DocumentFileSystemProvider.getInstance().invalidateAndNotifyFieldDeleted(connectionId, docPath, field);

        panel.webview.postMessage({
          type: "fieldDeleted",
          field,
        });
        vscode.window.showInformationMessage(`Field '${field}' deleted!`);
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to delete field '${field}': ${err.message}`);
        panel.webview.postMessage({
          type: "error",
          message: `Failed to delete field '${field}': ${err.message}`,
        });
      }
      return;
    }

    if (message.command === "addField") {
      const addConn = ConnectionManager.getInstance().getConnection(connectionId);
      if (addConn?.readOnly) {
        vscode.window.showErrorMessage(
          `Connection '${addConn.name}' is in Read-Only mode. Unlock it from the connection context menu to add fields.`
        );
        return;
      }
      try {
        const keyInput = await vscode.window.showInputBox({
          prompt: `Enter new field name for '${documentId}'`,
          validateInput: (v) => {
            const trimmed = v.trim();
            if (!trimmed) return "Field name cannot be empty";
            if (trimmed.includes("/")) return "Field name cannot contain '/'";
            if (trimmed in ctx.docData) return `Field '${trimmed}' already exists`;
            return undefined;
          },
        });
        if (!keyInput) return;
        const newFieldName = keyInput.trim();

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
          { placeHolder: `Select value type for new field '${newFieldName}'` }
        );
        if (!typePick) return;

        let entryVal: any;
        switch (typePick.type) {
          case "string": {
            const str = await vscode.window.showInputBox({ prompt: "Enter string value" });
            if (str === undefined) return;
            entryVal = str;
            break;
          }
          case "number": {
            const num = await vscode.window.showInputBox({
              prompt: "Enter numeric value",
              validateInput: (v) => (isNaN(Number(v)) ? "Must be a valid number" : undefined),
            });
            if (num === undefined) return;
            entryVal = Number(num);
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
                  return "Invalid JSON";
                }
              },
            });
            if (jsonStr === undefined) return;
            entryVal = JSON.parse(jsonStr);
            break;
          }
        }

        const conn = ConnectionManager.getInstance().getConnection(connectionId);
        if (conn?.isLocalJson) {
          LocalJsonService.getInstance().updateField(conn, docPath, newFieldName, entryVal);
        } else {
          const firestore = await ConnectionManager.getInstance().getFirestore(connectionId);
          const docRef = firestore.doc(docPath);
          try {
            await docRef.update(new FieldPath(newFieldName), entryVal);
          } catch (updateErr: any) {
            if (updateErr.code === 5 || (updateErr.message && updateErr.message.includes("NOT_FOUND"))) {
              await docRef.set({ [newFieldName]: entryVal }, { merge: true });
            } else {
              throw updateErr;
            }
          }
          CostService.getInstance().recordOperation(connectionId, "write", 1);
        }

        ctx.docData[newFieldName] = entryVal;
        ctx.fields = parseFields(ctx.docData);

        suppressNextFileChange = true;
        DocumentFileSystemProvider.getInstance().invalidateAndNotify(connectionId, docPath);

        panel.webview.postMessage({
          type: "init",
          documentId,
          docPath,
          parentCollectionPath,
          fields: ctx.fields,
        });
        vscode.window.showInformationMessage(`Field '${newFieldName}' added!`);
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to add field: ${err.message}`);
        panel.webview.postMessage({
          type: "error",
          message: `Failed to add field: ${err.message}`,
        });
      }
      return;
    }

    if (message.command === "deleteDocument") {
      const delConn = ConnectionManager.getInstance().getConnection(connectionId);
      if (delConn?.readOnly) {
        vscode.window.showErrorMessage(
          `Connection '${delConn.name}' is in Read-Only mode. Unlock it from the connection context menu to delete documents.`
        );
        return;
      }
      const confirm = await vscode.window.showWarningMessage(
        `Are you sure you want to delete entire document '${docPath}'?`,
        { modal: true },
        "Delete Document",
        "Cancel"
      );
      if (confirm !== "Delete Document") return;

      try {
        const conn = ConnectionManager.getInstance().getConnection(connectionId);
        if (conn?.isLocalJson) {
          LocalJsonService.getInstance().deleteDocument(conn, docPath);
        } else {
          const firestore = await ConnectionManager.getInstance().getFirestore(connectionId);
          await firestore.doc(docPath).delete();
          CostService.getInstance().recordOperation(connectionId, "delete", 1);
        }

        DocumentFileSystemProvider.getInstance().invalidateAndNotifyDocumentDeleted(connectionId, docPath);
        if (explorerDataProvider) {
          explorerDataProvider.refresh();
        }
        panel.dispose();
        vscode.window.showInformationMessage(`Document '${documentId}' deleted!`);
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to delete document: ${err.message}`);
      }
      return;
    }
  });

  ctx.messageSubscription = messageSubscription;

  panel.webview.html = getDocumentTableHtml({
    documentId,
    docPath,
    parentCollectionPath,
    connectionId,
    fields,
    sizeInfoFormatted: sizeInfo?.formatted,
    errorMessage: fetchError,
  });

  // Listen to file changes from DocumentFileSystemProvider to keep open table in live sync
  let fileChangeDebounce: NodeJS.Timeout | undefined;
  const fileChangeSubscription = DocumentFileSystemProvider.getInstance().onDidChangeFile((events) => {
    for (const ev of events) {
      if (ev.type === vscode.FileChangeType.Changed && ev.uri.scheme === "ketrik-firestore-studio" && ev.uri.authority === connectionId) {
        const parsed = DocumentFileSystemProvider.getInstance().parseUri(ev.uri);
        if (parsed.docPath === docPath) {
          if (suppressNextFileChange) {
            suppressNextFileChange = false;
            return;
          }
          if (fileChangeDebounce) clearTimeout(fileChangeDebounce);
          fileChangeDebounce = setTimeout(async () => {
            try {
              const conn = ConnectionManager.getInstance().getConnection(connectionId);
              let freshData: any = {};
              if (conn?.isLocalJson) {
                freshData = LocalJsonService.getInstance().getDocument(conn, docPath) || {};
              } else {
                const firestore = await ConnectionManager.getInstance().getFirestore(connectionId);
                const snap = await firestore.doc(docPath).get();
                CostService.getInstance().recordOperation(connectionId, "read", 1);
                if (snap.exists) {
                  freshData = snap.data() || {};
                }
              }
              ctx.docData = freshData;
              ctx.fields = parseFields(freshData);
              panel.webview.postMessage({
                type: "init",
                documentId,
                docPath,
                parentCollectionPath,
                fields: ctx.fields,
              });
            } catch {}
          }, 150);
        }
      }
    }
  });

  panel.onDidDispose(() => {
    activeDocumentPanels.delete(panelKey);
    messageSubscription.dispose();
    fileChangeSubscription.dispose();
    if (fileChangeDebounce) {
      clearTimeout(fileChangeDebounce);
      fileChangeDebounce = undefined;
    }
    ctx.fields = [];
    ctx.docData = null;
  });
}


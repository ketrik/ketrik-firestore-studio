import * as vscode from "vscode";
import { CollectionItem, DocumentFieldItem, DocumentItem } from "../explorer/items";
import openPath from "./openPath";
import { DocumentFileSystemProvider } from "../editor/DocumentFileSystemProvider";
import ExplorerDataProvider from "../explorer/ExplorerDataProvider";
import { ConnectionManager } from "../connections/ConnectionManager";
import { DocumentReference, FieldPath, FieldValue, Timestamp } from "firebase-admin/firestore";
import { isTimestampLike, timestampToDate, formatDateTime } from "../utils/timestampUtils";
import { LocalJsonService } from "../services/LocalJsonService";
import { CostService } from "../cost/costService";
import { safeFirestoreFieldUpdate } from "../webview/common/tableUtils";
import {
  confirmProductionAction,
  getEnvironmentWarningPrefix,
  isProtectSystemKeysEnabled,
  isSystemFieldPath,
} from "../utils/deleteUtils";

/**
 * Guard helper to block field mutations when a connection is in Read-Only mode.
 */
function ensureWritable(connectionId: string | undefined, actionDesc: string): boolean {
  if (!connectionId) return true;
  return ConnectionManager.getInstance().ensureWritable(connectionId, actionDesc);
}

/**
 * Handle opening or quick-editing a field.
 */
export async function openFieldCommand(
  item: DocumentFieldItem,
  explorerDataProvider: ExplorerDataProvider
) {
  if (!item?.parentDocRef || !item?.fieldName) {
    return;
  }

  const conn = ConnectionManager.getInstance().getConnection(item.connectionId);
  const segments = item.pathSegments && item.pathSegments.length > 0 ? item.pathSegments : [item.fieldName];
  const fieldTarget = item.fullFieldPath || segments.join(".");

  if (conn?.readOnly) {
    await openPath(item.parentDocRef.path, item.connectionId, fieldTarget);
    return;
  }

  if (!ensureWritable(item.connectionId, "edit fields")) {
    return;
  }

  if (item.isArrayElement) {
    return editArrayItemCommand(item, explorerDataProvider);
  }

  const setDocField = async (newVal: any) => {
    if (conn?.isLocalJson) {
      LocalJsonService.getInstance().updateField(conn, item.parentDocRef.path, fieldTarget, newVal);
    } else {
      await item.parentDocRef.update(new FieldPath(...segments), newVal);
      CostService.getInstance().recordOperation(item.connectionId, "write", 1);
    }
  };

  const value = item.value;
  const valType = Array.isArray(value)
    ? "array"
    : value === null
      ? "null"
      : typeof value;

  // If it's a Firestore VectorValue, prompt to edit vector numbers
  const isVec = value && (value.constructor?.name === "VectorValue" || (Array.isArray(value._values) && typeof value.isEqual === "function") || (value.__type === "VectorValue" && Array.isArray(value.values)));
  if (isVec) {
    const rawNums: number[] = typeof value.toArray === "function" ? value.toArray() : (Array.isArray(value._values) ? value._values : (value.values || []));
    const input = await vscode.window.showInputBox({
      prompt: `Edit Vector (${rawNums.length} dimensions) for '${fieldTarget}'`,
      value: JSON.stringify(rawNums),
      validateInput: (v) => {
        if (!v.trim()) return "Vector cannot be empty";
        return undefined;
      },
    });
    if (!input) return;
    let newNums: number[] = [];
    try {
      const parsed = JSON.parse(input.trim());
      if (Array.isArray(parsed)) newNums = parsed.map(Number).filter((n) => !isNaN(n));
    } catch {
      newNums = input.split(",").map((s) => Number(s.trim())).filter((n) => !isNaN(n));
    }
    if (newNums.length === 0) {
      vscode.window.showErrorMessage("Invalid vector numbers provided.");
      return;
    }
    try {
      const writeVec = conn?.isLocalJson ? newNums : FieldValue.vector(newNums);
      await setDocField(writeVec);
      DocumentFileSystemProvider.getInstance().invalidateAndNotify(item.connectionId, item.parentDocRef.path);
      vscode.window.showInformationMessage(`Updated vector '${fieldTarget}' (${newNums.length} dimensions)`);
      explorerDataProvider.refreshNode(item);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to update vector: ${err.message}`);
    }
    return;
  }

  // If it's a Firestore Timestamp, prompt to update timestamp
  if (valType === "object" && isTimestampLike(value)) {
    const curDate = timestampToDate(value) ?? new Date();
    const curIso = curDate.toISOString();
    const curLocal = formatDateTime(curDate);

    const action = await vscode.window.showQuickPick(
      [
        {
          label: "$(clock) Set to Now",
          description: "Use current machine datetime",
          action: "now",
        },
        {
          label: "$(server-process) Set to ServerTimestamp",
          description: "FieldValue.serverTimestamp() (evaluated on server)",
          action: "serverTimestamp",
        },
        {
          label: "$(edit) Edit ISO Date / Time String",
          description: `Current: ${curIso}`,
          action: "custom",
        },
        {
          label: "$(json) Open in JSON Editor",
          description: "Edit raw _seconds and _nanoseconds in editor",
          action: "editor",
        },
      ],
      { placeHolder: `Edit Timestamp for '${fieldTarget}' (Current: ${curLocal})` }
    );

    if (!action) {
      return;
    }

    if (action.action === "editor") {
      await openPath(item.parentDocRef.path, item.connectionId, fieldTarget);
      return;
    }

    try {
      if (action.action === "now") {
        await setDocField(Timestamp.now());
      } else if (action.action === "serverTimestamp") {
        await setDocField(FieldValue.serverTimestamp());
      } else if (action.action === "custom") {
        const input = await vscode.window.showInputBox({
          prompt: `Enter ISO-8601 or Date string for '${fieldTarget}'`,
          value: curIso,
          validateInput: (v) => {
            const parsed = Date.parse(v);
            return isNaN(parsed) ? "Invalid date format. Use ISO-8601 (e.g. 2026-10-14T15:00:00Z)" : undefined;
          },
        });
        if (!input) {
          return;
        }
        const targetDate = new Date(input);
        await setDocField(Timestamp.fromDate(targetDate));
      }

      DocumentFileSystemProvider.getInstance().invalidateAndNotify(item.connectionId, item.parentDocRef.path);
      vscode.window.showInformationMessage(`Updated timestamp '${fieldTarget}'`);
      explorerDataProvider.refreshNode(item);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to update timestamp: ${err.message}`);
    }
    return;
  }

  // If it's a complex type (object or array), open directly in the virtual JSON editor
  if (valType === "object" || valType === "array") {
    await openPath(item.parentDocRef.path, item.connectionId, fieldTarget);
    return;
  }

  // For booleans: QuickPick true / false
  if (valType === "boolean") {
    const currentStr = String(value);
    const picked = await vscode.window.showQuickPick(
      [
        { label: "true", description: currentStr === "true" ? "(current value)" : undefined },
        { label: "false", description: currentStr === "false" ? "(current value)" : undefined },
      ],
      { placeHolder: `Set boolean value for '${item.fieldName}'` }
    );

    if (!picked) {
      return;
    }

    const newValue = picked.label === "true";
    if (newValue === value) {
      return;
    }

    try {
      await setDocField(newValue);
      DocumentFileSystemProvider.getInstance().invalidateAndNotify(item.connectionId, item.parentDocRef.path);
      vscode.window.showInformationMessage(`Updated '${item.fieldName}' to ${newValue}`);
      explorerDataProvider.refreshNode(item);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to update field: ${err.message}`);
    }
    return;
  }

  // For numbers: Modal InputBox with number validation
  if (valType === "number") {
    const input = await vscode.window.showInputBox({
      prompt: `Edit numeric value for '${item.fieldName}'`,
      value: String(value),
      validateInput: (v) => (isNaN(Number(v)) ? "Must be a valid number" : undefined),
    });

    if (input === undefined) {
      return;
    }

    const newNum = Number(input);
    if (newNum === value) {
      return;
    }

    try {
      await setDocField(newNum);
      DocumentFileSystemProvider.getInstance().invalidateAndNotify(item.connectionId, item.parentDocRef.path);
      vscode.window.showInformationMessage(`Updated '${item.fieldName}' to ${newNum}`);
      explorerDataProvider.refreshNode(item);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to update field: ${err.message}`);
    }
    return;
  }

  // For null values: Prompt user to choose new type/value or open in JSON editor
  if (valType === "null") {
    const typeChoice = await vscode.window.showQuickPick(
      [
        { label: "$(symbol-namespace) Object / Map ({})", description: "Convert to empty object & open in editor", type: "object" },
        { label: "$(symbol-array) Array ([])", description: "Convert to empty array & open in editor", type: "array" },
        { label: "$(calendar) Timestamp", description: "Set current time or custom date", type: "timestamp" },
        { label: "$(symbol-string) String", description: "Set text value", type: "string" },
        { label: "$(symbol-number) Number", description: "Set numeric value", type: "number" },
        { label: "$(symbol-boolean) Boolean", description: "Set true / false", type: "boolean" },
        { label: "$(json) Open in JSON Editor", description: "Open raw JSON tab to edit", type: "editor" },
      ],
      { placeHolder: `Field '${item.fieldName}' is null. Choose new type or open in editor:` }
    );

    if (!typeChoice) {
      return;
    }

    if (typeChoice.type === "editor") {
      await openPath(item.parentDocRef.path, item.connectionId, fieldTarget);
      return;
    }

    try {
      if (typeChoice.type === "object") {
        await setDocField({});
        DocumentFileSystemProvider.getInstance().invalidateAndNotify(item.connectionId, item.parentDocRef.path);
        explorerDataProvider.refreshNode(item);
        await openPath(item.parentDocRef.path, item.connectionId, fieldTarget);
        return;
      }

      if (typeChoice.type === "array") {
        await setDocField([]);
        DocumentFileSystemProvider.getInstance().invalidateAndNotify(item.connectionId, item.parentDocRef.path);
        explorerDataProvider.refreshNode(item);
        await openPath(item.parentDocRef.path, item.connectionId, fieldTarget);
        return;
      }

      if (typeChoice.type === "timestamp") {
        const tsChoice = await vscode.window.showQuickPick(
          [
            { label: "$(clock) Current Time (Now)", action: "now" },
            { label: "$(server-process) ServerTimestamp (FieldValue.serverTimestamp)", action: "server" },
            { label: "$(edit) Custom ISO-8601 String", action: "custom" },
          ],
          { placeHolder: `Set Timestamp value for '${item.fieldName}'` }
        );
        if (!tsChoice) {
          return;
        }
        let tsVal: any;
        if (tsChoice.action === "now") {
          tsVal = Timestamp.now();
        } else if (tsChoice.action === "server") {
          tsVal = FieldValue.serverTimestamp();
        } else {
          const iso = await vscode.window.showInputBox({
            prompt: `Enter ISO-8601 string for '${item.fieldName}'`,
            value: new Date().toISOString(),
            validateInput: (v) => (isNaN(Date.parse(v)) ? "Invalid date format" : undefined),
          });
          if (!iso) {
            return;
          }
          tsVal = Timestamp.fromDate(new Date(iso));
        }
        await setDocField(tsVal);
        DocumentFileSystemProvider.getInstance().invalidateAndNotify(item.connectionId, item.parentDocRef.path);
        vscode.window.showInformationMessage(`Updated '${item.fieldName}' to Timestamp`);
        explorerDataProvider.refreshNode(item);
        return;
      }

      if (typeChoice.type === "boolean") {
        const boolPick = await vscode.window.showQuickPick(
          [{ label: "true" }, { label: "false" }],
          { placeHolder: `Set boolean value for '${item.fieldName}'` }
        );
        if (!boolPick) {
          return;
        }
        const bVal = boolPick.label === "true";
        await setDocField(bVal);
        DocumentFileSystemProvider.getInstance().invalidateAndNotify(item.connectionId, item.parentDocRef.path);
        vscode.window.showInformationMessage(`Updated '${item.fieldName}' to ${bVal}`);
        explorerDataProvider.refreshNode(item);
        return;
      }

      if (typeChoice.type === "number") {
        const numInput = await vscode.window.showInputBox({
          prompt: `Enter numeric value for '${item.fieldName}'`,
          validateInput: (v) => (isNaN(Number(v)) ? "Must be a valid number" : undefined),
        });
        if (numInput === undefined) {
          return;
        }
        const nVal = Number(numInput);
        await setDocField(nVal);
        DocumentFileSystemProvider.getInstance().invalidateAndNotify(item.connectionId, item.parentDocRef.path);
        vscode.window.showInformationMessage(`Updated '${item.fieldName}' to ${nVal}`);
        explorerDataProvider.refreshNode(item);
        return;
      }

      if (typeChoice.type === "string") {
        const strInput = await vscode.window.showInputBox({
          prompt: `Enter string value for '${item.fieldName}'`,
        });
        if (strInput === undefined) {
          return;
        }
        await setDocField(strInput);
        DocumentFileSystemProvider.getInstance().invalidateAndNotify(item.connectionId, item.parentDocRef.path);
        vscode.window.showInformationMessage(`Updated '${item.fieldName}'`);
        explorerDataProvider.refreshNode(item);
        return;
      }
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to update '${item.fieldName}': ${err?.message || err}`);
    }
    return;
  }

  // For strings: Modal InputBox
  const input = await vscode.window.showInputBox({
    prompt: `Edit string value for '${item.fieldName}'`,
    value: String(value),
  });

  if (input === undefined) {
    return;
  }

  if (input === value) {
    return;
  }

  try {
    await setDocField(input);
    DocumentFileSystemProvider.getInstance().invalidateAndNotify(item.connectionId, item.parentDocRef.path);
    vscode.window.showInformationMessage(`Updated '${item.fieldName}'`);
    explorerDataProvider.refreshNode(item);
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to update field: ${err.message}`);
  }
}

/**
 * Rename a field atomically with Safe Mode protection.
 */
export async function renameFieldCommand(
  item: DocumentFieldItem,
  explorerDataProvider: ExplorerDataProvider,
  documentFileSystemProvider: DocumentFileSystemProvider
) {
  if (!item?.parentDocRef || !item?.fieldName) {
    return;
  }

  if (!ensureWritable(item.connectionId, "rename fields")) {
    return;
  }

  if (item.isArrayElement) {
    vscode.window.showWarningMessage("Array elements cannot be renamed. They are indexed by position.");
    return;
  }

  const currentSegments = item.pathSegments && item.pathSegments.length > 0 ? item.pathSegments : [item.fieldName];
  const parentSegments = currentSegments.slice(0, -1);
  const oldPathStr = currentSegments.join(".");

  const newName = await vscode.window.showInputBox({
    prompt: `Rename field '${oldPathStr}'`,
    value: item.fieldName,
    validateInput: (v) => {
      const trimmed = v.trim();
      if (!trimmed) {
        return "Field name cannot be empty";
      }
      if (trimmed === item.fieldName) {
        return "New field name must be different";
      }
      if (trimmed.includes("/")) {
        return "Field name cannot contain '/'";
      }
      return undefined;
    },
  });

  if (!newName || newName.trim() === item.fieldName) {
    return;
  }

  const targetName = newName.trim();
  const targetSegments = [...parentSegments, targetName];
  const newPathStr = targetSegments.join(".");

  // Safe Mode: Protection for System Envelope and Protocol keys
  const config = vscode.workspace.getConfiguration("ketrik-firestore-studio");
  const protectSystemKeys = config.get<boolean>("protectSystemKeys", true);
  const isSystemKey = item.fieldName.startsWith("_") || targetName.startsWith("_");
  if (protectSystemKeys && isSystemKey) {
    const proceed = await vscode.window.showWarningMessage(
      `Safe Mode: "${item.fieldName}" is a System Envelope or Protocol key. Renaming it may disrupt lifecycle or query operations. Proceed?`,
      { modal: true },
      "Proceed with Rename",
      "Cancel"
    );
    if (proceed !== "Proceed with Rename") {
      return;
    }
  }

  try {
    const conn = ConnectionManager.getInstance().getConnection(item.connectionId);
    if (conn?.isLocalJson) {
      const data = LocalJsonService.getInstance().getDocument(conn, item.parentDocRef.path) || {};
      let cur = data;
      for (const p of parentSegments) {
        cur = cur?.[p];
      }
      if (!cur || !(item.fieldName in cur)) {
        vscode.window.showErrorMessage(`Field "${oldPathStr}" no longer exists.`);
        return;
      }
      if (targetName in cur) {
        const overwrite = await vscode.window.showWarningMessage(
          `Field "${newPathStr}" already exists on document "${item.parentDocRef.id}". Overwrite it?`,
          { modal: true },
          "Overwrite",
          "Cancel"
        );
        if (overwrite !== "Overwrite") {
          return;
        }
      }
      const existingValue = cur[item.fieldName];
      delete cur[item.fieldName];
      cur[targetName] = existingValue;
      LocalJsonService.getInstance().setDocument(conn, item.parentDocRef.path, data);

      documentFileSystemProvider.invalidateAndNotifyFieldDeleted(item.connectionId, item.parentDocRef.path, [oldPathStr, item.fieldName]);
      vscode.window.showInformationMessage(`Renamed '${oldPathStr}' to '${newPathStr}'`);
      explorerDataProvider.refreshNode(item);
      return;
    }

    CostService.getInstance().recordOperation(item.connectionId, "read", 1);
    const snapshot = await item.parentDocRef.get();
    if (!snapshot.exists) {
      vscode.window.showErrorMessage(`Document "${item.parentDocRef.id}" no longer exists.`);
      return;
    }

    const data = snapshot.data() || {};
    let cur = data;
    for (const p of parentSegments) {
      cur = cur?.[p];
    }
    if (!cur || !(item.fieldName in cur)) {
      vscode.window.showErrorMessage(`Field "${oldPathStr}" no longer exists.`);
      return;
    }

    if (targetName in cur) {
      const overwrite = await vscode.window.showWarningMessage(
        `Field "${newPathStr}" already exists on document "${item.parentDocRef.id}". Overwrite it?`,
        { modal: true },
        "Overwrite",
        "Cancel"
      );
      if (overwrite !== "Overwrite") {
        return;
      }
    }

    const existingValue = cur[item.fieldName];

    await item.parentDocRef.update(
      new FieldPath(...targetSegments),
      existingValue,
      new FieldPath(...currentSegments),
      FieldValue.delete()
    );
    CostService.getInstance().recordOperation(item.connectionId, "write", 1);

    documentFileSystemProvider.invalidateAndNotifyFieldDeleted(item.connectionId, item.parentDocRef.path, [oldPathStr, item.fieldName]);
    vscode.window.showInformationMessage(`Renamed '${oldPathStr}' to '${newPathStr}'`);
    explorerDataProvider.refreshNode(item);
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to rename field: ${err.message}`);
  }
}

/**
 * Delete a field atomically with Safe Mode protection.
 */
export async function deleteFieldCommand(
  item: DocumentFieldItem | undefined,
  explorerDataProvider: ExplorerDataProvider,
  documentFileSystemProvider: DocumentFileSystemProvider
) {
  let targetItem = item;
  if (targetItem?.connectionId && !ensureWritable(targetItem.connectionId, "delete fields")) {
    return;
  }

  // Fallback to active editor if triggered without an item argument (e.g. keybinding or command palette)
  if (!targetItem?.parentDocRef || !targetItem?.fieldName) {
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor && activeEditor.document.uri.scheme === "ketrik-firestore-studio") {
      const parsed = documentFileSystemProvider.parseUri(activeEditor.document.uri);
      if (parsed.connectionId && parsed.docPath && parsed.fieldPath) {
        if (!ensureWritable(parsed.connectionId, "delete fields")) {
          return;
        }
        try {
          const conn = ConnectionManager.getInstance().getConnection(parsed.connectionId);
          let docRef: any;
          let segments: string[];
          if (conn?.isLocalJson) {
            docRef = { id: parsed.docPath.split("/").pop()!, path: parsed.docPath };
            const localDoc = LocalJsonService.getInstance().getDocument(conn, parsed.docPath);
            if (localDoc && Object.prototype.hasOwnProperty.call(localDoc, parsed.fieldPath)) {
              segments = [parsed.fieldPath];
            } else {
              segments = parsed.fieldPath.includes(".")
                ? parsed.fieldPath.split(".")
                : [parsed.fieldPath];
            }
          } else {
            const firestore = await ConnectionManager.getInstance().getFirestore(parsed.connectionId);
            docRef = firestore.doc(parsed.docPath);
            segments = parsed.fieldPath.includes(".")
              ? parsed.fieldPath.split(".")
              : [parsed.fieldPath];
          }
          targetItem = {
            parentDocRef: docRef,
            fieldName: segments[segments.length - 1],
            pathSegments: segments,
            connectionId: parsed.connectionId,
          } as DocumentFieldItem;
        } catch {
          // Ignore fallback resolution failure
        }
      }
    }
  }

  if (!targetItem?.parentDocRef || !targetItem?.fieldName) {
    vscode.window.showErrorMessage("No field selected to delete.");
    return;
  }

  if (targetItem.isArrayElement) {
    return deleteArrayItemCommand(targetItem, explorerDataProvider);
  }

  const segments = targetItem.pathSegments && targetItem.pathSegments.length > 0 ? targetItem.pathSegments : [targetItem.fieldName];
  const fullPathStr = targetItem.fullFieldPath || segments.join(".");

  const envPrefix = getEnvironmentWarningPrefix(targetItem.connectionId);
  const isSystemKey = isSystemFieldPath(segments);
  const promptText =
    isProtectSystemKeysEnabled() && isSystemKey
      ? `${envPrefix}⚠️ Safe Mode Warning: "${fullPathStr}" is a System Envelope or Protocol key. Deleting it may break query filtering or lifecycle rules. Are you sure?`
      : `${envPrefix}Are you sure you want to delete the field "${fullPathStr}" from document "${targetItem.parentDocRef.id}"?`;

  const confirm = await vscode.window.showWarningMessage(
    promptText,
    { modal: true },
    "Delete Field",
    "Cancel"
  );

  if (confirm === "Delete Field") {
    try {
      const conn = ConnectionManager.getInstance().getConnection(targetItem.connectionId);
      if (conn?.isLocalJson) {
        LocalJsonService.getInstance().updateField(conn, targetItem.parentDocRef.path, segments, undefined, true);
        documentFileSystemProvider.invalidateAndNotifyFieldDeleted(targetItem.connectionId, targetItem.parentDocRef.path, [fullPathStr]);
        vscode.window.showInformationMessage(`Field "${fullPathStr}" deleted!`);
        explorerDataProvider.refreshNode(targetItem);
        return;
      }

      if (segments.some((s) => /^\d+$/.test(s))) {
        const firestore = await ConnectionManager.getInstance().getFirestore(targetItem.connectionId);
        await safeFirestoreFieldUpdate(firestore, targetItem.parentDocRef.path, segments, undefined, true);
        CostService.getInstance().recordOperation(targetItem.connectionId, "read", 1);
        CostService.getInstance().recordOperation(targetItem.connectionId, "write", 1);
      } else {
        await targetItem.parentDocRef.update(new FieldPath(...segments), FieldValue.delete());
        CostService.getInstance().recordOperation(targetItem.connectionId, "write", 1);
      }
      documentFileSystemProvider.invalidateAndNotifyFieldDeleted(targetItem.connectionId, targetItem.parentDocRef.path, [fullPathStr]);
      vscode.window.showInformationMessage(`Field "${fullPathStr}" deleted!`);
      explorerDataProvider.refreshNode(targetItem);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to delete field: ${err.message}`);
    }
  }
}

/**
 * Delete multiple fields atomically from a document or scoped map using a multi-select QuickPick checklist.
 */
export async function deleteMultipleFieldsCommand(
  item: DocumentItem | DocumentFieldItem | vscode.Uri | undefined,
  explorerDataProvider: ExplorerDataProvider,
  documentFileSystemProvider: DocumentFileSystemProvider
) {
  let docRef: any | undefined;
  let connectionId: string | undefined;
  let scopedFieldPath: string | undefined;
  const refreshTarget: any = item;

  if (item instanceof DocumentItem) {
    docRef = item.reference;
    connectionId = item.connectionId;
    if (!ensureWritable(connectionId, "delete fields")) {
      return;
    }
  } else if (item instanceof DocumentFieldItem) {
    docRef = item.parentDocRef;
    connectionId = item.connectionId;
    if (!ensureWritable(connectionId, "delete fields")) {
      return;
    }
  } else if (item instanceof vscode.Uri) {
    const parsed = documentFileSystemProvider.parseUri(item);
    connectionId = parsed.connectionId;
    scopedFieldPath = parsed.fieldPath;
    if (!ensureWritable(connectionId, "delete fields")) {
      return;
    }
    if (parsed.docPath && !parsed.isRules) {
      const conn = ConnectionManager.getInstance().getConnection(connectionId);
      if (conn?.isLocalJson) {
        docRef = { id: parsed.docPath.split("/").pop()!, path: parsed.docPath };
      } else {
        const firestore = await ConnectionManager.getInstance().getFirestore(connectionId);
        docRef = firestore.doc(parsed.docPath);
      }
    }
  } else {
    // Check active text editor
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor && activeEditor.document.uri.scheme === "ketrik-firestore-studio") {
      const parsed = documentFileSystemProvider.parseUri(activeEditor.document.uri);
      connectionId = parsed.connectionId;
      scopedFieldPath = parsed.fieldPath;
      if (parsed.docPath && !parsed.isRules) {
        const conn = ConnectionManager.getInstance().getConnection(connectionId);
        if (conn?.isLocalJson) {
          docRef = { id: parsed.docPath.split("/").pop()!, path: parsed.docPath };
        } else {
          const firestore = await ConnectionManager.getInstance().getFirestore(connectionId);
          docRef = firestore.doc(parsed.docPath);
        }
      }
    }
  }

  if (!docRef || !connectionId) {
    vscode.window.showErrorMessage("No document selected. Open a document or select one in Firestore Studio.");
    return;
  }

  if (!ConnectionManager.getInstance().ensureWritable(connectionId, "delete fields")) {
    return;
  }

  try {
    const conn = ConnectionManager.getInstance().getConnection(connectionId);
    let freshDocData: Record<string, any> = {};

    if (conn?.isLocalJson) {
      freshDocData = LocalJsonService.getInstance().getDocument(conn, docRef.path) || {};
    } else {
      CostService.getInstance().recordOperation(connectionId, "read", 1);
      const snapshot = await docRef.get();
      if (!snapshot.exists) {
        vscode.window.showErrorMessage(`Document "${docRef.id}" does not exist.`);
        return;
      }
      freshDocData = snapshot.data() || {};
    }

    let targetSegments: string[] | undefined;
    if (item instanceof DocumentFieldItem) {
      targetSegments =
        item.pathSegments && item.pathSegments.length > 0 ? item.pathSegments : [item.fieldName];
    } else if (scopedFieldPath) {
      targetSegments = Object.prototype.hasOwnProperty.call(freshDocData, scopedFieldPath)
        ? [scopedFieldPath]
        : scopedFieldPath.split(".").filter(Boolean);
    }

    let targetValue: any = freshDocData;
    if (targetSegments && targetSegments.length > 0) {
      for (const seg of targetSegments) {
        if (Array.isArray(targetValue) && /^\d+$/.test(seg)) {
          targetValue = targetValue[parseInt(seg, 10)];
        } else if (targetValue && typeof targetValue === "object") {
          targetValue = targetValue[seg];
        } else {
          targetValue = undefined;
          break;
        }
      }
    }

    const targetPathStr =
      item instanceof DocumentFieldItem && item.fullFieldPath
        ? item.fullFieldPath
        : targetSegments && targetSegments.length > 0
          ? targetSegments.join(".")
          : "";

    const isScopedMap =
      Boolean(targetSegments && targetSegments.length > 0) &&
      targetValue !== null &&
      typeof targetValue === "object" &&
      !Array.isArray(targetValue) &&
      !isTimestampLike(targetValue);

    const isScopedArray =
      Boolean(targetSegments && targetSegments.length > 0) && Array.isArray(targetValue);

    if (isScopedArray && targetSegments) {
      const arrData = targetValue as any[];
      if (arrData.length === 0) {
        vscode.window.showInformationMessage(`Array "${targetPathStr}" has no items to delete.`);
        return;
      }

      interface ArrayPickItem extends vscode.QuickPickItem {
        index: number;
      }

      const arrItems: ArrayPickItem[] = arrData.map((val, idx) => {
        let preview = "";
        try {
          if (val === null) {
            preview = "null";
          } else if (Array.isArray(val)) {
            preview = `[Array(${val.length})]`;
          } else if (typeof val === "object") {
            preview = `{${Object.keys(val).length} keys}`;
          } else if (typeof val === "string") {
            preview = `"${val.length > 35 ? val.slice(0, 32) + "..." : val}"`;
          } else {
            preview = String(val);
          }
        } catch {
          preview = String(val);
        }

        return {
          label: `$(symbol-array) [${idx}]`,
          description: preview,
          picked: false,
          index: idx,
        };
      });

      const selected = await vscode.window.showQuickPick(arrItems, {
        canPickMany: true,
        placeHolder: `Select items to delete from Array '${targetPathStr}' (${arrData.length} items)`,
        title: `Delete Multiple Array Items (${targetPathStr})`,
      });

      if (!selected || selected.length === 0) {
        return;
      }

      const selectedIndices = selected.map((s) => s.index);
      const indexSet = new Set(selectedIndices);
      const envPrefix = getEnvironmentWarningPrefix(connectionId);
      const safeWarning =
        isProtectSystemKeysEnabled() && isSystemFieldPath(targetSegments)
          ? `⚠️ Safe Mode Warning: Array "${targetPathStr}" is under a System Envelope / Protocol path.\n\n`
          : "";

      const btnLabel = `Delete ${selectedIndices.length} Item${selectedIndices.length > 1 ? "s" : ""}`;
      const confirm = await vscode.window.showWarningMessage(
        `${envPrefix}${safeWarning}Are you sure you want to delete ${selectedIndices.length} item(s) ([${selectedIndices.slice(0, 8).join(", ")}${selectedIndices.length > 8 ? ", ..." : ""}]) from Array "${targetPathStr}"?`,
        { modal: true },
        btnLabel,
        "Cancel"
      );

      if (confirm !== btnLabel) {
        return;
      }

      const confirmedProd = await confirmProductionAction({
        connectionId,
        actionLabel: `Delete ${selectedIndices.length} Array Item(s)`,
        targetSummary: `${selectedIndices.length} item(s) from Array '${targetPathStr}'`,
        expectedInput: `DELETE ${selectedIndices.length}`,
      });
      if (!confirmedProd) {
        return;
      }

      if (conn?.isLocalJson) {
        const updatedArr = arrData.filter((_, i) => !indexSet.has(i));
        LocalJsonService.getInstance().updateField(conn, docRef.path, targetSegments, updatedArr);
      } else {
        const firestore = await ConnectionManager.getInstance().getFirestore(connectionId);
        const typedDocRef = docRef as DocumentReference;
        await firestore.runTransaction(async (tx) => {
          const snap = await tx.get(typedDocRef);
          if (!snap.exists) {
            throw new Error(`Document "${typedDocRef.id}" no longer exists.`);
          }
          const docData = snap.data() || {};
          let parentContainer: any = docData;
          for (let i = 0; i < targetSegments!.length - 1; i++) {
            const seg = targetSegments![i];
            if (Array.isArray(parentContainer) && /^\d+$/.test(seg)) {
              parentContainer = parentContainer[parseInt(seg, 10)];
            } else if (parentContainer && typeof parentContainer === "object") {
              parentContainer = parentContainer[seg];
            } else {
              parentContainer = undefined;
              break;
            }
          }
          const lastSeg = targetSegments![targetSegments!.length - 1];
          const existingArr =
            Array.isArray(parentContainer) && /^\d+$/.test(lastSeg)
              ? parentContainer[parseInt(lastSeg, 10)]
              : parentContainer?.[lastSeg];
          if (!Array.isArray(existingArr)) {
            throw new Error(`Field "${targetPathStr}" is no longer an Array.`);
          }
          const updatedArr = existingArr.filter((_, i) => !indexSet.has(i));
          if (Array.isArray(parentContainer) && /^\d+$/.test(lastSeg)) {
            parentContainer[parseInt(lastSeg, 10)] = updatedArr;
          } else {
            parentContainer[lastSeg] = updatedArr;
          }

          const firstNumericIdx = targetSegments!.findIndex((s) => /^\d+$/.test(s));
          if (firstNumericIdx > 0) {
            const topArraySegments = targetSegments!.slice(0, firstNumericIdx);
            let topArrayVal: any = docData;
            for (const seg of topArraySegments) {
              topArrayVal = topArrayVal?.[seg];
            }
            tx.update(typedDocRef, new FieldPath(...topArraySegments), topArrayVal);
          } else {
            tx.update(typedDocRef, new FieldPath(...targetSegments!), updatedArr);
          }
        });
        CostService.getInstance().recordOperation(connectionId, "read", 1);
        CostService.getInstance().recordOperation(connectionId, "write", 1);
      }

      documentFileSystemProvider.invalidateAndNotify(connectionId, docRef.path);
      vscode.window.showInformationMessage(
        `Successfully deleted ${selectedIndices.length} item(s) from Array "${targetPathStr}".`
      );
      if (refreshTarget instanceof DocumentItem || refreshTarget instanceof DocumentFieldItem) {
        explorerDataProvider.refreshNode(refreshTarget);
      }
      return;
    }

    if (isScopedMap && targetSegments) {
      const parentSegments = targetSegments;
      const mapData = targetValue || {};
      const keys = Object.keys(mapData);

      if (keys.length === 0) {
        vscode.window.showInformationMessage(`Map "${targetPathStr}" has no properties to delete.`);
        return;
      }

      interface PropPickItem extends vscode.QuickPickItem {
        key: string;
        isSystem: boolean;
      }

      const propItems: PropPickItem[] = keys.map((key) => {
        const val = mapData[key];
        const valType = Array.isArray(val) ? "array" : val === null ? "null" : typeof val;
        const isProtocol = key.startsWith("__");
        const isEnvelope = key.startsWith("_") && !isProtocol;
        const isSystem = isProtocol || isEnvelope;

        let typePreview = valType;
        if (valType === "object" && val !== null) {
          typePreview = `{${Object.keys(val).length} keys}`;
        } else if (valType === "array") {
          typePreview = `[${val.length}]`;
        } else if (valType === "string") {
          typePreview = `"${val.length > 25 ? val.slice(0, 22) + "..." : val}"`;
        } else {
          typePreview = String(val);
        }

        const icon = isProtocol ? "$(shield)" : isEnvelope ? "$(tag)" : "$(symbol-field)";
        const systemBadge = isProtocol ? " [Protocol]" : isEnvelope ? " [Envelope]" : "";

        return {
          label: `${icon} ${key}${systemBadge}`,
          description: `(${typePreview})`,
          picked: false,
          key,
          isSystem,
        };
      });

      const selected = await vscode.window.showQuickPick(propItems, {
        canPickMany: true,
        placeHolder: `Select properties to delete from '${targetPathStr}' (${keys.length} available)`,
        title: `Delete Multiple Properties (${targetPathStr})`,
      });

      if (!selected || selected.length === 0) {
        return;
      }

      const envPrefix = getEnvironmentWarningPrefix(connectionId);
      const selectedKeys = selected.map((s) => s.key);
      const protectSystemKeys = isProtectSystemKeysEnabled();
      const isParentSystem = isSystemFieldPath(parentSegments);
      const hasSystemKeys = isParentSystem || selected.some((s) => s.isSystem);

      let confirmPrompt = `${envPrefix}Are you sure you want to delete ${selectedKeys.length} propert${selectedKeys.length > 1 ? "ies" : "y"} (${selectedKeys.slice(0, 5).join(", ")}${selectedKeys.length > 5 ? "..." : ""}) from Map "${targetPathStr}"?`;
      if (protectSystemKeys && hasSystemKeys) {
        const systemKeyNames = selected.filter((s) => s.isSystem).map((s) => s.key).join(", ");
        confirmPrompt = systemKeyNames
          ? `${envPrefix}⚠️ Safe Mode Warning: You selected System Envelope / Protocol keys (${systemKeyNames}). Proceed with deleting all ${selectedKeys.length} properties?`
          : `${envPrefix}⚠️ Safe Mode Warning: Map "${targetPathStr}" is under a System Envelope / Protocol path. Proceed with deleting ${selectedKeys.length} propert${selectedKeys.length > 1 ? "ies" : "y"}?`;
      }

      const confirm = await vscode.window.showWarningMessage(
        confirmPrompt,
        { modal: true },
        `Delete ${selectedKeys.length} Propert${selectedKeys.length > 1 ? "ies" : "y"}`,
        "Cancel"
      );

      if (confirm !== `Delete ${selectedKeys.length} Propert${selectedKeys.length > 1 ? "ies" : "y"}`) {
        return;
      }

      const confirmedProd = await confirmProductionAction({
        connectionId,
        actionLabel: `Delete ${selectedKeys.length} Properties`,
        targetSummary: `${selectedKeys.length} propert${selectedKeys.length > 1 ? "ies" : "y"} from Map '${targetPathStr}'`,
        expectedInput: `DELETE ${selectedKeys.length}`,
      });
      if (!confirmedProd) {
        return;
      }

      const fullKeyPaths = selectedKeys.map((k) => [...parentSegments, k].join("."));

      if (conn?.isLocalJson) {
        for (const k of selectedKeys) {
          LocalJsonService.getInstance().updateField(conn, docRef.path, [...parentSegments, k], undefined, true);
        }
        documentFileSystemProvider.invalidateAndNotifyFieldDeleted(connectionId, docRef.path, fullKeyPaths);
        vscode.window.showInformationMessage(`Successfully deleted ${selectedKeys.length} propert${selectedKeys.length > 1 ? "ies" : "y"} from "${targetPathStr}".`);
        if (refreshTarget instanceof DocumentItem || refreshTarget instanceof DocumentFieldItem) {
          explorerDataProvider.refreshNode(refreshTarget);
        }
        return;
      }

      // Firestore deletion with array-index safety or FieldPath
      if (parentSegments.some((s) => /^\d+$/.test(s))) {
        const firestore = await ConnectionManager.getInstance().getFirestore(connectionId);
        const typedDocRef = docRef as DocumentReference;
        await firestore.runTransaction(async (tx) => {
          const snap = await tx.get(typedDocRef);
          if (!snap.exists) {
            throw new Error(`Document "${typedDocRef.id}" no longer exists.`);
          }
          const docData = snap.data() || {};
          let cur: any = docData;
          for (const seg of parentSegments) {
            if (Array.isArray(cur) && /^\d+$/.test(seg)) {
              cur = cur[parseInt(seg, 10)];
            } else if (cur && typeof cur === "object") {
              cur = cur[seg];
            } else {
              cur = undefined;
              break;
            }
          }
          if (cur && typeof cur === "object" && !Array.isArray(cur)) {
            for (const k of selectedKeys) {
              delete cur[k];
            }
          }
          const firstNumericIdx = parentSegments.findIndex((s) => /^\d+$/.test(s));
          const topArraySegments = parentSegments.slice(0, firstNumericIdx);
          let topArrayVal: any = docData;
          for (const seg of topArraySegments) {
            topArrayVal = topArrayVal?.[seg];
          }
          tx.update(typedDocRef, new FieldPath(...topArraySegments), topArrayVal);
        });
        CostService.getInstance().recordOperation(connectionId, "read", 1);
        CostService.getInstance().recordOperation(connectionId, "write", 1);
      } else {
        const args: any[] = [];
        for (const k of selectedKeys) {
          args.push(new FieldPath(...parentSegments, k), FieldValue.delete());
        }
        await (docRef.update as any)(...args);
        CostService.getInstance().recordOperation(connectionId, "write", 1);
      }
      documentFileSystemProvider.invalidateAndNotifyFieldDeleted(connectionId, docRef.path, fullKeyPaths);
      vscode.window.showInformationMessage(`Successfully deleted ${selectedKeys.length} propert${selectedKeys.length > 1 ? "ies" : "y"} from "${targetPathStr}".`);
      if (refreshTarget instanceof DocumentItem || refreshTarget instanceof DocumentFieldItem) {
        explorerDataProvider.refreshNode(refreshTarget);
      }
      return;
    }

    const data = freshDocData;

    const keys = Object.keys(data);
    if (keys.length === 0) {
      vscode.window.showInformationMessage(`Document "${docRef.id}" has no fields to delete.`);
      return;
    }

    // Build QuickPick items
    interface FieldPickItem extends vscode.QuickPickItem {
      key: string;
      isSystem: boolean;
    }

    const items: FieldPickItem[] = keys.map((key) => {
      const val = data[key];
      const valType = Array.isArray(val) ? "array" : val === null ? "null" : typeof val;
      const isProtocol = key.startsWith("__");
      const isEnvelope = key.startsWith("_") && !isProtocol;
      const isSystem = isProtocol || isEnvelope;

      let typePreview = valType;
      if (valType === "object" && val !== null) {
        typePreview = `{${Object.keys(val).length} keys}`;
      } else if (valType === "array") {
        typePreview = `[${val.length}]`;
      } else if (valType === "string") {
        typePreview = `"${val.length > 25 ? val.slice(0, 22) + "..." : val}"`;
      } else {
        typePreview = String(val);
      }

      const icon = isProtocol ? "$(shield)" : isEnvelope ? "$(tag)" : "$(symbol-field)";
      const systemBadge = isProtocol ? " [Protocol]" : isEnvelope ? " [Envelope]" : "";

      return {
        label: `${icon} ${key}${systemBadge}`,
        description: `(${typePreview})`,
        picked: false,
        key,
        isSystem,
      };
    });

    const selected = await vscode.window.showQuickPick(items, {
      canPickMany: true,
      placeHolder: `Select fields to delete from '${docRef.id}' (${keys.length} available)`,
      title: `Delete Multiple Fields (${docRef.id})`,
    });

    if (!selected || selected.length === 0) {
      return;
    }

    const envPrefix = getEnvironmentWarningPrefix(connectionId);
    const selectedKeys = selected.map((s) => s.key);
    const config = vscode.workspace.getConfiguration("ketrik-firestore-studio");
    const protectSystemKeys = config.get<boolean>("protectSystemKeys", true);
    const hasSystemKeys = selected.some((s) => s.isSystem);

    let confirmPrompt = `${envPrefix}Are you sure you want to delete ${selectedKeys.length} field(s) (${selectedKeys.slice(0, 5).join(", ")}${selectedKeys.length > 5 ? "..." : ""}) from document "${docRef.id}"?`;
    if (protectSystemKeys && hasSystemKeys) {
      const systemKeyNames = selected.filter((s) => s.isSystem).map((s) => s.key).join(", ");
      confirmPrompt = `${envPrefix}⚠️ Safe Mode Warning: You selected System Envelope / Protocol keys (${systemKeyNames}). Deleting them may disrupt lifecycle operations. Proceed with deleting all ${selectedKeys.length} fields?`;
    }

    const confirm = await vscode.window.showWarningMessage(
      confirmPrompt,
      { modal: true },
      `Delete ${selectedKeys.length} Field${selectedKeys.length > 1 ? "s" : ""}`,
      "Cancel"
    );

    if (confirm !== `Delete ${selectedKeys.length} Field${selectedKeys.length > 1 ? "s" : ""}`) {
      return;
    }

    const confirmedProd = await confirmProductionAction({
      connectionId,
      actionLabel: `Delete ${selectedKeys.length} Field(s)`,
      targetSummary: `${selectedKeys.length} field(s) from document '${docRef.path}'`,
      expectedInput: `DELETE ${selectedKeys.length}`,
    });
    if (!confirmedProd) {
      return;
    }

    if (conn?.isLocalJson) {
      for (const key of selectedKeys) {
        LocalJsonService.getInstance().updateField(conn, docRef.path, [key], undefined, true);
      }
      documentFileSystemProvider.invalidateAndNotifyFieldDeleted(connectionId, docRef.path, selectedKeys);
      vscode.window.showInformationMessage(`Successfully deleted ${selectedKeys.length} field(s) from "${docRef.id}".`);

      if (refreshTarget instanceof DocumentItem || refreshTarget instanceof DocumentFieldItem) {
        explorerDataProvider.refreshNode(refreshTarget);
      }
      return;
    }

    // Build atomic update arguments with FieldPath for dot-safety
    if (selectedKeys.length === 1) {
      await docRef.update(new FieldPath(selectedKeys[0]), FieldValue.delete());
    } else {
      const args: any[] = [];
      for (const key of selectedKeys) {
        args.push(new FieldPath(key), FieldValue.delete());
      }
      await (docRef.update as any)(...args);
    }

    CostService.getInstance().recordOperation(connectionId, "write", 1);
    documentFileSystemProvider.invalidateAndNotifyFieldDeleted(connectionId, docRef.path, selectedKeys);
    vscode.window.showInformationMessage(`Successfully deleted ${selectedKeys.length} field(s) from "${docRef.id}".`);

    if (refreshTarget instanceof DocumentItem || refreshTarget instanceof DocumentFieldItem) {
      explorerDataProvider.refreshNode(refreshTarget);
    }
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to delete multiple fields: ${err.message}`);
  }
}

/**
 * Add a new field to a document or nested property to a map.
 */
export async function addFieldCommand(
  item: DocumentItem | DocumentFieldItem,
  explorerDataProvider: ExplorerDataProvider
) {
  const docRef =
    item instanceof DocumentItem
      ? item.reference
      : item instanceof DocumentFieldItem
        ? item.parentDocRef
        : undefined;

  const connectionId = item?.connectionId;

  if (!docRef) {
    vscode.window.showErrorMessage("No document selected.");
    return;
  }

  if (!ensureWritable(connectionId, "add fields")) {
    return;
  }

  const isMissingDoc = item instanceof DocumentItem && item.isMissingDocument;
  const isMapField =
    item instanceof DocumentFieldItem &&
    (item.contextValue?.startsWith("documentField:map") ||
      (!item.contextValue?.startsWith("documentField:timestamp") &&
        !item.contextValue?.startsWith("documentField:vector") &&
        item.value &&
        typeof item.value === "object" &&
        !Array.isArray(item.value) &&
        !isTimestampLike(item.value)));
  const isNestedSibling =
    item instanceof DocumentFieldItem &&
    !isMapField &&
    !item.isArrayElement &&
    Array.isArray(item.pathSegments) &&
    item.pathSegments.length > 1;
  const parentSegments = isMapField
    ? item.pathSegments && item.pathSegments.length > 0
      ? item.pathSegments
      : [item.fieldName]
    : isNestedSibling
      ? item.pathSegments.slice(0, -1)
      : [];
  const targetLabel = isMapField
    ? item.fullFieldPath || item.fieldName
    : isNestedSibling
      ? parentSegments.join(".")
      : docRef.id;

  const fieldName = await vscode.window.showInputBox({
    prompt:
      isMapField || isNestedSibling
        ? `Enter new Property name for '${targetLabel}'`
        : `Enter new Field name for '${docRef.id}'`,
    placeHolder:
      isMapField || isNestedSibling
        ? "propertyName (e.g. timeout, theme, host)"
        : "fieldName (e.g. settings, tags, status)",
    validateInput: (v) => {
      const trimmed = v.trim();
      if (!trimmed) {
        return "Name cannot be empty";
      }
      if (trimmed.includes("/")) {
        return "Name cannot contain '/'";
      }
      return undefined;
    },
  });

  if (!fieldName) {
    return;
  }

  const typePick = await vscode.window.showQuickPick(
    [
      { label: "$(symbol-namespace) Object / Map ({})", description: "Empty object (opens in editor)", type: "object" },
      { label: "$(symbol-array) Array ([])", description: "Empty array (opens in editor)", type: "array" },
      { label: "$(zap) Vector (FieldValue.vector)", description: "Firestore Vector embedding (number array)", type: "vector" },
      { label: "$(calendar) Timestamp", description: "Set current time (Now) or custom date", type: "timestamp" },
      { label: "$(symbol-string) String", description: "Text value", type: "string" },
      { label: "$(symbol-number) Number", description: "Numeric value", type: "number" },
      { label: "$(symbol-boolean) Boolean", description: "true / false", type: "boolean" },
      { label: "$(json) Custom JSON", description: "Input raw JSON payload", type: "json" },
    ],
    { placeHolder: `Select value type for '${fieldName.trim()}'` }
  );

  if (!typePick) {
    return;
  }

  let fieldValue: any;
  let shouldOpenInEditor = false;

  switch (typePick.type) {
    case "timestamp": {
      const tsChoice = await vscode.window.showQuickPick(
        [
          { label: "$(clock) Current Time (Now)", action: "now" },
          { label: "$(server-process) ServerTimestamp (FieldValue.serverTimestamp)", action: "server" },
          { label: "$(edit) Custom ISO-8601 String", action: "custom" },
        ],
        { placeHolder: `Set Timestamp value for '${fieldName.trim()}'` }
      );
      if (!tsChoice) { return; }
      if (tsChoice.action === "now") {
        fieldValue = Timestamp.now();
      } else if (tsChoice.action === "server") {
        fieldValue = FieldValue.serverTimestamp();
      } else {
        const iso = await vscode.window.showInputBox({
          prompt: `Enter ISO-8601 string for '${fieldName.trim()}'`,
          value: new Date().toISOString(),
          validateInput: (v) => (isNaN(Date.parse(v)) ? "Invalid date format" : undefined),
        });
        if (!iso) { return; }
        fieldValue = Timestamp.fromDate(new Date(iso));
      }
      break;
    }
    case "object":
      fieldValue = {};
      shouldOpenInEditor = true;
      break;
    case "array":
      fieldValue = [];
      shouldOpenInEditor = true;
      break;
    case "vector": {
      const vecInput = await vscode.window.showInputBox({
        prompt: `Enter vector embedding values for '${fieldName.trim()}' (comma-separated numbers or JSON array)`,
        placeHolder: "0.05, -0.12, 0.88, 0.31",
        validateInput: (v) => {
          if (!v.trim()) return "Vector values cannot be empty";
          return undefined;
        },
      });
      if (!vecInput) { return; }
      let nums: number[] = [];
      try {
        const parsed = JSON.parse(vecInput.trim());
        if (Array.isArray(parsed)) {
          nums = parsed.map(Number).filter((n) => !isNaN(n));
        }
      } catch {
        nums = vecInput.split(",").map((s) => Number(s.trim())).filter((n) => !isNaN(n));
      }
      if (nums.length === 0) {
        vscode.window.showErrorMessage("Please provide a valid array of numbers for the vector.");
        return;
      }
      const conn = connectionId ? ConnectionManager.getInstance().getConnection(connectionId) : undefined;
      if (conn?.isLocalJson) {
        fieldValue = nums;
      } else {
        fieldValue = FieldValue.vector(nums);
      }
      break;
    }
    case "string": {
      const strVal = await vscode.window.showInputBox({
        prompt: `Enter string value for '${fieldName.trim()}'`,
        placeHolder: "value",
      });
      if (strVal === undefined) { return; }
      fieldValue = strVal;
      break;
    }
    case "number": {
      const numVal = await vscode.window.showInputBox({
        prompt: `Enter number value for '${fieldName.trim()}'`,
        placeHolder: "0",
        validateInput: (v) => (isNaN(Number(v)) ? "Must be a valid number" : undefined),
      });
      if (numVal === undefined) { return; }
      fieldValue = Number(numVal);
      break;
    }
    case "boolean": {
      const boolPick = await vscode.window.showQuickPick(["true", "false"], {
        placeHolder: `Select boolean value for '${fieldName.trim()}'`,
      });
      if (!boolPick) { return; }
      fieldValue = boolPick === "true";
      break;
    }
    case "json": {
      const jsonVal = await vscode.window.showInputBox({
        prompt: `Enter JSON value for '${fieldName.trim()}'`,
        placeHolder: '{"key": "value"}',
      });
      if (jsonVal === undefined) { return; }
      try {
        fieldValue = JSON.parse(jsonVal || "null");
      } catch {
        vscode.window.showErrorMessage("Invalid JSON value entered.");
        return;
      }
      break;
    }
  }

  try {
    const targetSegments = [...parentSegments, fieldName.trim()];
    const fullTargetStr = targetSegments.join(".");
    const conn = connectionId ? ConnectionManager.getInstance().getConnection(connectionId) : undefined;

    if (conn?.isLocalJson) {
      LocalJsonService.getInstance().updateField(conn, docRef.path, fullTargetStr, fieldValue);
      DocumentFileSystemProvider.getInstance().invalidateAndNotify(connectionId!, docRef.path);
    } else {
      if (isMissingDoc) {
        await docRef.set({ [fieldName.trim()]: fieldValue }, { merge: true });
      } else {
        await docRef.update(new FieldPath(...targetSegments), fieldValue);
      }
      if (connectionId) {
        CostService.getInstance().recordOperation(connectionId, "write", 1);
        DocumentFileSystemProvider.getInstance().invalidateAndNotify(connectionId, docRef.path);
      }
    }
    vscode.window.showInformationMessage(
      isMapField || isNestedSibling
        ? `Property '${fieldName.trim()}' added to '${targetLabel}'!`
        : `Field '${fieldName.trim()}' added!`
    );
    explorerDataProvider.refreshNode(item);
    if (isMissingDoc && docRef.parent) {
      explorerDataProvider.refreshNode(
        new CollectionItem(docRef.parent.id, docRef.parent, connectionId!)
      );
    }

    if (shouldOpenInEditor) {
      await openPath(docRef.path, connectionId, fullTargetStr);
    }
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to add ${isMapField || isNestedSibling ? "property" : "field"}: ${err.message}`);
  }
}

/**
 * Add a nested property inside a Map field.
 */
export async function addNestedPropertyCommand(
  item: DocumentFieldItem,
  explorerDataProvider: ExplorerDataProvider
) {
  return addFieldCommand(item, explorerDataProvider);
}

/**
 * Copy field value formatted as JSON to clipboard.
 */
export async function copyFieldJsonCommand(item: DocumentFieldItem) {
  if (!item) {
    return;
  }
  const value = item.value;
  let text: string;
  if (value && typeof value === "object") {
    text = JSON.stringify(value, null, 2);
  } else if (value === undefined) {
    text = "null";
  } else {
    text = String(value);
  }
  await vscode.env.clipboard.writeText(text);
  vscode.window.showInformationMessage(`Copied JSON for '${item.fullFieldPath || item.fieldName}' to clipboard!`);
}

/**
 * Duplicate a field or nested property under a new name.
 */
export async function duplicateFieldCommand(
  item: DocumentFieldItem,
  explorerDataProvider: ExplorerDataProvider
) {
  if (!item?.parentDocRef || !item?.fieldName) {
    return;
  }

  if (!ensureWritable(item.connectionId, "duplicate fields")) {
    return;
  }

  if (item.isArrayElement) {
    vscode.window.showWarningMessage("Array elements cannot be duplicated by name. Use Add Array Item instead.");
    return;
  }

  const currentSegments =
    item.pathSegments && item.pathSegments.length > 0
      ? item.pathSegments
      : [item.fieldName];
  const parentSegments = currentSegments.slice(0, -1);
  const oldPathStr = currentSegments.join(".");

  const defaultNewName = `${item.fieldName}_copy`;
  const newName = await vscode.window.showInputBox({
    prompt: `Duplicate field '${oldPathStr}' as`,
    value: defaultNewName,
    validateInput: (v) => {
      const trimmed = v.trim();
      if (!trimmed) {
        return "Field name cannot be empty";
      }
      if (trimmed === item.fieldName) {
        return "New field name must be different from original";
      }
      if (trimmed.includes("/")) {
        return "Field name cannot contain '/'";
      }
      return undefined;
    },
  });

  if (!newName || newName.trim() === item.fieldName) {
    return;
  }

  const targetName = newName.trim();
  const targetSegments = [...parentSegments, targetName];
  const newPathStr = targetSegments.join(".");

  try {
    const conn = ConnectionManager.getInstance().getConnection(item.connectionId);
    let valToClone = item.value;
    if (valToClone !== null && typeof valToClone === "object" && !isTimestampLike(valToClone)) {
      try {
        valToClone = JSON.parse(JSON.stringify(valToClone));
      } catch { }
    }

    if (conn?.isLocalJson) {
      LocalJsonService.getInstance().updateField(conn, item.parentDocRef.path, newPathStr, valToClone);
      DocumentFileSystemProvider.getInstance().invalidateAndNotify(item.connectionId, item.parentDocRef.path);
      vscode.window.showInformationMessage(`Duplicated '${oldPathStr}' to '${newPathStr}'!`);
      const refreshTarget = item.parentFieldItem || item;
      explorerDataProvider.refreshNode(refreshTarget);
      return;
    }

    await item.parentDocRef.update(new FieldPath(...targetSegments), valToClone);
    if (item.connectionId) {
      CostService.getInstance().recordOperation(item.connectionId, "write", 1);
      DocumentFileSystemProvider.getInstance().invalidateAndNotify(item.connectionId, item.parentDocRef.path);
    }
    vscode.window.showInformationMessage(`Duplicated '${oldPathStr}' to '${newPathStr}'!`);
    const refreshTarget = item.parentFieldItem || item;
    explorerDataProvider.refreshNode(refreshTarget);
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to duplicate field: ${err.message}`);
  }
}

/**
 * Helper to mutate an array within a document in Firestore or Local JSON.
 */
async function mutateDocumentArray(
  item: DocumentFieldItem,
  mutator: (arr: any[]) => void,
  actionDesc: string,
  explorerDataProvider: ExplorerDataProvider
): Promise<boolean> {
  if (!item?.parentDocRef) return false;

  const parentArray = item.isArrayElement ? (item.parentArrayItem || item) : item;
  const arraySegments =
    parentArray.pathSegments && parentArray.pathSegments.length > 0
      ? parentArray.pathSegments
      : [parentArray.fieldName];
  const arrayPathStr = arraySegments.join(".");

  try {
    const conn = ConnectionManager.getInstance().getConnection(item.connectionId);
    let arr: any[] = [];

    if (conn?.isLocalJson) {
      const doc = LocalJsonService.getInstance().getDocument(conn, item.parentDocRef.path) || {};
      let cur: any = doc;
      for (let i = 0; i < arraySegments.length - 1; i++) {
        cur = cur?.[arraySegments[i]];
      }
      const existing = cur?.[arraySegments[arraySegments.length - 1]];
      arr = Array.isArray(existing) ? [...existing] : [];
      mutator(arr);
      if (cur) {
        cur[arraySegments[arraySegments.length - 1]] = arr;
      }
      LocalJsonService.getInstance().setDocument(conn, item.parentDocRef.path, doc);
    } else {
      const firestore = await ConnectionManager.getInstance().getFirestore(item.connectionId);
      await firestore.runTransaction(async (tx) => {
        const snap = await tx.get(item.parentDocRef);
        if (!snap.exists) {
          throw new Error(`Document "${item.parentDocRef.id}" no longer exists.`);
        }
        const docData = snap.data() || {};
        let cur: any = docData;
        for (let i = 0; i < arraySegments.length - 1; i++) {
          const seg = arraySegments[i];
          cur = Array.isArray(cur) && /^\d+$/.test(seg) ? cur[parseInt(seg, 10)] : cur?.[seg];
        }
        const lastSeg = arraySegments[arraySegments.length - 1];
        const existing =
          Array.isArray(cur) && /^\d+$/.test(lastSeg) ? cur[parseInt(lastSeg, 10)] : cur?.[lastSeg];
        arr = Array.isArray(existing) ? [...existing] : [];
        mutator(arr);
        if (cur && typeof cur === "object") {
          if (Array.isArray(cur) && /^\d+$/.test(lastSeg)) {
            cur[parseInt(lastSeg, 10)] = arr;
          } else {
            cur[lastSeg] = arr;
          }
        }
        const firstNumericIdx = arraySegments.findIndex((s) => /^\d+$/.test(s));
        if (firstNumericIdx > 0) {
          const topArraySegments = arraySegments.slice(0, firstNumericIdx);
          let topArrayVal: any = docData;
          for (const seg of topArraySegments) {
            topArrayVal = topArrayVal?.[seg];
          }
          tx.update(item.parentDocRef, new FieldPath(...topArraySegments), topArrayVal);
        } else {
          tx.update(item.parentDocRef, new FieldPath(...arraySegments), arr);
        }
      });
      CostService.getInstance().recordOperation(item.connectionId, "read", 1);
      CostService.getInstance().recordOperation(item.connectionId, "write", 1);
    }

    if (parentArray) {
      parentArray.value = arr;
    }
    DocumentFileSystemProvider.getInstance().invalidateAndNotify(item.connectionId, item.parentDocRef.path);
    explorerDataProvider.refreshNode(parentArray || item);
    vscode.window.showInformationMessage(`${actionDesc} in '${arrayPathStr}'!`);
    return true;
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to ${actionDesc.toLowerCase()}: ${err.message}`);
    return false;
  }
}

/**
 * Edit a single array element in place.
 */
export async function editArrayItemCommand(
  item: DocumentFieldItem,
  explorerDataProvider: ExplorerDataProvider
) {
  if (!item?.parentDocRef || item.arrayIndex === undefined) {
    vscode.window.showErrorMessage("No array item selected.");
    return;
  }

  if (!ensureWritable(item.connectionId, "edit array items")) {
    return;
  }

  const idx = item.arrayIndex;
  const val = item.value;
  const parentName = item.parentArrayItem?.fieldName || "array";
  const valType = Array.isArray(val)
    ? "array"
    : val === null
      ? "null"
      : typeof val;

  let newVal: any;

  if (valType === "string") {
    const input = await vscode.window.showInputBox({
      prompt: `Edit item [${idx}] for '${parentName}' (String)`,
      value: String(val),
    });
    if (input === undefined) return;
    newVal = input;
  } else if (valType === "number") {
    const input = await vscode.window.showInputBox({
      prompt: `Edit item [${idx}] for '${parentName}' (Number)`,
      value: String(val),
      validateInput: (v) => (isNaN(Number(v)) ? "Must be a valid number" : undefined),
    });
    if (input === undefined) return;
    newVal = Number(input);
  } else if (valType === "boolean") {
    const pick = await vscode.window.showQuickPick(
      [
        { label: "true", description: val === true ? "(current)" : undefined },
        { label: "false", description: val === false ? "(current)" : undefined },
      ],
      { placeHolder: `Set boolean value for item [${idx}]` }
    );
    if (!pick) return;
    newVal = pick.label === "true";
  } else if (valType === "object" && isTimestampLike(val)) {
    const curDate = timestampToDate(val) ?? new Date();
    const action = await vscode.window.showQuickPick(
      [
        { label: "$(clock) Set to Now", action: "now" },
        { label: "$(edit) Edit ISO Date String", action: "custom" },
      ],
      { placeHolder: `Update timestamp for item [${idx}]` }
    );
    if (!action) return;
    if (action.action === "now") {
      newVal = Timestamp.now();
    } else {
      const input = await vscode.window.showInputBox({
        prompt: `Enter ISO-8601 string for item [${idx}]`,
        value: curDate.toISOString(),
        validateInput: (v) => (isNaN(Date.parse(v)) ? "Invalid ISO-8601 date string" : undefined),
      });
      if (!input) return;
      newVal = Timestamp.fromDate(new Date(input));
    }
  } else {
    // Complex object, array, or null: provide QuickPick
    const currentJson = JSON.stringify(val, null, 2);
    const action = await vscode.window.showQuickPick(
      [
        { label: "$(json) Edit as JSON String", action: "json", description: "Edit full JSON payload inline" },
        { label: "$(edit) Open in Document Editor", action: "editor", description: "Jump directly into document JSON editor" },
        { label: "$(repo-forked) Duplicate Item", action: "duplicate", description: "Insert a clone of this item" },
        { label: "$(trash) Delete Item", action: "delete", description: "Remove this item from the array" },
      ],
      { placeHolder: `Choose action for item [${idx}]` }
    );
    if (!action) return;

    if (action.action === "editor") {
      const parentSegments =
        item.parentArrayItem?.pathSegments ||
        (item.pathSegments ? item.pathSegments.slice(0, -1) : [item.fieldName]);
      await openPath(item.parentDocRef.path, item.connectionId, parentSegments.join("."));
      return;
    } else if (action.action === "duplicate") {
      await duplicateArrayItemCommand(item, explorerDataProvider);
      return;
    } else if (action.action === "delete") {
      await deleteArrayItemCommand(item, explorerDataProvider);
      return;
    } else if (action.action === "json") {
      const input = await vscode.window.showInputBox({
        prompt: `Edit JSON for item [${idx}]`,
        value: currentJson,
        validateInput: (v) => {
          try {
            JSON.parse(v);
            return undefined;
          } catch {
            return "Invalid JSON syntax";
          }
        },
      });
      if (input === undefined) return;
      newVal = JSON.parse(input);
    }
  }

  await mutateDocumentArray(
    item,
    (arr) => {
      arr[idx] = newVal;
    },
    `Updated item [${idx}]`,
    explorerDataProvider
  );
}

/**
 * Duplicate a single array element at index + 1.
 */
export async function duplicateArrayItemCommand(
  item: DocumentFieldItem,
  explorerDataProvider: ExplorerDataProvider
) {
  if (!item?.parentDocRef || item.arrayIndex === undefined) {
    vscode.window.showErrorMessage("No array item selected.");
    return;
  }

  if (!ensureWritable(item.connectionId, "duplicate array items")) {
    return;
  }

  const idx = item.arrayIndex;
  let cloneVal = item.value;
  try {
    cloneVal = JSON.parse(JSON.stringify(cloneVal));
  } catch { }

  await mutateDocumentArray(
    item,
    (arr) => {
      arr.splice(idx + 1, 0, cloneVal);
    },
    `Duplicated item [${idx}]`,
    explorerDataProvider
  );
}

/**
 * Delete a single array element from its parent array.
 */
export async function deleteArrayItemCommand(
  item: DocumentFieldItem,
  explorerDataProvider: ExplorerDataProvider
) {
  if (!item?.parentDocRef || item.arrayIndex === undefined) {
    vscode.window.showErrorMessage("No array item selected.");
    return;
  }

  if (!ensureWritable(item.connectionId, "delete array items")) {
    return;
  }

  const idx = item.arrayIndex;
  const parentArray = item.parentArrayItem || item;
  const parentSegments =
    parentArray.pathSegments && parentArray.pathSegments.length > 0
      ? parentArray.pathSegments
      : [parentArray.fieldName];
  const parentName = parentArray.fieldName || "array";

  let previewStr = "";
  try {
    const raw = JSON.stringify(item.value);
    if (raw !== undefined) {
      previewStr = raw.length > 50 ? `${raw.slice(0, 47)}...` : raw;
    }
  } catch {
    previewStr = String(item.value);
  }
  const envPrefix = getEnvironmentWarningPrefix(item.connectionId);
  const valueDetail = previewStr ? ` (${previewStr})` : "";
  const safeWarning =
    isProtectSystemKeysEnabled() && isSystemFieldPath(parentSegments)
      ? `⚠️ Safe Mode Warning: '${parentSegments.join(".")}' is a System Envelope or Protocol field.\n\n`
      : "";

  const confirm = await vscode.window.showWarningMessage(
    `${envPrefix}${safeWarning}Are you sure you want to delete item [${idx}]${valueDetail} from '${parentName}'?`,
    { modal: true },
    "Delete Item",
    "Cancel"
  );
  if (confirm !== "Delete Item") return;

  const ok = await mutateDocumentArray(
    item,
    (arr) => {
      if (idx >= 0 && idx < arr.length) {
        arr.splice(idx, 1);
      }
    },
    `Deleted item [${idx}]`,
    explorerDataProvider
  );
  if (ok) {
    DocumentFileSystemProvider.getInstance().invalidateAndNotifyFieldDeleted(
      item.connectionId,
      item.parentDocRef.path,
      item.fullFieldPath
    );
  }
}

/**
 * Add a new item to an array field.
 */
export async function addArrayItemCommand(
  item: DocumentFieldItem,
  explorerDataProvider: ExplorerDataProvider
) {
  if (!item?.parentDocRef) {
    vscode.window.showErrorMessage("No array selected.");
    return;
  }

  if (!ensureWritable(item.connectionId, "add array items")) {
    return;
  }

  const parentArray = item.isArrayElement ? (item.parentArrayItem || item) : item;
  const parentName = parentArray.fieldName;

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
    { placeHolder: `Select value type for new item in '${parentName}'` }
  );
  if (!typePick) return;

  let entryVal: any;
  switch (typePick.type) {
    case "string": {
      const strVal = await vscode.window.showInputBox({
        prompt: `Enter string value for new item in '${parentName}'`,
      });
      if (strVal === undefined) return;
      entryVal = strVal;
      break;
    }
    case "number": {
      const numVal = await vscode.window.showInputBox({
        prompt: `Enter numeric value for new item in '${parentName}'`,
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
        prompt: "Enter raw JSON for new array item",
        placeHolder: '{"key": "value"}',
        validateInput: (v) => {
          try {
            JSON.parse(v || "null");
            return undefined;
          } catch {
            return "Invalid JSON syntax";
          }
        },
      });
      if (jsonStr === undefined) return;
      entryVal = JSON.parse(jsonStr || "null");
      break;
    }
  }

  await mutateDocumentArray(
    parentArray,
    (arr) => {
      arr.push(entryVal);
    },
    `Added item [${Array.isArray(parentArray.value) ? parentArray.value.length : 0}]`,
    explorerDataProvider
  );
}


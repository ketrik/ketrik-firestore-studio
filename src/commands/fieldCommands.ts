import * as vscode from "vscode";
import { DocumentFieldItem, DocumentItem } from "../explorer/items";
import openPath from "./openPath";
import { DocumentFileSystemProvider } from "../editor/DocumentFileSystemProvider";
import ExplorerDataProvider from "../explorer/ExplorerDataProvider";
import { ConnectionManager } from "../connections/ConnectionManager";
import { FieldPath, FieldValue, Timestamp } from "firebase-admin/firestore";
import { isTimestampLike, timestampToDate, formatDateTime } from "../utils/timestampUtils";
import { LocalJsonService } from "../services/LocalJsonService";
import { CostService } from "../cost/costService";

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
  const setDocField = async (newVal: any) => {
    if (conn?.isLocalJson) {
      LocalJsonService.getInstance().updateField(conn, item.parentDocRef.path, item.fieldName, newVal);
    } else {
      await item.parentDocRef.update(new FieldPath(item.fieldName), newVal);
      CostService.getInstance().recordOperation(item.connectionId, "write", 1);
    }
  };

  const value = item.value;
  const valType = Array.isArray(value)
    ? "array"
    : value === null
    ? "null"
    : typeof value;

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
      { placeHolder: `Edit Timestamp for '${item.fieldName}' (Current: ${curLocal})` }
    );

    if (!action) {
      return;
    }

    if (action.action === "editor") {
      await openPath(item.parentDocRef.path, item.connectionId, item.fieldName);
      return;
    }

    try {
      if (action.action === "now") {
        await setDocField(Timestamp.now());
      } else if (action.action === "serverTimestamp") {
        await setDocField(FieldValue.serverTimestamp());
      } else if (action.action === "custom") {
        const input = await vscode.window.showInputBox({
          prompt: `Enter ISO-8601 or Date string for '${item.fieldName}'`,
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
      vscode.window.showInformationMessage(`Updated timestamp '${item.fieldName}'`);
      explorerDataProvider.refreshNode(item);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to update timestamp: ${err.message}`);
    }
    return;
  }

  // If it's a complex type (object or array), open directly in the virtual JSON editor
  if (valType === "object" || valType === "array") {
    await openPath(item.parentDocRef.path, item.connectionId, item.fieldName);
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
      await openPath(item.parentDocRef.path, item.connectionId, item.fieldName);
      return;
    }

    if (typeChoice.type === "object") {
      await setDocField({});
      DocumentFileSystemProvider.getInstance().invalidateAndNotify(item.connectionId, item.parentDocRef.path);
      explorerDataProvider.refreshNode(item);
      await openPath(item.parentDocRef.path, item.connectionId, item.fieldName);
      return;
    }

    if (typeChoice.type === "array") {
      await setDocField([]);
      DocumentFileSystemProvider.getInstance().invalidateAndNotify(item.connectionId, item.parentDocRef.path);
      explorerDataProvider.refreshNode(item);
      await openPath(item.parentDocRef.path, item.connectionId, item.fieldName);
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

  const newName = await vscode.window.showInputBox({
    prompt: `Rename field '${item.fieldName}'`,
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

  // Safe Mode: Protection for System Envelope and Protocol keys
  const config = vscode.workspace.getConfiguration("ketrik-firestore-studio");
  const protectSystemKeys = config.get<boolean>("protectSystemKeys", true);
  const isSystemKey = item.fieldName.startsWith("_");
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
      if (!(item.fieldName in data)) {
        vscode.window.showErrorMessage(`Field "${item.fieldName}" no longer exists.`);
        return;
      }
      if (targetName in data) {
        const overwrite = await vscode.window.showWarningMessage(
          `Field "${targetName}" already exists on document "${item.parentDocRef.id}". Overwrite it?`,
          { modal: true },
          "Overwrite",
          "Cancel"
        );
        if (overwrite !== "Overwrite") {
          return;
        }
      }
      const existingValue = data[item.fieldName];
      delete data[item.fieldName];
      data[targetName] = existingValue;
      LocalJsonService.getInstance().setDocument(conn, item.parentDocRef.path, data);

      documentFileSystemProvider.invalidateAndNotify(item.connectionId, item.parentDocRef.path);
      vscode.window.showInformationMessage(`Renamed '${item.fieldName}' to '${targetName}'`);
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
    if (!(item.fieldName in data)) {
      vscode.window.showErrorMessage(`Field "${item.fieldName}" no longer exists.`);
      return;
    }

    if (targetName in data) {
      const overwrite = await vscode.window.showWarningMessage(
        `Field "${targetName}" already exists on document "${item.parentDocRef.id}". Overwrite it?`,
        { modal: true },
        "Overwrite",
        "Cancel"
      );
      if (overwrite !== "Overwrite") {
        return;
      }
    }

    const existingValue = data[item.fieldName];

    await item.parentDocRef.update(
      new FieldPath(targetName),
      existingValue,
      new FieldPath(item.fieldName),
      FieldValue.delete()
    );
    CostService.getInstance().recordOperation(item.connectionId, "write", 1);

    documentFileSystemProvider.invalidateAndNotify(item.connectionId, item.parentDocRef.path);
    vscode.window.showInformationMessage(`Renamed '${item.fieldName}' to '${targetName}'`);
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

  // Fallback to active editor if triggered without an item argument (e.g. keybinding or command palette)
  if (!targetItem?.parentDocRef || !targetItem?.fieldName) {
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor && activeEditor.document.uri.scheme === "ketrik-firestore-studio") {
      const parsed = documentFileSystemProvider.parseUri(activeEditor.document.uri);
      if (parsed.connectionId && parsed.docPath && parsed.fieldPath) {
        try {
          const firestore = await ConnectionManager.getInstance().getFirestore(parsed.connectionId);
          const docRef = firestore.doc(parsed.docPath);
          targetItem = {
            parentDocRef: docRef,
            fieldName: parsed.fieldPath,
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

  const config = vscode.workspace.getConfiguration("ketrik-firestore-studio");
  const protectSystemKeys = config.get<boolean>("protectSystemKeys", true);
  const isSystemKey = targetItem.fieldName.startsWith("_");

  const promptText = (protectSystemKeys && isSystemKey)
    ? `⚠️ Safe Mode Warning: "${targetItem.fieldName}" is a System Envelope or Protocol key. Deleting it may break query filtering or lifecycle rules. Are you sure?`
    : `Are you sure you want to delete the field "${targetItem.fieldName}" from document "${targetItem.parentDocRef.id}"?`;

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
        LocalJsonService.getInstance().updateField(conn, targetItem.parentDocRef.path, targetItem.fieldName, undefined, true);
        documentFileSystemProvider.invalidateAndNotify(targetItem.connectionId, targetItem.parentDocRef.path);
        vscode.window.showInformationMessage(`Field "${targetItem.fieldName}" deleted!`);
        explorerDataProvider.refreshNode(targetItem);
        return;
      }

      await targetItem.parentDocRef.update(new FieldPath(targetItem.fieldName), FieldValue.delete());
      CostService.getInstance().recordOperation(targetItem.connectionId, "write", 1);
      documentFileSystemProvider.invalidateAndNotify(targetItem.connectionId, targetItem.parentDocRef.path);
      vscode.window.showInformationMessage(`Field "${targetItem.fieldName}" deleted!`);
      explorerDataProvider.refreshNode(targetItem);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to delete field: ${err.message}`);
    }
  }
}

/**
 * Delete multiple fields atomically from a document using a multi-select QuickPick checklist.
 */
export async function deleteMultipleFieldsCommand(
  item: DocumentItem | DocumentFieldItem | vscode.Uri | undefined,
  explorerDataProvider: ExplorerDataProvider,
  documentFileSystemProvider: DocumentFileSystemProvider
) {
  let docRef: any | undefined;
  let connectionId: string | undefined;
  let refreshTarget: any = item;

  if (item instanceof DocumentItem) {
    docRef = item.reference;
    connectionId = item.connectionId;
  } else if (item instanceof DocumentFieldItem) {
    docRef = item.parentDocRef;
    connectionId = item.connectionId;
  } else if (item instanceof vscode.Uri) {
    const parsed = documentFileSystemProvider.parseUri(item);
    connectionId = parsed.connectionId;
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

  try {
    const conn = ConnectionManager.getInstance().getConnection(connectionId);
    let data: Record<string, any> = {};

    if (conn?.isLocalJson) {
      data = LocalJsonService.getInstance().getDocument(conn, docRef.path) || {};
    } else {
      CostService.getInstance().recordOperation(connectionId, "read", 1);
      const snapshot = await docRef.get();
      if (!snapshot.exists) {
        vscode.window.showErrorMessage(`Document "${docRef.id}" does not exist.`);
        return;
      }
      data = snapshot.data() || {};
    }

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

    const selectedKeys = selected.map((s) => s.key);
    const config = vscode.workspace.getConfiguration("ketrik-firestore-studio");
    const protectSystemKeys = config.get<boolean>("protectSystemKeys", true);
    const hasSystemKeys = selected.some((s) => s.isSystem);

    let confirmPrompt = `Are you sure you want to delete ${selectedKeys.length} field(s) (${selectedKeys.slice(0, 5).join(", ")}${selectedKeys.length > 5 ? "..." : ""}) from document "${docRef.id}"?`;
    if (protectSystemKeys && hasSystemKeys) {
      const systemKeyNames = selected.filter((s) => s.isSystem).map((s) => s.key).join(", ");
      confirmPrompt = `⚠️ Safe Mode Warning: You selected System Envelope / Protocol keys (${systemKeyNames}). Deleting them may disrupt lifecycle operations. Proceed with deleting all ${selectedKeys.length} fields?`;
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

    if (conn?.isLocalJson) {
      for (const key of selectedKeys) {
        LocalJsonService.getInstance().updateField(conn, docRef.path, key, undefined, true);
      }
      documentFileSystemProvider.invalidateAndNotify(connectionId, docRef.path);
      vscode.window.showInformationMessage(`Successfully deleted ${selectedKeys.length} field(s) from "${docRef.id}".`);

      if (refreshTarget) {
        explorerDataProvider.refreshNode(refreshTarget);
      } else {
        explorerDataProvider.refresh();
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
    documentFileSystemProvider.invalidateAndNotify(connectionId, docRef.path);
    vscode.window.showInformationMessage(`Successfully deleted ${selectedKeys.length} field(s) from "${docRef.id}".`);

    if (refreshTarget) {
      explorerDataProvider.refreshNode(refreshTarget);
    } else {
      explorerDataProvider.refresh();
    }
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to delete fields: ${err.message}`);
  }
}

/**
 * Add a new field to a document.
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

  const fieldName = await vscode.window.showInputBox({
    prompt: "Enter new Field name",
    placeHolder: "fieldName (e.g. settings, tags, status)",
    validateInput: (v) => {
      const trimmed = v.trim();
      if (!trimmed) {
        return "Field name cannot be empty";
      }
      if (trimmed.includes("/")) {
        return "Field name cannot contain '/'";
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
      { label: "$(calendar) Timestamp", description: "Set current time (Now) or custom date", type: "timestamp" },
      { label: "$(symbol-string) String", description: "Text value", type: "string" },
      { label: "$(symbol-number) Number", description: "Numeric value", type: "number" },
      { label: "$(symbol-boolean) Boolean", description: "true / false", type: "boolean" },
      { label: "$(json) Custom JSON", description: "Input raw JSON payload", type: "json" },
    ],
    { placeHolder: `Select value type for field '${fieldName.trim()}'` }
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
    const conn = connectionId ? ConnectionManager.getInstance().getConnection(connectionId) : undefined;
    if (conn?.isLocalJson) {
      LocalJsonService.getInstance().updateField(conn, docRef.path, fieldName.trim(), fieldValue);
      DocumentFileSystemProvider.getInstance().invalidateAndNotify(connectionId!, docRef.path);
    } else {
      await docRef.update(new FieldPath(fieldName.trim()), fieldValue);
      if (connectionId) {
        CostService.getInstance().recordOperation(connectionId, "write", 1);
        DocumentFileSystemProvider.getInstance().invalidateAndNotify(connectionId, docRef.path);
      }
    }
    vscode.window.showInformationMessage(`Field '${fieldName.trim()}' added!`);
    explorerDataProvider.refreshNode(item);

    if (shouldOpenInEditor) {
      await openPath(docRef.path, connectionId, fieldName.trim());
    }
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to add field: ${err.message}`);
  }
}

import * as vscode from "vscode";
import { DocumentFieldItem, DocumentItem } from "../explorer/items";
import openPath from "./openPath";
import { DocumentFileSystemProvider } from "../editor/DocumentFileSystemProvider";
import ExplorerDataProvider from "../explorer/ExplorerDataProvider";
import { FieldValue } from "firebase-admin/firestore";

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

  const value = item.value;
  const valType = Array.isArray(value)
    ? "array"
    : value === null
    ? "null"
    : typeof value;

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
      await item.parentDocRef.update({
        [item.fieldName]: newValue,
      });
      vscode.window.showInformationMessage(`Updated '${item.fieldName}' to ${newValue}`);
      explorerDataProvider.refresh();
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
      await item.parentDocRef.update({
        [item.fieldName]: newNum,
      });
      vscode.window.showInformationMessage(`Updated '${item.fieldName}' to ${newNum}`);
      explorerDataProvider.refresh();
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
      await item.parentDocRef.update({ [item.fieldName]: {} });
      explorerDataProvider.refresh();
      await openPath(item.parentDocRef.path, item.connectionId, item.fieldName);
      return;
    }

    if (typeChoice.type === "array") {
      await item.parentDocRef.update({ [item.fieldName]: [] });
      explorerDataProvider.refresh();
      await openPath(item.parentDocRef.path, item.connectionId, item.fieldName);
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
      await item.parentDocRef.update({ [item.fieldName]: bVal });
      vscode.window.showInformationMessage(`Updated '${item.fieldName}' to ${bVal}`);
      explorerDataProvider.refresh();
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
      await item.parentDocRef.update({ [item.fieldName]: nVal });
      vscode.window.showInformationMessage(`Updated '${item.fieldName}' to ${nVal}`);
      explorerDataProvider.refresh();
      return;
    }

    if (typeChoice.type === "string") {
      const strInput = await vscode.window.showInputBox({
        prompt: `Enter string value for '${item.fieldName}'`,
      });
      if (strInput === undefined) {
        return;
      }
      await item.parentDocRef.update({ [item.fieldName]: strInput });
      vscode.window.showInformationMessage(`Updated '${item.fieldName}'`);
      explorerDataProvider.refresh();
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
    await item.parentDocRef.update({
      [item.fieldName]: input,
    });
    vscode.window.showInformationMessage(`Updated '${item.fieldName}'`);
    explorerDataProvider.refresh();
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

    await item.parentDocRef.update({
      [targetName]: existingValue,
      [item.fieldName]: FieldValue.delete(),
    });

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
  item: DocumentFieldItem,
  explorerDataProvider: ExplorerDataProvider,
  documentFileSystemProvider: DocumentFileSystemProvider
) {
  if (!item?.parentDocRef || !item?.fieldName) {
    return;
  }

  const config = vscode.workspace.getConfiguration("ketrik-firestore-studio");
  const protectSystemKeys = config.get<boolean>("protectSystemKeys", true);
  const isSystemKey = item.fieldName.startsWith("_");

  const promptText = (protectSystemKeys && isSystemKey)
    ? `⚠️ Safe Mode Warning: "${item.fieldName}" is a System Envelope or Protocol key. Deleting it may break query filtering or lifecycle rules. Are you sure?`
    : `Are you sure you want to delete the field "${item.fieldName}" from document "${item.parentDocRef.id}"?`;

  const confirm = await vscode.window.showWarningMessage(
    promptText,
    { modal: true },
    "Delete Field",
    "Cancel"
  );

  if (confirm === "Delete Field") {
    try {
      await item.parentDocRef.update({
        [item.fieldName]: FieldValue.delete(),
      });
      documentFileSystemProvider.invalidateAndNotify(item.connectionId, item.parentDocRef.path);
      vscode.window.showInformationMessage(`Field "${item.fieldName}" deleted!`);
      explorerDataProvider.refreshNode(item);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to delete field: ${err.message}`);
    }
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
    await docRef.update({
      [fieldName.trim()]: fieldValue,
    });
    vscode.window.showInformationMessage(`Field '${fieldName.trim()}' added!`);
    explorerDataProvider.refresh();

    if (shouldOpenInEditor) {
      await openPath(docRef.path, connectionId, fieldName.trim());
    }
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to add field: ${err.message}`);
  }
}

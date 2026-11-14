import * as vscode from "vscode";
import { CollectionItem } from "../explorer/items";
import { ConnectionManager } from "../connections/ConnectionManager";
import { LocalJsonService } from "../services/LocalJsonService";
import ExplorerDataProvider from "../explorer/ExplorerDataProvider";
import { TransformService } from "./transformService";
import { TransformActionType, TransformRule } from "./types";
import { parseFilterValue } from "../webview/common/tableUtils";

export interface TransformWizardInitialParams {
  connectionId: string;
  collectionPath: string;
  targetField?: string;
  suggestedAction?: TransformActionType;
  newFieldName?: string;
  defaultValue?: any;
}

/**
 * Launch the Interactive Bulk Field Transformation Wizard.
 */
export async function transformCollectionFieldCommand(
  target?: CollectionItem | TransformWizardInitialParams | any,
  explorerDataProvider?: ExplorerDataProvider
): Promise<void> {
  const connectionManager = ConnectionManager.getInstance();

  let connectionId: string;
  let collectionPath: string;
  let initialField: string | undefined;
  let initialAction: TransformActionType | undefined;

  if (target instanceof CollectionItem) {
    connectionId = target.connectionId;
    collectionPath = target.reference.path;
  } else if (target && "connectionId" in target && "collectionPath" in target) {
    connectionId = target.connectionId;
    collectionPath = target.collectionPath;
    initialField = target.targetField;
    initialAction = target.suggestedAction;
  } else {
    // Interactive QuickPick for connection and collection
    const connections = connectionManager.getConnections();
    if (connections.length === 0) {
      vscode.window.showInformationMessage("No connections configured. Please add a connection first.");
      return;
    }

    let chosenConn = connections[0];
    if (connections.length > 1) {
      const picked = await vscode.window.showQuickPick(
        connections.map((c) => ({
          label: `${c.readOnly ? "$(lock)" : "$(database)"} ${c.name}`,
          description: c.readOnly ? "Read-Only" : c.projectId || c.id,
          conn: c,
        })),
        { placeHolder: "Select connection for bulk field transformation" }
      );
      if (!picked) return;
      chosenConn = picked.conn;
    }
    connectionId = chosenConn.id;

    let colls: string[] = [];
    if (chosenConn.isLocalJson) {
      colls = LocalJsonService.getInstance().listCollections(chosenConn);
    } else {
      try {
        const firestore = await connectionManager.getFirestore(connectionId);
        const list = await firestore.listCollections();
        colls = list.map((c) => c.id);
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to list collections: ${err.message}`);
        return;
      }
    }

    if (colls.length === 0) {
      vscode.window.showInformationMessage("No collections found in this database.");
      return;
    }

    const pickedColl = await vscode.window.showQuickPick(colls, {
      placeHolder: "Select collection to transform",
    });
    if (!pickedColl) return;
    collectionPath = pickedColl;
  }

  const conn = connectionManager.getConnection(connectionId);
  if (conn?.readOnly) {
    vscode.window.showErrorMessage(
      `Connection '${conn.name}' is currently in Read-Only mode. Unlock it from the connection context menu to perform bulk transformations.`
    );
    return;
  }

  // 1. Target Field selection
  let targetField = initialField;
  if (!targetField) {
    const inputField = await vscode.window.showInputBox({
      title: `Transform Collection Field: ${collectionPath}`,
      prompt: "Enter the target field name or dot-notation path (e.g. price, profile.age, createdAt)",
      placeHolder: "field_name",
      validateInput: (val) => (val && val.trim().length > 0 ? null : "Field name cannot be empty"),
    });
    if (!inputField) return;
    targetField = inputField.trim();
  }

  // 2. Transformation Action Selection
  const actions: { label: string; description: string; detail: string; action: TransformActionType }[] = [
    {
      label: "$(symbol-numeric) Cast String ➔ Number",
      description: "e.g. \"49.99\" ➔ 49.99",
      detail: "Parses numeric strings into Firestore double / integer numbers",
      action: "cast_string_to_number",
    },
    {
      label: "$(symbol-string) Cast Number ➔ String",
      description: "e.g. 42 ➔ \"42\"",
      detail: "Converts numbers into string representation",
      action: "cast_number_to_string",
    },
    {
      label: "$(watch) Cast String ➔ Firestore Timestamp",
      description: "e.g. ISO-8601 string ➔ Timestamp",
      detail: "Parses ISO date strings or epoch timestamps into native Firestore Timestamps",
      action: "cast_string_to_timestamp",
    },
    {
      label: "$(symbol-string) Cast Timestamp ➔ ISO String",
      description: "e.g. Timestamp ➔ \"2026-11-13T00:00:00.000Z\"",
      detail: "Converts native Firestore Timestamps into ISO-8601 strings",
      action: "cast_timestamp_to_string",
    },
    {
      label: "$(symbol-number) Cast Timestamp ➔ Epoch Milliseconds",
      description: "e.g. Timestamp ➔ 1794528000000",
      detail: "Converts native Firestore Timestamps into Unix epoch millisecond numbers",
      action: "cast_timestamp_to_millis",
    },
    {
      label: "$(watch) Cast Epoch Milliseconds ➔ Firestore Timestamp",
      description: "e.g. 1794528000000 ➔ Timestamp",
      detail: "Converts epoch millisecond numbers into native Firestore Timestamps",
      action: "cast_millis_to_timestamp",
    },
    {
      label: "$(symbol-boolean) Cast String ➔ Boolean",
      description: "e.g. \"true\" / \"1\" ➔ true, \"false\" / \"0\" ➔ false",
      detail: "Converts truthy/falsy strings into native booleans",
      action: "cast_string_to_boolean",
    },
    {
      label: "$(symbol-array) Wrap Scalar ➔ Array",
      description: "e.g. \"tag\" ➔ [\"tag\"]",
      detail: "Wraps existing scalar values into a single-item array",
      action: "wrap_in_array",
    },
    {
      label: "$(symbol-variable) Backfill Default Value",
      description: "Populate missing or null fields across documents",
      detail: "Only modifies documents where this field is missing or null",
      action: "backfill_default",
    },
    {
      label: "$(edit) Rename Field Across Collection",
      description: "Rename or move field path",
      detail: "Copies value to new key and deletes old key across all documents",
      action: "rename_field",
    },
    {
      label: "$(trash) Delete Field Across Collection",
      description: "Purge deprecated or obsolete field",
      detail: "Permanently removes this field from every document in the collection",
      action: "delete_field",
    },
  ];

  let selectedAction: TransformActionType = initialAction || "cast_string_to_number";
  if (!initialAction) {
    const pickedAction = await vscode.window.showQuickPick(actions, {
      title: `Select Transformation Action for '${targetField}' in '${collectionPath}'`,
      placeHolder: "Choose how to transform this field across the collection",
    });
    if (!pickedAction) return;
    selectedAction = pickedAction.action;
  }

  // 3. Additional inputs for specific actions
  let newFieldName: string | undefined;
  let defaultValue: any;

  if (selectedAction === "rename_field") {
    const inputNewName = await vscode.window.showInputBox({
      title: `Rename Field '${targetField}'`,
      prompt: "Enter the new field name or dot path (e.g. display_price, profile.user_age)",
      value: targetField,
      validateInput: (v) => {
        if (!v || !v.trim()) return "New field name cannot be empty";
        if (v.trim() === targetField) return "New field name must be different from current name";
        return null;
      },
    });
    if (!inputNewName) return;
    newFieldName = inputNewName.trim();
  } else if (selectedAction === "backfill_default") {
    const inputVal = await vscode.window.showInputBox({
      title: `Backfill Default Value for '${targetField}'`,
      prompt: "Enter default value as primitive or JSON (e.g. 0, false, active, [\"general\"], {\"role\": \"user\"})",
      placeHolder: "0",
      validateInput: (v) => (v !== undefined ? null : "Value is required"),
    });
    if (inputVal === undefined) return;
    defaultValue = parseFilterValue(inputVal);
  }

  const rule: TransformRule = {
    targetField,
    action: selectedAction,
    newFieldName,
    defaultValue,
  };

  // 4. Sample 5 Documents for Interactive Live Preview Diff
  const preview = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Sampling collection '${collectionPath}' for transformation preview...`,
      cancellable: false,
    },
    () => TransformService.getInstance().previewTransformation(connectionId, collectionPath, rule, 5)
  );

  // Format preview diff message
  let previewText = `Preview: ${preview.modifiedCount} of ${preview.totalSampled} sample documents would be transformed.\n\n`;
  preview.samples.forEach((s, idx) => {
    const status = s.isModified ? "✨ MODIFY" : `⚪ SKIP (${s.statusNote || "no change"})`;
    previewText += `[${idx + 1}] Doc '${s.docId}': ${status}\n  Before: ${JSON.stringify(s.before)}\n  After:  ${JSON.stringify(s.after)}\n\n`;
  });

  const confirmChoice = await vscode.window.showWarningMessage(
    `Bulk Transform Field '${targetField}' in '${collectionPath}'?\n\n${previewText}`,
    { modal: true },
    "Execute Transformation Across Collection",
    "Cancel"
  );

  if (confirmChoice !== "Execute Transformation Across Collection") {
    return;
  }

  // 5. Execute with Progress Reporting and Cancellation
  const result = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Transforming '${targetField}' across '${collectionPath}'...`,
      cancellable: true,
    },
    async (progress, token) => {
      progress.report({ message: "Starting batch execution (400 docs/chunk)..." });
      return TransformService.getInstance().executeTransformation(
        connectionId,
        collectionPath,
        rule,
        token,
        (processed, updated, total) => {
          const totalStr = total ? `/${total}` : "";
          progress.report({
            message: `Processed ${processed}${totalStr} docs (${updated} updated)...`,
          });
        }
      );
    }
  );

  if (result.cancelled) {
    vscode.window.showWarningMessage(
      `Transformation cancelled by user. Processed ${result.totalProcessed} docs (${result.totalUpdated} updated, ${result.totalDeleted} deleted).`
    );
  } else {
    vscode.window.showInformationMessage(
      `Transformation complete! Processed ${result.totalProcessed} docs: ${result.totalUpdated} updated, ${result.totalDeleted} deleted, ${result.totalSkipped} unchanged.`
    );
  }

  if (result.errors.length > 0) {
    vscode.window.showErrorMessage(
      `Encountered ${result.errors.length} error(s) during transformation. Sample: ${result.errors[0]}`
    );
  }

  explorerDataProvider?.refresh();
}

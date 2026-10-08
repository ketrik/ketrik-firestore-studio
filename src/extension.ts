import * as vscode from "vscode";
import copyPath from "./commands/copyPath";
import init from "./commands/init";
import orderBy from "./commands/orderBy";
import openPath from "./commands/openPath";
import openServiceAccountSettings from "./commands/openServiceAccountSettings";
import {
  addConnectionCommand,
  editConnectionCommand,
  deleteConnectionCommand,
  testConnectionCommand,
} from "./commands/connectionCommands";
import { scheme } from "./constants";
import { DocumentFileSystemProvider } from "./editor/DocumentFileSystemProvider";
import ExplorerDataProvider from "./explorer/ExplorerDataProvider";
import { CollectionItem, ConnectionTreeItem, DocumentFieldItem, DocumentItem, Item } from "./explorer/items";
import { openCollectionAsTable } from "./webview/openCollectionAsTable";
import { ConnectionManager } from "./connections/ConnectionManager";
import { FieldValue } from "firebase-admin/firestore";

/** Parsed document template (label + data). */
interface DocumentTemplate {
  label: string;
  data: any;
}

/**
 * Cache the loaded templates so we don't re-read configuration on
 * every createDocument invocation. The cache is invalidated when the user
 * changes the ketrik-firestore-studio configuration.
 */
let _templateCache: DocumentTemplate[] | null = null;

function getTemplates(): DocumentTemplate[] {
  if (_templateCache !== null) {
    return _templateCache;
  }
  const config = vscode.workspace.getConfiguration("ketrik-firestore-studio");
  const templates = config.get<any[]>("documentTemplates") || [];

  _templateCache = templates.map((t) => ({
    label: t.name || t.label || "Template",
    data: (() => {
      try {
        return typeof t.template === "string" ? JSON.parse(t.template) : t.data || {};
      } catch {
        return {};
      }
    })(),
  }));

  return _templateCache;
}

export async function activate(context: vscode.ExtensionContext) {
  // Initialize ConnectionManager singleton
  ConnectionManager.getInstance();

  const explorerDataProvider = new ExplorerDataProvider();
  const documentFileSystemProvider = new DocumentFileSystemProvider();

  // Automatically refresh Explorer Tree whenever a document or sub-field is saved in the editor
  context.subscriptions.push(
    documentFileSystemProvider.onDidChangeFile(() => {
      explorerDataProvider.refresh();
    })
  );

  const explorerView = vscode.window.createTreeView("ketrik-firestore-studio-view", {
    treeDataProvider: explorerDataProvider,
  });

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("ketrik-firestore-studio.documentTemplates")) {
        _templateCache = null;
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.refreshExplorer",
      () => explorerDataProvider.refresh()
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.addConnection",
      addConnectionCommand
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.editConnection",
      editConnectionCommand
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.deleteConnection",
      deleteConnectionCommand
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.testConnection",
      testConnectionCommand
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.setServiceAccountKeyPath",
      openServiceAccountSettings
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("ketrik-firestore-studio.init", init)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("ketrik-firestore-studio.openPath", openPath)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("ketrik-firestore-studio.copyPath", copyPath)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.orderBy",
      (item: Item) => orderBy(item, explorerDataProvider)
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.showMoreItems",
      (path: string, connectionId?: string) => {
        explorerDataProvider.showMoreItems(path, connectionId);
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.openCollectionAsTable",
      (item: CollectionItem) => {
        openCollectionAsTable(item);
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.jumpToDocument",
      async (item: CollectionItem) => {
        if (!item?.reference) {
          vscode.window.showErrorMessage("No collection selected.");
          return;
        }

        const docId = await vscode.window.showInputBox({
          prompt: `Jump to Document ID in '${item.collectionId}'`,
          placeHolder: "Enter Document ID (e.g. user_123, msg_abc)",
          validateInput: (v) => (v.trim() ? undefined : "Document ID cannot be empty"),
        });

        if (!docId) {
          return;
        }

        try {
          const docRef = item.reference.doc(docId.trim());
          const snapshot = await docRef.get();
          if (!snapshot.exists) {
            const createChoice = await vscode.window.showWarningMessage(
              `Document '${docId.trim()}' does not exist in collection '${item.collectionId}'. Would you like to create it?`,
              "Create",
              "Cancel"
            );
            if (createChoice === "Create") {
              await docRef.set({});
              await openPath(docRef.path, item.connectionId);
              explorerDataProvider.refresh();
            }
            return;
          }

          await openPath(docRef.path, item.connectionId);
        } catch (err: any) {
          vscode.window.showErrorMessage(`Failed to retrieve document: ${err.message}`);
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.createDocument",
      async (item: CollectionItem) => {
        if (!item?.reference) {
          vscode.window.showErrorMessage("No collection selected.");
          return;
        }

        const docId = await vscode.window.showInputBox({
          prompt: "Enter Document ID (leave blank for auto-generated ID)",
          placeHolder: "Document ID",
        });

        const templates = getTemplates();
        let data: any;

        if (templates.length > 0) {
          const picked = await vscode.window.showQuickPick(
            templates.map((t) => t.label),
            { placeHolder: "Select a template or ESC to enter JSON manually" }
          );

          if (picked) {
            data = templates.find((t) => t.label === picked)?.data;
          }
        }

        if (!data) {
          const json = await vscode.window.showInputBox({
            prompt: "Enter document data as JSON",
            placeHolder: '{"field1": "value1", "field2": 123}',
          });

          if (!json) {
            vscode.window.showWarningMessage("No data entered.");
            return;
          }

          try {
            data = JSON.parse(json);
          } catch {
            vscode.window.showErrorMessage("Invalid JSON.");
            return;
          }
        }

        try {
          const ref = docId ? item.reference.doc(docId) : item.reference.doc();
          await ref.set(data);
          await openPath(ref.path, item.connectionId);
          vscode.window.showInformationMessage("Document created!");
          explorerDataProvider.refresh();
        } catch (err: any) {
          vscode.window.showErrorMessage(
            "Failed to create document: " + err.message
          );
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.addCollection",
      async (item: ConnectionTreeItem | DocumentItem) => {
        // Determine the Firestore instance and parent reference.
        let firestore: import("firebase-admin/firestore").Firestore;
        let connectionId: string;
        let parentPath: string | null;

        try {
          if (item instanceof ConnectionTreeItem) {
            firestore = await ConnectionManager.getInstance().getFirestore(item.config.id);
            connectionId = item.config.id;
            parentPath = null;
          } else if (item instanceof DocumentItem) {
            firestore = await ConnectionManager.getInstance().getFirestore(item.connectionId);
            connectionId = item.connectionId;
            parentPath = item.reference.path;
          } else {
            vscode.window.showErrorMessage("Select a connection or a document to add a collection under.");
            return;
          }
        } catch (err: any) {
          vscode.window.showErrorMessage("Failed to connect: " + err.message);
          return;
        }

        const collectionId = await vscode.window.showInputBox({
          prompt: "Enter Collection ID",
          placeHolder: "my-collection",
          validateInput: (v) => (v.trim() ? undefined : "Collection ID cannot be empty"),
        });
        if (!collectionId) { return; }

        const docId = await vscode.window.showInputBox({
          prompt: "Enter initial Document ID (leave blank for auto-generated ID)",
          placeHolder: "Document ID",
        });
        if (docId === undefined) { return; }  // user pressed Escape

        const json = await vscode.window.showInputBox({
          prompt: "Enter initial document data as JSON",
          placeHolder: '{"field1": "value1"}',
          value: "{}",
        });
        if (json === undefined) { return; }  // user pressed Escape

        let data: any;
        try {
          data = JSON.parse(json || "{}");
        } catch {
          vscode.window.showErrorMessage("Invalid JSON.");
          return;
        }

        try {
          const collRef = parentPath
            ? firestore.doc(parentPath).collection(collectionId.trim())
            : firestore.collection(collectionId.trim());
          const docRef = docId.trim() ? collRef.doc(docId.trim()) : collRef.doc();
          await docRef.set(data);
          vscode.window.showInformationMessage(`Collection '${collectionId.trim()}' created!`);
          await openPath(docRef.path, connectionId);
          explorerDataProvider.refresh();
        } catch (err: any) {
          vscode.window.showErrorMessage("Failed to create collection: " + err.message);
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.deleteDocument",
      async (item: DocumentItem) => {
        if (!item?.reference) {
          return;
        }

        const confirm = await vscode.window.showWarningMessage(
          `Are you sure you want to delete the document "${item.label}"?`,
          { modal: true },
          "Delete",
          "Cancel"
        );

        if (confirm === "Delete") {
          try {
            await item.reference.delete();
            vscode.window.showInformationMessage("Document deleted!");
            explorerDataProvider.refresh();
          } catch (err: any) {
            vscode.window.showErrorMessage(
              "Failed to delete document: " + err.message
            );
          }
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.openField",
      async (item: DocumentFieldItem) => {
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

        // For strings or null: Modal InputBox
        const input = await vscode.window.showInputBox({
          prompt: `Edit string value for '${item.fieldName}'`,
          value: value === null ? "" : String(value),
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
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.openFieldInEditor",
      async (item: DocumentFieldItem) => {
        if (!item?.parentDocRef || !item?.fieldName) {
          return;
        }
        await openPath(item.parentDocRef.path, item.connectionId, item.fieldName);
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.deleteField",
      async (item: DocumentFieldItem) => {
        if (!item?.parentDocRef || !item?.fieldName) {
          return;
        }

        const confirm = await vscode.window.showWarningMessage(
          `Are you sure you want to delete the field "${item.fieldName}" from document "${item.parentDocRef.id}"?`,
          { modal: true },
          "Delete Field",
          "Cancel"
        );

        if (confirm === "Delete Field") {
          try {
            await item.parentDocRef.update({
              [item.fieldName]: FieldValue.delete(),
            });
            vscode.window.showInformationMessage(`Field "${item.fieldName}" deleted!`);
            explorerDataProvider.refresh();
          } catch (err: any) {
            vscode.window.showErrorMessage(
              `Failed to delete field: ${err.message}`
            );
          }
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.addField",
      async (item: DocumentItem | DocumentFieldItem) => {
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
    )
  );

  context.subscriptions.push(explorerView);

  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider(
      scheme,
      documentFileSystemProvider,
      { isCaseSensitive: true }
    )
  );

  // Automatically enforce JSON syntax highlighting for all opened Firestore documents
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((document) => {
      if (document.uri.scheme === scheme && document.languageId !== "json") {
        vscode.languages.setTextDocumentLanguage(document, "json");
      }
    })
  );
}

export function deactivate() {}

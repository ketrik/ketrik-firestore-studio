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
import { openFieldAsTable } from "./webview/openFieldAsTable";
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
  const connectionManager = ConnectionManager.getInstance();
  context.subscriptions.push(connectionManager);

  const explorerDataProvider = new ExplorerDataProvider();
  context.subscriptions.push(explorerDataProvider);

  const documentFileSystemProvider = new DocumentFileSystemProvider();
  context.subscriptions.push(documentFileSystemProvider);

  // Automatically refresh Explorer Tree whenever a document or sub-field is saved in the editor (preserve pagination)
  context.subscriptions.push(
    documentFileSystemProvider.onDidChangeFile(() => {
      explorerDataProvider.refresh(false);
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
      () => explorerDataProvider.refresh(true)
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

        const subcollections = await item.reference.listCollections();
        const hasSubcollections = subcollections.length > 0;

        let confirm: string | undefined;

        if (hasSubcollections) {
          confirm = await vscode.window.showWarningMessage(
            `Document "${item.label}" has ${subcollections.length} subcollection(s) (${subcollections.map((s) => s.id).join(", ")}). How would you like to delete it?`,
            { modal: true },
            "Deep Delete (Doc + Subcollections)",
            "Delete Document Only",
            "Cancel"
          );
        } else {
          confirm = await vscode.window.showWarningMessage(
            `Are you sure you want to delete the document "${item.label}"?`,
            { modal: true },
            "Delete",
            "Cancel"
          );
        }

        if (!confirm || confirm === "Cancel") {
          return;
        }

        if (confirm === "Deep Delete (Doc + Subcollections)") {
          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: `Deep deleting document "${item.label}" and all subcollections...`,
              cancellable: false,
            },
            async () => {
              try {
                const firestore = await ConnectionManager.getInstance().getFirestore(item.connectionId);
                await firestore.recursiveDelete(item.reference);
                vscode.window.showInformationMessage(`Deleted document "${item.label}" and all nested subcollections.`);
                explorerDataProvider.refresh();
              } catch (err: any) {
                vscode.window.showErrorMessage(`Failed deep delete: ${err.message}`);
              }
            }
          );
        } else if (confirm === "Delete" || confirm === "Delete Document Only") {
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

  // In-memory document clipboard for copy/paste across collections and connections
  let copiedDocumentBuffer: {
    sourceDocId: string;
    sourcePath: string;
    sourceConnectionId: string;
    data: any;
  } | null = null;

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.duplicateDocument",
      async (item: DocumentItem) => {
        if (!item?.reference) {
          vscode.window.showErrorMessage("No document selected.");
          return;
        }

        const snapshot = await item.reference.get();
        if (!snapshot.exists) {
          vscode.window.showErrorMessage(`Document "${item.documentId}" does not exist.`);
          return;
        }

        const newDocId = await vscode.window.showInputBox({
          prompt: `Duplicate document "${item.documentId}"`,
          value: `${item.documentId}_copy`,
          placeHolder: "Enter new Document ID (or leave blank to auto-generate)",
        });

        if (newDocId === undefined) {
          return; // User cancelled
        }

        try {
          const targetRef = newDocId.trim()
            ? item.reference.parent.doc(newDocId.trim())
            : item.reference.parent.doc();

          await targetRef.set(snapshot.data() || {});
          vscode.window.showInformationMessage(`Document duplicated as "${targetRef.id}"!`);
          await openPath(targetRef.path, item.connectionId);
          explorerDataProvider.refresh();
        } catch (err: any) {
          vscode.window.showErrorMessage(`Failed to duplicate document: ${err.message}`);
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.copyDocument",
      async (item: DocumentItem) => {
        if (!item?.reference) {
          vscode.window.showErrorMessage("No document selected.");
          return;
        }

        try {
          const snapshot = await item.reference.get();
          if (!snapshot.exists) {
            vscode.window.showErrorMessage(`Document "${item.documentId}" does not exist.`);
            return;
          }

          copiedDocumentBuffer = {
            sourceDocId: item.documentId,
            sourcePath: item.reference.path,
            sourceConnectionId: item.connectionId,
            data: snapshot.data() || {},
          };

          vscode.window.showInformationMessage(
            `Document "${item.documentId}" copied to Firestore Studio clipboard.`
          );
        } catch (err: any) {
          vscode.window.showErrorMessage(`Failed to copy document: ${err.message}`);
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.pasteDocument",
      async (item: CollectionItem) => {
        if (!item?.reference) {
          vscode.window.showErrorMessage("No target collection selected.");
          return;
        }

        if (!copiedDocumentBuffer) {
          vscode.window.showWarningMessage(
            "No document in Firestore Studio clipboard. Copy a document first."
          );
          return;
        }

        const targetDocId = await vscode.window.showInputBox({
          prompt: `Paste document into collection "${item.collectionId}"`,
          value: copiedDocumentBuffer.sourceDocId,
          placeHolder: "Enter Document ID (or leave blank for auto-generated ID)",
        });

        if (targetDocId === undefined) {
          return; // User cancelled
        }

        try {
          const targetRef = targetDocId.trim()
            ? item.reference.doc(targetDocId.trim())
            : item.reference.doc();

          await targetRef.set(copiedDocumentBuffer.data);
          vscode.window.showInformationMessage(
            `Pasted document "${targetRef.id}" into "${item.collectionId}"!`
          );
          await openPath(targetRef.path, item.connectionId);
          explorerDataProvider.refresh();
        } catch (err: any) {
          vscode.window.showErrorMessage(`Failed to paste document: ${err.message}`);
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.copyDocumentJson",
      async (item: DocumentItem) => {
        if (!item?.reference) {
          vscode.window.showErrorMessage("No document selected.");
          return;
        }

        try {
          const snapshot = await item.reference.get();
          if (!snapshot.exists) {
            vscode.window.showErrorMessage(`Document "${item.documentId}" does not exist.`);
            return;
          }

          const jsonText = JSON.stringify(snapshot.data() || {}, null, 2);
          await vscode.env.clipboard.writeText(jsonText);
          vscode.window.showInformationMessage(`Copied document JSON to clipboard.`);
        } catch (err: any) {
          vscode.window.showErrorMessage(`Failed to copy JSON: ${err.message}`);
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
      "ketrik-firestore-studio.openFieldAsTable",
      async (item: DocumentFieldItem) => {
        if (!item?.parentDocRef || !item?.fieldName) {
          return;
        }
        await openFieldAsTable(item);
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.renameField",
      async (item: DocumentFieldItem) => {
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

        try {
          // Read current value from document
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

          // Atomically set new field and delete old field
          await item.parentDocRef.update({
            [targetName]: existingValue,
            [item.fieldName]: FieldValue.delete(),
          });

          // Invalidate virtual file system and notify open editor tabs to reload document
          documentFileSystemProvider.invalidateAndNotify(item.connectionId, item.parentDocRef.path);

          vscode.window.showInformationMessage(`Renamed '${item.fieldName}' to '${targetName}'`);
          explorerDataProvider.refreshNode(item);
        } catch (err: any) {
          vscode.window.showErrorMessage(`Failed to rename field: ${err.message}`);
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.refreshItem",
      async (item: Item) => {
        if (!item) {
          explorerDataProvider.refresh();
          return;
        }
        if (item instanceof DocumentItem) {
          documentFileSystemProvider.invalidateAndNotify(item.connectionId, item.reference.path);
        } else if (item instanceof DocumentFieldItem) {
          documentFileSystemProvider.invalidateAndNotify(item.connectionId, item.parentDocRef.path);
        }
        explorerDataProvider.refreshNode(item);
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
            documentFileSystemProvider.invalidateAndNotify(item.connectionId, item.parentDocRef.path);
            vscode.window.showInformationMessage(`Field "${item.fieldName}" deleted!`);
            explorerDataProvider.refreshNode(item);
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

export async function deactivate(): Promise<void> {
  await ConnectionManager.getInstance().dispose();
}

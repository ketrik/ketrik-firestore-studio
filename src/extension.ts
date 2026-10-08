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

  context.subscriptions.push(explorerView);

  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider(
      scheme,
      new DocumentFileSystemProvider(),
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

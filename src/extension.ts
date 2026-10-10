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
import {
  jumpToDocumentCommand,
  createDocumentCommand,
  deleteDocumentCommand,
  duplicateDocumentCommand,
  copyDocumentCommand,
  pasteDocumentCommand,
  copyDocumentJsonCommand,
} from "./commands/documentCommands";
import {
  openFieldCommand,
  renameFieldCommand,
  deleteFieldCommand,
  addFieldCommand,
} from "./commands/fieldCommands";
import {
  openCollectionAsTableCommand,
  addCollectionCommand,
} from "./commands/collectionCommands";
import { scheme } from "./constants";
import { DocumentFileSystemProvider } from "./editor/DocumentFileSystemProvider";
import ExplorerDataProvider from "./explorer/ExplorerDataProvider";
import { CollectionItem, ConnectionTreeItem, DocumentFieldItem, DocumentItem, Item } from "./explorer/items";
import { openFieldAsTable } from "./webview/openFieldAsTable";
import { ConnectionManager } from "./connections/ConnectionManager";
import { TemplateService } from "./services/TemplateService";

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

  // Invalidate template cache when workspace configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("ketrik-firestore-studio.documentTemplates")) {
        TemplateService.getInstance().invalidate();
      }
    })
  );

  // ── Connection & Navigation Commands ──────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.refreshExplorer",
      () => explorerDataProvider.refresh(true)
    ),
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.addConnection",
      addConnectionCommand
    ),
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.editConnection",
      editConnectionCommand
    ),
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.deleteConnection",
      deleteConnectionCommand
    ),
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.testConnection",
      testConnectionCommand
    ),
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.setServiceAccountKeyPath",
      openServiceAccountSettings
    ),
    vscode.commands.registerCommand("ketrik-firestore-studio.init", init),
    vscode.commands.registerCommand("ketrik-firestore-studio.openPath", openPath),
    vscode.commands.registerCommand("ketrik-firestore-studio.copyPath", copyPath),
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.orderBy",
      (item: Item) => orderBy(item, explorerDataProvider)
    ),
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.showMoreItems",
      (path: string, connectionId?: string) => {
        explorerDataProvider.showMoreItems(path, connectionId);
      }
    )
  );

  // ── Collection Commands ───────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.openCollectionAsTable",
      (item: CollectionItem) => openCollectionAsTableCommand(item)
    ),
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.addCollection",
      (item: ConnectionTreeItem | DocumentItem) =>
        addCollectionCommand(item, explorerDataProvider)
    )
  );

  // ── Document Commands ─────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.jumpToDocument",
      (item: CollectionItem) => jumpToDocumentCommand(item, explorerDataProvider)
    ),
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.createDocument",
      (item: CollectionItem) => createDocumentCommand(item, explorerDataProvider)
    ),
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.deleteDocument",
      (item: DocumentItem) => deleteDocumentCommand(item, explorerDataProvider)
    ),
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.duplicateDocument",
      (item: DocumentItem) => duplicateDocumentCommand(item, explorerDataProvider)
    ),
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.copyDocument",
      copyDocumentCommand
    ),
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.pasteDocument",
      (item: CollectionItem | DocumentFieldItem) =>
        pasteDocumentCommand(item, explorerDataProvider, documentFileSystemProvider)
    ),
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.copyDocumentJson",
      copyDocumentJsonCommand
    )
  );

  // ── Field Commands ────────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.openField",
      (item: DocumentFieldItem) => openFieldCommand(item, explorerDataProvider)
    ),
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.openFieldInEditor",
      async (item: DocumentFieldItem) => {
        if (!item?.parentDocRef || !item?.fieldName) {
          return;
        }
        await openPath(item.parentDocRef.path, item.connectionId, item.fieldName);
      }
    ),
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.openFieldAsTable",
      async (item: DocumentFieldItem) => {
        if (!item?.parentDocRef || !item?.fieldName) {
          return;
        }
        await openFieldAsTable(item);
      }
    ),
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.renameField",
      (item: DocumentFieldItem) =>
        renameFieldCommand(item, explorerDataProvider, documentFileSystemProvider)
    ),
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
    ),
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.deleteField",
      (item: DocumentFieldItem) =>
        deleteFieldCommand(item, explorerDataProvider, documentFileSystemProvider)
    ),
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.addField",
      (item: DocumentItem | DocumentFieldItem) =>
        addFieldCommand(item, explorerDataProvider)
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

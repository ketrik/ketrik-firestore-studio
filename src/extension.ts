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
import {
  explodeFieldCommand,
  consolidateCollectionCommand,
} from "./commands/migrationCommands";
import {
  purgeFieldTombstonesCommand,
  purgeCollectionTombstonesCommand,
} from "./commands/tombstoneCommands";
import {
  openRulesCommand,
  diffRulesCommand,
  deployRulesCommand,
} from "./rules/rulesCommands";
import {
  editAuthUserClaimsCommand,
  createAuthUserProfileCommand,
  openAuthUserProfileCommand,
  manageAuthUsersCommand,
  deleteAuthUserCommand,
  resetAuthUserPasswordCommand,
  cloneAuthUserCommand,
  mintCustomTokenCommand,
  revokeUserSessionsCommand,
  createAuthUserCommand,
  inspectProjectAuthConfigCommand,
} from "./auth/authCommands";
import { generateSchemaCommand } from "./commands/schemaCommands";
import { exportCollectionCommand, importCollectionCommand } from "./commands/importExportCommands";
import { RulesService } from "./rules/RulesService";
import { scheme } from "./constants";
import { DocumentFileSystemProvider } from "./editor/DocumentFileSystemProvider";
import ExplorerDataProvider from "./explorer/ExplorerDataProvider";
import { CollectionItem, ConnectionTreeItem, DocumentFieldItem, DocumentItem, Item } from "./explorer/items";
import { openFieldAsTable } from "./webview/openFieldAsTable";
import { openAuthUsersAsTable } from "./webview/openAuthUsersAsTable";
import { ConnectionManager } from "./connections/ConnectionManager";
import { TemplateService } from "./services/TemplateService";

export async function activate(context: vscode.ExtensionContext) {
  // Initialize ConnectionManager singleton
  const connectionManager = ConnectionManager.getInstance();
  context.subscriptions.push(connectionManager);

  const explorerDataProvider = new ExplorerDataProvider();
  context.subscriptions.push(explorerDataProvider);

  // Initialize RulesService singleton to watch firestore.rules
  const rulesService = RulesService.getInstance();
  rulesService.setContext(context);
  context.subscriptions.push(rulesService);

  const documentFileSystemProvider = DocumentFileSystemProvider.getInstance();
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
      "ketrik-firestore-studio.openSecurityRules",
      openRulesCommand
    ),
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.diffSecurityRules",
      diffRulesCommand
    ),
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.deploySecurityRules",
      deployRulesCommand
    ),
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.setServiceAccountKeyPath",
      openServiceAccountSettings
    ),
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.openAuthUserClaims",
      (item?: any) => editAuthUserClaimsCommand(item, explorerDataProvider)
    ),
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.createAuthUserProfile",
      (item?: any) => createAuthUserProfileCommand(item, explorerDataProvider, documentFileSystemProvider)
    ),
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.openAuthUserProfile",
      (item?: any) => openAuthUserProfileCommand(item, explorerDataProvider, documentFileSystemProvider)
    ),
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.manageAuthUsers",
      (item?: any) => manageAuthUsersCommand(item, explorerDataProvider, documentFileSystemProvider)
    ),
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.deleteAuthUser",
      (item?: any) => deleteAuthUserCommand(item, explorerDataProvider, documentFileSystemProvider)
    ),
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.resetAuthUserPassword",
      (item?: any) => resetAuthUserPasswordCommand(item)
    ),
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.cloneAuthUser",
      (item?: any) => cloneAuthUserCommand(item, explorerDataProvider, documentFileSystemProvider)
    ),
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.mintCustomToken",
      (item?: any) => mintCustomTokenCommand(item)
    ),
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.revokeUserSessions",
      (item?: any) => revokeUserSessionsCommand(item)
    ),
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.openAuthUsersAsTable",
      async (item?: any) => {
        let connId = "default";
        if (typeof item === "string") {
          connId = item;
        } else if (item?.connectionId) {
          connId = item.connectionId;
        } else if (item?.config?.id) {
          connId = item.config.id;
        } else {
          const conns = ConnectionManager.getInstance().getConnections();
          connId = conns[0]?.id || "default";
        }
        await openAuthUsersAsTable(connId, documentFileSystemProvider);
      }
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
    ),
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.showMoreAuthUsers",
      (connectionId?: string) => {
        explorerDataProvider.showMoreAuthUsers(connectionId);
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
    ),
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.generateSchema",
      (item?: CollectionItem | DocumentItem) => generateSchemaCommand(item)
    ),
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.exportCollection",
      (item: CollectionItem) => exportCollectionCommand(item)
    ),
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.importCollection",
      (item: CollectionItem) => importCollectionCommand(item, explorerDataProvider)
    ),
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.createAuthUser",
      (item?: any) => createAuthUserCommand(item, explorerDataProvider, documentFileSystemProvider)
    ),
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.inspectProjectAuthConfig",
      (item?: any) => inspectProjectAuthConfigCommand(item)
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
    ),
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.explodeField",
      (item: DocumentFieldItem) =>
        explodeFieldCommand(item, explorerDataProvider, documentFileSystemProvider)
    ),
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.consolidateCollection",
      (item: CollectionItem) =>
        consolidateCollectionCommand(item, explorerDataProvider, documentFileSystemProvider)
    ),
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.purgeFieldTombstones",
      (item: DocumentFieldItem) =>
        purgeFieldTombstonesCommand(item, explorerDataProvider, documentFileSystemProvider)
    ),
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.purgeCollectionTombstones",
      (item: CollectionItem) =>
        purgeCollectionTombstonesCommand(item, explorerDataProvider, documentFileSystemProvider)
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

  // Automatically enforce JSON syntax highlighting for all opened Firestore JSON documents
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((document) => {
      if (document.uri.scheme === scheme) {
        if (
          (document.uri.path.endsWith(".rules") || document.uri.path.endsWith("/firestore.rules")) &&
          document.languageId !== "firestore-rules"
        ) {
          vscode.languages.setTextDocumentLanguage(document, "firestore-rules");
        } else if (
          !document.uri.path.endsWith(".rules") &&
          !document.uri.path.endsWith("/firestore.rules") &&
          document.languageId !== "json"
        ) {
          vscode.languages.setTextDocumentLanguage(document, "json");
        }
      }
    })
  );
}

export async function deactivate(): Promise<void> {
  await ConnectionManager.getInstance().dispose();
}

import * as vscode from "vscode";
import { ConnectionManager } from "../connections/ConnectionManager.js";
import { CollectionItem, DocumentItem } from "../explorer/items.js";
import { GraphDataService } from "../graph/graphDataService.js";
import { getGraphCanvasHtml } from "./graphCanvas/graphCanvasHtml.js";
import openPath from "../commands/openPath.js";
import { openCollectionAsTable } from "./openCollectionAsTable.js";
import { LocalJsonService } from "../services/LocalJsonService.js";

// Active graph panels registry to avoid duplicate webviews
const activeGraphPanels = new Map<string, vscode.WebviewPanel>();

export async function openGraphCanvas(
  target?: CollectionItem | DocumentItem | { connectionId: string; rootPath: string }
) {
  let connectionId: string;
  let rootPath: string;

  if (target instanceof CollectionItem) {
    connectionId = target.connectionId;
    rootPath = target.reference.path;
  } else if (target instanceof DocumentItem) {
    connectionId = target.connectionId;
    rootPath = target.reference.path;
  } else if (target && "connectionId" in target && "rootPath" in target) {
    connectionId = target.connectionId;
    rootPath = target.rootPath;
  } else {
    // Pick connection and collection interactively
    const connections = ConnectionManager.getInstance().getConnections();
    if (connections.length === 0) {
      vscode.window.showInformationMessage("No connections configured. Please add a connection first.");
      return;
    }
    let chosenConn = connections[0];
    if (connections.length > 1) {
      const picked = await vscode.window.showQuickPick(
        connections.map((c) => ({ label: c.name, description: c.id, connection: c })),
        { placeHolder: "Select connection for Data Graph Canvas" }
      );
      if (!picked) return;
      chosenConn = picked.connection;
    }
    connectionId = chosenConn.id;

    let colls: string[] = [];
    if (chosenConn.isLocalJson) {
      colls = LocalJsonService.getInstance().listCollections(chosenConn);
    } else {
      try {
        const firestore = await ConnectionManager.getInstance().getFirestore(connectionId);
        const colRefs = await firestore.listCollections();
        colls = colRefs.map((c) => c.id);
      } catch {}
    }

    const inputChoice = await vscode.window.showQuickPick(
      [
        ...colls.map((c) => ({ label: `📁 ${c}`, path: c })),
        { label: "$(edit) Enter custom collection or document path...", path: "__custom__" },
      ],
      { placeHolder: "Select collection or document to visualize" }
    );
    if (!inputChoice) return;

    if (inputChoice.path === "__custom__") {
      const customPath = await vscode.window.showInputBox({
        title: "Enter Path to Visualize",
        placeHolder: "e.g. users or orders/ord_123",
        validateInput: (v) => (v.trim() ? undefined : "Path cannot be empty"),
      });
      if (!customPath) return;
      rootPath = customPath.trim();
    } else {
      rootPath = inputChoice.path;
    }
  }

  const panelKey = `${connectionId}:${rootPath}`;
  const existingPanel = activeGraphPanels.get(panelKey);
  if (existingPanel) {
    existingPanel.reveal(vscode.ViewColumn.One);
    return;
  }

  const panelTitle = `Graph: ${rootPath}`;

  const panel = vscode.window.createWebviewPanel(
    "firestoreDataGraph",
    panelTitle,
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
    }
  );
  activeGraphPanels.set(panelKey, panel);

  let messageSub: vscode.Disposable | undefined;

  panel.onDidDispose(() => {
    activeGraphPanels.delete(panelKey);
    messageSub?.dispose();
  });

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Building Data Graph for '${rootPath}'...`,
      cancellable: false,
    },
    async () => {
      try {
        const graphData = await GraphDataService.getInstance().buildGraphData(
          connectionId,
          rootPath,
          15
        );
        panel.webview.html = getGraphCanvasHtml(graphData);
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to build graph: ${err.message}`);
        panel.dispose();
      }
    }
  );

  messageSub = panel.webview.onDidReceiveMessage(async (msg) => {
    switch (msg.command) {
      case "openDocument":
        if (msg.path) {
          await openPath(msg.path, connectionId);
        }
        break;

      case "openCollection":
        if (msg.path) {
          await openCollectionAsTable({
            connectionId,
            collectionId: msg.path.split("/").pop() || msg.path,
            collectionPath: msg.path,
          } as any);
        }
        break;

      case "expandReference":
        if (msg.refPath) {
          try {
            const result = await GraphDataService.getInstance().fetchSingleDocumentNode(
              connectionId,
              msg.refPath
            );
            if (result) {
              panel.webview.postMessage({
                type: "nodeAdded",
                node: result.node,
                edges: result.edges,
                sourcePath: msg.sourcePath || rootPath,
              });
            } else {
              vscode.window.showWarningMessage(`Referenced document '${msg.refPath}' not found.`);
            }
          } catch (err: any) {
            vscode.window.showErrorMessage(`Error expanding reference: ${err.message}`);
          }
        }
        break;
    }
  });
}

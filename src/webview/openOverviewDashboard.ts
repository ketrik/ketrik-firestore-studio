import * as vscode from "vscode";
import { ConnectionManager } from "../connections/ConnectionManager";
import { OverviewService } from "../analytics/overviewService";
import { getOverviewDashboardHtml } from "./overviewDashboard/overviewDashboardHtml";
import { openCollectionAsTable } from "./openCollectionAsTable";

// Registry of active overview panels keyed by connectionId to prevent duplicate webviews
const activeOverviewPanels = new Map<string, vscode.WebviewPanel>();

export async function openOverviewDashboard(target?: { connectionId?: string } | string) {
  const connectionManager = ConnectionManager.getInstance();
  const connections = connectionManager.getConnections();

  if (connections.length === 0) {
    vscode.window.showWarningMessage("No Firestore connections configured. Add a connection first.");
    return;
  }

  let selectedConnectionId: string | undefined;

  if (typeof target === "string") {
    selectedConnectionId = target;
  } else if (target && typeof target.connectionId === "string") {
    selectedConnectionId = target.connectionId;
  }

  if (!selectedConnectionId) {
    if (connections.length === 1) {
      selectedConnectionId = connections[0].id;
    } else {
      const picks = connections.map((c) => ({
        label: c.name,
        description: c.projectId || (c.isEmulator ? "Emulator" : "Local JSON"),
        detail: `ID: ${c.id}`,
        id: c.id,
      }));
      const picked = await vscode.window.showQuickPick(picks, {
        placeHolder: "Select a Firestore connection for Overview & Traffic Analytics",
      });
      if (!picked) return;
      selectedConnectionId = picked.id;
    }
  }

  const conn = connectionManager.getConnection(selectedConnectionId);
  if (!conn) {
    vscode.window.showErrorMessage(`Connection '${selectedConnectionId}' not found.`);
    return;
  }

  const existingPanel = activeOverviewPanels.get(conn.id);
  if (existingPanel) {
    existingPanel.reveal(vscode.ViewColumn.One);
    return;
  }

  const overviewService = OverviewService.getInstance();
  const initialData = await overviewService.getOverviewData(conn.id);

  const config = vscode.workspace.getConfiguration("ketrik-firestore-studio");
  const retainContextWhenHidden = config.get<boolean>("retainWebviewTabs", true);

  const panel = vscode.window.createWebviewPanel(
    "firestoreOverviewDashboard",
    `Overview: ${conn.name}`,
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden,
    }
  );
  activeOverviewPanels.set(conn.id, panel);
  panel.webview.html = getOverviewDashboardHtml(initialData);

  let messageSub: vscode.Disposable | undefined;

  panel.onDidDispose(() => {
    activeOverviewPanels.delete(conn.id);
    messageSub?.dispose();
  });

  // Handle messages from the webview
  messageSub = panel.webview.onDidReceiveMessage(async (message) => {
    if (message.command === "refresh") {
      try {
        const freshData = await overviewService.getOverviewData(conn.id, true);
        panel.webview.html = getOverviewDashboardHtml(freshData);
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to refresh overview data: ${err?.message || err}`);
      }
    }

    if (message.command === "openCollectionTable") {
      const collectionId = message.collectionId;
      if (collectionId) {
        try {
          await openCollectionAsTable({
            connectionId: conn.id,
            collectionId,
            collectionPath: collectionId,
          });
        } catch (err: any) {
          vscode.window.showErrorMessage(`Failed to open collection table: ${err?.message || err}`);
        }
      }
    }

    if (message.command === "exportJson") {
      try {
        const data = await overviewService.getOverviewData(conn.id);
        const doc = await vscode.workspace.openTextDocument({
          content: JSON.stringify(data, null, 2),
          language: "json",
        });
        await vscode.window.showTextDocument(doc, { preview: false });
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to export JSON report: ${err?.message || err}`);
      }
    }

    if (message.command === "exportMarkdown") {
      try {
        const data = await overviewService.getOverviewData(conn.id);
        const md = generateMarkdownReport(data);
        const doc = await vscode.workspace.openTextDocument({
          content: md,
          language: "markdown",
        });
        await vscode.window.showTextDocument(doc, { preview: false });
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to export Markdown report: ${err?.message || err}`);
      }
    }
  });
}

function generateMarkdownReport(data: any): string {
  return `# Firestore Studio Overview & Traffic Report: ${data.connectionName}
**Generated:** ${data.lastRefreshed}  
**Project ID:** ${data.projectId || "N/A"}  
**Traffic Source:** ${data.traffic.source}  

## 📊 Summary KPIs
- **Root Collections:** ${data.database.totalCollections}
- **Total Sampled Documents:** ${data.database.totalDocuments.toLocaleString()}
- **Today's Operations:** ${(data.traffic.todayReads + data.traffic.todayWrites + data.traffic.todayDeletes).toLocaleString()} (Reads: ${data.traffic.todayReads.toLocaleString()}, Writes: ${data.traffic.todayWrites.toLocaleString()}, Deletes: ${data.traffic.todayDeletes.toLocaleString()})
- **Auth Users:** ${data.auth.isAvailable ? data.auth.totalUsers.toLocaleString() : "N/A"}

## 🗄️ Top Collections
| Collection | Document Count | Avg Size | Estimated Total Size |
| :--- | :--- | :--- | :--- |
${data.database.topCollections.map((c: any) => `| ${c.id} | ${c.documentCount.toLocaleString()} | ${c.avgDocSizeBytes} B | ${c.estimatedSizeBytes} B |`).join("\n")}

## 📈 7-Day Traffic History
| Date | Reads | Writes | Deletes | Sent Bytes | Received Bytes | Real-time Connections |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
${data.traffic.history7Days.map((h: any) => `| ${h.date} | ${h.reads.toLocaleString()} | ${h.writes.toLocaleString()} | ${h.deletes.toLocaleString()} | ${h.sentBytes || 0} | ${h.receivedBytes || 0} | ${h.realtimeConnections || 0} |`).join("\n")}
`;
}

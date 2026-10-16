import * as vscode from "vscode";
import { ConnectionManager } from "../connections/ConnectionManager";
import { CostService, SPARK_FREE_QUOTA, BLAZE_PRICING } from "../cost/costService";
import { getCostSimulatorHtml } from "./costSimulator/costSimulatorHtml";

export async function openCostSimulator(target?: { connectionId?: string } | string) {
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
        placeHolder: "Select a Firestore connection for Cost Simulator & Quota Usage",
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

  const costService = CostService.getInstance();
  const initialSnapshot = await costService.fetchDailyUsage(conn.id);

  const panel = vscode.window.createWebviewPanel(
    "firestoreCostSimulator",
    `Cost & Quotas: ${conn.name}`,
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
    }
  );

  panel.webview.html = getCostSimulatorHtml({
    connectionId: conn.id,
    connectionName: conn.name,
    projectId: conn.projectId,
    isEmulator: !!conn.isEmulator,
    isLocalJson: !!conn.isLocalJson,
    usageSnapshot: initialSnapshot,
  });

  // Listen to live usage changes from mutations or queries
  const sub = costService.onDidChangeUsage(async (cId) => {
    if (cId === conn.id || cId === "*") {
      const updated = await costService.fetchDailyUsage(conn.id);
      panel.webview.postMessage({
        type: "usageUpdate",
        usageSnapshot: updated,
      });
    }
  });

  panel.onDidDispose(() => {
    sub.dispose();
  });

  panel.webview.onDidReceiveMessage(async (message) => {
    if (message.command === "refresh") {
      const updated = await costService.fetchDailyUsage(conn.id);
      panel.webview.postMessage({
        type: "usageUpdate",
        usageSnapshot: updated,
      });
      vscode.window.showInformationMessage("Usage statistics refreshed.");
    }

    if (message.command === "resetSession") {
      costService.resetSessionCounts(conn.id);
      const updated = await costService.fetchDailyUsage(conn.id);
      panel.webview.postMessage({
        type: "usageUpdate",
        usageSnapshot: updated,
      });
      vscode.window.showInformationMessage(`Reset session operation counters for '${conn.name}'.`);
    }

    if (message.command === "exportMarkdown") {
      const snap = await costService.fetchDailyUsage(conn.id);
      const md = `# Firestore Cost & Quota Report: ${conn.name}
**Date:** ${snap.date}  
**Source:** ${snap.source}  
**Project ID:** ${conn.projectId || "N/A"}  

## Daily Allowance Consumption
- **Reads:** ${snap.reads.toLocaleString()} / ${SPARK_FREE_QUOTA.readsPerDay.toLocaleString()} (${Math.round((snap.reads / SPARK_FREE_QUOTA.readsPerDay) * 100)}%)
- **Writes:** ${snap.writes.toLocaleString()} / ${SPARK_FREE_QUOTA.writesPerDay.toLocaleString()} (${Math.round((snap.writes / SPARK_FREE_QUOTA.writesPerDay) * 100)}%)
- **Deletes:** ${snap.deletes.toLocaleString()} / ${SPARK_FREE_QUOTA.deletesPerDay.toLocaleString()} (${Math.round((snap.deletes / SPARK_FREE_QUOTA.deletesPerDay) * 100)}%)

## Pricing Model Rates (Blaze Pay-As-You-Go)
- Reads: $${BLAZE_PRICING.readsPer100k} / 100k reads
- Writes: $${BLAZE_PRICING.writesPer100k} / 100k writes
- Deletes: $${BLAZE_PRICING.deletesPer100k} / 100k deletes
- Storage: $${BLAZE_PRICING.storagePerGiBMonth} / GiB / month
- Egress: $${BLAZE_PRICING.egressPerGiB} / GiB
`;

      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(`firestore-cost-report-${conn.id}.md`),
        filters: { Markdown: ["md"] },
      });
      if (uri) {
        await vscode.workspace.fs.writeFile(uri, Buffer.from(md, "utf8"));
        vscode.window.showInformationMessage("Exported Markdown cost report!");
      }
    }

    if (message.command === "exportJson") {
      const snap = await costService.fetchDailyUsage(conn.id);
      const report = {
        connection: {
          id: conn.id,
          name: conn.name,
          projectId: conn.projectId,
        },
        date: snap.date,
        source: snap.source,
        dailyUsage: {
          reads: snap.reads,
          writes: snap.writes,
          deletes: snap.deletes,
        },
        quotas: SPARK_FREE_QUOTA,
        pricingRates: BLAZE_PRICING,
      };

      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(`firestore-cost-report-${conn.id}.json`),
        filters: { JSON: ["json"] },
      });
      if (uri) {
        await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(report, null, 2), "utf8"));
        vscode.window.showInformationMessage("Exported JSON cost report!");
      }
    }
  });
}

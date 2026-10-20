import * as vscode from "vscode";
import { ConnectionManager } from "../connections/ConnectionManager";
import { CostService, SPARK_FREE_QUOTA, BLAZE_PRICING } from "../cost/costService";
import { getCostSimulatorHtml } from "./costSimulator/costSimulatorHtml";

// Active cost simulator panels registry to avoid duplicate webviews and memory retention
const activeCostPanels = new Map<string, vscode.WebviewPanel>();

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

  const existingPanel = activeCostPanels.get(conn.id);
  if (existingPanel) {
    existingPanel.reveal(vscode.ViewColumn.One);
    return;
  }

  const costService = CostService.getInstance();
  const [initialSnapshot, initialHistory] = await Promise.all([
    costService.fetchDailyUsage(conn.id),
    costService.fetchHistoricalUsage(conn.id, 7),
  ]);

  const config = vscode.workspace.getConfiguration("ketrik-firestore-studio");
  const retainContextWhenHidden = config.get<boolean>("retainWebviewTabs", true);

  const panel = vscode.window.createWebviewPanel(
    "firestoreCostSimulator",
    `Cost & Quotas: ${conn.name}`,
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden,
    }
  );
  activeCostPanels.set(conn.id, panel);

  const effectiveProjectId = ConnectionManager.getInstance().getEffectiveProjectId(conn);

  panel.webview.html = getCostSimulatorHtml({
    connectionId: conn.id,
    connectionName: conn.name,
    projectId: effectiveProjectId,
    isEmulator: !!conn.isEmulator,
    isLocalJson: !!conn.isLocalJson,
    usageSnapshot: initialSnapshot,
    historicalUsage: initialHistory,
  });

  // Listen to live usage changes from mutations or queries (debounced to avoid webview flooding)
  let usageDebounceTimer: NodeJS.Timeout | undefined;
  const sub = costService.onDidChangeUsage((cId) => {
    if (cId === conn.id || cId === "*") {
      if (usageDebounceTimer) {
        clearTimeout(usageDebounceTimer);
      }
      usageDebounceTimer = setTimeout(async () => {
        usageDebounceTimer = undefined;
        try {
          const updated = await costService.fetchDailyUsage(conn.id);
          panel.webview.postMessage({
            type: "usageUpdate",
            usageSnapshot: updated,
          });
        } catch {
          // Panel may be disposed or closed
        }
      }, 500);
    }
  });

  const messageSub = panel.webview.onDidReceiveMessage(async (message) => {
    if (message.command === "refresh") {
      const days = message.days || 7;
      const [updated, history] = await Promise.all([
        costService.fetchDailyUsage(conn.id, true),
        costService.fetchHistoricalUsage(conn.id, days, true),
      ]);
      panel.webview.postMessage({
        type: "usageUpdate",
        usageSnapshot: updated,
      });
      panel.webview.postMessage({
        type: "historicalUpdate",
        historicalUsage: history,
      });
      vscode.window.showInformationMessage("Usage statistics and history refreshed.");
    }

    if (message.command === "fetchHistory") {
      const days = (message.days === 14 ? 14 : message.days === 30 ? 30 : 7) as 7 | 14 | 30;
      const history = await costService.fetchHistoricalUsage(conn.id, days);
      panel.webview.postMessage({
        type: "historicalUpdate",
        historicalUsage: history,
      });
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
      const scenario = message.scenario;
      let scenarioSection = "";

      if (scenario && scenario.inputs && scenario.results) {
        scenarioSection = `
## Architectural Capacity & Scenario Simulation
- **Daily Active Users (DAU):** ${Number(scenario.inputs.dau).toLocaleString()}
- **Reads / Session:** ${scenario.inputs.readsPerSession}
- **Writes / Session:** ${scenario.inputs.writesPerSession}
- **Deletes / Session:** ${scenario.inputs.deletesPerSession}
- **Avg Document Size:** ${scenario.inputs.docSize} bytes
- **Data Retention Window:** ${scenario.inputs.retentionDays} days
- **Client-Side Caching:** ${scenario.inputs.enableCaching ? `Enabled (${scenario.inputs.cacheHitRate}% hit rate)` : "Disabled"}

### Projected Monthly Costs (Blaze)
- **Document Reads:** ${scenario.results.readsCost || "$0.00"}
- **Document Writes:** ${scenario.results.writesCost || "$0.00"}
- **Document Deletes:** ${scenario.results.deletesCost || "$0.00"}
- **Storage:** ${scenario.results.storageCost || "$0.00"} (${scenario.results.storageGiB || "0.00 GiB"})
- **Total Projected Monthly Cost:** **${scenario.results.monthlyTotal || "$0.00"}**
${scenario.results.savings ? `- **Estimated Caching Savings:** ${scenario.results.savings} / month\n` : ""}
`;
      }

      const effectivePid = ConnectionManager.getInstance().getEffectiveProjectId(conn);
      const md = `# Firestore Cost & Quota Report: ${conn.name}
**Date:** ${snap.date}  
**Source:** ${snap.source}  
**Project ID:** ${effectivePid || "N/A"}  

## Daily Allowance Consumption
- **Reads:** ${snap.reads.toLocaleString()} / ${SPARK_FREE_QUOTA.readsPerDay.toLocaleString()} (${Math.round((snap.reads / SPARK_FREE_QUOTA.readsPerDay) * 100)}%)
- **Writes:** ${snap.writes.toLocaleString()} / ${SPARK_FREE_QUOTA.writesPerDay.toLocaleString()} (${Math.round((snap.writes / SPARK_FREE_QUOTA.writesPerDay) * 100)}%)
- **Deletes:** ${snap.deletes.toLocaleString()} / ${SPARK_FREE_QUOTA.deletesPerDay.toLocaleString()} (${Math.round((snap.deletes / SPARK_FREE_QUOTA.deletesPerDay) * 100)}%)
${scenarioSection}
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
      const history = await costService.fetchHistoricalUsage(conn.id, 7);
      const effectivePid = ConnectionManager.getInstance().getEffectiveProjectId(conn);
      const report = {
        connection: {
          id: conn.id,
          name: conn.name,
          projectId: effectivePid,
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
        scenarioSimulation: message.scenario || null,
        historicalTrend7d: history.points,
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

  panel.onDidDispose(() => {
    activeCostPanels.delete(conn.id);
    if (usageDebounceTimer) {
      clearTimeout(usageDebounceTimer);
      usageDebounceTimer = undefined;
    }
    sub.dispose();
    messageSub.dispose();
  });
}

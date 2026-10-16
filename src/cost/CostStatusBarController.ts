import * as vscode from "vscode";
import { CostService, SPARK_FREE_QUOTA } from "../cost/costService";
import { ConnectionManager } from "../connections/ConnectionManager";

/**
 * Controller for the Firestore Quota & Cost status bar indicator.
 * Displays daily reads and warning color when approaching free quota limit.
 */
export class CostStatusBarController implements vscode.Disposable {
  private _statusBarItem: vscode.StatusBarItem;
  private _disposables: vscode.Disposable[] = [];
  private _activeConnectionId: string | undefined;
  private _updateTimer: NodeJS.Timeout | undefined;
  private _isUpdating = false;

  constructor() {
    this._statusBarItem = vscode.window.createStatusBarItem(
      "ketrik-firestore-studio.costQuota",
      vscode.StatusBarAlignment.Right,
      95
    );
    this._statusBarItem.name = "Firestore Quota & Cost";
    this._statusBarItem.command = "ketrik-firestore-studio.openCostSimulator";
    this._disposables.push(this._statusBarItem);

    const costService = CostService.getInstance();
    this._disposables.push(
      costService.onDidChangeUsage((connectionId) => {
        if (!this._activeConnectionId || connectionId === "*" || connectionId === this._activeConnectionId) {
          this.scheduleUpdate(1000);
        }
      })
    );

    const connMgr = ConnectionManager.getInstance();
    this._disposables.push(
      connMgr.onDidChangeConnections(() => {
        this.scheduleUpdate(100);
      })
    );

    // Track active text editor to automatically sync active connection ID
    this._disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (!editor) return;
        const uri = editor.document.uri;
        let detectedConnId: string | undefined;

        if (uri.authority) {
          detectedConnId = uri.authority;
        } else if (uri.path) {
          const firstSegment = uri.path.replace(/^\//, "").split("/")[0];
          if (firstSegment && connMgr.getConnection(firstSegment)) {
            detectedConnId = firstSegment;
          }
        }

        if (detectedConnId && detectedConnId !== this._activeConnectionId) {
          this._activeConnectionId = detectedConnId;
          this.scheduleUpdate(100);
        }
      })
    );

    this.update();
  }

  public scheduleUpdate(delayMs = 1000): void {
    if (this._updateTimer) {
      clearTimeout(this._updateTimer);
    }
    this._updateTimer = setTimeout(() => {
      this._updateTimer = undefined;
      this.update().catch(() => {});
    }, delayMs);
  }

  public setActiveConnection(connectionId: string | undefined): void {
    this._activeConnectionId = connectionId;
    this.scheduleUpdate(50);
  }

  public async update(): Promise<void> {
    if (this._isUpdating) {
      this.scheduleUpdate(500);
      return;
    }
    this._isUpdating = true;
    try {
      await this._executeUpdate();
    } finally {
      this._isUpdating = false;
    }
  }

  private async _executeUpdate(): Promise<void> {
    const connMgr = ConnectionManager.getInstance();
    const connections = connMgr.getConnections();

    if (connections.length === 0) {
      this._statusBarItem.hide();
      return;
    }

    const connId = this._activeConnectionId || connections[0].id;
    const conn = connMgr.getConnection(connId);
    if (!conn) {
      this._statusBarItem.hide();
      return;
    }

    const costService = CostService.getInstance();
    const session = costService.getSessionCounts(connId);

    // Fetch daily usage (Cloud Monitoring API or session fallback)
    const daily = await costService.fetchDailyUsage(connId);

    const config = vscode.workspace.getConfiguration("ketrik-firestore-studio");
    const readThreshold = config.get<number>("costAlerts.dailyReadThreshold") ?? 40_000;
    const writeThreshold = config.get<number>("costAlerts.dailyWriteThreshold") ?? 16_000;
    const enableNotifications = config.get<boolean>("costAlerts.enableNotifications") ?? true;

    const dailyReads = daily.reads;
    const dailyWrites = daily.writes;
    const readsPct = Math.round((dailyReads / SPARK_FREE_QUOTA.readsPerDay) * 100);

    let icon = "$(graph)";
    let color: string | vscode.ThemeColor | undefined = undefined;

    const isReadExceeded = dailyReads >= readThreshold;
    const isWriteExceeded = dailyWrites >= writeThreshold;

    if (readsPct >= 100 || dailyReads >= SPARK_FREE_QUOTA.readsPerDay) {
      icon = "$(warning)";
      color = new vscode.ThemeColor("statusBarItem.errorForeground");
    } else if (isReadExceeded || isWriteExceeded || readsPct >= 80) {
      icon = "$(alert)";
      color = new vscode.ThemeColor("statusBarItem.warningForeground");
    }

    // Trigger one-time notification per session/day if alert threshold exceeded
    if (enableNotifications && (isReadExceeded || isWriteExceeded)) {
      this._checkAndShowNotification(conn.name, dailyReads, readThreshold, dailyWrites, writeThreshold);
    }

    // Display daily usage with session delta indicator
    if (daily.source === "cloud-monitoring" && session.reads > 0) {
      this._statusBarItem.text = `${icon} ${dailyReads.toLocaleString()} daily reads (+${session.reads} session)`;
    } else {
      this._statusBarItem.text = `${icon} ${dailyReads.toLocaleString()} reads (${readsPct}%)`;
    }

    this._statusBarItem.color = color;

    const sourceLabel =
      daily.source === "cloud-monitoring"
        ? "Google Cloud Monitoring (24h actual)"
        : "Session Accounting";

    const tooltipMd = new vscode.MarkdownString();
    tooltipMd.isTrusted = true;
    tooltipMd.appendMarkdown(`### 📊 Firestore Quota & Daily Usage\n\n`);
    tooltipMd.appendMarkdown(`- **Connection:** \`${conn.name}\` (${conn.projectId || "Local"})\n`);
    tooltipMd.appendMarkdown(`- **Source:** *${sourceLabel}*\n\n`);
    tooltipMd.appendMarkdown(`**Daily Quota (Spark Free Tier):**\n`);
    tooltipMd.appendMarkdown(`- **Reads:** \`${dailyReads.toLocaleString()} / 50,000\` (${readsPct}%)\n`);
    tooltipMd.appendMarkdown(`- **Writes:** \`${dailyWrites.toLocaleString()} / 20,000\`\n`);
    tooltipMd.appendMarkdown(`- **Deletes:** \`${daily.deletes.toLocaleString()} / 20,000\`\n\n`);
    tooltipMd.appendMarkdown(`**Budget Guardrails:**\n`);
    tooltipMd.appendMarkdown(`- Read Alert Threshold: \`${readThreshold.toLocaleString()}\` (${dailyReads >= readThreshold ? "⚠️ EXCEEDED" : "OK"})\n`);
    tooltipMd.appendMarkdown(`- Write Alert Threshold: \`${writeThreshold.toLocaleString()}\` (${dailyWrites >= writeThreshold ? "⚠️ EXCEEDED" : "OK"})\n\n`);
    if (session.reads > 0 || session.writes > 0 || session.deletes > 0) {
      tooltipMd.appendMarkdown(`**Current Session In-Memory Delta:**\n`);
      tooltipMd.appendMarkdown(`- Reads: \`${session.reads.toLocaleString()}\` | Writes: \`${session.writes.toLocaleString()}\` | Deletes: \`${session.deletes.toLocaleString()}\`\n\n`);
    }
    tooltipMd.appendMarkdown(`*Click to open Cost Simulator & Modeler.*`);

    this._statusBarItem.tooltip = tooltipMd;
    this._statusBarItem.show();
  }

  private _alertedKeys = new Set<string>();

  private _checkAndShowNotification(
    connectionName: string,
    reads: number,
    readThreshold: number,
    writes: number,
    writeThreshold: number
  ): void {
    const today = new Date().toISOString().slice(0, 10);
    const alertKey = `${connectionName}:${today}`;
    if (this._alertedKeys.has(alertKey)) return;

    this._alertedKeys.add(alertKey);
    const msgs: string[] = [];
    if (reads >= readThreshold) {
      msgs.push(`daily reads (${reads.toLocaleString()}) reached threshold of ${readThreshold.toLocaleString()}`);
    }
    if (writes >= writeThreshold) {
      msgs.push(`daily writes (${writes.toLocaleString()}) reached threshold of ${writeThreshold.toLocaleString()}`);
    }

    vscode.window
      .showWarningMessage(
        `[Ketrik Firestore Studio] Budget Alert for '${connectionName}': ${msgs.join(" and ")}.`,
        "Open Cost Simulator",
        "Dismiss"
      )
      .then((choice) => {
        if (choice === "Open Cost Simulator") {
          vscode.commands.executeCommand("ketrik-firestore-studio.openCostSimulator");
        }
      });
  }

  public dispose(): void {
    if (this._updateTimer) {
      clearTimeout(this._updateTimer);
      this._updateTimer = undefined;
    }
    this._disposables.forEach((d) => d.dispose());
  }
}

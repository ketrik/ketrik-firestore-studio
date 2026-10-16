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
          this.update();
        }
      })
    );

    const connMgr = ConnectionManager.getInstance();
    this._disposables.push(
      connMgr.onDidChangeConnections(() => {
        this.update();
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
          this.update();
        }
      })
    );

    this.update();
  }

  public setActiveConnection(connectionId: string | undefined): void {
    this._activeConnectionId = connectionId;
    this.update();
  }

  public async update(): Promise<void> {
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

    const dailyReads = daily.reads;
    const readsPct = Math.round((dailyReads / SPARK_FREE_QUOTA.readsPerDay) * 100);

    let icon = "$(graph)";
    let color: string | vscode.ThemeColor | undefined = undefined;

    if (readsPct >= 90) {
      icon = "$(warning)";
      color = new vscode.ThemeColor("statusBarItem.errorForeground");
    } else if (readsPct >= 70) {
      icon = "$(alert)";
      color = new vscode.ThemeColor("statusBarItem.warningForeground");
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
    tooltipMd.appendMarkdown(`- **Writes:** \`${daily.writes.toLocaleString()} / 20,000\`\n`);
    tooltipMd.appendMarkdown(`- **Deletes:** \`${daily.deletes.toLocaleString()} / 20,000\`\n\n`);
    if (session.reads > 0 || session.writes > 0 || session.deletes > 0) {
      tooltipMd.appendMarkdown(`**Current Session In-Memory Delta:**\n`);
      tooltipMd.appendMarkdown(`- Reads: \`${session.reads.toLocaleString()}\` | Writes: \`${session.writes.toLocaleString()}\` | Deletes: \`${session.deletes.toLocaleString()}\`\n\n`);
    }
    tooltipMd.appendMarkdown(`*Click to open Cost Simulator & Modeler.*`);

    this._statusBarItem.tooltip = tooltipMd;
    this._statusBarItem.show();
  }

  public dispose(): void {
    this._disposables.forEach((d) => d.dispose());
  }
}

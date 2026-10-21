import { OverviewDashboardData } from "../../analytics/overviewTypes";

export function getOverviewDashboardHtml(data: OverviewDashboardData): string {
  const jsonData = JSON.stringify(data).replace(/</g, "\\u003c");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Overview & Traffic Analytics: ${data.connectionName}</title>
  <style>
    :root {
      --bg: var(--vscode-editor-background, #1e1e1e);
      --fg: var(--vscode-editor-foreground, #cccccc);
      --card-bg: var(--vscode-editorWidget-background, rgba(255, 255, 255, 0.04));
      --card-border: var(--vscode-widget-border, var(--vscode-panel-border, rgba(128, 128, 128, 0.2)));
      --accent: var(--vscode-textLink-foreground, #3794ff);
      --accent-hover: var(--vscode-textLink-activeForeground, #58a6ff);
      --success: #4ec9b0;
      --warning: #cca700;
      --danger: #f14c4c;
      --purple: #c586c0;
      --muted: var(--vscode-descriptionForeground, #888888);
      --font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
      --button-bg: var(--vscode-button-background, #0e639c);
      --button-fg: var(--vscode-button-foreground, #ffffff);
      --button-hover: var(--vscode-button-hoverBackground, #1177bb);
      --badge-bg: var(--vscode-badge-background, #4d4d4d);
      --badge-fg: var(--vscode-badge-foreground, #ffffff);
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      background-color: var(--bg);
      color: var(--fg);
      font-family: var(--font-family);
      padding: 24px;
      line-height: 1.5;
    }

    /* Header */
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--card-border);
      gap: 16px;
      flex-wrap: wrap;
    }

    .title-row {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    h1 {
      font-size: 20px;
      font-weight: 600;
    }

    .status-badge {
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 12px;
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      color: var(--muted);
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }

    .status-badge.connected {
      color: var(--success);
      border-color: rgba(78, 201, 176, 0.4);
    }

    .status-badge.degraded {
      color: var(--warning);
      border-color: rgba(204, 167, 0, 0.4);
    }

    .actions {
      display: flex;
      gap: 8px;
    }

    .btn {
      background: var(--card-bg);
      color: var(--fg);
      border: 1px solid var(--card-border);
      padding: 6px 12px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: background 0.15s, border-color 0.15s;
    }

    .btn:hover {
      background: rgba(255, 255, 255, 0.08);
      border-color: var(--accent);
    }

    .btn-primary {
      background: var(--button-bg);
      color: var(--button-fg);
      border-color: var(--button-bg);
    }

    .btn-primary:hover {
      background: var(--button-hover);
    }

    /* KPI Summary Row */
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }

    .kpi-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 6px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .kpi-title {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--muted);
    }

    .kpi-value {
      font-size: 24px;
      font-weight: 600;
      color: var(--fg);
    }

    .kpi-sub {
      font-size: 11px;
      color: var(--muted);
    }

    /* Tabs */
    .tab-bar {
      display: flex;
      gap: 8px;
      border-bottom: 1px solid var(--card-border);
      margin-bottom: 20px;
    }

    .tab-btn {
      background: none;
      border: none;
      color: var(--muted);
      padding: 8px 16px;
      font-size: 13px;
      cursor: pointer;
      border-bottom: 2px solid transparent;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }

    .tab-btn:hover {
      color: var(--fg);
    }

    .tab-btn.active {
      color: var(--accent);
      border-bottom-color: var(--accent);
      font-weight: 600;
    }

    .tab-pane {
      display: none;
    }

    .tab-pane.active {
      display: block;
    }

    /* Content Cards */
    .card-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(420px, 1fr));
      gap: 20px;
      margin-bottom: 20px;
    }

    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 6px;
      padding: 20px;
    }

    .card-title {
      font-size: 14px;
      font-weight: 600;
      margin-bottom: 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    /* Notice Banner */
    .notice-banner {
      background: rgba(204, 167, 0, 0.1);
      border: 1px solid rgba(204, 167, 0, 0.3);
      border-radius: 4px;
      padding: 10px 14px;
      margin-bottom: 20px;
      font-size: 12px;
      color: var(--warning);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }

    /* Top Collections Table */
    .styled-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }

    .styled-table th {
      text-align: left;
      padding: 8px 10px;
      border-bottom: 1px solid var(--card-border);
      color: var(--muted);
      font-weight: 500;
    }

    .styled-table td {
      padding: 8px 10px;
      border-bottom: 1px solid rgba(128, 128, 128, 0.1);
    }

    .styled-table tr:hover td {
      background: rgba(255, 255, 255, 0.02);
    }

    .link-action {
      color: var(--accent);
      cursor: pointer;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }

    .link-action:hover {
      text-decoration: underline;
    }

    /* SVG Chart Containers */
    .chart-container {
      width: 100%;
      height: 200px;
      position: relative;
    }

    svg.time-chart {
      width: 100%;
      height: 100%;
      overflow: visible;
    }

    /* Tooltip */
    #chart-tooltip {
      position: absolute;
      display: none;
      background: #252526;
      border: 1px solid var(--card-border);
      border-radius: 4px;
      padding: 6px 10px;
      font-size: 11px;
      pointer-events: none;
      box-shadow: 0 4px 10px rgba(0, 0, 0, 0.4);
      z-index: 1000;
    }

    /* Progress bar */
    .progress-bar {
      width: 100%;
      height: 8px;
      background: rgba(128, 128, 128, 0.2);
      border-radius: 4px;
      overflow: hidden;
      margin-top: 6px;
    }

    .progress-fill {
      height: 100%;
      border-radius: 4px;
      transition: width 0.3s ease;
    }
  </style>
</head>
<body>
  <div id="chart-tooltip"></div>

  <div class="header">
    <div>
      <div class="title-row">
        <h1>Studio Overview & Traffic Analytics</h1>
        <span id="traffic-badge" class="status-badge ${data.traffic.status}">
          ● ${data.traffic.source}
        </span>
      </div>
      <div style="font-size: 12px; color: var(--muted); margin-top: 4px;">
        Connection: <strong>${data.connectionName}</strong> | Project: <strong>${data.projectId || "N/A"}</strong> | Refreshed: <span id="refreshed-time">${new Date(data.lastRefreshed).toLocaleTimeString()}</span>
      </div>
    </div>
    <div class="actions">
      <button class="btn" id="btn-refresh">🔄 Refresh</button>
      <button class="btn" id="btn-export-json">💾 Export JSON</button>
      <button class="btn" id="btn-export-md">📝 Export Markdown</button>
    </div>
  </div>

  ${data.traffic.noticeMessage ? `
  <div class="notice-banner">
    <div>ℹ️ ${data.traffic.noticeMessage}</div>
  </div>
  ` : ""}

  <!-- KPI SUMMARY ROW -->
  <div class="kpi-grid">
    <div class="kpi-card">
      <div class="kpi-title">Root Collections</div>
      <div class="kpi-value" id="kpi-collections">${data.database.totalCollections.toLocaleString()}</div>
      <div class="kpi-sub">Total database roots</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-title">Total Documents (Sampled)</div>
      <div class="kpi-value" id="kpi-documents">${data.database.totalDocuments.toLocaleString()}</div>
      <div class="kpi-sub">Across top collections</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-title">Operations (Today)</div>
      <div class="kpi-value" id="kpi-reads">${(data.traffic.todayReads + data.traffic.todayWrites + data.traffic.todayDeletes).toLocaleString()}</div>
      <div class="kpi-sub">📖 ${data.traffic.todayReads.toLocaleString()} reads · ✍️ ${data.traffic.todayWrites.toLocaleString()} writes</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-title">Auth Registered Users</div>
      <div class="kpi-value" id="kpi-users">${data.auth.isAvailable ? data.auth.totalUsers.toLocaleString() : "N/A"}</div>
      <div class="kpi-sub">${data.auth.isAvailable ? `🟢 ${data.auth.activeUsers.toLocaleString()} active` : "Auth disabled/unreachable"}</div>
    </div>
  </div>

  <!-- TABS -->
  <div class="tab-bar">
    <button class="tab-btn active" data-tab="tab-traffic">📈 Traffic & Throughput</button>
    <button class="tab-btn" data-tab="tab-database">🗄️ Database & Storage</button>
    <button class="tab-btn" data-tab="tab-auth">👥 Auth & Growth</button>
  </div>

  <!-- TAB 1: TRAFFIC & THROUGHPUT -->
  <div id="tab-traffic" class="tab-pane active">
    <div class="card-grid">
      <!-- Throughput Chart Card -->
      <div class="card">
        <div class="card-title">
          <span>Throughput (7-Day Reads, Writes & Deletes)</span>
          <span style="font-size: 11px; color: var(--muted);">Operations</span>
        </div>
        <div class="chart-container" id="throughput-chart-container">
          <svg class="time-chart" id="throughput-chart"></svg>
        </div>
        <div style="display: flex; gap: 16px; margin-top: 12px; font-size: 11px; justify-content: center;">
          <span style="display: flex; align-items: center; gap: 4px;"><span style="width: 8px; height: 8px; background: var(--accent); border-radius: 50%;"></span> Reads</span>
          <span style="display: flex; align-items: center; gap: 4px;"><span style="width: 8px; height: 8px; background: var(--success); border-radius: 50%;"></span> Writes</span>
          <span style="display: flex; align-items: center; gap: 4px;"><span style="width: 8px; height: 8px; background: var(--danger); border-radius: 50%;"></span> Deletes</span>
        </div>
      </div>

      <!-- Network Bandwidth / Payload Card -->
      <div class="card">
        <div class="card-title">
          <span>Network Bandwidth (7-Day Ingress vs. Egress)</span>
          <span style="font-size: 11px; color: var(--muted);">Bytes</span>
        </div>
        <div class="chart-container" id="bandwidth-chart-container">
          <svg class="time-chart" id="bandwidth-chart"></svg>
        </div>
        <div style="display: flex; gap: 16px; margin-top: 12px; font-size: 11px; justify-content: center;">
          <span style="display: flex; align-items: center; gap: 4px;"><span style="width: 8px; height: 8px; background: var(--purple); border-radius: 50%;"></span> Sent (Egress)</span>
          <span style="display: flex; align-items: center; gap: 4px;"><span style="width: 8px; height: 8px; background: var(--warning); border-radius: 50%;"></span> Received (Ingress)</span>
        </div>
      </div>
    </div>

    <!-- Active Connections & Rules Evaluations -->
    <div class="card-grid">
      <div class="card">
        <div class="card-title">Real-Time Listeners (Active Connections)</div>
        <div style="display: flex; align-items: baseline; gap: 8px; margin-bottom: 8px;">
          <span style="font-size: 32px; font-weight: 600; color: var(--accent);">${data.traffic.currentListenersCount.toLocaleString()}</span>
          <span style="color: var(--muted); font-size: 12px;">Active onSnapshot Clients</span>
        </div>
        <p style="font-size: 12px; color: var(--muted);">Real-time snapshot streams open simultaneously between apps and Firestore.</p>
      </div>

      <div class="card">
        <div class="card-title">Security Rules Evaluation Traffic</div>
        <div style="display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 6px;">
          <span>Allowed vs. Denied Traffic</span>
          <span id="rules-ratio">Live Metrics</span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill" style="width: 95%; background: var(--success);"></div>
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 11px; color: var(--muted); margin-top: 6px;">
          <span>🟢 Allowed Operations</span>
          <span>🔴 Denied Operations</span>
        </div>
      </div>
    </div>
  </div>

  <!-- TAB 2: DATABASE & STORAGE -->
  <div id="tab-database" class="tab-pane">
    <div class="card" style="margin-bottom: 20px;">
      <div class="card-title">
        <span>Top Collections by Volume</span>
        <span style="font-size: 11px; color: var(--muted);">Server count() aggregations</span>
      </div>
      <table class="styled-table">
        <thead>
          <tr>
            <th>Collection</th>
            <th>Document Count</th>
            <th>Avg. Doc Size</th>
            <th>Estimated Total Size</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody id="top-collections-tbody">
          ${data.database.topCollections.map(col => `
            <tr>
              <td><strong>${col.id}</strong></td>
              <td>${col.documentCount.toLocaleString()}</td>
              <td>${formatBytes(col.avgDocSizeBytes)}</td>
              <td>${formatBytes(col.estimatedSizeBytes)}</td>
              <td>
                <a class="link-action open-table-link" data-collection="${col.id}">
                  ↗ Open Table
                </a>
              </td>
            </tr>
          `).join("")}
          ${data.database.topCollections.length === 0 ? `<tr><td colspan="5" style="text-align: center; color: var(--muted); padding: 20px;">No root collections found</td></tr>` : ""}
        </tbody>
      </table>
    </div>

    <!-- Storage Footprint & Quota Burn Rate Grid -->
    <div class="card-grid">
      <!-- Storage Capacity Gauge -->
      <div class="card">
        <div class="card-title">
          <span>Projected Database Storage</span>
          <span style="font-size: 11px; color: var(--muted);">Spark Free: 1.0 GiB</span>
        </div>
        <div style="display: flex; align-items: baseline; gap: 8px; margin-bottom: 8px;">
          <span style="font-size: 28px; font-weight: 600; color: var(--fg);">${formatBytes(data.database.totalEstimatedSizeBytes)}</span>
          <span style="color: var(--muted); font-size: 12px;">projected storage footprint</span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${Math.min(100, Math.max(1, (data.database.totalEstimatedSizeBytes / (1024 * 1024 * 1024)) * 100))}%; background: var(--accent);"></div>
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 11px; color: var(--muted); margin-top: 6px;">
          <span>${((data.database.totalEstimatedSizeBytes / (1024 * 1024 * 1024)) * 100).toFixed(2)}% of 1 GB Spark allowance</span>
          <span>Max Free: 1.0 GiB</span>
        </div>
      </div>

      <!-- Daily Operations Quota Burn Rate -->
      <div class="card">
        <div class="card-title">
          <span>Daily Allowance Burn Rate</span>
          <span style="font-size: 11px; color: var(--muted);">Spark Daily Allowances</span>
        </div>
        <div style="display: flex; flex-direction: column; gap: 10px; margin-top: 4px;">
          <!-- Reads Burn Rate -->
          <div>
            <div style="display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 3px;">
              <span>Document Reads</span>
              <span><strong>${data.traffic.todayReads.toLocaleString()}</strong> / 50,000 (${Math.min(100, Math.round((data.traffic.todayReads / 50000) * 100))}%)</span>
            </div>
            <div class="progress-bar">
              <div class="progress-fill" style="width: ${Math.min(100, (data.traffic.todayReads / 50000) * 100)}%; background: ${data.traffic.todayReads > 45000 ? "var(--danger)" : data.traffic.todayReads > 30000 ? "var(--warning)" : "var(--accent)"};"></div>
            </div>
          </div>
          <!-- Writes Burn Rate -->
          <div>
            <div style="display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 3px;">
              <span>Document Writes</span>
              <span><strong>${data.traffic.todayWrites.toLocaleString()}</strong> / 20,000 (${Math.min(100, Math.round((data.traffic.todayWrites / 20000) * 100))}%)</span>
            </div>
            <div class="progress-bar">
              <div class="progress-fill" style="width: ${Math.min(100, (data.traffic.todayWrites / 20000) * 100)}%; background: ${data.traffic.todayWrites > 18000 ? "var(--danger)" : data.traffic.todayWrites > 12000 ? "var(--warning)" : "var(--success)"};"></div>
            </div>
          </div>
          <!-- Deletes Burn Rate -->
          <div>
            <div style="display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 3px;">
              <span>Document Deletes</span>
              <span><strong>${data.traffic.todayDeletes.toLocaleString()}</strong> / 20,000 (${Math.min(100, Math.round((data.traffic.todayDeletes / 20000) * 100))}%)</span>
            </div>
            <div class="progress-bar">
              <div class="progress-fill" style="width: ${Math.min(100, (data.traffic.todayDeletes / 20000) * 100)}%; background: var(--danger);"></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- TAB 3: AUTH & GROWTH -->
  <div id="tab-auth" class="tab-pane">
    <div class="card-grid">
      <div class="card">
        <div class="card-title">User Account Breakdown</div>
        <div style="display: flex; flex-direction: column; gap: 12px; margin-top: 8px;">
          <div>
            <div style="display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 4px;">
              <span>Active Accounts</span>
              <span><strong>${data.auth.activeUsers.toLocaleString()}</strong> (${data.auth.totalUsers > 0 ? Math.round((data.auth.activeUsers / data.auth.totalUsers) * 100) : 0}%)</span>
            </div>
            <div class="progress-bar">
              <div class="progress-fill" style="width: ${data.auth.totalUsers > 0 ? (data.auth.activeUsers / data.auth.totalUsers) * 100 : 0}%; background: var(--success);"></div>
            </div>
          </div>
          <div>
            <div style="display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 4px;">
              <span>Verified Email Accounts</span>
              <span><strong>${data.auth.verifiedEmailUsers.toLocaleString()}</strong> (${data.auth.totalUsers > 0 ? Math.round((data.auth.verifiedEmailUsers / data.auth.totalUsers) * 100) : 0}%)</span>
            </div>
            <div class="progress-bar">
              <div class="progress-fill" style="width: ${data.auth.totalUsers > 0 ? (data.auth.verifiedEmailUsers / data.auth.totalUsers) * 100 : 0}%; background: var(--accent);"></div>
            </div>
          </div>
          <div>
            <div style="display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 4px;">
              <span>7-Day Active Sign-Ins</span>
              <span><strong>${data.auth.recentActive7Days.toLocaleString()}</strong> (${data.auth.totalUsers > 0 ? Math.round((data.auth.recentActive7Days / data.auth.totalUsers) * 100) : 0}%)</span>
            </div>
            <div class="progress-bar">
              <div class="progress-fill" style="width: ${data.auth.totalUsers > 0 ? (data.auth.recentActive7Days / data.auth.totalUsers) * 100 : 0}%; background: var(--purple);"></div>
            </div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">Auth Identity Providers</div>
        <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 8px;">
          ${Object.entries(data.auth.providers).map(([provider, count]) => `
            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 12px; padding: 6px 0; border-bottom: 1px solid rgba(128, 128, 128, 0.1);">
              <span style="text-transform: capitalize;">${provider}</span>
              <span style="font-weight: 600;">${count.toLocaleString()}</span>
            </div>
          `).join("")}
          ${Object.keys(data.auth.providers).length === 0 ? `<p style="font-size: 12px; color: var(--muted); text-align: center; padding: 20px;">No provider statistics available</p>` : ""}
        </div>
      </div>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    let currentData = ${jsonData};

    function formatBytes(bytes) {
      if (!bytes || bytes === 0) return "0 B";
      const k = 1024;
      const sizes = ["B", "KB", "MB", "GB", "TB"];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return (bytes / Math.pow(k, i)).toFixed(1) + " " + sizes[i];
    }

    // Tab Navigation
    document.querySelectorAll(".tab-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
        document.querySelectorAll(".tab-pane").forEach(p => p.classList.remove("active"));
        btn.classList.add("active");
        const tabId = btn.getAttribute("data-tab");
        const pane = document.getElementById(tabId);
        if (pane) pane.classList.add("active");
        renderCharts();
      });
    });

    // Top Collections Open Table Jumps
    document.querySelectorAll(".open-table-link").forEach(a => {
      a.addEventListener("click", () => {
        const col = a.getAttribute("data-collection");
        if (col) {
          vscode.postMessage({ command: "openCollectionTable", collectionId: col });
        }
      });
    });

    // Toolbar Actions
    document.getElementById("btn-refresh").addEventListener("click", () => {
      const btn = document.getElementById("btn-refresh");
      btn.textContent = "⏳ Refreshing...";
      vscode.postMessage({ command: "refresh" });
    });

    document.getElementById("btn-export-json").addEventListener("click", () => {
      vscode.postMessage({ command: "exportJson" });
    });

    document.getElementById("btn-export-md").addEventListener("click", () => {
      vscode.postMessage({ command: "exportMarkdown" });
    });

    // Render Crisp SVG Time Charts
    function renderCharts() {
      const history = currentData.traffic?.history7Days || [];
      if (history.length === 0) return;

      renderThroughputChart(history);
      renderBandwidthChart(history);
    }

    function renderThroughputChart(history) {
      const svg = document.getElementById("throughput-chart");
      if (!svg) return;
      svg.innerHTML = "";

      const width = svg.clientWidth || 400;
      const height = svg.clientHeight || 200;
      const padLeft = 40, padRight = 10, padTop = 20, padBottom = 30;
      const chartW = width - padLeft - padRight;
      const chartH = height - padTop - padBottom;

      const maxVal = Math.max(
        10,
        ...history.map(h => Math.max(h.reads, h.writes, h.deletes))
      );

      // Axes & grid lines
      let gridHtml = \`
        <line x1="\${padLeft}" y1="\${padTop + chartH}" x2="\${padLeft + chartW}" y2="\${padTop + chartH}" stroke="rgba(128,128,128,0.3)" />
        <line x1="\${padLeft}" y1="\${padTop}" x2="\${padLeft + chartW}" y2="\${padTop}" stroke="rgba(128,128,128,0.1)" stroke-dasharray="2,2" />
        <text x="\${padLeft - 6}" y="\${padTop + 4}" fill="var(--muted)" font-size="10" text-anchor="end">\${maxVal.toLocaleString()}</text>
        <text x="\${padLeft - 6}" y="\${padTop + chartH}" fill="var(--muted)" font-size="10" text-anchor="end">0</text>
      \`;

      const getX = idx => padLeft + (idx / (history.length - 1)) * chartW;
      const getY = val => padTop + chartH - (val / maxVal) * chartH;

      // Lines
      const makePath = key => {
        return history.map((pt, i) => \`\${i === 0 ? "M" : "L"} \${getX(i)} \${getY(pt[key])}\`).join(" ");
      };

      const pathReads = makePath("reads");
      const pathWrites = makePath("writes");
      const pathDeletes = makePath("deletes");

      let pathsHtml = \`
        <path d="\${pathReads}" fill="none" stroke="var(--accent)" stroke-width="2" />
        <path d="\${pathWrites}" fill="none" stroke="var(--success)" stroke-width="2" />
        <path d="\${pathDeletes}" fill="none" stroke="var(--danger)" stroke-width="2" />
      \`;

      // Circles & Tooltips
      let pointsHtml = "";
      history.forEach((pt, i) => {
        const x = getX(i);
        const yReads = getY(pt.reads);
        const dateLabel = pt.date.slice(5);

        pointsHtml += \`
          <text x="\${x}" y="\${padTop + chartH + 16}" fill="var(--muted)" font-size="10" text-anchor="middle">\${dateLabel}</text>
          <circle cx="\${x}" cy="\${yReads}" r="4" fill="var(--accent)" class="chart-point" data-info="Reads: \${pt.reads.toLocaleString()} (\${pt.date})">
            <title>Reads: \${pt.reads.toLocaleString()} (\${pt.date})</title>
          </circle>
        \`;
      });

      svg.innerHTML = gridHtml + pathsHtml + pointsHtml;
    }

    function renderBandwidthChart(history) {
      const svg = document.getElementById("bandwidth-chart");
      if (!svg) return;
      svg.innerHTML = "";

      const width = svg.clientWidth || 400;
      const height = svg.clientHeight || 200;
      const padLeft = 50, padRight = 10, padTop = 20, padBottom = 30;
      const chartW = width - padLeft - padRight;
      const chartH = height - padTop - padBottom;

      const maxVal = Math.max(
        1024,
        ...history.map(h => Math.max(h.sentBytes || 0, h.receivedBytes || 0))
      );

      let gridHtml = \`
        <line x1="\${padLeft}" y1="\${padTop + chartH}" x2="\${padLeft + chartW}" y2="\${padTop + chartH}" stroke="rgba(128,128,128,0.3)" />
        <text x="\${padLeft - 6}" y="\${padTop + 4}" fill="var(--muted)" font-size="10" text-anchor="end">\${formatBytes(maxVal)}</text>
        <text x="\${padLeft - 6}" y="\${padTop + chartH}" fill="var(--muted)" font-size="10" text-anchor="end">0 B</text>
      \`;

      const getX = idx => padLeft + (idx / (history.length - 1)) * chartW;
      const getY = val => padTop + chartH - (val / maxVal) * chartH;

      const pathSent = history.map((pt, i) => \`\${i === 0 ? "M" : "L"} \${getX(i)} \${getY(pt.sentBytes || 0)}\`).join(" ");
      const pathRecv = history.map((pt, i) => \`\${i === 0 ? "M" : "L"} \${getX(i)} \${getY(pt.receivedBytes || 0)}\`).join(" ");

      let pathsHtml = \`
        <path d="\${pathSent}" fill="none" stroke="var(--purple)" stroke-width="2" />
        <path d="\${pathRecv}" fill="none" stroke="var(--warning)" stroke-width="2" />
      \`;

      let pointsHtml = "";
      history.forEach((pt, i) => {
        const x = getX(i);
        const ySent = getY(pt.sentBytes || 0);
        const dateLabel = pt.date.slice(5);

        pointsHtml += \`
          <text x="\${x}" y="\${padTop + chartH + 16}" fill="var(--muted)" font-size="10" text-anchor="middle">\${dateLabel}</text>
          <circle cx="\${x}" cy="\${ySent}" r="4" fill="var(--purple)" class="chart-point" data-info="Sent: \${formatBytes(pt.sentBytes || 0)} (\${pt.date})">
            <title>Sent: \${formatBytes(pt.sentBytes || 0)} (\${pt.date})</title>
          </circle>
        \`;
      });

      svg.innerHTML = gridHtml + pathsHtml + pointsHtml;
    }

    // Delegated chart tooltip handling (0 event listeners per circle)
    const tooltip = document.getElementById("chart-tooltip");
    document.addEventListener("mouseover", (e) => {
      const circle = e.target.closest(".chart-point");
      if (!circle || !tooltip) return;
      const info = circle.getAttribute("data-info");
      if (!info) return;
      tooltip.textContent = info;
      tooltip.style.display = "block";
      const rect = circle.getBoundingClientRect();
      tooltip.style.left = (rect.left + 10) + "px";
      tooltip.style.top = (rect.top - 25) + "px";
    });

    document.addEventListener("mouseout", (e) => {
      const circle = e.target.closest(".chart-point");
      if (circle && tooltip) {
        tooltip.style.display = "none";
      }
    });

    // Initial render
    window.addEventListener("load", () => {
      renderCharts();
    });

    let resizeRaf = null;
    window.addEventListener("resize", () => {
      if (resizeRaf) return;
      resizeRaf = requestAnimationFrame(() => {
        renderCharts();
        resizeRaf = null;
      });
    });
  </script>
</body>
</html>`;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return (bytes / Math.pow(k, i)).toFixed(1) + " " + sizes[i];
}

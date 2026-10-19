import { SPARK_FREE_QUOTA, BLAZE_PRICING, DailyUsageSnapshot, HistoricalUsageData } from "../../cost/costService";

export interface CostSimulatorInitialData {
  connectionId: string;
  connectionName: string;
  projectId?: string;
  isEmulator: boolean;
  isLocalJson: boolean;
  usageSnapshot: DailyUsageSnapshot;
  historicalUsage?: HistoricalUsageData;
}

export function getCostSimulatorHtml(data: CostSimulatorInitialData): string {

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Firestore Cost Simulator & Quota Usage</title>
  <style>
    :root {
      --bg-color: var(--vscode-editor-background, #1e1e1e);
      --text-color: var(--vscode-editor-foreground, #d4d4d4);
      --card-bg: var(--vscode-editorWidget-background, rgba(255, 255, 255, 0.04));
      --card-border: var(--vscode-widget-border, var(--vscode-panel-border, rgba(128, 128, 128, 0.2)));
      --accent: var(--vscode-textLink-foreground, #3794ff);
      --success: #4ec9b0;
      --warning: #cca700;
      --danger: #f14c4c;
      --muted: var(--vscode-descriptionForeground, #888888);
      --font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      background-color: var(--bg-color);
      color: var(--text-color);
      font-family: var(--font-family);
      padding: 24px;
      line-height: 1.5;
    }

    .header-container {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 24px;
      border-bottom: 1px solid var(--card-border);
      padding-bottom: 16px;
      gap: 16px;
      flex-wrap: wrap;
    }

    .header-info {
      flex: 1 1 360px;
      min-width: 0;
    }

    .header-title {
      font-size: 1.4rem;
      font-weight: 600;
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 10px;
      line-height: 1.3;
    }

    .badge-source {
      font-size: 0.75rem;
      padding: 3px 10px;
      border-radius: 12px;
      font-weight: 600;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      white-space: nowrap;
      transition: all 0.2s ease;
    }

    .badge-live {
      background: rgba(78, 201, 176, 0.15);
      color: var(--success);
      border: 1px solid rgba(78, 201, 176, 0.4);
    }

    .badge-session {
      background: rgba(204, 167, 0, 0.15);
      color: var(--warning);
      border: 1px solid rgba(204, 167, 0, 0.45);
    }

    .monitoring-notice-banner {
      display: none;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-top: 10px;
      padding: 8px 12px;
      border-radius: 6px;
      background: rgba(204, 167, 0, 0.08);
      border: 1px solid rgba(204, 167, 0, 0.3);
      font-size: 0.82rem;
      color: var(--text-color);
      flex-wrap: wrap;
    }

    .monitoring-notice-banner.visible {
      display: flex;
    }

    .monitoring-notice-content {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      flex: 1 1 280px;
      min-width: 0;
    }

    .monitoring-notice-error {
      color: var(--muted);
      font-family: monospace;
      font-size: 0.78rem;
      background: rgba(0, 0, 0, 0.2);
      padding: 2px 6px;
      border-radius: 3px;
      word-break: break-word;
    }

    .btn-inline-retry {
      background: transparent;
      color: var(--warning);
      border: 1px solid rgba(204, 167, 0, 0.5);
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 0.78rem;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      white-space: nowrap;
    }

    .btn-inline-retry:hover {
      background: rgba(204, 167, 0, 0.2);
    }

    .header-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      align-items: center;
      align-self: flex-start;
    }

    @media (max-width: 768px) {
      body {
        padding: 14px;
      }

      .header-container {
        flex-direction: column;
        align-items: stretch;
        gap: 14px;
        margin-bottom: 16px;
        padding-bottom: 12px;
      }

      .header-info {
        flex: 1 1 100%;
      }

      .header-title {
        font-size: 1.15rem;
        gap: 8px;
      }

      .header-actions {
        width: 100%;
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 8px;
      }

      .header-actions button {
        width: 100%;
        justify-content: center;
        padding: 7px 10px;
        font-size: 0.8rem;
      }

      .tabs {
        overflow-x: auto;
        white-space: nowrap;
        scrollbar-width: thin;
        gap: 2px;
        margin-bottom: 14px;
        -webkit-overflow-scrolling: touch;
      }

      .tab-btn {
        padding: 6px 12px;
        font-size: 0.85rem;
        flex-shrink: 0;
      }

      .trend-toolbar {
        flex-direction: column;
        align-items: flex-start;
        gap: 10px;
      }

      .time-selector {
        width: 100%;
        display: flex;
      }

      .time-selector .time-btn {
        flex: 1;
        text-align: center;
      }

      .chart-title {
        flex-direction: column;
        align-items: flex-start;
        gap: 8px;
      }
    }

    @media (max-width: 480px) {
      .header-actions {
        grid-template-columns: 1fr;
      }
    }

    button {
      background: var(--vscode-button-background, #0e639c);
      color: var(--vscode-button-foreground, #ffffff);
      border: none;
      padding: 6px 14px;
      border-radius: 4px;
      font-size: 0.85rem;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-family: inherit;
    }

    button:hover {
      background: var(--vscode-button-hoverBackground, #1177bb);
    }

    button.secondary {
      background: var(--vscode-button-secondaryBackground, #3a3d41);
      color: var(--vscode-button-secondaryForeground, #ffffff);
    }

    button.secondary:hover {
      background: var(--vscode-button-secondaryHoverBackground, #45494e);
    }

    .tabs {
      display: flex;
      gap: 4px;
      border-bottom: 1px solid var(--card-border);
      margin-bottom: 20px;
    }

    .tab-btn {
      background: none;
      border: none;
      border-bottom: 2px solid transparent;
      padding: 8px 16px;
      color: var(--muted);
      border-radius: 0;
      cursor: pointer;
      font-size: 0.95rem;
      font-weight: 500;
    }

    .tab-btn:hover {
      background: rgba(128, 128, 128, 0.08);
      color: var(--text-color);
    }

    .tab-btn.active {
      color: var(--accent);
      border-bottom: 2px solid var(--accent);
      background: none;
    }

    .tab-content {
      display: none;
    }

    .tab-content.active {
      display: block;
    }

    .grid-cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }

    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 16px 20px;
      position: relative;
    }

    .card-title {
      font-size: 0.85rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--muted);
      margin-bottom: 8px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .card-value {
      font-size: 1.7rem;
      font-weight: 700;
      margin-bottom: 4px;
    }

    .card-subtext {
      font-size: 0.82rem;
      color: var(--muted);
    }

    .progress-bar-container {
      background: rgba(128, 128, 128, 0.2);
      border-radius: 4px;
      height: 8px;
      width: 100%;
      overflow: hidden;
      margin: 10px 0 6px 0;
    }

    .progress-bar-fill {
      height: 100%;
      border-radius: 4px;
      transition: width 0.4s ease, background-color 0.4s ease;
    }

    .fill-green {
      background: var(--success);
    }

    .fill-yellow {
      background: var(--warning);
    }

    .fill-red {
      background: var(--danger);
    }

    .calculator-layout {
      display: grid;
      grid-template-columns: 360px 1fr;
      gap: 24px;
    }

    @media (max-width: 800px) {
      .calculator-layout {
        grid-template-columns: 1fr;
      }
    }

    .form-group {
      margin-bottom: 14px;
    }

    label {
      display: block;
      font-size: 0.85rem;
      font-weight: 500;
      margin-bottom: 6px;
    }

    .label-hint {
      font-size: 0.78rem;
      color: var(--muted);
      font-weight: normal;
      margin-left: 4px;
    }

    input[type="number"], select {
      width: 100%;
      padding: 8px 10px;
      border: 1px solid var(--card-border);
      background: var(--vscode-input-background, #2d2d2d);
      color: var(--vscode-input-foreground, #cccccc);
      border-radius: 4px;
      font-family: inherit;
      font-size: 0.9rem;
    }

    input[type="number"]:focus, select:focus {
      outline: 1px solid var(--accent);
      border-color: var(--accent);
    }

    .checkbox-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 10px;
      cursor: pointer;
    }

    .checkbox-row input {
      cursor: pointer;
    }

    .results-panel {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 20px;
    }

    .results-title {
      font-size: 1.1rem;
      font-weight: 600;
      margin-bottom: 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .results-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 16px;
    }

    .results-table th, .results-table td {
      padding: 10px 12px;
      text-align: left;
      border-bottom: 1px solid var(--card-border);
    }

    .results-table th {
      color: var(--muted);
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .results-table td.numeric {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }

    .total-highlight {
      font-weight: 700;
      font-size: 1.05rem;
      color: var(--accent);
    }

    .savings-badge {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 4px;
      background: rgba(78, 201, 176, 0.15);
      color: var(--success);
      border: 1px solid rgba(78, 201, 176, 0.3);
      font-weight: 600;
      font-size: 0.85rem;
      margin-top: 8px;
    }

    .rates-legend {
      margin-top: 24px;
      background: rgba(128, 128, 128, 0.06);
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 16px;
      font-size: 0.85rem;
    }

    .rates-legend h4 {
      margin-bottom: 8px;
      color: var(--text-color);
    }

    .rates-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 12px;
      color: var(--muted);
    }

    .rates-grid strong {
      color: var(--text-color);
    }

    /* Historical Trends Styles */
    .trend-toolbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
    }

    .time-selector {
      display: inline-flex;
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 6px;
      overflow: hidden;
    }

    .time-btn {
      background: transparent;
      border: none;
      border-radius: 0;
      padding: 6px 14px;
      color: var(--muted);
      font-size: 0.85rem;
      cursor: pointer;
    }

    .time-btn:hover {
      background: rgba(128, 128, 128, 0.1);
      color: var(--text-color);
    }

    .time-btn.active {
      background: var(--accent);
      color: #fff;
    }

    .chart-container {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 20px;
      position: relative;
    }

    .chart-title {
      font-size: 0.95rem;
      font-weight: 600;
      margin-bottom: 12px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .chart-legend {
      display: flex;
      gap: 16px;
      font-size: 0.8rem;
    }

    .legend-item {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .legend-dot {
      width: 10px;
      height: 10px;
      border-radius: 2px;
    }

    .svg-chart {
      width: 100%;
      height: 220px;
      overflow: visible;
    }
  </style>
</head>
<body>
  <div class="header-container">
    <div class="header-info">
      <div class="header-title">
        <span>💰 Firestore Cost Simulator & Free Quota Usage</span>
        <span class="badge-source ${
          data.usageSnapshot.source === "cloud-monitoring" ? "badge-live" : "badge-session"
        }" id="sourceBadge">${
          data.usageSnapshot.source === "cloud-monitoring"
            ? "🟢 Live Cloud Monitoring"
            : "🟡 Active Session Accounting"
        }</span>
      </div>
      <div style="font-size: 0.85rem; color: var(--muted); margin-top: 4px;">
        Connection: <strong>${data.connectionName}</strong> ${
    data.projectId ? `(${data.projectId})` : ""
  } &bull; Target: ${
    data.isEmulator ? "Local Emulator" : data.isLocalJson ? "Local JSON" : "Cloud Firestore"
  }
      </div>
      <div id="monitoringNoticeBanner" class="monitoring-notice-banner ${
        data.usageSnapshot.source === "session-accounting" && !data.isEmulator && !data.isLocalJson ? "visible" : ""
      }">
        <div class="monitoring-notice-content">
          <span>⚠️ <strong>Live Cloud Monitoring Unavailable</strong> &mdash; displaying operations recorded in this local VS Code session.</span>
          <span class="monitoring-notice-error" id="monitoringErrorText">${
            data.usageSnapshot.monitoringError ? `Reason: ${data.usageSnapshot.monitoringError}` : "Could not reach Google Cloud Monitoring API"
          }</span>
        </div>
        <button id="bannerRetryBtn" class="btn-inline-retry" title="Retry connecting to Google Cloud Monitoring API">🔄 Try Again</button>
      </div>
    </div>
    <div class="header-actions">
      <button id="refreshBtn" class="secondary" title="Re-fetch usage data">🔄 Refresh Usage</button>
      <button id="resetSessionBtn" class="secondary" title="Reset in-memory session operations counter">🧹 Reset Session</button>
      <button id="exportMdBtn" title="Export report as Markdown">📝 Export Markdown</button>
      <button id="exportJsonBtn" class="secondary" title="Export report as JSON">⬇ Export JSON</button>
    </div>
  </div>

  <div class="tabs">
    <button class="tab-btn active" data-tab="quotasTab">📊 Daily Quota Meters</button>
    <button class="tab-btn" data-tab="trendsTab">📈 Historical Trends</button>
    <button class="tab-btn" data-tab="calculatorTab">🧮 Capacity & Cost Modeler</button>
    <button class="tab-btn" data-tab="pricingTab">📋 Pricing Matrix & Rates</button>
  </div>

  <!-- TAB 1: DAILY QUOTAS -->
  <div id="quotasTab" class="tab-content active">
    <div class="grid-cards">
      <!-- READS CARD -->
      <div class="card">
        <div class="card-title">
          <span>Daily Reads</span>
          <span>50,000 Free / Day</span>
        </div>
        <div class="card-value" id="meterReadsVal">${data.usageSnapshot.reads.toLocaleString()}</div>
        <div class="progress-bar-container">
          <div id="meterReadsBar" class="progress-bar-fill fill-green" style="width: 0%;"></div>
        </div>
        <div class="card-subtext" id="meterReadsSub">0% of free daily allowance used</div>
      </div>

      <!-- WRITES CARD -->
      <div class="card">
        <div class="card-title">
          <span>Daily Writes</span>
          <span>20,000 Free / Day</span>
        </div>
        <div class="card-value" id="meterWritesVal">${data.usageSnapshot.writes.toLocaleString()}</div>
        <div class="progress-bar-container">
          <div id="meterWritesBar" class="progress-bar-fill fill-green" style="width: 0%;"></div>
        </div>
        <div class="card-subtext" id="meterWritesSub">0% of free daily allowance used</div>
      </div>

      <!-- DELETES CARD -->
      <div class="card">
        <div class="card-title">
          <span>Daily Deletes</span>
          <span>20,000 Free / Day</span>
        </div>
        <div class="card-value" id="meterDeletesVal">${data.usageSnapshot.deletes.toLocaleString()}</div>
        <div class="progress-bar-container">
          <div id="meterDeletesBar" class="progress-bar-fill fill-green" style="width: 0%;"></div>
        </div>
        <div class="card-subtext" id="meterDeletesSub">0% of free daily allowance used</div>
      </div>

      <!-- ESTIMATED OVERAGE COST -->
      <div class="card">
        <div class="card-title">
          <span>Blaze Daily Overage</span>
          <span>Pay-As-You-Go</span>
        </div>
        <div class="card-value" id="meterCostVal">$0.00</div>
        <div class="card-subtext" id="meterCostSub" style="margin-top: 14px;">$0.00 across all operations within free quota</div>
      </div>
    </div>

    <div class="card" style="margin-top: 16px;">
      <h3 style="font-size: 1rem; margin-bottom: 8px;">💡 Quota Health & Optimization Insights</h3>
      <p id="quotaInsightText" style="font-size: 0.88rem; color: var(--text-color);">
        All operations are currently running comfortably within Google Cloud Firestore's Spark Free Allowance. No billable overage charges incurred today.
      </p>
    </div>
  </div>

  <!-- TAB: HISTORICAL TRENDS -->
  <div id="trendsTab" class="tab-content">
    <div class="trend-toolbar">
      <div style="font-size: 0.95rem; font-weight: 600; display: flex; align-items: center; gap: 8px;">
        <span>Daily Firestore Operations Trend</span>
        <span class="badge-source ${
          data.historicalUsage?.source === "cloud-monitoring" ? "badge-live" : "badge-session"
        }" id="historySourceBadge">${
          data.historicalUsage?.source === "cloud-monitoring"
            ? "🟢 Cloud Monitoring Metrics"
            : "🟡 Simulated Historical Baseline"
        }</span>
      </div>
      <div class="time-selector">
        <button class="time-btn active" data-days="7">7 Days</button>
        <button class="time-btn" data-days="14">14 Days</button>
        <button class="time-btn" data-days="30">30 Days</button>
      </div>
    </div>

    <div class="chart-container">
      <div class="chart-title">
        <span>Document Operations (Reads, Writes & Deletes)</span>
        <div class="chart-legend">
          <div class="legend-item"><div class="legend-dot" style="background:#3794ff;"></div> Reads</div>
          <div class="legend-item"><div class="legend-dot" style="background:#4ec9b0;"></div> Writes</div>
          <div class="legend-item"><div class="legend-dot" style="background:#f14c4c;"></div> Deletes</div>
        </div>
      </div>
      <div id="chartSvgWrapper" style="position:relative; width: 100%;">
        <svg id="trendSvg" class="svg-chart" viewBox="0 0 800 220" preserveAspectRatio="none">
          <!-- Dynamic SVG content rendered via JS -->
        </svg>
      </div>
    </div>

    <div class="card">
      <h3 style="font-size: 1rem; margin-bottom: 8px;">📊 Time-Series Aggregations & Observations</h3>
      <div class="rates-grid" id="historyStatsGrid">
        <div><strong>Total Reads in Period:</strong> <span id="histTotalReads">0</span></div>
        <div><strong>Total Writes in Period:</strong> <span id="histTotalWrites">0</span></div>
        <div><strong>Total Deletes in Period:</strong> <span id="histTotalDeletes">0</span></div>
        <div><strong>Daily Peak Reads:</strong> <span id="histPeakReads">0</span></div>
      </div>
    </div>
  </div>

  <!-- TAB 2: CAPACITY MODELER -->
  <div id="calculatorTab" class="tab-content">
    <div class="calculator-layout">
      <!-- INPUTS FORM -->
      <div class="card">
        <h3 style="font-size: 1.05rem; margin-bottom: 16px;">Architecture & Traffic Inputs</h3>
        
        <div class="form-group">
          <label for="inpDau">Daily Active Users (DAU):</label>
          <input type="number" id="inpDau" value="1000" min="1" step="100" />
        </div>

        <div class="form-group">
          <label for="inpReadsPerSession">Reads per User Session: <span class="label-hint">(views, feeds)</span></label>
          <input type="number" id="inpReadsPerSession" value="25" min="0" step="1" />
        </div>

        <div class="form-group">
          <label for="inpWritesPerSession">Writes per User Session: <span class="label-hint">(mutations, logs)</span></label>
          <input type="number" id="inpWritesPerSession" value="5" min="0" step="1" />
        </div>

        <div class="form-group">
          <label for="inpDeletesPerSession">Deletes per User Session: <span class="label-hint">(cleanups)</span></label>
          <input type="number" id="inpDeletesPerSession" value="1" min="0" step="1" />
        </div>

        <div class="form-group">
          <label for="inpDocSize">Avg Document Size (Bytes): <span class="label-hint">(1 KB = 1024)</span></label>
          <input type="number" id="inpDocSize" value="1024" min="100" step="256" />
        </div>

        <div class="form-group">
          <label for="inpRetention">Data Retention (Days): <span class="label-hint">(TTL / storage window)</span></label>
          <input type="number" id="inpRetention" value="90" min="1" step="30" />
        </div>

        <div class="checkbox-row">
          <input type="checkbox" id="inpCaching" checked />
          <label for="inpCaching" style="margin-bottom:0; cursor:pointer;">Simulate In-Memory / Client Caching</label>
        </div>

        <div class="form-group" id="cacheGroup" style="margin-top: 10px;">
          <label for="inpCacheHitRate">Cache Hit Rate (%): <span class="label-hint">(avoided server reads)</span></label>
          <input type="number" id="inpCacheHitRate" value="65" min="0" max="99" step="5" />
        </div>
      </div>

      <!-- RESULTS PANEL -->
      <div class="results-panel">
        <div class="results-title">
          <span>Projected Cloud Cost Breakdown</span>
          <span style="font-size:0.8rem; color:var(--muted); font-weight:normal;">Calculated against standard Blaze tier</span>
        </div>

        <table class="results-table">
          <thead>
            <tr>
              <th>Operation / Resource</th>
              <th class="numeric">Daily Volume</th>
              <th class="numeric">Billable Units</th>
              <th class="numeric">Monthly Cost</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Document Reads ($0.06 / 100k)</td>
              <td class="numeric" id="resReadsDaily">0</td>
              <td class="numeric" id="resReadsBillable">0</td>
              <td class="numeric" id="resReadsCost">$0.00</td>
            </tr>
            <tr>
              <td>Document Writes ($0.18 / 100k)</td>
              <td class="numeric" id="resWritesDaily">0</td>
              <td class="numeric" id="resWritesBillable">0</td>
              <td class="numeric" id="resWritesCost">$0.00</td>
            </tr>
            <tr>
              <td>Document Deletes ($0.02 / 100k)</td>
              <td class="numeric" id="resDeletesDaily">0</td>
              <td class="numeric" id="resDeletesBillable">0</td>
              <td class="numeric" id="resDeletesCost">$0.00</td>
            </tr>
            <tr>
              <td>Retained Data Storage ($0.18 / GiB)</td>
              <td class="numeric" id="resStorageGiB">0.00 GiB</td>
              <td class="numeric" id="resStorageBillable">0.00 GiB</td>
              <td class="numeric" id="resStorageCost">$0.00</td>
            </tr>
            <tr style="border-top: 2px solid var(--card-border);">
              <td class="total-highlight">Total Estimated Monthly Cost</td>
              <td colspan="2"></td>
              <td class="numeric total-highlight" id="resMonthlyTotal">$0.00</td>
            </tr>
          </tbody>
        </table>

        <div id="savingsContainer" style="display:none;">
          <div class="savings-badge" id="savingsBadgeText">
            🎉 Client Caching saves ~$0.00 / month on document reads!
          </div>
        </div>

        <div style="margin-top: 20px; font-size: 0.82rem; color: var(--muted); line-height: 1.4;">
          * Projections subtract the daily Spark free allowance (50k reads, 20k writes, 20k deletes, 1 GiB storage). Exact monthly costs may vary with network egress and multi-region replication.
        </div>
      </div>
    </div>
  </div>

  <!-- TAB 3: PRICING MATRIX -->
  <div id="pricingTab" class="tab-content">
    <div class="rates-legend">
      <h4>Google Cloud Firestore Free Quota (Spark Tier)</h4>
      <div class="rates-grid" style="margin-bottom: 20px;">
        <div><strong>Daily Reads:</strong> 50,000 / day</div>
        <div><strong>Daily Writes:</strong> 20,000 / day</div>
        <div><strong>Daily Deletes:</strong> 20,000 / day</div>
        <div><strong>Stored Database:</strong> 1 GiB total</div>
        <div><strong>Network Egress:</strong> 10 GiB / month</div>
      </div>

      <h4>Google Cloud Firestore Pay-As-You-Go Rates (Blaze Tier)</h4>
      <div class="rates-grid">
        <div><strong>Document Reads:</strong> $0.06 per 100,000</div>
        <div><strong>Document Writes:</strong> $0.18 per 100,000</div>
        <div><strong>Document Deletes:</strong> $0.02 per 100,000</div>
        <div><strong>Stored Data:</strong> $0.18 per GiB / month</div>
        <div><strong>Network Egress:</strong> $0.12 per GiB</div>
      </div>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    let usageData = ${JSON.stringify(data.usageSnapshot)};
    const SPARK_FREE_QUOTA = ${JSON.stringify(SPARK_FREE_QUOTA)};
    const BLAZE_PRICING = ${JSON.stringify(BLAZE_PRICING)};

    function updateMeters() {
      const reads = usageData.reads || 0;
      const writes = usageData.writes || 0;
      const deletes = usageData.deletes || 0;

      const readsPct = Math.min(100, Math.round((reads / SPARK_FREE_QUOTA.readsPerDay) * 100));
      const writesPct = Math.min(100, Math.round((writes / SPARK_FREE_QUOTA.writesPerDay) * 100));
      const deletesPct = Math.min(100, Math.round((deletes / SPARK_FREE_QUOTA.deletesPerDay) * 100));

      const getFillClass = (pct) => pct >= 90 ? 'fill-red' : pct >= 70 ? 'fill-yellow' : 'fill-green';

      // Reads
      document.getElementById('meterReadsVal').textContent = reads.toLocaleString();
      const readsBar = document.getElementById('meterReadsBar');
      readsBar.style.width = readsPct + '%';
      readsBar.className = 'progress-bar-fill ' + getFillClass(readsPct);
      document.getElementById('meterReadsSub').textContent = readsPct + '% of free daily allowance used';

      // Writes
      document.getElementById('meterWritesVal').textContent = writes.toLocaleString();
      const writesBar = document.getElementById('meterWritesBar');
      writesBar.style.width = writesPct + '%';
      writesBar.className = 'progress-bar-fill ' + getFillClass(writesPct);
      document.getElementById('meterWritesSub').textContent = writesPct + '% of free daily allowance used';

      // Deletes
      document.getElementById('meterDeletesVal').textContent = deletes.toLocaleString();
      const deletesBar = document.getElementById('meterDeletesBar');
      deletesBar.style.width = deletesPct + '%';
      deletesBar.className = 'progress-bar-fill ' + getFillClass(deletesPct);
      document.getElementById('meterDeletesSub').textContent = deletesPct + '% of free daily allowance used';

      // Calculate billable overage
      const billableReads = Math.max(0, reads - SPARK_FREE_QUOTA.readsPerDay);
      const billableWrites = Math.max(0, writes - SPARK_FREE_QUOTA.writesPerDay);
      const billableDeletes = Math.max(0, deletes - SPARK_FREE_QUOTA.deletesPerDay);

      const overageCost = (billableReads / 100000) * BLAZE_PRICING.readsPer100k +
                          (billableWrites / 100000) * BLAZE_PRICING.writesPer100k +
                          (billableDeletes / 100000) * BLAZE_PRICING.deletesPer100k;

      document.getElementById('meterCostVal').textContent = '$' + overageCost.toFixed(2);
      if (overageCost > 0) {
        document.getElementById('meterCostSub').textContent = '⚠️ Billable overage charges incurred today';
        document.getElementById('quotaInsightText').textContent = '⚠️ You have exceeded free tier limits in some operations today. Consider caching frequently read documents or pruning unneeded writes.';
      } else {
        document.getElementById('meterCostSub').textContent = '$0.00 across all operations within free quota';
        document.getElementById('quotaInsightText').textContent = 'All operations are currently running comfortably within Google Cloud Firestore Spark Free Allowance. No billable overage charges incurred today.';
      }
    }

    function runCapacityCalculation() {
      const dau = Math.max(1, parseInt(document.getElementById('inpDau').value) || 1000);
      const readsPerSession = Math.max(0, parseInt(document.getElementById('inpReadsPerSession').value) || 0);
      const writesPerSession = Math.max(0, parseInt(document.getElementById('inpWritesPerSession').value) || 0);
      const deletesPerSession = Math.max(0, parseInt(document.getElementById('inpDeletesPerSession').value) || 0);
      const docSize = Math.max(10, parseInt(document.getElementById('inpDocSize').value) || 1024);
      const retentionDays = Math.max(1, parseInt(document.getElementById('inpRetention').value) || 30);
      const enableCaching = document.getElementById('inpCaching').checked;
      const cacheHitRate = Math.max(0, Math.min(99, parseInt(document.getElementById('inpCacheHitRate').value) || 0));

      const cacheMultiplier = enableCaching ? (1 - cacheHitRate / 100) : 1;
      const effectiveReads = Math.round(dau * readsPerSession * cacheMultiplier);
      const totalWrites = Math.round(dau * writesPerSession);
      const totalDeletes = Math.round(dau * deletesPerSession);

      const billableReadsDaily = Math.max(0, effectiveReads - SPARK_FREE_QUOTA.readsPerDay);
      const billableWritesDaily = Math.max(0, totalWrites - SPARK_FREE_QUOTA.writesPerDay);
      const billableDeletesDaily = Math.max(0, totalDeletes - SPARK_FREE_QUOTA.deletesPerDay);

      const monthlyReadsCost = ((billableReadsDaily * 30.416) / 100000) * BLAZE_PRICING.readsPer100k;
      const monthlyWritesCost = ((billableWritesDaily * 30.416) / 100000) * BLAZE_PRICING.writesPer100k;
      const monthlyDeletesCost = ((billableDeletesDaily * 30.416) / 100000) * BLAZE_PRICING.deletesPer100k;

      // Storage
      const netDailyDocs = Math.max(0, totalWrites - totalDeletes);
      const totalRetainedDocs = netDailyDocs * retentionDays;
      const storageBytes = totalRetainedDocs * docSize;
      const storageGiB = storageBytes / (1024 * 1024 * 1024);
      const billableStorageGiB = Math.max(0, storageGiB - SPARK_FREE_QUOTA.storageGiB);
      const monthlyStorageCost = billableStorageGiB * BLAZE_PRICING.storagePerGiBMonth;

      const monthlyTotal = monthlyReadsCost + monthlyWritesCost + monthlyDeletesCost + monthlyStorageCost;

      // Uncached comparison
      const uncachedReads = dau * readsPerSession;
      const uncachedBillableReads = Math.max(0, uncachedReads - SPARK_FREE_QUOTA.readsPerDay);
      const uncachedMonthlyReadsCost = ((uncachedBillableReads * 30.416) / 100000) * BLAZE_PRICING.readsPer100k;
      const savings = Math.max(0, uncachedMonthlyReadsCost - monthlyReadsCost);

      // Render
      document.getElementById('resReadsDaily').textContent = effectiveReads.toLocaleString();
      document.getElementById('resReadsBillable').textContent = billableReadsDaily.toLocaleString();
      document.getElementById('resReadsCost').textContent = '$' + monthlyReadsCost.toFixed(2);

      document.getElementById('resWritesDaily').textContent = totalWrites.toLocaleString();
      document.getElementById('resWritesBillable').textContent = billableWritesDaily.toLocaleString();
      document.getElementById('resWritesCost').textContent = '$' + monthlyWritesCost.toFixed(2);

      document.getElementById('resDeletesDaily').textContent = totalDeletes.toLocaleString();
      document.getElementById('resDeletesBillable').textContent = billableDeletesDaily.toLocaleString();
      document.getElementById('resDeletesCost').textContent = '$' + monthlyDeletesCost.toFixed(2);

      document.getElementById('resStorageGiB').textContent = storageGiB.toFixed(2) + ' GiB';
      document.getElementById('resStorageBillable').textContent = billableStorageGiB.toFixed(2) + ' GiB';
      document.getElementById('resStorageCost').textContent = '$' + monthlyStorageCost.toFixed(2);

      document.getElementById('resMonthlyTotal').textContent = '$' + monthlyTotal.toFixed(2) + ' / mo';

      const savingsContainer = document.getElementById('savingsContainer');
      if (enableCaching && savings > 0.05) {
        savingsContainer.style.display = 'block';
        document.getElementById('savingsBadgeText').textContent = '🎉 Client Caching saves ~$' + savings.toFixed(2) + ' / month on Firestore reads!';
      } else {
        savingsContainer.style.display = 'none';
      }
    }

    // Tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(btn.getAttribute('data-tab')).classList.add('active');
      };
    });

    // Inputs listeners
    ['inpDau', 'inpReadsPerSession', 'inpWritesPerSession', 'inpDeletesPerSession', 'inpDocSize', 'inpRetention', 'inpCacheHitRate'].forEach(id => {
      document.getElementById(id).addEventListener('input', runCapacityCalculation);
    });

    document.getElementById('inpCaching').addEventListener('change', (e) => {
      document.getElementById('cacheGroup').style.display = e.target.checked ? 'block' : 'none';
      runCapacityCalculation();
    });

    // Scenario gathering helper for exports
    function getScenarioPayload() {
      return {
        inputs: {
          dau: parseInt(document.getElementById('inpDau').value) || 1000,
          readsPerSession: parseInt(document.getElementById('inpReadsPerSession').value) || 0,
          writesPerSession: parseInt(document.getElementById('inpWritesPerSession').value) || 0,
          deletesPerSession: parseInt(document.getElementById('inpDeletesPerSession').value) || 0,
          docSize: parseInt(document.getElementById('inpDocSize').value) || 1024,
          retentionDays: parseInt(document.getElementById('inpRetention').value) || 30,
          enableCaching: document.getElementById('inpCaching').checked,
          cacheHitRate: parseInt(document.getElementById('inpCacheHitRate').value) || 0,
        },
        results: {
          readsCost: document.getElementById('resReadsCost').textContent,
          writesCost: document.getElementById('resWritesCost').textContent,
          deletesCost: document.getElementById('resDeletesCost').textContent,
          storageGiB: document.getElementById('resStorageGiB').textContent,
          storageCost: document.getElementById('resStorageCost').textContent,
          monthlyTotal: document.getElementById('resMonthlyTotal').textContent,
          savings: document.getElementById('savingsContainer').style.display !== 'none' 
            ? document.getElementById('savingsBadgeText').textContent 
            : null,
        }
      };
    }

    // Historical Trend Data & SVG Renderer
    let historyData = ${JSON.stringify(data.historicalUsage || { days: 7, points: [], source: "simulated" })};

    function renderHistoricalChart() {
      const svg = document.getElementById('trendSvg');
      if (!svg) return;

      const points = historyData.points || [];
      if (points.length === 0) {
        svg.innerHTML = '<text x="400" y="110" text-anchor="middle" fill="#888" font-size="14">No historical metrics available</text>';
        return;
      }

      // Compute statistics
      let totalReads = 0;
      let totalWrites = 0;
      let totalDeletes = 0;
      let maxReads = 1;

      points.forEach(pt => {
        totalReads += pt.reads;
        totalWrites += pt.writes;
        totalDeletes += pt.deletes;
        if (pt.reads > maxReads) maxReads = pt.reads;
      });

      document.getElementById('histTotalReads').textContent = totalReads.toLocaleString();
      document.getElementById('histTotalWrites').textContent = totalWrites.toLocaleString();
      document.getElementById('histTotalDeletes').textContent = totalDeletes.toLocaleString();
      document.getElementById('histPeakReads').textContent = maxReads.toLocaleString();

      const width = 800;
      const height = 220;
      const padLeft = 60;
      const padRight = 30;
      const padTop = 25;
      const padBottom = 35;
      const chartW = width - padLeft - padRight;
      const chartH = height - padTop - padBottom;

      const yMax = Math.ceil(maxReads * 1.15);

      // Y-axis grid lines and labels
      let elements = [];
      const yTicks = 4;
      for (let i = 0; i <= yTicks; i++) {
        const val = Math.round((yMax / yTicks) * i);
        const y = padTop + chartH - (i / yTicks) * chartH;
        const valLabel = val >= 1000 ? (val/1000).toFixed(1) + 'k' : val;
        elements.push('<line x1="' + padLeft + '" y1="' + y + '" x2="' + (width - padRight) + '" y2="' + y + '" stroke="rgba(128,128,128,0.2)" stroke-dasharray="3,3" />');
        elements.push('<text x="' + (padLeft - 10) + '" y="' + (y + 4) + '" text-anchor="end" fill="#888" font-size="10">' + valLabel + '</text>');
      }

      // Spark free quota reference line if within bounds
      if (SPARK_FREE_QUOTA.readsPerDay <= yMax) {
        const freeY = padTop + chartH - (SPARK_FREE_QUOTA.readsPerDay / yMax) * chartH;
        elements.push('<line x1="' + padLeft + '" y1="' + freeY + '" x2="' + (width - padRight) + '" y2="' + freeY + '" stroke="#cca700" stroke-width="1.5" stroke-dasharray="4,4" />');
        elements.push('<text x="' + (width - padRight) + '" y="' + (freeY - 6) + '" text-anchor="end" fill="#cca700" font-size="10">Spark Free Quota (50k)</text>');
      }

      const numPoints = points.length;
      const xStep = numPoints > 1 ? chartW / (numPoints - 1) : chartW;

      const makePath = (key, color, strokeWidth = 2) => {
        let coords = points.map((p, i) => {
          const x = padLeft + i * xStep;
          const val = p[key] || 0;
          const y = padTop + chartH - (val / yMax) * chartH;
          return { x, y, val, date: p.date };
        });

        const d = coords.map((c, i) => (i === 0 ? 'M ' + c.x + ' ' + c.y : 'L ' + c.x + ' ' + c.y)).join(' ');
        elements.push('<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="' + strokeWidth + '" />');

        // Dots and hover tooltips
        coords.forEach(c => {
          elements.push('<circle cx="' + c.x + '" cy="' + c.y + '" r="3.5" fill="' + color + '" stroke="#1e1e1e" stroke-width="1.5"><title>' + c.date + ': ' + c.val.toLocaleString() + ' ' + key + '</title></circle>');
        });
      };

      // Draw series: Deletes (red), Writes (teal), Reads (blue)
      makePath('deletes', '#f14c4c', 1.5);
      makePath('writes', '#4ec9b0', 2);
      makePath('reads', '#3794ff', 2.5);

      // X-axis labels
      points.forEach((p, i) => {
        // Sample labels so they don't crowd (e.g. at most 7 labels)
        const skip = numPoints > 14 ? 4 : numPoints > 7 ? 2 : 1;
        if (i % skip === 0 || i === numPoints - 1) {
          const x = padLeft + i * xStep;
          const label = p.date.slice(5); // MM-DD
          elements.push('<text x="' + x + '" y="' + (height - 10) + '" text-anchor="middle" fill="#888" font-size="10">' + label + '</text>');
        }
      });

      svg.innerHTML = elements.join('');
    }

    // Time selector buttons
    document.querySelectorAll('.time-btn').forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll('.time-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const days = parseInt(btn.getAttribute('data-days')) || 7;
        vscode.postMessage({ command: 'fetchHistory', days });
      };
    });

    // Toolbar buttons
    document.getElementById('refreshBtn').onclick = () => {
      const activeTimeBtn = document.querySelector('.time-btn.active');
      const days = activeTimeBtn ? parseInt(activeTimeBtn.getAttribute('data-days')) : 7;
      vscode.postMessage({ command: 'refresh', days });
    };

    const bannerRetryBtn = document.getElementById('bannerRetryBtn');
    if (bannerRetryBtn) {
      bannerRetryBtn.onclick = () => {
        const activeTimeBtn = document.querySelector('.time-btn.active');
        const days = activeTimeBtn ? parseInt(activeTimeBtn.getAttribute('data-days')) : 7;
        vscode.postMessage({ command: 'refresh', days });
      };
    }

    document.getElementById('resetSessionBtn').onclick = () => {
      vscode.postMessage({ command: 'resetSession' });
    };

    document.getElementById('exportMdBtn').onclick = () => {
      vscode.postMessage({ command: 'exportMarkdown', scenario: getScenarioPayload() });
    };

    document.getElementById('exportJsonBtn').onclick = () => {
      vscode.postMessage({ command: 'exportJson', scenario: getScenarioPayload() });
    };

    // Messages from extension
    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'usageUpdate') {
        usageData = msg.usageSnapshot;
        const isLive = usageData.source === 'cloud-monitoring';
        const sourceBadge = document.getElementById('sourceBadge');
        if (sourceBadge) {
          sourceBadge.textContent = isLive ? '🟢 Live Cloud Monitoring' : '🟡 Active Session Accounting';
          sourceBadge.className = 'badge-source ' + (isLive ? 'badge-live' : 'badge-session');
        }

        const banner = document.getElementById('monitoringNoticeBanner');
        const errorText = document.getElementById('monitoringErrorText');
        if (banner) {
          if (!isLive && !${data.isEmulator} && !${data.isLocalJson}) {
            banner.classList.add('visible');
            if (errorText) {
              errorText.textContent = usageData.monitoringError ? ('Reason: ' + usageData.monitoringError) : 'Could not reach Google Cloud Monitoring API';
            }
          } else {
            banner.classList.remove('visible');
          }
        }

        updateMeters();
      }

      if (msg.type === 'historicalUpdate') {
        historyData = msg.historicalUsage;
        const isLive = historyData.source === 'cloud-monitoring';
        const histBadge = document.getElementById('historySourceBadge');
        if (histBadge) {
          histBadge.textContent = isLive ? '🟢 Cloud Monitoring Metrics' : '🟡 Simulated Historical Baseline';
          histBadge.className = 'badge-source ' + (isLive ? 'badge-live' : 'badge-session');
        }
        renderHistoricalChart();
      }
    });

    // Init
    updateMeters();
    renderHistoricalChart();
    runCapacityCalculation();
  </script>
</body>
</html>`;
}

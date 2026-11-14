import { DatabaseMetadata } from "./types";

function escapeHtmlConfig(val: any): string {
  if (val === null || val === undefined) return "";
  return String(val)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function getDatabaseConfigHtml(data: DatabaseMetadata, connectionName: string): string {
  const isPitrEnabled = data.pointInTimeRecoveryEnablement === "POINT_IN_TIME_RECOVERY_ENABLED";
  const isDeleteProtected = data.deleteProtectionState === "DELETE_PROTECTION_ENABLED";
  const isPessimistic = data.concurrencyMode === "PESSIMISTIC";
  const isAppEngineEnabled = data.appEngineIntegrationMode === "ENABLED";
  const isReadOnlyMode = data.isLocalJson || data.isEmulator;

  let earliestTimeDesc = "Not available (PITR Disabled)";
  if (data.earliestVersionTime) {
    try {
      const d = new Date(data.earliestVersionTime);
      const diffMs = Date.now() - d.getTime();
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
      const diffDays = Math.floor(diffHours / 24);
      const remHours = diffHours % 24;
      const relative = diffDays > 0 ? `${diffDays}d ${remHours}h ago` : `${diffHours}h ago`;
      earliestTimeDesc = `${d.toUTCString()} (${relative})`;
    } catch {
      earliestTimeDesc = data.earliestVersionTime;
    }
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Database Configuration: ${escapeHtmlConfig(connectionName)}</title>
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
      --muted: var(--vscode-descriptionForeground, #888888);
      --font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
      --btn-bg: var(--vscode-button-background, #0e639c);
      --btn-fg: var(--vscode-button-foreground, #ffffff);
      --btn-hover: var(--vscode-button-hoverBackground, #1177bb);
      --btn-secondary-bg: var(--vscode-button-secondaryBackground, #3a3d41);
      --btn-secondary-fg: var(--vscode-button-secondaryForeground, #ffffff);
      --btn-secondary-hover: var(--vscode-button-secondaryHoverBackground, #45494e);
      --input-bg: var(--vscode-input-background, #252526);
      --input-border: var(--vscode-input-border, #3c3c3c);
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      background-color: var(--bg);
      color: var(--fg);
      font-family: var(--font-family);
      padding: 24px;
      line-height: 1.5;
      max-width: 900px;
      margin: 0 auto;
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
      gap: 12px;
    }

    h1 {
      font-size: 20px;
      font-weight: 600;
    }

    .badge {
      font-size: 11px;
      padding: 3px 8px;
      border-radius: 12px;
      font-weight: 500;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      border: 1px solid var(--card-border);
      background: var(--card-bg);
    }

    .badge.active {
      color: var(--success);
      border-color: rgba(78, 201, 176, 0.4);
      background: rgba(78, 201, 176, 0.1);
    }

    .badge.inactive {
      color: var(--muted);
      border-color: var(--card-border);
    }

    .badge.warning {
      color: var(--warning);
      border-color: rgba(204, 167, 0, 0.4);
      background: rgba(204, 167, 0, 0.1);
    }

    .btn {
      background: var(--btn-secondary-bg);
      color: var(--btn-secondary-fg);
      border: 1px solid var(--card-border);
      padding: 6px 14px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: background 0.15s ease;
    }

    .btn:hover { background: var(--btn-secondary-hover); }

    .btn-primary {
      background: var(--btn-bg);
      color: var(--btn-fg);
      border-color: transparent;
    }
    .btn-primary:hover { background: var(--btn-hover); }

    .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    /* Cards */
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 20px;
    }

    .card-title {
      font-size: 15px;
      font-weight: 600;
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .card-desc {
      font-size: 13px;
      color: var(--muted);
      margin-bottom: 16px;
      line-height: 1.4;
    }

    .setting-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 0;
      border-top: 1px solid rgba(128, 128, 128, 0.1);
    }

    .setting-info {
      flex: 1;
      padding-right: 20px;
    }

    .setting-label {
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 2px;
    }

    .setting-sub {
      font-size: 12px;
      color: var(--muted);
    }

    /* Toggle switch */
    .switch {
      position: relative;
      display: inline-block;
      width: 44px;
      height: 22px;
    }

    .switch input {
      opacity: 0;
      width: 0;
      height: 0;
    }

    .slider {
      position: absolute;
      cursor: pointer;
      top: 0; left: 0; right: 0; bottom: 0;
      background-color: #4a4a4a;
      transition: .2s;
      border-radius: 22px;
    }

    .slider:before {
      position: absolute;
      content: "";
      height: 16px;
      width: 16px;
      left: 3px;
      bottom: 3px;
      background-color: white;
      transition: .2s;
      border-radius: 50%;
    }

    input:checked + .slider {
      background-color: #3794ff;
    }

    input:checked + .slider:before {
      transform: translateX(22px);
    }

    input:disabled + .slider {
      opacity: 0.5;
      cursor: not-allowed;
    }

    /* Grid metadata */
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
      gap: 14px;
      margin-top: 8px;
    }

    .meta-item {
      background: rgba(0, 0, 0, 0.15);
      border: 1px solid rgba(128, 128, 128, 0.1);
      border-radius: 6px;
      padding: 10px 14px;
    }

    .meta-key {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--muted);
      margin-bottom: 4px;
    }

    .meta-val {
      font-size: 13px;
      font-weight: 500;
      word-break: break-all;
    }

    /* Code block */
    .code-block {
      background: rgba(0, 0, 0, 0.25);
      border: 1px solid rgba(128, 128, 128, 0.15);
      border-radius: 6px;
      padding: 12px;
      font-family: monospace;
      font-size: 12px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
    }

    .code-content {
      overflow-x: auto;
      white-space: pre;
    }

    .notice {
      padding: 12px 16px;
      border-radius: 6px;
      background: rgba(204, 167, 0, 0.1);
      border: 1px solid rgba(204, 167, 0, 0.3);
      color: #e5c07b;
      font-size: 12px;
      margin-bottom: 20px;
      display: flex;
      align-items: center;
      gap: 10px;
    }
  </style>
</head>
<body>

  <div class="header">
    <div>
      <div class="title-row">
        <h1>${escapeHtmlConfig(connectionName)}</h1>
        <span class="badge ${isReadOnlyMode ? "warning" : "active"}">
          ${isReadOnlyMode ? (data.isLocalJson ? "Local JSON" : "Emulator") : "Cloud Firestore"}
        </span>
        <span class="badge ${isPitrEnabled ? "active" : "inactive"}">
          ${isPitrEnabled ? "PITR Active (7d)" : "PITR Disabled"}
        </span>
        ${isDeleteProtected ? '<span class="badge active">🛡️ Delete Protected</span>' : ""}
      </div>
      <div style="font-size: 12px; color: var(--muted); margin-top: 4px;">
        Database ID: <strong>${escapeHtmlConfig(data.databaseId)}</strong> | Project: <strong>${escapeHtmlConfig(data.projectId)}</strong>
        ${data.locationId ? ` | Region: <strong>${escapeHtmlConfig(data.locationId)}</strong>` : ""}
      </div>
    </div>
    <div>
      <button class="btn" id="btnRefresh">🔄 Refresh</button>
    </div>
  </div>

  ${isReadOnlyMode ? `
    <div class="notice">
      ℹ️ This is a ${data.isLocalJson ? "Local JSON Database" : "Local Emulator"} connection. Google Cloud PITR and Delete Protection policies only apply to live Google Cloud Firestore databases.
    </div>
  ` : ""}

  <!-- Section 1: Disaster Recovery & PITR -->
  <div class="card">
    <div class="card-title">
      <span>🕒 Point-in-Time Recovery (PITR) & Time Travel</span>
      ${isPitrEnabled ? '<button class="btn btn-primary" id="btnOpenTimeTravel">🕒 Open Time-Travel Explorer</button>' : ""}
    </div>
    <div class="card-desc">
      Continuously logs microsecond database changes, allowing you to query, diff, and restore documents from any point in the past 7 days.
    </div>

    <div class="setting-row">
      <div class="setting-info">
        <div class="setting-label">Enable Point-in-Time Recovery</div>
        <div class="setting-sub">Continuous changelog retention window: <strong>7 days (604,800s)</strong></div>
      </div>
      <div>
        <label class="switch">
          <input type="checkbox" id="togglePitr" ${isPitrEnabled ? "checked" : ""} ${isReadOnlyMode ? "disabled" : ""}>
          <span class="slider"></span>
        </label>
      </div>
    </div>

    <div class="setting-row">
      <div class="setting-info">
        <div class="setting-label">Earliest Recovery Point (earliestVersionTime)</div>
        <div class="setting-sub">The oldest historical snapshot timestamp available to query</div>
      </div>
      <div style="font-size: 12px; font-weight: 500; color: ${isPitrEnabled ? "var(--fg)" : "var(--muted)"}">
        ${escapeHtmlConfig(earliestTimeDesc)}
      </div>
    </div>
  </div>

  <!-- Section 2: Safety & Concurrency -->
  <div class="card">
    <div class="card-title">
      <span>🛡️ Operational Safety & Concurrency</span>
    </div>
    <div class="card-desc">
      Production safeguard controls and transaction concurrency semantics.
    </div>

    <div class="setting-row">
      <div class="setting-info">
        <div class="setting-label">Delete Protection</div>
        <div class="setting-sub">Prevents accidental deletion of the database resource via GCP Console, CLI, or API</div>
      </div>
      <div>
        <label class="switch">
          <input type="checkbox" id="toggleDeleteProtection" ${isDeleteProtected ? "checked" : ""} ${isReadOnlyMode ? "disabled" : ""}>
          <span class="slider"></span>
        </label>
      </div>
    </div>

    <div class="setting-row">
      <div class="setting-info">
        <div class="setting-label">Concurrency Control Mode</div>
        <div class="setting-sub">
          <strong>OPTIMISTIC</strong> (validates at commit, recommended for web) vs <strong>PESSIMISTIC</strong> (locks on read)
        </div>
      </div>
      <div>
        <select id="selectConcurrency" style="background: var(--input-bg); color: var(--fg); border: 1px solid var(--input-border); padding: 5px 10px; border-radius: 4px;" ${isReadOnlyMode ? "disabled" : ""}>
          <option value="OPTIMISTIC" ${!isPessimistic ? "selected" : ""}>Optimistic</option>
          <option value="PESSIMISTIC" ${isPessimistic ? "selected" : ""}>Pessimistic (Locking)</option>
        </select>
      </div>
    </div>

    <div class="setting-row">
      <div class="setting-info">
        <div class="setting-label">App Engine Integration Mode</div>
        <div class="setting-sub">Controls access through legacy App Engine default credentials</div>
      </div>
      <div>
        <label class="switch">
          <input type="checkbox" id="toggleAppEngine" ${isAppEngineEnabled ? "checked" : ""} ${isReadOnlyMode ? "disabled" : ""}>
          <span class="slider"></span>
        </label>
      </div>
    </div>
  </div>

  <!-- Section 3: Metadata -->
  <div class="card">
    <div class="card-title">
      <span>⚙️ Infrastructure & Region Details</span>
    </div>

    <div class="meta-grid">
      <div class="meta-item">
        <div class="meta-key">Database ID</div>
        <div class="meta-val">${escapeHtmlConfig(data.databaseId)}</div>
      </div>
      <div class="meta-item">
        <div class="meta-key">GCP Project</div>
        <div class="meta-val">${escapeHtmlConfig(data.projectId)}</div>
      </div>
      <div class="meta-item">
        <div class="meta-key">Location / Region</div>
        <div class="meta-val">${escapeHtmlConfig(data.locationId || "Default")}</div>
      </div>
      <div class="meta-item">
        <div class="meta-key">Database Type</div>
        <div class="meta-val">${escapeHtmlConfig(data.type || "FIRESTORE_NATIVE")}</div>
      </div>
      ${data.uid ? `
      <div class="meta-item">
        <div class="meta-key">Database UID</div>
        <div class="meta-val" style="font-size: 11px; font-family: monospace;">${escapeHtmlConfig(data.uid)}</div>
      </div>` : ""}
      ${data.createTime ? `
      <div class="meta-item">
        <div class="meta-key">Created Time</div>
        <div class="meta-val">${escapeHtmlConfig(new Date(data.createTime).toLocaleDateString())}</div>
      </div>` : ""}
      ${data.cmekConfig?.kmsKeyName ? `
      <div class="meta-item" style="grid-column: 1 / -1;">
        <div class="meta-key">Customer-Managed Encryption Key (CMEK)</div>
        <div class="meta-val" style="font-size: 11px; font-family: monospace;">${escapeHtmlConfig(data.cmekConfig.kmsKeyName)}</div>
      </div>` : ""}
    </div>
  </div>

  <!-- Section 4: CLI Alternative -->
  ${!isReadOnlyMode ? `
  <div class="card">
    <div class="card-title">
      <span>💻 Equivalent gcloud Command</span>
    </div>
    <div class="card-desc">
      If your service account lacks IAM permissions to mutate database settings directly, run this command in terminal:
    </div>
    <div class="code-block">
      <div class="code-content" id="gcloudCode">gcloud firestore databases update --database='${escapeHtmlConfig(data.databaseId)}' ${isPitrEnabled ? "--enable-pitr" : "--no-enable-pitr"} ${isDeleteProtected ? "--enable-delete-protection" : "--no-enable-delete-protection"} --project=${escapeHtmlConfig(data.projectId)}</div>
      <button class="btn" id="btnCopyGcloud">📋 Copy</button>
    </div>
  </div>
  ` : ""}

  <script>
    const vscode = acquireVsCodeApi();

    document.getElementById("btnRefresh")?.addEventListener("click", () => {
      vscode.postMessage({ command: "refresh" });
    });

    document.getElementById("btnOpenTimeTravel")?.addEventListener("click", () => {
      vscode.postMessage({ command: "openTimeTravel" });
    });

    document.getElementById("togglePitr")?.addEventListener("change", (e) => {
      vscode.postMessage({
        command: "updateSetting",
        setting: "pointInTimeRecoveryEnablement",
        value: e.target.checked ? "POINT_IN_TIME_RECOVERY_ENABLED" : "POINT_IN_TIME_RECOVERY_DISABLED"
      });
    });

    document.getElementById("toggleDeleteProtection")?.addEventListener("change", (e) => {
      vscode.postMessage({
        command: "updateSetting",
        setting: "deleteProtectionState",
        value: e.target.checked ? "DELETE_PROTECTION_ENABLED" : "DELETE_PROTECTION_DISABLED"
      });
    });

    document.getElementById("selectConcurrency")?.addEventListener("change", (e) => {
      vscode.postMessage({
        command: "updateSetting",
        setting: "concurrencyMode",
        value: e.target.value
      });
    });

    document.getElementById("toggleAppEngine")?.addEventListener("change", (e) => {
      vscode.postMessage({
        command: "updateSetting",
        setting: "appEngineIntegrationMode",
        value: e.target.checked ? "ENABLED" : "DISABLED"
      });
    });

    document.getElementById("btnCopyGcloud")?.addEventListener("click", () => {
      const text = document.getElementById("gcloudCode")?.innerText;
      if (text) {
        vscode.postMessage({ command: "copyText", text });
      }
    });
  </script>
</body>
</html>`;
}


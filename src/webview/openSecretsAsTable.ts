import * as vscode from "vscode";
import { SecretManagerService, SecretMetadata } from "../secrets/SecretManagerService";
import { ConnectionManager } from "../connections/ConnectionManager";
import ExplorerDataProvider from "../explorer/ExplorerDataProvider";
import { getSharedTableStyles } from "./common/tableStyles";
import { copyWithSecurityWipe } from "../secrets/secretCommands";

const activeSecretsPanels = new Map<string, vscode.WebviewPanel>();

/**
 * Opens a webview table displaying all secrets in Google Cloud Secret Manager
 * for the given connection, with search, create, inspect, copy, add version, and delete actions.
 */
export async function openSecretsAsTable(
  connectionId: string,
  explorerDataProvider?: ExplorerDataProvider
): Promise<void> {
  const existingPanel = activeSecretsPanels.get(connectionId);
  if (existingPanel) {
    existingPanel.reveal(vscode.ViewColumn.One);
    return;
  }

  const connMgr = ConnectionManager.getInstance();
  const conn = connMgr.getConnection(connectionId);
  const connLabel = conn?.name || connectionId;
  let lastReadOnly = connMgr.isReadOnly(connectionId);

  const retainContextWhenHidden = vscode.workspace
    .getConfiguration("ketrik-firestore-studio")
    .get<boolean>("retainWebviewTabs", true);

  const panel = vscode.window.createWebviewPanel(
    "ketrikSecretsTable",
    `Secrets: ${connLabel}`,
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden,
    }
  );
  activeSecretsPanels.set(connectionId, panel);

  let secrets: SecretMetadata[] = [];
  let nextPageToken: string | undefined;
  let hasRenderedTable = false;
  let isDisposed = false;
  const PAGE_SIZE = 100;

  const mapRows = (items: SecretMetadata[], lockedSet: Set<string>) =>
    items.map((s) => ({
      id: s.id,
      name: s.name,
      replication: s.replicationType || "automatic",
      locations: s.locations || [],
      labels: s.labels || {},
      createTime: s.createTime || "",
      locked: lockedSet.has(s.id),
    }));

  const postStateUpdate = () => {
    lastReadOnly = connMgr.isReadOnly(connectionId);
    const lockedSet = SecretManagerService.getInstance().getLockedSecrets(connectionId);
    if (!hasRenderedTable) {
      hasRenderedTable = true;
      panel.webview.html = getSecretsTableHtml(connLabel, secrets, lastReadOnly, Boolean(nextPageToken), lockedSet);
      return;
    }
    panel.webview.postMessage({
      command: "updateState",
      secrets: mapRows(secrets, lockedSet),
      isReadOnly: lastReadOnly,
      hasMore: Boolean(nextPageToken),
    });
  };

  const loadAndRender = async () => {
    try {
      const svc = SecretManagerService.getInstance();
      const result = await svc.listSecrets(connectionId, PAGE_SIZE);
      if (isDisposed) {
        return;
      }
      secrets = result.secrets;
      nextPageToken = result.nextPageToken;
      postStateUpdate();
    } catch (err: any) {
      if (isDisposed) {
        return;
      }
      hasRenderedTable = false;
      panel.webview.html = getErrorHtml(connLabel, err?.message || String(err));
    }
  };

  const connSub = connMgr.onDidChangeConnections(() => {
    if (hasRenderedTable && connMgr.isReadOnly(connectionId) !== lastReadOnly) {
      postStateUpdate();
    }
  });

  const viewStateSub = panel.onDidChangeViewState(() => {
    if (panel.visible && hasRenderedTable && connMgr.isReadOnly(connectionId) !== lastReadOnly) {
      postStateUpdate();
    }
  });

  const messageSub = panel.webview.onDidReceiveMessage(async (msg) => {
    const svc = SecretManagerService.getInstance();
    switch (msg.command) {
      case "refresh": {
        await loadAndRender();
        break;
      }
      case "loadMore": {
        if (!nextPageToken) {
          return;
        }
        try {
          const result = await svc.listSecrets(connectionId, PAGE_SIZE, nextPageToken);
          secrets = [...secrets, ...result.secrets];
          nextPageToken = result.nextPageToken;
          postStateUpdate();
        } catch (err: any) {
          vscode.window.showErrorMessage(`Failed to load more secrets: ${err.message}`);
          postStateUpdate();
        }
        break;
      }
      case "createSecret": {
        if (!connMgr.ensureWritable(connectionId, "create secret")) {
          return;
        }
        const secretId = await vscode.window.showInputBox({
          prompt: "Enter new Secret ID (e.g., stripe-api-key)",
          validateInput: (v) =>
            /^[a-zA-Z0-9_-]+$/.test(v)
              ? null
              : "Secret ID must contain only letters, numbers, hyphens, or underscores.",
        });
        if (!secretId) {
          return;
        }
        const payload = await vscode.window.showInputBox({
          prompt: `Enter initial secret value for '${secretId}' (optional, press Enter for empty or Esc to cancel)`,
          password: true,
        });
        if (payload === undefined) {
          return;
        }
        try {
          await svc.createSecret(connectionId, secretId, payload || undefined);
          vscode.window.showInformationMessage(`Secret '${secretId}' created.`);
          explorerDataProvider?.refreshSecrets(connectionId);
          await loadAndRender();
        } catch (err: any) {
          vscode.window.showErrorMessage(`Failed to create secret: ${err.message}`);
        }
        break;
      }
      case "inspectPayload": {
        const secretId = msg.secretId as string;
        try {
          const payload = await svc.accessSecretPayload(connectionId, secretId, "latest");
          let isJson = false;
          let content = payload;
          try {
            const parsed = JSON.parse(payload);
            content = JSON.stringify(parsed, null, 2);
            isJson = true;
          } catch {}
          panel.webview.postMessage({
            command: "showPayloadModal",
            secretId,
            content,
            isJson,
          });
        } catch (err: any) {
          vscode.window.showErrorMessage(`Failed to inspect secret '${secretId}': ${err.message}`);
        }
        break;
      }
      case "copyPayload": {
        const secretId = msg.secretId as string;
        try {
          const payload = await svc.accessSecretPayload(connectionId, secretId, "latest");
          await copyWithSecurityWipe(payload, `Secret '${secretId}'`);
        } catch (err: any) {
          vscode.window.showErrorMessage(`Failed to copy payload: ${err.message}`);
        }
        break;
      }
      case "copyModalValue": {
        const secretId = (msg.secretId as string) || "Secret";
        const content = (msg.content as string) || "";
        await copyWithSecurityWipe(content, `Secret '${secretId}'`);
        break;
      }
      case "copyResourceName": {
        const resourceName = msg.resourceName as string;
        await vscode.env.clipboard.writeText(resourceName);
        vscode.window.showInformationMessage(`Copied resource name: ${resourceName}`);
        break;
      }
      case "addVersion": {
        if (!connMgr.ensureWritable(connectionId, "add secret version")) {
          return;
        }
        const secretId = msg.secretId as string;
        const payload = await vscode.window.showInputBox({
          prompt: `Enter new secret version payload for '${secretId}'`,
          password: true,
        });
        if (payload === undefined) {
          return;
        }
        try {
          await svc.addSecretVersion(connectionId, secretId, payload);
          vscode.window.showInformationMessage(`Added new version to '${secretId}'.`);
          explorerDataProvider?.refreshSecrets(connectionId);
          await loadAndRender();
        } catch (err: any) {
          vscode.window.showErrorMessage(`Failed to add secret version: ${err.message}`);
        }
        break;
      }
      case "deleteSecret": {
        if (!connMgr.ensureWritable(connectionId, "delete secret")) {
          return;
        }
        const secretId = msg.secretId as string;
        if (svc.isSecretLocked(connectionId, secretId)) {
          vscode.window.showWarningMessage(`Secret '${secretId}' is locked against deletion.`);
          return;
        }
        const confirm = await vscode.window.showWarningMessage(
          `Are you sure you want to PERMANENTLY DELETE secret '${secretId}' and ALL of its versions? This action cannot be undone.`,
          { modal: true },
          "Delete Secret"
        );
        if (confirm !== "Delete Secret") {
          return;
        }
        try {
          panel.webview.postMessage({
            command: "deleteProgress",
            active: true,
            current: 1,
            total: 1,
            secretId,
          });
          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: `Deleting secret '${secretId}'...`,
            },
            async () => {
              await svc.deleteSecret(connectionId, secretId);
            }
          );
          secrets = secrets.filter((s) => s.id !== secretId);
          postStateUpdate();
          vscode.window.showInformationMessage(`Secret '${secretId}' deleted.`);
          explorerDataProvider?.refreshSecrets(connectionId);
        } catch (err: any) {
          vscode.window.showErrorMessage(`Failed to delete secret: ${err.message}`);
        } finally {
          panel.webview.postMessage({ command: "deleteProgress", active: false });
        }
        break;
      }
      case "toggleLock": {
        const secretId = msg.secretId as string;
        const nowLocked = await svc.toggleSecretLock(connectionId, secretId);
        postStateUpdate();
        explorerDataProvider?.refreshSecrets(connectionId);
        vscode.window.setStatusBarMessage(
          nowLocked ? `🔒 Locked '${secretId}' against deletion` : `🔓 Unlocked '${secretId}'`,
          3000
        );
        break;
      }
      case "deleteSelectedSecrets": {
        if (!connMgr.ensureWritable(connectionId, "delete secrets")) {
          return;
        }
        const ids = (msg.secretIds as string[]).filter((id) => !svc.isSecretLocked(connectionId, id));
        if (ids.length === 0) {
          vscode.window.showWarningMessage("No unlocked secrets selected.");
          return;
        }
        const confirm = await vscode.window.showWarningMessage(
          `Are you sure you want to PERMANENTLY DELETE ${ids.length} selected secret(s) and ALL of their versions? This action cannot be undone.`,
          { modal: true },
          "Delete Selected"
        );
        if (confirm !== "Delete Selected") {
          return;
        }
        const deletedIds = new Set<string>();
        try {
          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: `Deleting ${ids.length} secret(s)...`,
            },
            async (progress) => {
              for (let i = 0; i < ids.length; i++) {
                const id = ids[i];
                progress.report({
                  message: `(${i + 1}/${ids.length}) ${id}`,
                  increment: 100 / ids.length,
                });
                panel.webview.postMessage({
                  command: "deleteProgress",
                  active: true,
                  current: i + 1,
                  total: ids.length,
                  secretId: id,
                });
                try {
                  await svc.deleteSecret(connectionId, id);
                  deletedIds.add(id);
                } catch (err: any) {
                  vscode.window.showErrorMessage(`Failed to delete '${id}': ${err.message}`);
                }
              }
            }
          );
        } finally {
          panel.webview.postMessage({ command: "deleteProgress", active: false });
        }
        if (deletedIds.size > 0) {
          secrets = secrets.filter((s) => !deletedIds.has(s.id));
          postStateUpdate();
        }
        vscode.window.showInformationMessage(`Deleted ${deletedIds.size} of ${ids.length} secret(s).`);
        explorerDataProvider?.refreshSecrets(connectionId);
        break;
      }
    }
  });

  panel.onDidDispose(() => {
    isDisposed = true;
    activeSecretsPanels.delete(connectionId);
    messageSub.dispose();
    connSub.dispose();
    viewStateSub.dispose();
    secrets = [];
    nextPageToken = undefined;
  });

  panel.webview.html = getLoadingHtml(connLabel);
  await loadAndRender();
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getLoadingHtml(connLabel: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 24px; }
</style></head>
<body><p>Loading secrets for <strong>${escapeHtml(connLabel)}</strong>...</p></body>
</html>`;
}

function getErrorHtml(connLabel: string, message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-errorForeground); padding: 24px; }
</style></head>
<body>
  <h3>Failed to load secrets for ${escapeHtml(connLabel)}</h3>
  <p>${escapeHtml(message)}</p>
</body>
</html>`;
}

function getSecretsTableHtml(
  connLabel: string,
  secrets: SecretMetadata[],
  isReadOnly: boolean,
  hasMore: boolean = false,
  lockedSet: Set<string> = new Set()
): string {
  const rowsJson = JSON.stringify(
    secrets.map((s) => ({
      id: s.id,
      name: s.name,
      replication: s.replicationType || "automatic",
      locations: s.locations || [],
      labels: s.labels || {},
      createTime: s.createTime || "",
      locked: lockedSet.has(s.id),
    }))
  ).replace(/</g, "\\u003c");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Secrets: ${escapeHtml(connLabel)}</title>
  <style>
    ${getSharedTableStyles()}
    .secrets-search {
      flex: 1;
      min-width: 220px;
      max-width: 340px;
      padding: 5px 10px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, var(--vscode-widget-border, transparent));
      border-radius: 4px;
      outline: none;
    }
    .secrets-search:focus {
      border-color: var(--vscode-focusBorder);
    }
    .toolbar-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    th:first-child,
    td:first-child:not(.empty) {
      position: sticky;
      left: 0;
      width: 38px;
      min-width: 38px;
      max-width: 38px;
      text-align: center;
      padding: 9px 8px;
      z-index: 4;
      background-color: var(--vscode-editor-background);
    }
    th:first-child {
      z-index: 12;
    }
    th:nth-child(2),
    td.secret-id {
      position: sticky;
      left: 38px;
      z-index: 4;
      background-color: var(--vscode-editor-background);
      white-space: nowrap;
      max-width: none;
      overflow: visible;
      text-overflow: unset;
      border-right: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.25));
    }
    th:nth-child(2) {
      z-index: 12;
    }
    tbody tr:nth-child(even) td:first-child,
    tbody tr:nth-child(even) td.secret-id {
      background-color: var(--vscode-editor-background);
      background-image: linear-gradient(rgba(128, 128, 128, 0.035), rgba(128, 128, 128, 0.035));
    }
    tbody tr:hover td:first-child,
    tbody tr:hover td.secret-id {
      background-color: var(--vscode-editor-background) !important;
      background-image: linear-gradient(
        var(--vscode-list-hoverBackground, rgba(128, 128, 128, 0.15)),
        var(--vscode-list-hoverBackground, rgba(128, 128, 128, 0.15))
      ) !important;
    }
    .secret-id {
      font-family: var(--mono-font);
      font-weight: 600;
    }
    .label-chip {
      display: inline-block;
      padding: 1px 6px;
      margin: 1px 3px 1px 0;
      border-radius: 3px;
      font-size: 11px;
      background: var(--vscode-textCodeBlock-background);
      border: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.25));
    }
    th:last-child,
    td:last-child {
      max-width: none;
      overflow: visible;
    }
    .row-actions {
      display: flex;
      gap: 4px;
      flex-wrap: nowrap;
      white-space: nowrap;
    }
    .row-actions button {
      padding: 3px 7px;
      font-size: 11px;
    }
    button.danger {
      background: var(--vscode-inputValidation-errorBackground, #5a1d1d);
      color: var(--vscode-errorForeground, #f48771);
    }
    .progress-banner {
      display: none;
      margin-bottom: 12px;
      padding: 10px 14px;
      border-radius: 6px;
      background: var(--vscode-editorWidget-background, rgba(128, 128, 128, 0.08));
      border: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.25));
    }
    .progress-banner.active {
      display: block;
    }
    .progress-text {
      font-size: 12px;
      margin-bottom: 6px;
      font-family: var(--mono-font);
      color: var(--vscode-foreground);
    }
    .progress-track {
      width: 100%;
      height: 5px;
      border-radius: 3px;
      background: var(--vscode-scrollbarSlider-background, rgba(128, 128, 128, 0.25));
      overflow: hidden;
    }
    .progress-fill {
      height: 100%;
      width: 0%;
      background: var(--vscode-progressBar-background, #0e70c0);
      transition: width 0.2s ease;
    }
    tr.deleting-row {
      opacity: 0.55;
    }
    .modal-backdrop {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.55);
      z-index: 100;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .modal-backdrop.open {
      display: flex;
    }
    .modal {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border, rgba(128,128,128,0.4)));
      border-radius: 6px;
      width: 100%;
      max-width: 680px;
      max-height: 80vh;
      display: flex;
      flex-direction: column;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    }
    .modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      border-bottom: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.2));
      gap: 10px;
    }
    .modal-title {
      font-family: var(--mono-font);
      font-weight: 600;
      font-size: 13px;
      word-break: break-all;
    }
    .modal-body {
      padding: 16px;
      overflow: auto;
      flex: 1;
    }
    .modal-body pre {
      margin: 0;
      padding: 12px;
      border-radius: 4px;
      background: var(--vscode-textCodeBlock-background);
      font-family: var(--mono-font);
      font-size: 12px;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .modal-footer {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      padding: 10px 16px;
      border-top: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.2));
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <div class="title-area">
      <h1>🔐 <span class="collection-name">${escapeHtml(connLabel)}</span></h1>
      <span id="countBadge" class="badge">${secrets.length} secrets</span>
      <span id="readOnlyBadge" class="badge" style="${isReadOnly ? "" : "display:none;"}">READ-ONLY</span>
    </div>
    <div class="toolbar-actions">
      <input id="searchInput" class="secrets-search" type="search" placeholder="Filter by Secret ID or label..." />
      <button id="deleteSelectedBtn" class="danger" disabled>Delete Selected (0)</button>
      <button id="loadMoreBtn" class="secondary" style="${hasMore ? "" : "display:none;"}">Load More (+100)</button>
      <button id="createBtn" ${isReadOnly ? "disabled" : ""}>+ Create Secret</button>
      <button id="refreshBtn" class="secondary">↻ Refresh</button>
    </div>
  </div>

  <div id="progressBanner" class="progress-banner" role="status" aria-live="polite">
    <div id="progressText" class="progress-text">Deleting...</div>
    <div class="progress-track">
      <div id="progressBarFill" class="progress-fill"></div>
    </div>
  </div>

  <div class="table-container">
  <table>
    <thead>
      <tr>
        <th><input id="selectAllCb" type="checkbox" title="Select all unlocked" ${isReadOnly ? "disabled" : ""} /></th>
        <th>Secret ID</th>
        <th>Replication</th>
        <th>Labels</th>
        <th>Created</th>
        <th>Actions</th>
      </tr>
    </thead>
    <tbody id="tableBody"></tbody>
  </table>
  </div>

  <div id="payloadModal" class="modal-backdrop">
    <div class="modal" role="dialog" aria-modal="true">
      <div class="modal-header">
        <div>
          <span id="modalSecretId" class="modal-title"></span>
          <span id="modalFormatBadge" class="badge" style="margin-left: 8px;"></span>
        </div>
        <button id="modalCloseX" class="secondary" title="Close">✕</button>
      </div>
      <div class="modal-body">
        <pre id="modalContent"></pre>
      </div>
      <div class="modal-footer">
        <button id="modalCopyBtn">Copy Value</button>
        <button id="modalCloseBtn" class="secondary">Close</button>
      </div>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    let allSecrets = ${rowsJson};
    let isReadOnly = ${isReadOnly ? "true" : "false"};
    let hasMore = ${hasMore ? "true" : "false"};
    const tbody = document.getElementById("tableBody");
    const searchInput = document.getElementById("searchInput");
    const countBadge = document.getElementById("countBadge");
    const readOnlyBadge = document.getElementById("readOnlyBadge");
    const selectAllCb = document.getElementById("selectAllCb");
    const deleteSelectedBtn = document.getElementById("deleteSelectedBtn");
    const createBtn = document.getElementById("createBtn");
    const loadMoreBtn = document.getElementById("loadMoreBtn");
    const selectedIds = new Set();

    function syncToolbarControls() {
      readOnlyBadge.style.display = isReadOnly ? "" : "none";
      createBtn.disabled = isReadOnly;
      selectAllCb.disabled = isReadOnly;
      loadMoreBtn.style.display = hasMore ? "" : "none";
      loadMoreBtn.disabled = false;
      loadMoreBtn.textContent = "Load More (+100)";
      updateBulkDeleteBtn();
    }

    function updateBulkDeleteBtn() {
      const count = selectedIds.size;
      deleteSelectedBtn.textContent = \`Delete Selected (\${count})\`;
      deleteSelectedBtn.disabled = isReadOnly || count === 0;
    }

    deleteSelectedBtn.addEventListener("click", () => {
      if (!isReadOnly && selectedIds.size > 0) {
        vscode.postMessage({ command: "deleteSelectedSecrets", secretIds: Array.from(selectedIds) });
      }
    });

    selectAllCb.addEventListener("change", (e) => {
      const checked = e.target.checked;
      const checkboxes = tbody.querySelectorAll("input.row-cb:not(:disabled)");
      checkboxes.forEach((cb) => {
        cb.checked = checked;
        if (checked) selectedIds.add(cb.dataset.id);
        else selectedIds.delete(cb.dataset.id);
      });
      updateBulkDeleteBtn();
    });

    document.getElementById("refreshBtn").addEventListener("click", () => {
      vscode.postMessage({ command: "refresh" });
    });

    loadMoreBtn.addEventListener("click", () => {
      loadMoreBtn.disabled = true;
      loadMoreBtn.textContent = "Loading...";
      vscode.postMessage({ command: "loadMore" });
    });

    createBtn.addEventListener("click", () => {
      if (!isReadOnly) {
        vscode.postMessage({ command: "createSecret" });
      }
    });

    function formatTime(iso) {
      if (!iso) return "—";
      try {
        return new Date(iso).toLocaleString();
      } catch {
        return iso;
      }
    }

    function render(filterText = "") {
      const q = filterText.trim().toLowerCase();
      const filtered = q
        ? allSecrets.filter((s) => {
            if (s.id.toLowerCase().includes(q)) return true;
            return Object.entries(s.labels || {}).some(
              ([k, v]) => k.toLowerCase().includes(q) || String(v).toLowerCase().includes(q)
            );
          })
        : allSecrets;

      countBadge.textContent = q
        ? \`\${filtered.length} of \${allSecrets.length} secrets\`
        : \`\${allSecrets.length} secrets\`;

      if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty">No secrets match your filter.</td></tr>';
        return;
      }

      tbody.innerHTML = "";
      for (const s of filtered) {
        const tr = document.createElement("tr");
        tr.dataset.secretId = s.id;
        tr.dataset.locked = s.locked ? "1" : "0";
        tr.style.cursor = "pointer";
        tr.title = "Double-click to inspect latest payload";
        tr.addEventListener("dblclick", () => {
          vscode.postMessage({ command: "inspectPayload", secretId: s.id });
        });

        const tdCb = document.createElement("td");
        tdCb.style.textAlign = "center";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.className = "row-cb";
        cb.dataset.id = s.id;
        cb.disabled = s.locked || isReadOnly;
        cb.checked = !s.locked && selectedIds.has(s.id);
        cb.addEventListener("click", (e) => e.stopPropagation());
        cb.addEventListener("change", (e) => {
          if (e.target.checked) selectedIds.add(s.id);
          else selectedIds.delete(s.id);
          updateBulkDeleteBtn();
        });
        tdCb.appendChild(cb);
        tr.appendChild(tdCb);

        const tdId = document.createElement("td");
        tdId.className = "secret-id";
        tdId.textContent = s.locked ? \`🔒 \${s.id}\` : s.id;
        tr.appendChild(tdId);

        const tdRep = document.createElement("td");
        tdRep.textContent = s.locations.length > 0
          ? \`\${s.replication} (\${s.locations.join(", ")})\`
          : s.replication;
        tr.appendChild(tdRep);

        const tdLabels = document.createElement("td");
        const entries = Object.entries(s.labels || {});
        if (entries.length === 0) {
          tdLabels.textContent = "—";
        } else {
          for (const [k, v] of entries) {
            const chip = document.createElement("span");
            chip.className = "label-chip";
            chip.textContent = \`\${k}=\${v}\`;
            tdLabels.appendChild(chip);
          }
        }
        tr.appendChild(tdLabels);

        const tdCreated = document.createElement("td");
        tdCreated.textContent = formatTime(s.createTime);
        tr.appendChild(tdCreated);

        const tdActions = document.createElement("td");
        tdActions.className = "row-actions";

        const makeBtn = (label, cls, onClick, disabled = false) => {
          const btn = document.createElement("button");
          btn.textContent = label;
          if (cls) btn.className = cls;
          btn.disabled = disabled;
          btn.addEventListener("click", onClick);
          return btn;
        };

        tdActions.appendChild(
          makeBtn("Inspect", "secondary", () =>
            vscode.postMessage({ command: "inspectPayload", secretId: s.id })
          )
        );
        tdActions.appendChild(
          makeBtn("Copy Value", "secondary", () =>
            vscode.postMessage({ command: "copyPayload", secretId: s.id })
          )
        );
        tdActions.appendChild(
          makeBtn("Copy URI", "secondary", () =>
            vscode.postMessage({ command: "copyResourceName", resourceName: s.name })
          )
        );
        tdActions.appendChild(
          makeBtn("+ Version", "secondary", () =>
            vscode.postMessage({ command: "addVersion", secretId: s.id }),
            isReadOnly
          )
        );
        tdActions.appendChild(
          makeBtn(s.locked ? "🔓 Unlock" : "🔒 Lock", "secondary", () =>
            vscode.postMessage({ command: "toggleLock", secretId: s.id })
          )
        );
        tdActions.appendChild(
          makeBtn("Delete", "danger row-delete-btn", () =>
            vscode.postMessage({ command: "deleteSecret", secretId: s.id }),
            isReadOnly || s.locked
          )
        );

        tr.appendChild(tdActions);
        tbody.appendChild(tr);
      }
    }

    searchInput.addEventListener("input", (e) => render(e.target.value));
    render();

    const payloadModal = document.getElementById("payloadModal");
    const modalSecretId = document.getElementById("modalSecretId");
    const modalFormatBadge = document.getElementById("modalFormatBadge");
    const modalContent = document.getElementById("modalContent");
    const closeModal = () => payloadModal.classList.remove("open");

    document.getElementById("modalCloseX").addEventListener("click", closeModal);
    document.getElementById("modalCloseBtn").addEventListener("click", closeModal);
    payloadModal.addEventListener("click", (e) => {
      if (e.target === payloadModal) closeModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && payloadModal.classList.contains("open")) closeModal();
    });
    document.getElementById("modalCopyBtn").addEventListener("click", () => {
      vscode.postMessage({
        command: "copyModalValue",
        secretId: modalSecretId.textContent || "",
        content: modalContent.textContent || "",
      });
      const btn = document.getElementById("modalCopyBtn");
      btn.textContent = "Copied!";
      setTimeout(() => { btn.textContent = "Copy Value"; }, 1500);
    });

    const progressBanner = document.getElementById("progressBanner");
    const progressText = document.getElementById("progressText");
    const progressBarFill = document.getElementById("progressBarFill");

    function clearDeletingRows() {
      tbody.querySelectorAll("tr.deleting-row").forEach((r) => {
        r.classList.remove("deleting-row");
        const delBtn = r.querySelector("button.row-delete-btn");
        if (delBtn) {
          delBtn.textContent = "Delete";
          delBtn.disabled = isReadOnly || r.dataset.locked === "1";
        }
      });
    }

    window.addEventListener("message", (event) => {
      const msg = event.data;
      if (!msg) return;
      if (msg.command === "showPayloadModal") {
        modalSecretId.textContent = msg.secretId;
        modalFormatBadge.textContent = msg.isJson ? "JSON" : "TEXT";
        modalContent.textContent = msg.content;
        payloadModal.classList.add("open");
      } else if (msg.command === "deleteProgress") {
        if (msg.active) {
          const pct = msg.total > 0 ? Math.round((msg.current / msg.total) * 100) : 0;
          progressBanner.classList.add("active");
          progressText.textContent = \`Deleting (\${msg.current}/\${msg.total}): \${msg.secretId}...\`;
          progressBarFill.style.width = \`\${pct}%\`;
          deleteSelectedBtn.disabled = true;
          clearDeletingRows();
          const targetRow = Array.from(tbody.querySelectorAll("tr")).find(
            (r) => r.dataset.secretId === msg.secretId
          );
          if (targetRow) {
            targetRow.classList.add("deleting-row");
            const delBtn = targetRow.querySelector("button.row-delete-btn");
            if (delBtn) {
              delBtn.disabled = true;
              delBtn.textContent = "Deleting...";
            }
          }
        } else {
          progressBanner.classList.remove("active");
          progressBarFill.style.width = "0%";
          clearDeletingRows();
          updateBulkDeleteBtn();
        }
      } else if (msg.command === "updateState") {
        allSecrets = msg.secrets || [];
        isReadOnly = Boolean(msg.isReadOnly);
        hasMore = Boolean(msg.hasMore);
        const validUnlocked = new Set(allSecrets.filter((s) => !s.locked).map((s) => s.id));
        for (const id of Array.from(selectedIds)) {
          if (!validUnlocked.has(id)) {
            selectedIds.delete(id);
          }
        }
        selectAllCb.checked = false;
        syncToolbarControls();
        render(searchInput.value);
      }
    });
  </script>
</body>
</html>`;
}

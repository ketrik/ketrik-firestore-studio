import * as vscode from "vscode";
import { ConnectionManager } from "../connections/ConnectionManager";
import ExplorerDataProvider from "../explorer/ExplorerDataProvider";
import {
  FirestoreCompositeIndex,
  FirestoreFieldIndexOverride,
  FirestoreIndexConfigEntry,
  IndexesService,
} from "../indexes/indexesService";
import { confirmProductionAction, getEnvironmentWarningPrefix } from "../utils/deleteUtils";
import { getSharedTableStyles } from "./common/tableStyles";

const activeIndexPanels = new Map<string, vscode.WebviewPanel>();

export interface IndexTableRow {
  key: string;
  name?: string;
  collectionGroup: string;
  queryScope: string;
  apiScope?: string;
  fields: Array<{
    fieldPath: string;
    order?: string;
    arrayConfig?: string;
    vectorConfig?: { dimension: number };
  }>;
  state: string;
  syncStatus: "Synced" | "Cloud Only" | "Local Only";
  raw: any;
}

export interface OverrideTableRow {
  key: string;
  collectionGroup: string;
  fieldPath: string;
  usesAncestorConfig: boolean;
  indexes: Array<{
    queryScope: string;
    order?: string;
    arrayConfig?: string;
  }>;
  ttlConfig?: { state: string };
  ttl?: boolean;
  localIndexes?: Array<{
    queryScope: string;
    order?: string;
    arrayConfig?: string;
  }>;
  localTtl?: boolean;
  syncStatus: "Synced" | "Drifted" | "Cloud Only" | "Local Only";
}

function escapeHtml(str: any): string {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Open a rich Webview Table for inspecting, filtering, syncing, and managing
 * Firestore Composite/Vector Indexes, Field Overrides, and TTL Policies.
 */
export async function openIndexesAsTable(
  connectionId: string,
  explorerDataProvider?: ExplorerDataProvider,
  initialCollectionGroup?: string
): Promise<void> {
  const existing = activeIndexPanels.get(connectionId);
  if (existing) {
    existing.reveal(vscode.ViewColumn.One);
    if (initialCollectionGroup) {
      existing.webview.postMessage({
        type: "setCollectionFilter",
        collectionGroup: initialCollectionGroup,
      });
    }
    return;
  }

  const connMgr = ConnectionManager.getInstance();
  const conn = connMgr.getConnection(connectionId);
  const connLabel = conn?.name || connectionId;

  const retainContextWhenHidden = vscode.workspace
    .getConfiguration("ketrik-firestore-studio")
    .get<boolean>("retainWebviewTabs", true);

  const panel = vscode.window.createWebviewPanel(
    "ketrikIndexesTable",
    `Indexes & TTL: ${connLabel}`,
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden,
    }
  );
  activeIndexPanels.set(connectionId, panel);

  let isDisposed = false;
  let hasRendered = false;
  let pollTimer: NodeJS.Timeout | undefined;
  let lastCreatingCount = 0;

  let currentRows: IndexTableRow[] = [];
  let currentOverrides: OverrideTableRow[] = [];
  let localFilePath: string | null = null;

  const stopPolling = () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = undefined;
    }
  };

  const buildRows = (
    liveIndexes: FirestoreCompositeIndex[],
    localIndexes: FirestoreIndexConfigEntry[]
  ): IndexTableRow[] => {
    const indexesService = IndexesService.getInstance();
    const localMap = new Map<string, FirestoreIndexConfigEntry>();
    for (const loc of localIndexes) {
      localMap.set(indexesService.getIndexKey(loc), loc);
    }

    const rows: IndexTableRow[] = [];
    const seenKeys = new Set<string>();

    for (const live of liveIndexes) {
      const key = indexesService.getIndexKey(live);
      seenKeys.add(key);
      rows.push({
        key,
        name: live.name,
        collectionGroup: live.collectionGroup,
        queryScope: live.queryScope,
        apiScope: live.apiScope,
        fields: live.fields,
        state: live.state,
        syncStatus: localMap.has(key) ? "Synced" : "Cloud Only",
        raw: live,
      });
    }

    for (const loc of localIndexes) {
      const key = indexesService.getIndexKey(loc);
      if (!seenKeys.has(key)) {
        rows.push({
          key,
          collectionGroup: loc.collectionGroup,
          queryScope: loc.queryScope || "COLLECTION",
          apiScope: loc.apiScope,
          fields: loc.fields || [],
          state: "LOCAL",
          syncStatus: "Local Only",
          raw: loc,
        });
      }
    }

    return rows.sort((a, b) => a.key.localeCompare(b.key));
  };

  const buildOverrideRows = (
    liveOverrides: FirestoreFieldIndexOverride[],
    localOverrides: any[]
  ): OverrideTableRow[] => {
    const indexesService = IndexesService.getInstance();
    const localByKey = new Map<string, any>();
    for (const loc of localOverrides) {
      if (loc?.collectionGroup && loc?.fieldPath) {
        localByKey.set(indexesService.getFieldOverrideKey(loc), loc);
      }
    }

    const rows: OverrideTableRow[] = [];
    const seen = new Set<string>();

    const normOverrideIndexes = (arr: any[] | undefined): string => {
      if (!Array.isArray(arr)) return "";
      return arr
        .map((i) => `${i?.queryScope || ""}|${i?.order || ""}|${i?.arrayConfig || ""}`)
        .sort()
        .join(";");
    };

    for (const live of liveOverrides) {
      const key = indexesService.getFieldOverrideKey(live);
      seen.add(key);
      const loc = localByKey.get(key);
      let syncStatus: OverrideTableRow["syncStatus"] = "Cloud Only";
      let localIndexes: OverrideTableRow["localIndexes"];
      let localTtl: boolean | undefined;
      if (loc) {
        const locIdxArr = Array.isArray(loc.indexes) ? loc.indexes : [];
        const sameTtl = Boolean(live.ttlConfig) === Boolean(loc.ttl);
        const sameIndexes = normOverrideIndexes(live.indexes) === normOverrideIndexes(locIdxArr);
        syncStatus = sameTtl && sameIndexes ? "Synced" : "Drifted";
        localIndexes = locIdxArr;
        localTtl = Boolean(loc.ttl);
      }
      rows.push({
        key,
        collectionGroup: live.collectionGroup,
        fieldPath: live.fieldPath,
        usesAncestorConfig: live.usesAncestorConfig,
        indexes: live.indexes,
        ttlConfig: live.ttlConfig,
        ttl: Boolean(live.ttlConfig),
        localIndexes,
        localTtl,
        syncStatus,
      });
    }

    for (const loc of localOverrides) {
      if (!loc?.collectionGroup || !loc?.fieldPath) continue;
      const key = indexesService.getFieldOverrideKey(loc);
      if (!seen.has(key)) {
        rows.push({
          key,
          collectionGroup: loc.collectionGroup,
          fieldPath: loc.fieldPath,
          usesAncestorConfig: false,
          indexes: Array.isArray(loc.indexes) ? loc.indexes : [],
          ttlConfig: loc.ttl ? { state: "LOCAL" } : undefined,
          ttl: Boolean(loc.ttl),
          syncStatus: "Local Only",
        });
      }
    }

    return rows.sort((a, b) =>
      `${a.collectionGroup}:${a.fieldPath}`.localeCompare(`${b.collectionGroup}:${b.fieldPath}`)
    );
  };

  const syncPollingState = (rows: IndexTableRow[], overrides: OverrideTableRow[]) => {
    const creatingCount =
      rows.filter((r) => r.state === "CREATING").length +
      overrides.filter((o) => o.ttlConfig?.state === "CREATING").length;

    if (lastCreatingCount > 0 && creatingCount < lastCreatingCount) {
      explorerDataProvider?.refresh();
    }
    lastCreatingCount = creatingCount;

    if (creatingCount > 0 && panel.visible && !isDisposed) {
      if (!pollTimer) {
        pollTimer = setInterval(() => {
          void loadAndPush(true);
        }, 10000);
      }
    } else {
      stopPolling();
    }
  };

  const loadAndPush = async (silent = false) => {
    if (isDisposed) return;
    const indexesService = IndexesService.getInstance();

    try {
      let cloudError: string | undefined;
      const [liveIndexes, liveOverrides, localRes] = await Promise.all([
        indexesService.listCompositeIndexes(connectionId).catch((err: any) => {
          cloudError = err?.message || String(err);
          return [];
        }),
        indexesService.listFieldOverrides(connectionId).catch(() => []),
        indexesService
          .loadLocalIndexesFile(connectionId)
          .catch(() => ({ path: "", data: { indexes: [], fieldOverrides: [] } })),
      ]);

      if (isDisposed) return;

      localFilePath = localRes.path || null;
      currentRows = buildRows(liveIndexes, localRes.data.indexes || []);
      currentOverrides = buildOverrideRows(
        liveOverrides,
        Array.isArray(localRes.data.fieldOverrides) ? localRes.data.fieldOverrides : []
      );
      const isReadOnly = connMgr.isReadOnly(connectionId);
      const isPolling =
        currentRows.some((r) => r.state === "CREATING") ||
        currentOverrides.some((o) => o.ttlConfig?.state === "CREATING");

      syncPollingState(currentRows, currentOverrides);

      if (!hasRendered) {
        hasRendered = true;
        panel.webview.html = getIndexesTableHtml({
          connLabel,
          rows: currentRows,
          overrides: currentOverrides,
          localFilePath,
          isReadOnly,
          isPolling,
          initialCollectionGroup,
          cloudError,
        });
      } else {
        panel.webview.postMessage({
          type: "updateState",
          rows: currentRows,
          overrides: currentOverrides,
          localFilePath,
          isReadOnly,
          isPolling,
          cloudError,
        });
      }
    } catch (err: any) {
      if (!silent) {
        vscode.window.showErrorMessage(`Failed to load indexes: ${err?.message || err}`);
      }
    }
  };

  const connSub = connMgr.onDidChangeConnections(() => {
    if (!isDisposed && hasRendered) {
      panel.webview.postMessage({
        type: "connectionState",
        isReadOnly: connMgr.isReadOnly(connectionId),
      });
    }
  });

  const viewStateSub = panel.onDidChangeViewState((e) => {
    if (!e.webviewPanel.visible) {
      stopPolling();
    } else {
      syncPollingState(currentRows, currentOverrides);
    }
  });

  const msgSub = panel.webview.onDidReceiveMessage(async (msg) => {
    if (msg.command === "ready" || msg.command === "refresh") {
      await loadAndPush(false);
      return;
    }

    if (msg.command === "createIndex") {
      await vscode.commands.executeCommand("ketrik-firestore-studio.buildCompositeIndex", {
        connectionId,
      });
      await loadAndPush(true);
      return;
    }

    if (msg.command === "diffIndexes") {
      await vscode.commands.executeCommand("ketrik-firestore-studio.diffIndexes", {
        connectionId,
      });
      return;
    }

    if (msg.command === "deployIndexes") {
      await vscode.commands.executeCommand("ketrik-firestore-studio.deployIndexes", {
        connectionId,
      });
      await loadAndPush(true);
      return;
    }

    if (msg.command === "snapshotIndexes") {
      await vscode.commands.executeCommand("ketrik-firestore-studio.snapshotLiveIndexes", {
        connectionId,
      });
      await loadAndPush(true);
      return;
    }

    if (msg.command === "inspectIndex") {
      const target = currentRows.find((r) => r.key === msg.key);
      if (!target) return;
      const doc = await vscode.workspace.openTextDocument({
        language: "json",
        content: JSON.stringify(target.raw, null, 2),
      });
      await vscode.window.showTextDocument(doc, { preview: true });
      return;
    }

    if (msg.command === "deploySingleIndex") {
      if (!connMgr.ensureWritable(connectionId, "deploy composite index")) return;
      const target = currentRows.find((r) => r.key === msg.key);
      if (!target) return;

      try {
        await IndexesService.getInstance().createCompositeIndex(
          connectionId,
          target.collectionGroup,
          target.queryScope as any,
          target.fields as any,
          target.apiScope
        );
        vscode.window.showInformationMessage(
          `Index build requested for '${target.collectionGroup}'. State: CREATING.`
        );
        await loadAndPush(true);
        explorerDataProvider?.refresh();
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to deploy index: ${err?.message || err}`);
      }
      return;
    }

    if (msg.command === "deleteIndex") {
      if (!connMgr.ensureWritable(connectionId, "delete composite index")) return;
      const target = currentRows.find((r) => r.key === msg.key);
      if (!target || !target.name) return;

      const envPrefix = getEnvironmentWarningPrefix(connectionId);
      const confirm = await vscode.window.showWarningMessage(
        `${envPrefix}Are you sure you want to delete index on '${target.collectionGroup}'? This action cannot be undone.`,
        { modal: true },
        "Delete Index"
      );
      if (confirm !== "Delete Index") return;

      const confirmedProd = await confirmProductionAction({
        connectionId,
        actionLabel: "Delete Composite Index",
        targetSummary: `composite index on '${target.collectionGroup}'`,
        expectedInput: target.collectionGroup,
      });
      if (!confirmedProd) return;

      try {
        await IndexesService.getInstance().deleteIndex(connectionId, target.name);
        vscode.window.showInformationMessage(
          `Deleted composite index for '${target.collectionGroup}'.`
        );
        await loadAndPush(true);
        explorerDataProvider?.refresh();
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to delete index: ${err?.message || err}`);
      }
      return;
    }

    if (msg.command === "configureTtl") {
      await vscode.commands.executeCommand("ketrik-firestore-studio.manageTtlPolicy", {
        connectionId,
        collectionGroup: msg.collectionGroup,
        fieldPath: msg.fieldPath,
        enable: msg.enable,
      });
      await loadAndPush(true);
      return;
    }

    if (msg.command === "configureFieldOverride") {
      await vscode.commands.executeCommand("ketrik-firestore-studio.manageFieldOverride", {
        connectionId,
        collectionGroup: msg.collectionGroup,
        fieldPath: msg.fieldPath,
        mode: msg.mode,
      });
      await loadAndPush(true);
      return;
    }

    if (msg.command === "deploySingleOverride") {
      if (!connMgr.ensureWritable(connectionId, "deploy field override")) return;
      const target = currentOverrides.find((o) => o.key === msg.key);
      if (!target) return;
      const indexesToDeploy =
        target.syncStatus === "Drifted" && target.localIndexes
          ? target.localIndexes
          : target.indexes;
      const ttlToDeploy =
        target.syncStatus === "Drifted" ? target.localTtl : target.ttl;
      try {
        await IndexesService.getInstance().setFieldIndexOverride(
          connectionId,
          target.collectionGroup,
          target.fieldPath,
          indexesToDeploy as any,
          ttlToDeploy
        );
        vscode.window.showInformationMessage(
          `Deployed field override for '${target.collectionGroup}.${target.fieldPath}'.`
        );
        await loadAndPush(true);
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to deploy field override: ${err?.message || err}`);
      }
      return;
    }

    if (msg.command === "rebuildIndex") {
      const target = currentRows.find((r) => r.key === msg.key);
      if (!target || !target.raw) return;
      await vscode.commands.executeCommand("ketrik-firestore-studio.rebuildIndex", {
        connectionId,
        index: target.raw,
      });
      await loadAndPush(true);
      return;
    }

    if (msg.command === "bulkDeleteIndexes") {
      if (!connMgr.ensureWritable(connectionId, "delete composite indexes")) return;
      const keys = Array.isArray(msg.keys) ? (msg.keys as string[]) : [];
      const targets = currentRows.filter((r) => keys.includes(r.key) && Boolean(r.name));
      if (targets.length === 0) return;

      const envPrefix = getEnvironmentWarningPrefix(connectionId);
      const confirm = await vscode.window.showWarningMessage(
        `${envPrefix}Are you sure you want to permanently delete ${targets.length} selected composite index(es)? This action cannot be undone.`,
        { modal: true },
        `Delete ${targets.length} Indexes`
      );
      if (confirm !== `Delete ${targets.length} Indexes`) return;

      const confirmedProd = await confirmProductionAction({
        connectionId,
        actionLabel: "Bulk Delete Composite Indexes",
        targetSummary: `${targets.length} composite index(es)`,
        expectedInput: `DELETE ${targets.length}`,
      });
      if (!confirmedProd) return;

      let deleted = 0;
      const errors: string[] = [];
      for (const target of targets) {
        try {
          await IndexesService.getInstance().deleteIndex(connectionId, target.name!);
          deleted++;
        } catch (err: any) {
          errors.push(`${target.collectionGroup}: ${err?.message || err}`);
        }
      }

      if (errors.length > 0) {
        vscode.window.showWarningMessage(
          `Deleted ${deleted} index(es); ${errors.length} failed (first: ${errors[0]}).`
        );
      } else {
        vscode.window.showInformationMessage(`Successfully deleted ${deleted} composite index(es).`);
      }
      await loadAndPush(true);
      explorerDataProvider?.refresh();
      return;
    }
  });

  panel.onDidDispose(() => {
    isDisposed = true;
    stopPolling();
    activeIndexPanels.delete(connectionId);
    connSub.dispose();
    viewStateSub.dispose();
    msgSub.dispose();
  });

  await loadAndPush(false);
}

function getIndexesTableHtml(params: {
  connLabel: string;
  rows: IndexTableRow[];
  overrides: OverrideTableRow[];
  localFilePath: string | null;
  isReadOnly: boolean;
  isPolling: boolean;
  initialCollectionGroup?: string;
  cloudError?: string;
}): string {
  const initialJson = JSON.stringify({
    rows: params.rows,
    overrides: params.overrides,
    localFilePath: params.localFilePath,
    isReadOnly: params.isReadOnly,
    isPolling: params.isPolling,
    initialCollectionGroup: params.initialCollectionGroup || "",
    cloudError: params.cloudError || "",
  }).replace(/</g, "\\u003c");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Indexes & TTL: ${escapeHtml(params.connLabel)}</title>
  <style>
    ${getSharedTableStyles()}
    body {
      padding: 16px 20px;
      display: flex;
      flex-direction: column;
      height: 100vh;
      box-sizing: border-box;
      overflow: hidden;
    }
    .header-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      margin-bottom: 12px;
      flex-wrap: wrap;
    }
    .header-title {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 16px;
      font-weight: 600;
    }
    .toolbar-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      align-items: center;
    }
    .tabs {
      display: flex;
      gap: 4px;
      border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.25));
      margin-bottom: 12px;
    }
    .tab-btn {
      background: transparent;
      color: var(--vscode-descriptionForeground);
      border: none;
      border-bottom: 2px solid transparent;
      padding: 6px 14px;
      cursor: pointer;
      font-size: 12.5px;
      font-weight: 500;
    }
    .tab-btn.active {
      color: var(--vscode-foreground);
      border-bottom-color: var(--vscode-focusBorder, #007acc);
    }
    .filters-bar {
      display: flex;
      gap: 10px;
      margin-bottom: 10px;
      flex-wrap: wrap;
      align-items: center;
    }
    .filters-bar input, .filters-bar select {
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, rgba(128,128,128,0.35));
      padding: 4px 8px;
      border-radius: 3px;
      font-size: 12px;
    }
    .table-scroll {
      flex: 1;
      overflow: auto;
      border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.2));
      border-radius: 4px;
    }
    .pill {
      display: inline-block;
      padding: 2px 7px;
      border-radius: 10px;
      font-size: 11px;
      font-weight: 500;
      margin-right: 4px;
      margin-bottom: 2px;
      background: rgba(128,128,128,0.16);
    }
    .pill-ready { background: rgba(78, 201, 176, 0.16); color: #4ec9b0; }
    .pill-creating { background: rgba(204, 167, 0, 0.2); color: #e5c07b; }
    .pill-error { background: rgba(241, 76, 76, 0.18); color: #f14c4c; }
    .pill-vector { background: rgba(157, 78, 221, 0.2); color: #c77dff; }
    .pill-synced { background: rgba(55, 148, 255, 0.15); color: #58a6ff; }
    .pill-cloud { background: rgba(204, 167, 0, 0.16); color: #cca700; }
    .pill-local { background: rgba(128, 128, 128, 0.2); color: #cccccc; }
    .poll-badge {
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 10px;
      background: rgba(204, 167, 0, 0.18);
      color: #e5c07b;
      display: none;
    }
    .action-btn {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border: none;
      padding: 3px 8px;
      border-radius: 3px;
      cursor: pointer;
      font-size: 11.5px;
      margin-right: 4px;
    }
    .action-btn:hover { background: var(--vscode-button-secondaryHoverBackground); }
    .action-btn.danger { color: #f14c4c; }
    .empty-state {
      padding: 32px;
      text-align: center;
      color: var(--vscode-descriptionForeground);
      font-size: 13px;
    }
  </style>
</head>
<body>
  <div class="header-bar">
    <div class="header-title">
      <span>🗂️ Indexes & TTL Explorer — ${escapeHtml(params.connLabel)}</span>
      <span id="pollingBadge" class="poll-badge">⏳ Auto-polling building indexes (10s)...</span>
      <span id="roBadge" class="pill pill-error" style="display:none;">🔒 Read-Only</span>
    </div>
    <div class="toolbar-actions">
      <button id="btnCreateIndex" class="primary">+ Create Index</button>
      <button id="btnConfigTtl" class="secondary">⏳ Configure TTL</button>
      <button id="btnGroupOverride" class="secondary">🌐 Group Index</button>
      <button id="btnExemptField" class="secondary">🚫 Exempt Field</button>
      <button id="btnBulkDelete" class="secondary" style="display:none; color:#f14c4c;">🗑️ Delete Selected (<span id="bulkDeleteCount">0</span>)</button>
      <button id="btnDiff" class="secondary">⇄ Diff</button>
      <button id="btnPull" class="secondary">⬇️ Pull Snapshot</button>
      <button id="btnDeploy" class="secondary">☁️ Deploy</button>
      <button id="btnRefresh" class="secondary">🔄 Refresh</button>
    </div>
  </div>

  <div class="tabs">
    <button id="tabComposite" class="tab-btn active">Composite & Vector Indexes (<span id="countComposite">0</span>)</button>
    <button id="tabOverrides" class="tab-btn">Field Overrides & TTL Policies (<span id="countOverrides">0</span>)</button>
  </div>

  <div id="cloudNoticeBanner" style="display:none; margin-bottom:10px; padding:8px 12px; border-radius:4px; background:rgba(55,148,255,0.12); border:1px solid rgba(55,148,255,0.35); font-size:12px;"></div>
  <div id="advisorBanner" style="display:none; margin-bottom:10px; padding:8px 12px; border-radius:4px; background:rgba(204,167,0,0.1); border:1px solid rgba(204,167,0,0.35); font-size:12px;"></div>

  <div id="compositeSection" style="display:flex; flex-direction:column; flex:1; overflow:hidden;">
    <div class="filters-bar">
      <input id="searchInput" type="text" placeholder="🔍 Filter collection, field, or scope..." style="width: 240px;" />
      <select id="groupFilter"><option value="">All Collections</option></select>
      <select id="stateFilter">
        <option value="">All States</option>
        <option value="READY">READY</option>
        <option value="CREATING">CREATING</option>
        <option value="NEEDS_REPAIR">NEEDS_REPAIR</option>
        <option value="LOCAL">LOCAL</option>
      </select>
      <select id="syncFilter">
        <option value="">All Sync Statuses</option>
        <option value="Synced">Synced</option>
        <option value="Cloud Only">Cloud Only</option>
        <option value="Local Only">Local Only</option>
      </select>
      <span id="summaryStats" style="font-size:12px; color:var(--vscode-descriptionForeground); margin-left:auto;"></span>
    </div>
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th style="width:28px;"><input type="checkbox" id="selectAllIndexes" title="Select all cloud indexes" /></th>
            <th>Collection Group</th>
            <th>Query Scope</th>
            <th>Indexed Fields</th>
            <th>State</th>
            <th>Sync Status</th>
            <th style="width:180px;">Actions</th>
          </tr>
        </thead>
        <tbody id="compositeBody"></tbody>
      </table>
      <div id="compositeEmpty" class="empty-state" style="display:none;">No matching composite or vector indexes found.</div>
    </div>
  </div>

  <div id="overridesSection" style="display:none; flex-direction:column; flex:1; overflow:hidden;">
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Collection Group</th>
            <th>Field Path</th>
            <th>Single-Field Index Overrides</th>
            <th>TTL Policy</th>
            <th>Sync Status</th>
            <th style="width:220px;">Actions</th>
          </tr>
        </thead>
        <tbody id="overridesBody"></tbody>
      </table>
      <div id="overridesEmpty" class="empty-state" style="display:none;">No single-field index overrides or TTL policies configured.</div>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    let state = ${initialJson};
    let activeTab = 'composite';
    let pendingGroupFilter = state.initialCollectionGroup || '';
    const selectedKeys = new Set();

    function updateBulkDeleteBtn() {
      const btn = document.getElementById('btnBulkDelete');
      const cnt = document.getElementById('bulkDeleteCount');
      if (btn && cnt) {
        cnt.textContent = selectedKeys.size;
        btn.style.display = selectedKeys.size > 0 && !state.isReadOnly ? 'inline-block' : 'none';
      }
    }

    function esc(s) {
      if (s === null || s === undefined) return '';
      return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    function render() {
      const ro = !!state.isReadOnly;
      document.getElementById('roBadge').style.display = ro ? 'inline-block' : 'none';
      document.getElementById('pollingBadge').style.display = state.isPolling ? 'inline-block' : 'none';
      document.getElementById('btnCreateIndex').disabled = ro;
      document.getElementById('btnDeploy').disabled = ro;
      document.getElementById('btnConfigTtl').disabled = ro;
      document.getElementById('btnGroupOverride').disabled = ro;
      document.getElementById('btnExemptField').disabled = ro;
      updateBulkDeleteBtn();

      document.getElementById('countComposite').textContent = state.rows.length;
      document.getElementById('countOverrides').textContent = state.overrides.length;

      // Update collection group dropdown
      const groupSel = document.getElementById('groupFilter');
      const prevGroup = pendingGroupFilter || groupSel.value;
      pendingGroupFilter = '';
      const groups = Array.from(new Set(state.rows.map(r => r.collectionGroup))).sort();
      groupSel.innerHTML = '<option value="">All Collections</option>' +
        groups.map(g => '<option value="' + esc(g) + '"' + (g === prevGroup ? ' selected' : '') + '>' + esc(g) + '</option>').join('');

      const q = (document.getElementById('searchInput').value || '').toLowerCase().trim();
      const gf = groupSel.value;
      const sf = document.getElementById('stateFilter').value;
      const syf = document.getElementById('syncFilter').value;

      const cloudBanner = document.getElementById('cloudNoticeBanner');
      if (cloudBanner) {
        if (state.cloudError) {
          cloudBanner.innerHTML = 'ℹ️ <strong>Cloud Index API unavailable:</strong> ' + esc(state.cloudError) + ' Showing local <code>firestore.indexes.json</code> definitions.';
          cloudBanner.style.display = 'block';
        } else {
          cloudBanner.style.display = 'none';
        }
      }

      // Index Redundancy & Health Advisor
      const advisorBanner = document.getElementById('advisorBanner');
      if (advisorBanner) {
        const advWarnings = [];
        const repairCount = state.rows.filter(r => r.state === 'NEEDS_REPAIR').length;
        if (repairCount > 0) {
          advWarnings.push('⚠️ ' + repairCount + ' index(es) are in NEEDS_REPAIR state — click 🔧 Rebuild.');
        }
        const singleFieldComposites = state.rows.filter(r =>
          r.queryScope === 'COLLECTION' && r.fields.length === 1 && !r.fields[0].vectorConfig
        );
        if (singleFieldComposites.length > 0) {
          advWarnings.push('💡 ' + singleFieldComposites.length + ' 1-field COLLECTION composite index(es) detected (already covered by automatic single-field indexing).');
        }
        const cgCounts = new Map();
        for (const r of state.rows) {
          cgCounts.set(r.collectionGroup, (cgCounts.get(r.collectionGroup) || 0) + 1);
        }
        const heavyCgs = Array.from(cgCounts.entries()).filter(([, c]) => c > 6).map(([cg, c]) => cg + ' (' + c + ')');
        if (heavyCgs.length > 0) {
          advWarnings.push('📈 High index write-amplification on: ' + heavyCgs.join(', ') + '.');
        }
        if (advWarnings.length > 0) {
          advisorBanner.innerHTML = '<strong>Index Advisor:</strong> ' + advWarnings.map(esc).join(' &nbsp;|&nbsp; ');
          advisorBanner.style.display = 'block';
        } else {
          advisorBanner.style.display = 'none';
        }
      }

      const filtered = state.rows.filter(r => {
        if (gf && r.collectionGroup !== gf) return false;
        if (sf && r.state !== sf) return false;
        if (syf && r.syncStatus !== syf) return false;
        if (q) {
          const text = (r.collectionGroup + ' ' + r.queryScope + ' ' + r.state + ' ' + r.syncStatus + ' ' +
            r.fields.map(f => f.fieldPath + ' ' + (f.order || f.arrayConfig || (f.vectorConfig ? 'vector ' + f.vectorConfig.dimension : ''))).join(' ')).toLowerCase();
          if (!text.includes(q)) return false;
        }
        return true;
      });

      document.getElementById('summaryStats').textContent =
        'Showing ' + filtered.length + ' of ' + state.rows.length + ' index(es)';

      const tbody = document.getElementById('compositeBody');
      const emptyEl = document.getElementById('compositeEmpty');
      if (filtered.length === 0) {
        tbody.innerHTML = '';
        emptyEl.style.display = 'block';
      } else {
        emptyEl.style.display = 'none';
        tbody.innerHTML = filtered.map(r => {
          const fieldsHtml = r.fields.map(f => {
            if (f.vectorConfig) {
              return '<span class="pill pill-vector">' + esc(f.fieldPath) + ' [VECTOR:' + esc(f.vectorConfig.dimension) + ']</span>';
            }
            if (f.arrayConfig === 'CONTAINS') {
              return '<span class="pill">' + esc(f.fieldPath) + ' ⋲ CONTAINS</span>';
            }
            const dir = f.order === 'DESCENDING' ? '↓ DESC' : '↑ ASC';
            return '<span class="pill">' + esc(f.fieldPath) + ' ' + dir + '</span>';
          }).join(' ');

          const stateCls = r.state === 'READY' ? 'pill-ready' : r.state === 'CREATING' ? 'pill-creating' : r.state === 'NEEDS_REPAIR' ? 'pill-error' : 'pill-local';
          const syncCls = r.syncStatus === 'Synced' ? 'pill-synced' : r.syncStatus === 'Cloud Only' ? 'pill-cloud' : 'pill-local';

          let actionsHtml = '<button class="action-btn" data-act="inspect" data-key="' + esc(r.key) + '">JSON</button>';
          if (r.state === 'NEEDS_REPAIR' && r.name && !ro) {
            actionsHtml += '<button class="action-btn" data-act="rebuild" data-key="' + esc(r.key) + '">🔧 Rebuild</button>';
          }
          if (r.syncStatus === 'Local Only' && !ro) {
            actionsHtml += '<button class="action-btn" data-act="deployOne" data-key="' + esc(r.key) + '">Deploy</button>';
          }
          if (r.name && !ro) {
            actionsHtml += '<button class="action-btn danger" data-act="delete" data-key="' + esc(r.key) + '">Delete</button>';
          }

          const cbHtml = r.name && !ro
            ? '<input type="checkbox" class="row-idx-cb" data-key="' + esc(r.key) + '"' + (selectedKeys.has(r.key) ? ' checked' : '') + ' />'
            : '';

          return '<tr>' +
            '<td>' + cbHtml + '</td>' +
            '<td><strong>' + esc(r.collectionGroup) + '</strong></td>' +
            '<td><span class="pill">' + esc(r.queryScope) + '</span></td>' +
            '<td>' + fieldsHtml + '</td>' +
            '<td><span class="pill ' + stateCls + '">' + esc(r.state) + '</span></td>' +
            '<td><span class="pill ' + syncCls + '">' + esc(r.syncStatus) + '</span></td>' +
            '<td>' + actionsHtml + '</td>' +
          '</tr>';
        }).join('');
      }

      // Render Overrides & TTL tab
      const ovBody = document.getElementById('overridesBody');
      const ovEmpty = document.getElementById('overridesEmpty');
      if (state.overrides.length === 0) {
        ovBody.innerHTML = '';
        ovEmpty.style.display = 'block';
      } else {
        ovEmpty.style.display = 'none';
        ovBody.innerHTML = state.overrides.map(o => {
          const idxSummary = o.usesAncestorConfig
            ? '<span style="opacity:0.7;">Inherited (Default)</span>'
            : (o.indexes.length === 0
              ? '<span class="pill pill-cloud">Disabled (Exempt)</span>'
              : o.indexes.map(i => '<span class="pill">' + esc(i.queryScope) + ' ' + esc(i.arrayConfig || i.order || '') + '</span>').join(' '));

          const ttlHtml = o.ttlConfig
            ? '<span class="pill ' + (o.ttlConfig.state === 'ACTIVE' ? 'pill-ready' : o.ttlConfig.state === 'CREATING' ? 'pill-creating' : o.ttlConfig.state === 'LOCAL' ? 'pill-local' : 'pill-error') + '">⏳ ' + esc(o.ttlConfig.state) + '</span>'
            : '<span style="opacity:0.5;">Off</span>';

          const syncCls = o.syncStatus === 'Synced'
            ? 'pill-synced'
            : o.syncStatus === 'Drifted'
              ? 'pill-creating'
              : o.syncStatus === 'Cloud Only'
                ? 'pill-cloud'
                : 'pill-local';
          const syncHtml = '<span class="pill ' + syncCls + '">' + esc(o.syncStatus || 'Cloud Only') + '</span>';

          let ttlBtn = '';
          if (!ro) {
            if (o.syncStatus === 'Local Only' || o.syncStatus === 'Drifted') {
              ttlBtn += '<button class="action-btn" data-act="deployOverride" data-key="' + esc(o.key) + '">Deploy</button>';
            }
            if (o.ttlConfig && o.syncStatus !== 'Local Only') {
              ttlBtn += '<button class="action-btn danger" data-act="disableTtl" data-cg="' + esc(o.collectionGroup) + '" data-field="' + esc(o.fieldPath) + '">Disable TTL</button>';
            } else if (o.syncStatus !== 'Local Only') {
              ttlBtn += '<button class="action-btn" data-act="enableTtl" data-cg="' + esc(o.collectionGroup) + '" data-field="' + esc(o.fieldPath) + '">Enable TTL</button>';
            }
            if (!o.usesAncestorConfig && o.syncStatus !== 'Local Only') {
              ttlBtn += '<button class="action-btn" data-act="restoreOverride" data-cg="' + esc(o.collectionGroup) + '" data-field="' + esc(o.fieldPath) + '">Restore Default</button>';
            }
          }

          return '<tr>' +
            '<td><strong>' + esc(o.collectionGroup) + '</strong></td>' +
            '<td><code>' + esc(o.fieldPath) + '</code></td>' +
            '<td>' + idxSummary + '</td>' +
            '<td>' + ttlHtml + '</td>' +
            '<td>' + syncHtml + '</td>' +
            '<td>' + ttlBtn + '</td>' +
          '</tr>';
        }).join('');
      }
    }

    document.getElementById('tabComposite').onclick = () => {
      activeTab = 'composite';
      document.getElementById('tabComposite').classList.add('active');
      document.getElementById('tabOverrides').classList.remove('active');
      document.getElementById('compositeSection').style.display = 'flex';
      document.getElementById('overridesSection').style.display = 'none';
    };
    document.getElementById('tabOverrides').onclick = () => {
      activeTab = 'overrides';
      document.getElementById('tabOverrides').classList.add('active');
      document.getElementById('tabComposite').classList.remove('active');
      document.getElementById('compositeSection').style.display = 'none';
      document.getElementById('overridesSection').style.display = 'flex';
    };

    document.getElementById('searchInput').oninput = render;
    document.getElementById('groupFilter').onchange = render;
    document.getElementById('stateFilter').onchange = render;
    document.getElementById('syncFilter').onchange = render;

    document.getElementById('btnCreateIndex').onclick = () => vscode.postMessage({ command: 'createIndex' });
    document.getElementById('btnConfigTtl').onclick = () => vscode.postMessage({ command: 'configureTtl', enable: true });
    document.getElementById('btnGroupOverride').onclick = () => vscode.postMessage({ command: 'configureFieldOverride', mode: 'collectionGroup' });
    document.getElementById('btnExemptField').onclick = () => vscode.postMessage({ command: 'configureFieldOverride', mode: 'exempt' });
    document.getElementById('btnBulkDelete').onclick = () => {
      if (selectedKeys.size > 0) {
        vscode.postMessage({ command: 'bulkDeleteIndexes', keys: Array.from(selectedKeys) });
      }
    };
    document.getElementById('selectAllIndexes').onchange = (e) => {
      const checked = e.target.checked;
      document.querySelectorAll('.row-idx-cb').forEach(cb => {
        cb.checked = checked;
        const k = cb.getAttribute('data-key');
        if (k) {
          if (checked) selectedKeys.add(k);
          else selectedKeys.delete(k);
        }
      });
      updateBulkDeleteBtn();
    };
    document.getElementById('compositeBody').addEventListener('change', (e) => {
      const cb = e.target.closest('.row-idx-cb');
      if (!cb) return;
      const k = cb.getAttribute('data-key');
      if (k) {
        if (cb.checked) selectedKeys.add(k);
        else selectedKeys.delete(k);
      }
      updateBulkDeleteBtn();
    });
    document.getElementById('btnDiff').onclick = () => vscode.postMessage({ command: 'diffIndexes' });
    document.getElementById('btnPull').onclick = () => vscode.postMessage({ command: 'snapshotIndexes' });
    document.getElementById('btnDeploy').onclick = () => vscode.postMessage({ command: 'deployIndexes' });
    document.getElementById('btnRefresh').onclick = () => vscode.postMessage({ command: 'refresh' });

    document.getElementById('compositeBody').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const act = btn.getAttribute('data-act');
      const key = btn.getAttribute('data-key');
      if (act === 'inspect') vscode.postMessage({ command: 'inspectIndex', key });
      if (act === 'rebuild') vscode.postMessage({ command: 'rebuildIndex', key });
      if (act === 'deployOne') vscode.postMessage({ command: 'deploySingleIndex', key });
      if (act === 'delete') vscode.postMessage({ command: 'deleteIndex', key });
    });

    document.getElementById('overridesBody').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const act = btn.getAttribute('data-act');
      const collectionGroup = btn.getAttribute('data-cg');
      const fieldPath = btn.getAttribute('data-field');
      if (act === 'deployOverride') vscode.postMessage({ command: 'deploySingleOverride', key: btn.getAttribute('data-key') });
      if (act === 'enableTtl') vscode.postMessage({ command: 'configureTtl', collectionGroup, fieldPath, enable: true });
      if (act === 'disableTtl') vscode.postMessage({ command: 'configureTtl', collectionGroup, fieldPath, enable: false });
      if (act === 'restoreOverride') vscode.postMessage({ command: 'configureFieldOverride', collectionGroup, fieldPath, mode: 'restore' });
    });

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'updateState') {
        selectedKeys.clear();
        const selectAllEl = document.getElementById('selectAllIndexes');
        if (selectAllEl) selectAllEl.checked = false;
        state = {
          rows: msg.rows || [],
          overrides: msg.overrides || [],
          localFilePath: msg.localFilePath,
          isReadOnly: !!msg.isReadOnly,
          isPolling: !!msg.isPolling,
          cloudError: msg.cloudError || '',
        };
        render();
      } else if (msg.type === 'setCollectionFilter') {
        pendingGroupFilter = msg.collectionGroup || '';
        render();
      } else if (msg.type === 'connectionState') {
        state.isReadOnly = !!msg.isReadOnly;
        render();
      }
    });

    render();
  </script>
</body>
</html>`;
}

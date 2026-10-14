import { getSharedTableStyles } from "../common/tableStyles";

export function getCollectionTableStyles(): string {
  return `
    ${getSharedTableStyles()}

    .actions {
      display: flex;
      justify-content: center;
      align-items: center;
      margin-top: 18px;
    }
    .load-more-group {
      display: inline-flex;
      align-items: center;
      background: var(--vscode-editorWidget-background, rgba(128, 128, 128, 0.1));
      border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border, rgba(128, 128, 128, 0.25)));
      border-radius: 6px;
      padding: 3px;
      gap: 4px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    }
    .load-more-group button {
      padding: 6px 12px;
      font-size: 0.9em;
      border-radius: 4px;
      white-space: nowrap;
    }
    .load-more-group button.primary-load-btn {
      min-width: 140px;
      font-weight: 600;
    }
    .load-more-group button.secondary-load-btn {
      background: transparent;
      border: 1px solid transparent;
      color: var(--vscode-foreground);
      padding: 6px 10px;
    }
    .load-more-group button.secondary-load-btn:hover:not(:disabled) {
      background: var(--vscode-toolbar-hoverBackground, rgba(128, 128, 128, 0.18));
      border-color: var(--vscode-widget-border, rgba(128, 128, 128, 0.25));
    }
    .table-container {
      position: relative;
    }
    .table-loading-bar {
      position: sticky;
      bottom: 0;
      left: 0;
      width: 100%;
      height: 3px;
      background: transparent;
      overflow: hidden;
      z-index: 40;
      display: none;
    }
    .table-loading-bar.active {
      display: block;
      background: rgba(55, 148, 255, 0.15);
    }
    .table-loading-bar.active::after {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      width: 40%;
      height: 100%;
      background: linear-gradient(90deg, transparent, var(--vscode-progressBar-background, #007acc), transparent);
      animation: tableLoadingAnim 1.2s infinite ease-in-out;
    }
    @keyframes tableLoadingAnim {
      0% {
        transform: translateX(-100%);
      }
      100% {
        transform: translateX(350%);
      }
    }
    @keyframes newRowPulse {
      0% {
        background-color: var(--vscode-editor-findMatchHighlightBackground, rgba(234, 179, 8, 0.25));
      }
      100% {
        background-color: transparent;
      }
    }
    .new-row-highlight {
      animation: newRowPulse 1.5s ease-out forwards;
    }
    .query-builder-panel {
      background: var(--vscode-editorWidget-background, rgba(128, 128, 128, 0.08));
      border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border, rgba(128, 128, 128, 0.25)));
      border-radius: 6px;
      padding: 14px 16px;
      margin-bottom: 14px;
    }
    .query-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
      font-weight: 600;
      font-size: 0.95em;
    }
    .clause-row {
      display: flex;
      gap: 8px;
      align-items: center;
      margin-bottom: 8px;
    }
    .clause-row input.clause-field {
      min-width: 150px;
      flex: 1;
    }
    .clause-row select.clause-op {
      min-width: 140px;
    }
    .clause-row input.clause-val {
      min-width: 160px;
      flex: 1.5;
    }
    .batch-toolbar {
      display: flex;
      align-items: center;
      gap: 12px;
      background: var(--vscode-editorWidget-background, rgba(128, 128, 128, 0.1));
      border: 1px solid var(--vscode-focusBorder, #007acc);
      border-radius: 6px;
      padding: 10px 16px;
      margin-bottom: 12px;
    }
    .batch-count {
      font-weight: 600;
      font-size: 0.92em;
    }
    .batch-btn-danger {
      background: var(--vscode-statusBarItem-errorBackground, #c72e2e) !important;
      color: #fff !important;
    }
    .select-col {
      width: 36px;
      min-width: 36px;
      max-width: 36px;
      text-align: center;
      position: sticky;
      left: 0;
      z-index: 5;
      background-color: var(--vscode-editor-background);
      border-right: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.15));
    }
    thead th.select-col {
      z-index: 12;
      background-color: var(--vscode-editor-background);
      background-image: linear-gradient(
        var(--vscode-editorGroupHeader-tabsBackground, var(--vscode-sideBar-background, rgba(128, 128, 128, 0.1))),
        var(--vscode-editorGroupHeader-tabsBackground, var(--vscode-sideBar-background, rgba(128, 128, 128, 0.1)))
      );
    }
    td.sticky-col {
      left: 36px !important;
      box-shadow: 2px 0 5px -2px rgba(0, 0, 0, 0.25);
    }
    thead th.id-header {
      left: 36px !important;
      box-shadow: 2px 0 5px -2px rgba(0, 0, 0, 0.25);
    }
    tbody tr:nth-child(even) td.select-col {
      background-color: var(--vscode-editor-background);
      background-image: linear-gradient(rgba(128, 128, 128, 0.035), rgba(128, 128, 128, 0.035));
    }
    tbody tr:hover td.select-col {
      background-color: var(--vscode-editor-background) !important;
      background-image: linear-gradient(
        var(--vscode-list-hoverBackground, rgba(128, 128, 128, 0.15)),
        var(--vscode-list-hoverBackground, rgba(128, 128, 128, 0.15))
      ) !important;
    }
    .row-checkbox {
      cursor: pointer;
      width: 15px;
      height: 15px;
      accent-color: var(--vscode-button-background, #007acc);
    }
    .parent-header {
      min-width: 170px;
    }
    .parent-doc-link {
      color: var(--vscode-textLink-foreground, #3794ff);
      cursor: pointer;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 0.9em;
      border-radius: 3px;
      padding: 1px 4px;
    }
    .parent-doc-link:hover {
      text-decoration: underline;
      background: rgba(55, 148, 255, 0.1);
    }
    .doc-open-btn {
      opacity: 0.5;
      padding: 2px 4px;
      border-radius: 3px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      transition: opacity 0.15s ease, background 0.15s ease;
      margin-left: auto;
    }
    .doc-open-btn:hover {
      opacity: 1;
      background: rgba(128, 128, 128, 0.2);
    }
    td.data-cell {
      position: relative;
      cursor: pointer;
      user-select: text;
    }
    td.data-cell:hover {
      outline: 1px dashed var(--vscode-focusBorder, rgba(0, 122, 204, 0.5));
      outline-offset: -1px;
    }
    td.data-cell.selected {
      outline: 2px solid var(--vscode-focusBorder, #007acc) !important;
      outline-offset: -2px;
    }
    td.data-cell.editing {
      padding: 2px 4px !important;
      outline: 2px solid var(--vscode-focusBorder, #007acc) !important;
      outline-offset: -2px;
      background: var(--vscode-input-background) !important;
    }
    .cell-input {
      width: 100%;
      height: 100%;
      border: none !important;
      outline: none !important;
      padding: 4px 6px !important;
      font-size: inherit;
      font-family: inherit;
      background: transparent !important;
      color: var(--vscode-input-foreground) !important;
      box-shadow: none !important;
    }
    .cell-type-badge {
      font-size: 0.72em;
      opacity: 0.5;
      padding: 1px 3px;
      border-radius: 2px;
      margin-right: 4px;
      font-family: var(--mono-font);
      background: rgba(128, 128, 128, 0.15);
      user-select: none;
    }
    .cell-flash-success {
      animation: flash-green 1.4s ease-out;
    }
    @keyframes flash-green {
      0% { background-color: rgba(46, 204, 113, 0.5) !important; }
      100% { background-color: transparent; }
    }
    .cell-flash-error {
      animation: flash-red 1.4s ease-out;
    }
    @keyframes flash-red {
      0% { background-color: rgba(231, 76, 60, 0.5) !important; }
      100% { background-color: transparent; }
    }

    /* ── Storage Media Previews & DocumentReference Links ── */
    .storage-media-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 2px 8px;
      border-radius: 4px;
      background: rgba(255, 152, 0, 0.12);
      border: 1px solid rgba(255, 152, 0, 0.35);
      color: var(--vscode-editor-foreground);
      font-size: 0.86em;
      position: relative;
    }
    .storage-thumb {
      width: 22px;
      height: 22px;
      object-fit: cover;
      border-radius: 3px;
      cursor: zoom-in;
      border: 1px solid rgba(255, 255, 255, 0.2);
    }
    .storage-thumb:hover {
      transform: scale(3.5);
      transform-origin: left center;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45);
      z-index: 50;
      transition: transform 0.2s ease;
    }
    .doc-ref-link {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 2px 8px;
      border-radius: 4px;
      background: rgba(55, 148, 255, 0.12);
      border: 1px solid rgba(55, 148, 255, 0.35);
      color: var(--vscode-textLink-foreground, #3794ff);
      cursor: pointer;
      font-family: var(--mono-font);
      font-size: 0.86em;
      text-decoration: none;
      transition: background 0.15s ease, border-color 0.15s ease;
    }
    .doc-ref-link:hover {
      background: rgba(55, 148, 255, 0.25);
      border-color: var(--vscode-textLink-foreground, #3794ff);
      text-decoration: underline;
    }

    /* ── Slide-out Property Inspector Drawer ── */
    .drawer-backdrop {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.45);
      z-index: 99;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.2s ease;
    }
    .drawer-backdrop.open {
      opacity: 1;
      pointer-events: auto;
    }
    .property-drawer {
      position: fixed;
      top: 0;
      right: -520px;
      width: 500px;
      max-width: 90vw;
      height: 100vh;
      background: var(--vscode-editor-background);
      border-left: 1px solid var(--vscode-widget-border, var(--vscode-panel-border, rgba(128, 128, 128, 0.3)));
      box-shadow: -4px 0 16px rgba(0, 0, 0, 0.3);
      z-index: 100;
      display: flex;
      flex-direction: column;
      transition: right 0.25s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .property-drawer.open {
      right: 0;
    }
    .drawer-header {
      padding: 16px 20px;
      border-bottom: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.2));
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: var(--vscode-editorGroupHeader-tabsBackground, rgba(128, 128, 128, 0.05));
    }
    .drawer-title-area {
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    .drawer-title {
      font-size: 1.1em;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .drawer-subtitle {
      font-size: 0.82em;
      color: var(--vscode-descriptionForeground);
      font-family: var(--mono-font);
      word-break: break-all;
    }
    .drawer-close-btn {
      background: transparent !important;
      border: none !important;
      font-size: 1.2em;
      cursor: pointer;
      color: var(--vscode-editor-foreground);
      opacity: 0.6;
      padding: 4px 8px !important;
    }
    .drawer-close-btn:hover {
      opacity: 1;
      background: rgba(128, 128, 128, 0.2) !important;
    }
    .drawer-tabs {
      display: flex;
      border-bottom: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.2));
      padding: 0 16px;
      background: var(--vscode-editorWidget-background, rgba(128, 128, 128, 0.04));
    }
    .drawer-tab {
      padding: 8px 14px;
      font-size: 0.88em;
      cursor: pointer;
      border-bottom: 2px solid transparent;
      opacity: 0.7;
      user-select: none;
    }
    .drawer-tab.active {
      opacity: 1;
      font-weight: 600;
      border-bottom-color: var(--vscode-focusBorder, #007acc);
      color: var(--vscode-textLink-foreground, #3794ff);
    }
    .drawer-body {
      flex: 1;
      overflow-y: auto;
      padding: 16px 20px;
    }
    .kv-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 16px;
    }
    .kv-table th {
      font-size: 0.78em;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      padding: 6px 8px;
      border-bottom: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.2));
      background: transparent;
      color: var(--vscode-descriptionForeground);
    }
    .kv-row td {
      padding: 6px 8px;
      border-bottom: 1px solid rgba(128, 128, 128, 0.1);
      vertical-align: middle;
      font-size: 0.9em;
    }
    .kv-key-cell {
      width: 38%;
      font-family: var(--mono-font);
      font-weight: 500;
    }
    .kv-key-input {
      width: 100%;
      padding: 3px 6px;
      font-size: 0.92em;
      font-family: var(--mono-font);
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, rgba(128, 128, 128, 0.2));
      color: var(--vscode-input-foreground);
      border-radius: 3px;
    }
    .kv-val-cell {
      width: 52%;
    }
    .kv-val-input {
      width: 100%;
      padding: 4px 6px;
      font-size: 0.92em;
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, rgba(128, 128, 128, 0.2));
      color: var(--vscode-input-foreground);
      border-radius: 3px;
    }
    .kv-act-cell {
      width: 10%;
      text-align: right;
    }
    .kv-del-btn {
      opacity: 0.4;
      cursor: pointer;
      background: transparent !important;
      border: none !important;
      padding: 2px 4px !important;
      font-size: 0.95em;
    }
    .kv-del-btn:hover {
      opacity: 1;
      color: #e74c3c;
    }
    .drawer-raw-json {
      width: 100%;
      height: 100%;
      min-height: 380px;
      font-family: var(--mono-font);
      font-size: 0.9em;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, rgba(128, 128, 128, 0.3));
      border-radius: 4px;
      padding: 10px;
      resize: vertical;
      line-height: 1.4;
      box-sizing: border-box;
    }
    .drawer-footer {
      padding: 14px 20px;
      border-top: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.2));
      background: var(--vscode-editorGroupHeader-tabsBackground, rgba(128, 128, 128, 0.05));
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
    }
  `;
}

export function getCollectionTableHtml(
  item: { collectionId: string; connectionId: string },
  isCollectionGroup = false
): string {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: https:; font-src data:;">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${isCollectionGroup ? "Collection Group" : "Collection"}: ${item.collectionId}</title>
      <style>
        ${getCollectionTableStyles()}
      </style>
    </head>
    <body>
      <div class="toolbar">
        <div class="title-area">
          <h1>
            <span>${isCollectionGroup ? "🗂️" : "📁"}</span>
            <span class="collection-name">${item.collectionId}</span>
            ${
              isCollectionGroup
                ? '<span class="badge" style="margin-left: 8px; background: rgba(255,152,0,0.18); color: #ff9800; border: 1px solid rgba(255,152,0,0.4);">Collection Group</span>'
                : ""
            }
          </h1>
          <span class="badge" title="Connection ID">${item.connectionId}</span>
        </div>
        <div class="toolbar-actions" id="toolbarActions" style="display:none;">
          <button id="toggleProtoBtn" class="secondary toggle-btn" title="Toggle visibility of Operational Protocol (__) columns" style="display:none;">
            <span>🛡️</span> __ Protocol
          </button>
          <button id="toggleEnvBtn" class="secondary toggle-btn" title="Toggle visibility of System Envelope (_) columns" style="display:none;">
            <span>🏷️</span> _ Envelope
          </button>
          <button id="toggleFilterBtn" class="secondary" title="Build server-side Firestore query filters">
            <span>🔍</span> Filter / Where
          </button>
          <button id="toggleTimeTravelBtn" class="secondary toggle-btn" title="Simulate time-travel to preview live, scheduled, or expired documents" style="display:none;">
            <span>⏱️</span> Simulate Time
          </button>
          <div class="search-wrapper">
            <input id="searchInput" type="text" placeholder="Filter loaded rows..." />
          </div>
          <button id="searchBtn">Filter</button>
          <div class="search-wrapper" style="margin-left: 8px;">
            <input id="jumpInput" type="text" placeholder="Lookup exact Doc ID..." style="width: 170px;" />
          </div>
          <button id="jumpBtn" class="secondary" title="Direct single-read fetch of document ID">Lookup</button>
          <button id="countCollBtn" class="secondary" title="Get exact total document count in collection (1 read per 1k index entries)">
            <span>📊</span> Count
          </button>
          <button id="calcAggBtn" class="secondary" title="Compute Sum and Average on numeric fields" style="display:none;">
            <span>∑</span> Aggregates...
          </button>
          <button id="clearSearchBtn" class="secondary" style="display:none;">Clear</button>
          <button id="exportBtn" class="secondary" title="Export current view as JSON">
            <span>⬇</span> Export JSON
          </button>
        </div>
      </div>

      <div id="timeTravelPanel" class="time-travel-panel" style="display:none;">
        <div class="time-travel-title">
          <span>⏱️ Time-Travel Lifecycle Simulation</span>
          <span style="font-size:0.85em; opacity:0.8; font-weight:normal;">(Evaluating __.from & __.exp against virtual time)</span>
        </div>
        <div class="time-travel-controls">
          <label style="font-size:0.88em;">Virtual Time:</label>
          <input id="virtualTimeInput" type="datetime-local" style="padding:4px 8px; font-size:0.9em;" />
          <button id="timePresetNowBtn" class="secondary" style="font-size:0.82em; padding:3px 8px;">Now</button>
          <button id="timePresetPlus1hBtn" class="secondary" style="font-size:0.82em; padding:3px 8px;">+1h</button>
          <button id="timePresetPlus1dBtn" class="secondary" style="font-size:0.82em; padding:3px 8px;">+1d</button>
          <button id="timePresetPlus7dBtn" class="secondary" style="font-size:0.82em; padding:3px 8px;">+7d</button>
          <button id="timePresetPlus30dBtn" class="secondary" style="font-size:0.82em; padding:3px 8px;">+30d</button>
          <span style="border-left:1px solid rgba(128,128,128,0.3); height:18px; margin:0 4px;"></span>
          <label style="font-size:0.88em;">Filter Status:</label>
          <select id="lifecycleFilterSelect" style="padding:4px 8px; font-size:0.9em;">
            <option value="all">All States</option>
            <option value="active">Active Only 🟢</option>
            <option value="scheduled">Scheduled 🟡</option>
            <option value="expired">Expired 🔴</option>
            <option value="inactive">Inactive ⚪</option>
          </select>
        </div>
      </div>

      <div id="queryBuilderPanel" class="query-builder-panel" style="display:none;">
        <div class="query-header">
          <span>Server-Side Firestore Query Builder</span>
          <div style="display:flex; gap:8px; align-items:center;">
            <span style="font-size:0.85em; opacity:0.8;">Presets:</span>
            <button id="presetActiveBtn" class="secondary icon-btn" title="Filter docs where __.active == true" style="font-size:0.82em; padding:3px 8px;">⚡ Active Only</button>
            <button id="presetExpiredBtn" class="secondary icon-btn" title="Filter docs where __.active == false" style="font-size:0.82em; padding:3px 8px;">⏱ Inactive</button>
            <button id="bookmarkCurrentBtn" class="secondary icon-btn" title="Save current query as a named bookmark" style="font-size:0.82em; padding:3px 8px;">⭐ Bookmark</button>
            <select id="bookmarksDropdown" style="font-size:0.82em; padding:3px 8px; max-width:140px;">
              <option value="">Saved Queries...</option>
            </select>
            <select id="queryMatchMode" style="font-size:0.82em; padding:3px 8px; font-weight:600;" title="Logical match condition between clauses">
              <option value="and">Match: ALL (AND)</option>
              <option value="or">Match: ANY (OR)</option>
            </select>
            <button id="addClauseBtn" class="secondary icon-btn">+ Add Clause</button>
            <button id="runQueryBtn">Run Query</button>
            <button id="resetQueryBtn" class="secondary">Reset</button>
          </div>
        </div>
        <div id="clauseList"></div>
      </div>

      <div class="info-bar" id="infoBar" style="display:none;">
        <div class="info-text">
          Showing <b id="doc-count">0</b> documents
          <span id="total-count-badge" class="badge" style="display:none; margin-left: 8px; background: rgba(55,148,255,0.15); color: var(--vscode-textLink-foreground, #3794ff); border-color: rgba(55,148,255,0.4);"></span>
          <span class="search-note" id="search-note" style="display:none;">
            — (Filtered over loaded documents)
          </span>
          <span class="search-note" id="lookup-note" style="display:none; color:var(--vscode-editorWarning-foreground, #cca700);">
            — (Direct Document Lookup)
          </span>
          <span class="search-note" id="query-note" style="display:none; color:var(--vscode-textLink-foreground, #3794ff); font-weight:500;">
            — (Server Query Active)
          </span>
        </div>
        <div>💡 Click Doc ID to view JSON • Double-click cell to edit</div>
      </div>

      <div id="batchToolbar" class="batch-toolbar" style="display:none;">
        <span class="batch-count" id="batchCountLabel">0 rows selected</span>
        <button id="batchUpdateBtn" class="secondary">✏️ Batch Update Field...</button>
        <button id="batchDeleteBtn" class="secondary batch-btn-danger">🗑️ Batch Delete</button>
        <button id="batchClearBtn" class="secondary">Clear Selection</button>
      </div>

      <div class="table-container">
        <table>
          <thead id="table-head"><tr></tr></thead>
          <tbody id="table-body"></tbody>
        </table>
        <div id="empty-state" class="empty-state" style="display:none;">
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:0.4; margin-bottom:10px;">
            <path d="M4 4h16v16H4zM4 9h16M9 4v16"/>
          </svg>
          <h3 id="empty-state-title" style="margin:0 0 6px 0;">This collection is empty</h3>
          <p id="empty-state-msg" style="margin:0 0 16px 0; color:var(--vscode-descriptionForeground);">There are no documents in this collection yet.</p>
          <div id="empty-state-actions" style="display:flex; gap:10px; justify-content:center;">
            <button id="emptyCreateDocBtn" style="padding:6px 16px;">
              <span>➕</span> Create Document
            </button>
            <button id="emptyRefreshBtn" class="secondary" style="padding:6px 14px;">
              <span>🔄</span> Refresh
            </button>
          </div>
          <div id="empty-state-filter-actions" style="display:none; justify-content:center;">
            <button id="emptyClearFilterBtn" class="secondary" style="padding:6px 14px;">
              Clear Active Filters
            </button>
          </div>
        </div>
        <div id="tableLoadingBar" class="table-loading-bar"></div>
      </div>

      <div class="actions">
        <div id="loadMoreGroup" class="load-more-group" style="display:none;">
          <button id="loadMoreBtn" class="primary-load-btn" title="Load next page of documents">Load More</button>
          <button id="load50Btn" class="secondary-load-btn" title="Load next 50 documents">+50</button>
          <button id="load100Btn" class="secondary-load-btn" title="Load next 100 documents">+100</button>
          <button id="loadAllBtn" class="secondary-load-btn" style="font-weight:600; color:var(--vscode-textLink-foreground, #3794ff);" title="Load up to 1,000 documents (safety limit to prevent high Firestore billing)">Load All (Max 1,000)</button>
        </div>
      </div>

      <!-- Slide-out Property Inspector Drawer -->
      <div id="drawerBackdrop" class="drawer-backdrop"></div>
      <div id="propertyDrawer" class="property-drawer">
        <div class="drawer-header">
          <div class="drawer-title-area">
            <div class="drawer-title">
              <span id="drawerTypeIcon">📦</span>
              <span id="drawerFieldTitle">Field Inspector</span>
            </div>
            <div id="drawerDocPath" class="drawer-subtitle"></div>
          </div>
          <button id="drawerCloseBtn" class="drawer-close-btn" title="Close Drawer (Escape)">✕</button>
        </div>
        <div class="drawer-tabs">
          <div id="tabGrid" class="drawer-tab active">Property Grid</div>
          <div id="tabJson" class="drawer-tab">Raw JSON</div>
        </div>
        <div id="drawerBodyGrid" class="drawer-body">
          <table class="kv-table">
            <thead>
              <tr>
                <th style="width:38%;">Key / Index</th>
                <th style="width:52%;">Value</th>
                <th style="width:10%;"></th>
              </tr>
            </thead>
            <tbody id="kvTableBody"></tbody>
          </table>
          <button id="kvAddPropertyBtn" class="secondary" style="font-size:0.85em; padding:4px 10px;">
            <span>➕</span> Add Property
          </button>
        </div>
        <div id="drawerBodyJson" class="drawer-body" style="display:none;">
          <textarea id="drawerRawJsonInput" class="drawer-raw-json" spellcheck="false"></textarea>
        </div>
        <div class="drawer-footer">
          <button id="drawerOpenAsTableBtn" class="secondary" title="Open this Map or Array in dedicated multi-column table">
            <span>↗</span> Open as Table
          </button>
          <div style="display:flex; gap:8px;">
            <button id="drawerCancelBtn" class="secondary">Cancel</button>
            <button id="drawerSaveBtn">Save Changes</button>
          </div>
        </div>
      </div>

      <script>
        ${getCollectionTableClientScript(isCollectionGroup)}
      </script>
    </body>
    </html>
  `;
}

export function getCollectionTableClientScript(isCollectionGroup = false): string {
  return `
    (function() {
      const vscode = acquireVsCodeApi();
      const isGroup = ${isCollectionGroup};
      let isSearchMode = false;
      let isServerQueryMode = false;
      let currentHeaders = [];

      let isTimeTravelOpen = false;
      let simulatedTime = Date.now();
      let lifecycleFilter = 'all';

      let selectedDocIds = new Set();
      let savedBookmarksMap = {};

      function updateBatchToolbar() {
        const toolbar = document.getElementById('batchToolbar');
        const countLabel = document.getElementById('batchCountLabel');
        if (!toolbar || !countLabel) return;
        if (selectedDocIds.size > 0) {
          toolbar.style.display = 'flex';
          countLabel.textContent = selectedDocIds.size + ' row(s) selected';
        } else {
          toolbar.style.display = 'none';
        }
      }

      function updateBookmarksDropdown(bookmarks) {
        savedBookmarksMap = bookmarks || {};
        const dd = document.getElementById('bookmarksDropdown');
        if (!dd) return;
        dd.innerHTML = '<option value="">⭐ Saved Queries...</option>';
        Object.keys(savedBookmarksMap).forEach(name => {
          const opt = document.createElement('option');
          opt.value = name;
          opt.textContent = name;
          dd.appendChild(opt);
        });
      }

      // ── helpers ──────────────────────────────────────────────────────
      function escapeHtml(val) {
        if (val === null || val === undefined) { return ''; }
        return String(val)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');
      }

      function parseTimeVal(val) {
        if (!val) return null;
        if (typeof val === 'number') {
          return val < 1e11 ? val * 1000 : val;
        }
        if (typeof val === 'string') {
          const t = Date.parse(val);
          return isNaN(t) ? null : t;
        }
        if (typeof val === 'object' && val._seconds !== undefined) {
          return val._seconds * 1000;
        }
        return null;
      }

      function computeLifecycleStatus(doc, refTime) {
        const proto = doc.__ && typeof doc.__ === 'object' ? doc.__ : {};
        const active = proto.active !== undefined ? proto.active : doc['__.active'];
        const fromVal = proto.from !== undefined ? proto.from : doc['__.from'];
        const expVal = proto.exp !== undefined ? proto.exp : doc['__.exp'];

        if (active === false || active === 'false') {
          return { status: 'inactive', label: 'Inactive', cls: 'pill-inactive', icon: '⚪' };
        }

        const fromMs = parseTimeVal(fromVal);
        const expMs = parseTimeVal(expVal);

        if (fromMs !== null && refTime < fromMs) {
          return { status: 'scheduled', label: 'Scheduled', cls: 'pill-scheduled', icon: '🟡' };
        }
        if (expMs !== null && refTime > expMs) {
          return { status: 'expired', label: 'Expired', cls: 'pill-expired', icon: '🔴' };
        }

        if (active === true || active === 'true' || fromMs !== null || expMs !== null) {
          return { status: 'active', label: 'Active', cls: 'pill-active', icon: '🟢' };
        }

        return null;
      }

      function renderHeaderCell(h) {
        const isProto = h.startsWith('__');
        const isEnv = h.startsWith('_') && !isProto;
        let cls = isProto ? 'protocol-header col-proto' : isEnv ? 'envelope-header col-env' : '';
        let badge = isProto ? '<span class="th-tag protocol">protocol</span>' : isEnv ? '<span class="th-tag envelope">envelope</span>' : '';
        return '<th class="' + cls + '">' + badge + escapeHtml(h) + '</th>';
      }

      function renderHeaderRow(headers) {
        const parentHeader = isGroup ? '<th class="parent-header">Parent Document</th>' : '';
        return '<th class="select-col"><input type="checkbox" id="selectAllCheckbox" class="row-checkbox" title="Select All Loaded Rows" /></th>' +
          '<th class="id-header">Document ID</th>' +
          parentHeader +
          headers.map(h => renderHeaderCell(h)).join('');
      }

      function formatCell(value) {
        if (value === null || value === undefined) {
          return '<span style="opacity:0.4; font-style:italic;">null</span>';
        }
        if (typeof value === "object") {
          if (value._seconds !== undefined && value._nanoseconds !== undefined) {
            try {
              const date = new Date(value._seconds * 1000);
              return '<span class="chip" title="' + escapeHtml(date.toISOString()) + '">🕒 ' + escapeHtml(date.toLocaleString()) + '</span>';
            } catch (e) {}
          }
          return '<span class="chip" title="Click to view/edit in inspector">' + escapeHtml(JSON.stringify(value)) + '</span>';
        }
        if (typeof value === "boolean") {
          return '<span class="chip" style="font-weight:600;">' + (value ? 'true' : 'false') + '</span>';
        }

        const strVal = String(value);

        // 1. DocumentReference detection: [Ref: users/abc]
        if (strVal.startsWith('[Ref: ') && strVal.endsWith(']')) {
          const refPath = strVal.slice(6, -1);
          return '<span class="doc-ref-link" data-ref="' + escapeHtml(refPath) + '" title="Click to open referenced document: ' + escapeHtml(refPath) + '">' +
            '🔗 <b>' + escapeHtml(refPath) + '</b></span>';
        }

        // 2. Cloud Storage media URL / gs:// detection
        const isStorageHttp = strVal.startsWith('https://firebasestorage.googleapis.com/') || strVal.startsWith('https://storage.googleapis.com/');
        const isGsPath = strVal.startsWith('gs://');

        if (isStorageHttp || isGsPath) {
          const lower = strVal.toLowerCase();
          const isImg = lower.includes('.jpg') || lower.includes('.jpeg') || lower.includes('.png') || lower.includes('.webp') || lower.includes('.gif') || lower.includes('.svg');
          const isAudio = lower.includes('.mp3') || lower.includes('.wav') || lower.includes('.m4a') || lower.includes('.ogg');
          const isVideo = lower.includes('.mp4') || lower.includes('.webm') || lower.includes('.mov');
          const isPdf = lower.includes('.pdf');

          if (isImg && isStorageHttp) {
            return '<span class="storage-media-chip" title="' + escapeHtml(strVal) + '">' +
              '<img src="' + escapeHtml(strVal) + '" class="storage-thumb" alt="media" loading="lazy" />' +
              '<span>' + escapeHtml(strVal.split('?')[0].split('/').pop() || 'image') + '</span>' +
              '</span>';
          }
          if (isAudio) {
            return '<span class="storage-media-chip" title="' + escapeHtml(strVal) + '">🎵 Audio (' + escapeHtml(strVal.split('?')[0].split('/').pop() || '') + ')</span>';
          }
          if (isVideo) {
            return '<span class="storage-media-chip" title="' + escapeHtml(strVal) + '">🎬 Video (' + escapeHtml(strVal.split('?')[0].split('/').pop() || '') + ')</span>';
          }
          if (isPdf) {
            return '<span class="storage-media-chip" title="' + escapeHtml(strVal) + '">📑 PDF Document</span>';
          }
          return '<span class="storage-media-chip" title="' + escapeHtml(strVal) + '">☁️ ' + escapeHtml(strVal.split('?')[0].split('/').pop() || strVal) + '</span>';
        }

        return escapeHtml(strVal);
      }

      function renderRows(docs, headers) {
        return docs.map(doc => {
          const docId = doc.__id || (doc.__path ? doc.__path.split('/').pop() : '');
          const lc = computeLifecycleStatus(doc, simulatedTime);
          const pillHtml = lc
            ? '<span class="lifecycle-pill ' + lc.cls + '" title="Virtual Status: ' + lc.label + '">' + lc.icon + ' ' + lc.label + '</span>'
            : '';

          const isChecked = selectedDocIds.has(docId);
          const selectCell = '<td class="select-col"><input type="checkbox" class="row-checkbox row-select-checkbox" data-id="' + escapeHtml(docId) + '"' + (isChecked ? ' checked' : '') + ' /></td>';

          const idCell = '<td class="sticky-col"><div class="doc-id-cell">' +
            '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M4 1h8l3 3v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1zm7 1v3h3L11 2z"/></svg>' +
            '<span class="doc-id-link" title="Click to view raw JSON document in editor">' + escapeHtml(docId) + '</span>' + pillHtml +
            '<span class="doc-open-btn" title="Open JSON document">📄</span>' +
            '</div></td>';

          const parentCell = isGroup
            ? '<td>' + (doc.__parentPath
                ? '<span class="parent-doc-link" data-parent="' + escapeHtml(doc.__parentPath) + '" title="Click to open parent document: ' + escapeHtml(doc.__parentPath) + '">📁 ' + escapeHtml(doc.__parentPath) + '</span>'
                : '<span style="opacity:0.4; font-style:italic;">(root)</span>') + '</td>'
            : '';

          const dataCells = headers.map(h => {
            const isProto = h.startsWith('__');
            const isEnv = h.startsWith('_') && !isProto;
            const tdCls = isProto ? ' class="col-proto data-cell"' : isEnv ? ' class="col-env data-cell"' : ' class="data-cell"';
            const rawVal = doc[h];
            let valType = "string";
            if (rawVal === null || rawVal === undefined) valType = "null";
            else if (typeof rawVal === "boolean") valType = "boolean";
            else if (typeof rawVal === "number") valType = "number";
            else if (typeof rawVal === "object") {
              if (rawVal._seconds !== undefined && rawVal._nanoseconds !== undefined) valType = "timestamp";
              else if (Array.isArray(rawVal)) valType = "array";
              else valType = "map";
            }
            return '<td' + tdCls + ' data-field="' + escapeHtml(h) + '" data-type="' + valType + '">' + formatCell(rawVal) + '</td>';
          }).join('');

          return '<tr data-path="' + escapeHtml(doc.__path || '') + '" data-id="' + escapeHtml(docId) + '">' + selectCell + idCell + parentCell + dataCells + '</tr>';
        }).join('');
      }

      function getNumericFields() {
        const fields = new Set();
        function inspect(obj, prefix) {
          if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return;
          if (obj._seconds !== undefined && obj._nanoseconds !== undefined) return;
          if (obj._latitude !== undefined && obj._longitude !== undefined) return;

          for (const key of Object.keys(obj)) {
            if (!prefix && (key.startsWith('__') || key === '__id' || key === '__path' || key === '__parentPath')) continue;
            if (key === '_seconds' || key === '_nanoseconds' || key === '_latitude' || key === '_longitude') continue;

            const val = obj[key];
            const path = prefix ? prefix + '.' + key : key;
            if (typeof val === 'number' && Number.isFinite(val)) {
              fields.add(path);
            } else if (val && typeof val === 'object' && !Array.isArray(val) && prefix.split('.').length < 2) {
              inspect(val, path);
            }
          }
        }
        for (const doc of allLoadedDocs) {
          if (doc) inspect(doc, '');
        }
        for (const doc of lastDocs) {
          if (doc) inspect(doc, '');
        }
        return Array.from(fields).sort();
      }

      function updateContextualButtons() {
        const hasProto = currentHeaders.some(h => h.startsWith('__'));
        const hasEnv = currentHeaders.some(h => h.startsWith('_') && !h.startsWith('__'));
        const hasLifecycle = allLoadedDocs.some(d => d && (d.__ !== undefined || d['__.active'] !== undefined || d['__.from'] !== undefined || d['__.exp'] !== undefined));
        const numFields = getNumericFields();

        const protoBtn = document.getElementById('toggleProtoBtn');
        if (protoBtn) protoBtn.style.display = hasProto ? 'inline-flex' : 'none';

        const envBtn = document.getElementById('toggleEnvBtn');
        if (envBtn) envBtn.style.display = hasEnv ? 'inline-flex' : 'none';

        const timeBtn = document.getElementById('toggleTimeTravelBtn');
        if (timeBtn) timeBtn.style.display = hasLifecycle ? 'inline-flex' : 'none';

        const aggBtn = document.getElementById('calcAggBtn');
        if (aggBtn) {
          aggBtn.style.display = numFields.length > 0 ? 'inline-flex' : 'none';
          if (numFields.length > 0) {
            aggBtn.title = 'Compute Sum and Average on numeric fields: ' + numFields.join(', ');
          }
        }
      }

      function updateEmptyState(count, customMsg) {
        const emptyState = document.getElementById('empty-state');
        const titleEl = document.getElementById('empty-state-title');
        const msgEl = document.getElementById('empty-state-msg');
        const emptyActions = document.getElementById('empty-state-actions');
        const emptyFilterActions = document.getElementById('empty-state-filter-actions');
        const toolbarActions = document.getElementById('toolbarActions');
        const infoBar = document.getElementById('infoBar');
        const tableContainerTable = document.querySelector('.table-container table');

        updateContextualButtons();

        const isFiltering = isSearchMode || isServerQueryMode;

        if (count === 0) {
          emptyState.style.display = 'block';
          if (tableContainerTable) tableContainerTable.style.display = 'none';

          if (isFiltering) {
            // When filtering/querying, keep toolbar visible so user can clear/modify query
            if (toolbarActions) toolbarActions.style.display = 'flex';
            if (infoBar) infoBar.style.display = 'flex';
            if (titleEl) titleEl.textContent = 'No matching documents';
            if (msgEl) msgEl.textContent = customMsg || 'No documents matched your active search or query clauses.';
            if (emptyActions) emptyActions.style.display = 'none';
            if (emptyFilterActions) emptyFilterActions.style.display = 'flex';
          } else {
            // Truly empty collection: hide the busy toolbar actions
            if (toolbarActions) toolbarActions.style.display = 'none';
            if (infoBar) infoBar.style.display = 'none';
            if (titleEl) titleEl.textContent = 'This collection is empty';
            if (msgEl) msgEl.textContent = customMsg || 'There are no documents in this collection yet.';
            if (emptyActions) emptyActions.style.display = 'flex';
            if (emptyFilterActions) emptyFilterActions.style.display = 'none';
          }
        } else {
          emptyState.style.display = 'none';
          if (tableContainerTable) tableContainerTable.style.display = 'table';
          if (toolbarActions) toolbarActions.style.display = 'flex';
          if (infoBar) infoBar.style.display = 'flex';
          if (emptyActions) emptyActions.style.display = 'none';
          if (emptyFilterActions) emptyFilterActions.style.display = 'none';
        }
      }

      // ── Query Builder Row Generator ─────────────────────────────────
      function createClauseRow(fieldVal, opVal, valVal) {
        const row = document.createElement('div');
        row.className = 'clause-row';

        const fieldInput = document.createElement('input');
        fieldInput.type = 'text';
        fieldInput.className = 'clause-field';
        fieldInput.placeholder = 'Field path (e.g. status, age, user.name)';
        fieldInput.value = fieldVal || '';

        const opSelect = document.createElement('select');
        opSelect.className = 'clause-op';
        const ops = [
          { val: '==', label: '== (Equals)' },
          { val: '!=', label: '!= (Not Equals)' },
          { val: '<', label: '< (Less than)' },
          { val: '<=', label: '<= (Less than or equal)' },
          { val: '>', label: '> (Greater than)' },
          { val: '>=', label: '>= (Greater than or equal)' },
          { val: 'array-contains', label: 'array-contains' },
          { val: 'array-contains-any', label: 'array-contains-any' },
          { val: 'in', label: 'in (Match any in array)' },
          { val: 'not-in', label: 'not-in' },
          { val: 'starts-with', label: 'starts-with (Prefix helper)' }
        ];
        ops.forEach(o => {
          const opt = document.createElement('option');
          opt.value = o.val;
          opt.textContent = o.label;
          if (o.val === opVal) { opt.selected = true; }
          opSelect.appendChild(opt);
        });

        const valInput = document.createElement('input');
        valInput.type = 'text';
        valInput.className = 'clause-val';
        valInput.placeholder = 'Value (e.g. true, 25, active, ["a", "b"])';
        valInput.value = valVal || '';

        const removeBtn = document.createElement('button');
        removeBtn.className = 'secondary icon-btn';
        removeBtn.textContent = '✕';
        removeBtn.title = 'Remove clause';
        removeBtn.onclick = function() {
          row.remove();
          if (document.getElementById('clauseList').children.length === 0) {
            createClauseRow();
          }
        };

        row.appendChild(fieldInput);
        row.appendChild(opSelect);
        row.appendChild(valInput);
        row.appendChild(removeBtn);
        document.getElementById('clauseList').appendChild(row);
      }

      let allLoadedDocs = [];
      let lastDocs = [];

      function reRenderCurrentTable() {
        document.getElementById('table-head').innerHTML = '<tr>' + renderHeaderRow(currentHeaders) + '</tr>';
        document.getElementById('table-body').innerHTML = renderRows(lastDocs, currentHeaders);
        updateBatchToolbar();
      }

      function docMatchesSearch(doc, term) {
        if (!term) return true;
        for (const k in doc) {
          if (k === '__path') continue;
          const v = doc[k];
          if (v === null || v === undefined) continue;
          if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
            if (String(v).toLowerCase().includes(term)) return true;
          } else if (typeof v === 'object') {
            try {
              if (JSON.stringify(v).toLowerCase().includes(term)) return true;
            } catch (e) {}
          }
        }
        return false;
      }

      function filterCurrentDocs() {
        const searchTerm = (document.getElementById('searchInput').value || '').trim().toLowerCase();
        let docs = allLoadedDocs;

        if (searchTerm) {
          docs = docs.filter(d => docMatchesSearch(d, searchTerm));
        }

        if (lifecycleFilter !== 'all') {
          docs = docs.filter(d => {
            const lc = computeLifecycleStatus(d, simulatedTime);
            return lc && lc.status === lifecycleFilter;
          });
        }

        lastDocs = docs;
        document.getElementById('table-body').innerHTML = renderRows(lastDocs, currentHeaders);
        document.getElementById('doc-count').textContent = lastDocs.length;
        const isFiltering = !!searchTerm || lifecycleFilter !== 'all';
        document.getElementById('clearSearchBtn').style.display = isFiltering ? '' : (isServerQueryMode ? '' : 'none');
        document.getElementById('search-note').style.display = isFiltering ? '' : 'none';
        updateLoadMoreVisibility(!isFiltering && hasMoreState);
        updateEmptyState(lastDocs.length);
        updateBatchToolbar();
      }

      function updateLoadMoreVisibility(show) {
        const group = document.getElementById('loadMoreGroup');
        if (group) {
          group.style.display = show ? 'inline-flex' : 'none';
        }
      }

      function setLoadMoreButtonsDisabled(disabled, loadingText) {
        const loadBtn = document.getElementById('loadMoreBtn');
        const load50 = document.getElementById('load50Btn');
        const load100 = document.getElementById('load100Btn');
        const loadAll = document.getElementById('loadAllBtn');
        const loadingBar = document.getElementById('tableLoadingBar');
        if (loadingBar) {
          if (disabled) loadingBar.classList.add('active');
          else loadingBar.classList.remove('active');
        }
        if (loadBtn) {
          loadBtn.disabled = disabled;
          if (loadingText) loadBtn.textContent = loadingText;
          else if (!disabled) loadBtn.textContent = 'Load More';
        }
        if (load50) load50.disabled = disabled;
        if (load100) load100.disabled = disabled;
        if (loadAll) loadAll.disabled = disabled;
      }

      function applyClientSearch(term) {
        isSearchMode = !!(term || '').trim() || lifecycleFilter !== 'all';
        filterCurrentDocs();
      }

      function updateTimeInputValue() {
        const d = new Date(simulatedTime);
        const pad = n => String(n).padStart(2, '0');
        const formatted = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
        const el = document.getElementById('virtualTimeInput');
        if (el) el.value = formatted;
      }

      function setSimulatedTime(newMs) {
        simulatedTime = newMs;
        updateTimeInputValue();
        filterCurrentDocs();
      }

      let hasMoreState = false;

      // ── message handler ───────────────────────────────────────────
      window.addEventListener('message', function(event) {
        const msg = event.data;

        if (msg.type === 'init') {
          currentHeaders = msg.headers || [];
          allLoadedDocs = msg.docs || [];
          lastDocs = allLoadedDocs;
          hasMoreState = !!msg.hasMore;
          updateTimeInputValue();
          if (msg.bookmarks) {
            updateBookmarksDropdown(msg.bookmarks);
          }
          document.getElementById('table-head').innerHTML = '<tr>' + renderHeaderRow(currentHeaders) + '</tr>';
          document.getElementById('table-body').innerHTML = renderRows(lastDocs, currentHeaders);
          document.getElementById('doc-count').textContent = lastDocs.length;
          updateLoadMoreVisibility(hasMoreState);
          setLoadMoreButtonsDisabled(false);
          updateEmptyState(lastDocs.length);
          updateBatchToolbar();
        }

        if (msg.type === 'countResult') {
          const btn = document.getElementById('countCollBtn');
          if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<span>📊</span> Count';
          }
          const badge = document.getElementById('total-count-badge');
          if (badge) {
            badge.textContent = 'Total: ' + Number(msg.count).toLocaleString() + ' docs';
            badge.style.display = 'inline-block';
          }
        }

        if (msg.type === 'aggregateStart') {
          const btn = document.getElementById('calcAggBtn');
          if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<span>⏳</span> Calculating...';
          }
        }

        if (msg.type === 'aggregateResult') {
          const btn = document.getElementById('calcAggBtn');
          if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<span>∑</span> Aggregates...';
          }
          const badge = document.getElementById('total-count-badge');
          if (badge) {
            const avgFormatted = msg.avg !== null && msg.avg !== undefined ? Number(msg.avg).toFixed(2) : 'N/A';
            badge.textContent = msg.field + ': Sum=' + (msg.sum ?? 0) + ' | Avg=' + avgFormatted;
            badge.style.display = 'inline-block';
          }
        }

        if (msg.type === 'aggregateError') {
          const btn = document.getElementById('calcAggBtn');
          if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<span>∑</span> Aggregates...';
          }
        }

        if (msg.type === 'batchSuccess') {
          selectedDocIds.clear();
          updateBatchToolbar();
          if (msg.hasMore !== undefined) {
            hasMoreState = !!msg.hasMore;
          }
          if (msg.docs) {
            allLoadedDocs = msg.docs;
            lastDocs = allLoadedDocs;
            reRenderCurrentTable();
            document.getElementById('doc-count').textContent = lastDocs.length;
            updateEmptyState(lastDocs.length);
            updateLoadMoreVisibility(!isSearchMode && hasMoreState);
            setLoadMoreButtonsDisabled(false);
            if (lastDocs.length === 0 && hasMoreState && !isSearchMode) {
              vscode.postMessage({ command: 'loadMore' });
            }
          }
        }

        if (msg.type === 'bookmarksLoaded') {
          updateBookmarksDropdown(msg.bookmarks);
        }

        if (msg.type === 'appendRows') {
          currentHeaders = msg.headers || currentHeaders;
          hasMoreState = !!msg.hasMore;
          const previousCount = allLoadedDocs.length;
          const newDocCount = (msg.newDocs || []).length;

          if (msg.headersChanged) {
            allLoadedDocs = msg.allDocs || [];
          } else {
            allLoadedDocs = allLoadedDocs.concat(msg.newDocs || []);
          }
          filterCurrentDocs();

          updateLoadMoreVisibility(!isSearchMode && hasMoreState);
          setLoadMoreButtonsDisabled(false);
          updateEmptyState(lastDocs.length);

          // Scroll so the newly loaded rows comfortably come into view (showing ~5 new rows in the viewport)
          if (newDocCount > 0) {
            requestAnimationFrame(() => {
              const tableBody = document.getElementById('table-body');
              const container = document.querySelector('.table-container');
              if (tableBody && container) {
                const rows = tableBody.querySelectorAll('tr');
                if (rows.length > previousCount) {
                  // Target around 4-5 rows down the newly added batch to center them in the viewport
                  const targetIndex = Math.min(previousCount + 4, rows.length - 1);
                  const targetRow = rows[targetIndex] || rows[previousCount];
                  if (targetRow) {
                    targetRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  }
                } else if (rows.length > 0) {
                  container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
                }
              }
            });
          }
        }

        if (msg.type === 'searchResults') {
          isSearchMode = true;
          currentHeaders = msg.headers || currentHeaders;
          lastDocs = msg.docs || [];
          reRenderCurrentTable();
          document.getElementById('doc-count').textContent = lastDocs.length;
          updateLoadMoreVisibility(false);
          document.getElementById('clearSearchBtn').style.display = '';
          document.getElementById('search-note').style.display = '';
          document.getElementById('lookup-note').style.display = 'none';
          updateEmptyState(lastDocs.length);
        }

        if (msg.type === 'lookupResult') {
          isSearchMode = true;
          currentHeaders = msg.headers || currentHeaders;
          lastDocs = [msg.doc];
          reRenderCurrentTable();
          document.getElementById('doc-count').textContent = '1';
          updateLoadMoreVisibility(false);
          document.getElementById('clearSearchBtn').style.display = '';
          document.getElementById('search-note').style.display = 'none';
          document.getElementById('lookup-note').style.display = '';
          updateEmptyState(1);
        }

        if (msg.type === 'lookupNotFound') {
          isSearchMode = true;
          lastDocs = [];
          document.getElementById('table-body').innerHTML = '';
          document.getElementById('doc-count').textContent = '0';
          updateLoadMoreVisibility(false);
          document.getElementById('clearSearchBtn').style.display = '';
          document.getElementById('search-note').style.display = 'none';
          document.getElementById('lookup-note').style.display = '';
          updateEmptyState(0, "Document '" + msg.docId + "' was not found in Firestore.");
        }

        if (msg.type === 'clearSearch') {
          isSearchMode = false;
          currentHeaders = msg.headers || currentHeaders;
          allLoadedDocs = msg.docs || [];
          lastDocs = allLoadedDocs;
          hasMoreState = !!msg.hasMore;
          reRenderCurrentTable();
          document.getElementById('doc-count').textContent = lastDocs.length;
          updateLoadMoreVisibility(hasMoreState);
          setLoadMoreButtonsDisabled(false);
          document.getElementById('clearSearchBtn').style.display = isServerQueryMode ? '' : 'none';
          document.getElementById('search-note').style.display = 'none';
          document.getElementById('lookup-note').style.display = 'none';
          document.getElementById('searchInput').value = '';
          document.getElementById('jumpInput').value = '';
          updateEmptyState(lastDocs.length);
        }

        if (msg.type === 'queryResult') {
          isServerQueryMode = msg.isActive;
          isSearchMode = false;
          currentHeaders = msg.headers || [];
          allLoadedDocs = msg.docs || [];
          lastDocs = allLoadedDocs;
          hasMoreState = !!msg.hasMore;
          reRenderCurrentTable();
          document.getElementById('doc-count').textContent = lastDocs.length;
          updateLoadMoreVisibility(hasMoreState);
          setLoadMoreButtonsDisabled(false);
          document.getElementById('search-note').style.display = 'none';
          document.getElementById('lookup-note').style.display = 'none';
          document.getElementById('query-note').style.display = isServerQueryMode ? '' : 'none';
          document.getElementById('clearSearchBtn').style.display = isServerQueryMode ? '' : 'none';
          updateEmptyState(lastDocs.length, isServerQueryMode ? "No documents match the specified where clauses." : undefined);
        }

        if (msg.type === 'fieldUpdated') {
          const { docPath, field, value } = msg;
          const doc = allLoadedDocs.find(d => d.__path === docPath);
          if (doc) {
            doc[field] = value;
          }
          const lastD = lastDocs.find(d => d.__path === docPath);
          if (lastD) {
            lastD[field] = value;
          }
          const tr = document.querySelector('tr[data-path="' + CSS.escape(docPath) + '"]');
          if (tr) {
            const td = tr.querySelector('td.data-cell[data-field="' + CSS.escape(field) + '"]');
            if (td) {
              td.classList.remove('editing');
              td.innerHTML = formatCell(value);
              td.classList.add('cell-flash-success');
              setTimeout(() => td.classList.remove('cell-flash-success'), 1400);
            }
          }
        }

        if (msg.type === 'fieldUpdateFailed') {
          const { docPath, field } = msg;
          const tr = document.querySelector('tr[data-path="' + CSS.escape(docPath) + '"]');
          if (tr) {
            const td = tr.querySelector('td.data-cell[data-field="' + CSS.escape(field) + '"]');
            if (td) {
              td.classList.remove('editing');
              const doc = allLoadedDocs.find(d => d.__path === docPath);
              td.innerHTML = formatCell(doc ? doc[field] : null);
              td.classList.add('cell-flash-error');
              setTimeout(() => td.classList.remove('cell-flash-error'), 1400);
            }
          }
        }
      });

      // ── button handlers ───────────────────────────────────────────
      const tableEl = document.querySelector('table');

      document.getElementById('toggleProtoBtn').onclick = function() {
        const isHidden = tableEl.classList.toggle('hide-proto');
        this.classList.toggle('active', isHidden);
      };

      document.getElementById('toggleEnvBtn').onclick = function() {
        const isHidden = tableEl.classList.toggle('hide-env');
        this.classList.toggle('active', isHidden);
      };

      document.getElementById('toggleTimeTravelBtn').onclick = function() {
        const panel = document.getElementById('timeTravelPanel');
        isTimeTravelOpen = !isTimeTravelOpen;
        panel.style.display = isTimeTravelOpen ? 'flex' : 'none';
        this.classList.toggle('active', isTimeTravelOpen);
      };

      document.getElementById('virtualTimeInput').onchange = function() {
        const val = this.value;
        if (val) {
          const t = new Date(val).getTime();
          if (!isNaN(t)) {
            setSimulatedTime(t);
          }
        }
      };

      document.getElementById('timePresetNowBtn').onclick = function() {
        setSimulatedTime(Date.now());
      };

      document.getElementById('timePresetPlus1hBtn').onclick = function() {
        setSimulatedTime(simulatedTime + 3600 * 1000);
      };

      document.getElementById('timePresetPlus1dBtn').onclick = function() {
        setSimulatedTime(simulatedTime + 24 * 3600 * 1000);
      };

      document.getElementById('timePresetPlus7dBtn').onclick = function() {
        setSimulatedTime(simulatedTime + 7 * 24 * 3600 * 1000);
      };

      document.getElementById('timePresetPlus30dBtn').onclick = function() {
        setSimulatedTime(simulatedTime + 30 * 24 * 3600 * 1000);
      };

      document.getElementById('lifecycleFilterSelect').onchange = function() {
        lifecycleFilter = this.value;
        filterCurrentDocs();
      };

      document.getElementById('presetActiveBtn').onclick = function() {
        document.getElementById('clauseList').innerHTML = '';
        createClauseRow('__.active', '==', 'true');
      };

      document.getElementById('presetExpiredBtn').onclick = function() {
        document.getElementById('clauseList').innerHTML = '';
        createClauseRow('__.active', '==', 'false');
      };

      document.getElementById('bookmarkCurrentBtn').onclick = function() {
        const rows = Array.from(document.querySelectorAll('.clause-row'));
        const clauses = rows.map(r => ({
          field: r.querySelector('.clause-field').value.trim(),
          op: r.querySelector('.clause-op').value,
          value: r.querySelector('.clause-val').value.trim(),
        })).filter(c => c.field !== '');

        vscode.postMessage({ command: 'promptSaveBookmark', clauses });
      };

      document.getElementById('bookmarksDropdown').onchange = function() {
        const name = this.value;
        if (!name || !savedBookmarksMap[name]) return;
        const clauses = savedBookmarksMap[name];
        document.getElementById('clauseList').innerHTML = '';
        clauses.forEach(c => {
          createClauseRow(c.field, c.op, c.value);
        });
      };

      document.getElementById('countCollBtn').onclick = function() {
        this.disabled = true;
        this.innerHTML = '<span>⏳</span> Counting...';
        vscode.postMessage({ command: 'countCollection' });
      };

      document.getElementById('calcAggBtn').onclick = function() {
        const numFields = getNumericFields();
        vscode.postMessage({ command: 'calculateAggregates', numericFields: numFields });
      };

      document.getElementById('batchUpdateBtn').onclick = function() {
        if (selectedDocIds.size === 0) return;
        vscode.postMessage({ command: 'promptBatchUpdate', docIds: Array.from(selectedDocIds) });
      };

      document.getElementById('batchDeleteBtn').onclick = function() {
        if (selectedDocIds.size === 0) return;
        vscode.postMessage({ command: 'promptBatchDelete', docIds: Array.from(selectedDocIds) });
      };

      document.getElementById('batchClearBtn').onclick = function() {
        selectedDocIds.clear();
        const checkboxes = document.querySelectorAll('.row-select-checkbox, #selectAllCheckbox');
        checkboxes.forEach(cb => { cb.checked = false; });
        updateBatchToolbar();
      };

      document.addEventListener('change', function(event) {
        const target = event.target;
        if (!target) return;
        if (target.id === 'selectAllCheckbox') {
          const checked = target.checked;
          const checkboxes = document.querySelectorAll('.row-select-checkbox');
          checkboxes.forEach(cb => {
            cb.checked = checked;
            const id = cb.getAttribute('data-id');
            if (id) {
              if (checked) selectedDocIds.add(id);
              else selectedDocIds.delete(id);
            }
          });
          updateBatchToolbar();
        } else if (target.classList && target.classList.contains('row-select-checkbox')) {
          const id = target.getAttribute('data-id');
          if (id) {
            if (target.checked) selectedDocIds.add(id);
            else selectedDocIds.delete(id);
          }
          const allCheckboxes = document.querySelectorAll('.row-select-checkbox');
          const selectAllEl = document.getElementById('selectAllCheckbox');
          if (selectAllEl) {
            selectAllEl.checked = allCheckboxes.length > 0 && selectedDocIds.size === allCheckboxes.length;
          }
          updateBatchToolbar();
        }
      });

      document.getElementById('toggleFilterBtn').onclick = function() {
        const panel = document.getElementById('queryBuilderPanel');
        const isVisible = panel.style.display !== 'none';
        panel.style.display = isVisible ? 'none' : 'block';
        if (!isVisible && document.getElementById('clauseList').children.length === 0) {
          createClauseRow();
        }
      };

      document.getElementById('addClauseBtn').onclick = function() {
        createClauseRow();
      };

      document.getElementById('runQueryBtn').onclick = function() {
        const rows = Array.from(document.querySelectorAll('.clause-row'));
        const clauses = rows.map(r => ({
          field: r.querySelector('.clause-field').value.trim(),
          op: r.querySelector('.clause-op').value,
          value: r.querySelector('.clause-val').value.trim(),
        })).filter(c => c.field !== '');

        if (clauses.length === 0) {
          return;
        }
        const matchMode = document.getElementById('queryMatchMode') ? document.getElementById('queryMatchMode').value : 'and';
        vscode.postMessage({ command: 'runServerQuery', clauses, matchMode });
      };

      document.getElementById('resetQueryBtn').onclick = function() {
        document.getElementById('clauseList').innerHTML = '';
        createClauseRow();
        const matchModeEl = document.getElementById('queryMatchMode');
        if (matchModeEl) matchModeEl.value = 'and';
        vscode.postMessage({ command: 'resetServerQuery' });
      };

      document.getElementById('exportBtn').onclick = function() {
        const sourceDocs = (lastDocs && lastDocs.length > 0) ? lastDocs : allLoadedDocs;
        const data = sourceDocs.map(d => {
          const { __path, ...rest } = d;
          return rest;
        });
        vscode.postMessage({ command: 'exportJson', data });
      };

      document.getElementById('searchBtn').onclick = function() {
        const value = document.getElementById('searchInput').value;
        applyClientSearch(value);
      };

      let searchDebounceTimer = null;
      document.getElementById('searchInput').addEventListener('input', function() {
        if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
        const val = this.value;
        searchDebounceTimer = setTimeout(() => {
          applyClientSearch(val);
        }, 150);
      });

      document.getElementById('jumpBtn').onclick = function() {
        const docId = document.getElementById('jumpInput').value.trim();
        if (docId) {
          vscode.postMessage({ command: 'jumpToId', docId });
        }
      };

      document.getElementById('clearSearchBtn').onclick = function() {
        document.getElementById('searchInput').value = '';
        document.getElementById('jumpInput').value = '';
        lifecycleFilter = 'all';
        const filterEl = document.getElementById('lifecycleFilterSelect');
        if (filterEl) filterEl.value = 'all';
        if (isSearchMode && !isServerQueryMode) {
          applyClientSearch('');
        } else {
          vscode.postMessage({ command: 'clearSearch' });
        }
      };

      // ── Slide-out Property Inspector Drawer Logic ──────────────────────
      let drawerDocPath = null;
      let drawerField = null;
      let drawerType = null;
      let drawerCurrentVal = null;
      let drawerActiveTab = 'grid'; // 'grid' | 'json'

      function openComplexDrawer(docPath, field, type) {
        drawerDocPath = docPath;
        drawerField = field;
        drawerType = type;

        const doc = allLoadedDocs.find(d => d.__path === docPath);
        drawerCurrentVal = doc && doc[field] !== undefined ? JSON.parse(JSON.stringify(doc[field])) : (type === 'array' ? [] : {});

        document.getElementById('drawerDocPath').textContent = docPath + ' → ' + field;
        document.getElementById('drawerFieldTitle').textContent = field + ' (' + (type === 'array' ? 'Array' : 'Map') + ')';
        document.getElementById('drawerTypeIcon').textContent = type === 'array' ? '📑' : '📦';

        // Reset to Grid tab
        switchDrawerTab('grid');
        renderDrawerGrid();

        document.getElementById('drawerBackdrop').classList.add('open');
        document.getElementById('propertyDrawer').classList.add('open');
      }

      function closeComplexDrawer() {
        document.getElementById('drawerBackdrop').classList.remove('open');
        document.getElementById('propertyDrawer').classList.remove('open');
        drawerDocPath = null;
        drawerField = null;
        drawerType = null;
        drawerCurrentVal = null;
      }

      function switchDrawerTab(tab) {
        drawerActiveTab = tab;
        const tabGrid = document.getElementById('tabGrid');
        const tabJson = document.getElementById('tabJson');
        const bodyGrid = document.getElementById('drawerBodyGrid');
        const bodyJson = document.getElementById('drawerBodyJson');

        if (tab === 'grid') {
          tabGrid.classList.add('active');
          tabJson.classList.remove('active');
          bodyGrid.style.display = 'block';
          bodyJson.style.display = 'none';

          // If coming from JSON, try parsing JSON back into drawerCurrentVal
          const jsonText = document.getElementById('drawerRawJsonInput').value;
          if (jsonText) {
            try {
              drawerCurrentVal = JSON.parse(jsonText);
              renderDrawerGrid();
            } catch (err) {}
          }
        } else {
          tabGrid.classList.remove('active');
          tabJson.classList.add('active');
          bodyGrid.style.display = 'none';
          bodyJson.style.display = 'block';

          // Sync current grid state into JSON editor
          syncGridToCurrentVal();
          document.getElementById('drawerRawJsonInput').value = JSON.stringify(drawerCurrentVal, null, 2);
        }
      }

      function renderDrawerGrid() {
        const tbody = document.getElementById('kvTableBody');
        tbody.innerHTML = '';
        const isArr = Array.isArray(drawerCurrentVal);

        if (isArr) {
          drawerCurrentVal.forEach((item, index) => {
            const tr = document.createElement('tr');
            tr.className = 'kv-row';
            tr.setAttribute('data-index', String(index));

            // Key/Index cell (read-only index for arrays)
            const tdKey = document.createElement('td');
            tdKey.className = 'kv-key-cell';
            tdKey.innerHTML = '<span style="opacity:0.6;">[' + index + ']</span>';

            // Value cell
            const tdVal = document.createElement('td');
            tdVal.className = 'kv-val-cell';
            tdVal.appendChild(createKvValueInput(item, (newVal) => {
              drawerCurrentVal[index] = newVal;
            }));

            // Actions cell
            const tdAct = document.createElement('td');
            tdAct.className = 'kv-act-cell';
            const delBtn = document.createElement('button');
            delBtn.className = 'kv-del-btn';
            delBtn.title = 'Remove item';
            delBtn.textContent = '🗑️';
            delBtn.onclick = function() {
              drawerCurrentVal.splice(index, 1);
              renderDrawerGrid();
            };
            tdAct.appendChild(delBtn);

            tr.appendChild(tdKey);
            tr.appendChild(tdVal);
            tr.appendChild(tdAct);
            tbody.appendChild(tr);
          });
        } else if (drawerCurrentVal && typeof drawerCurrentVal === 'object') {
          Object.keys(drawerCurrentVal).forEach(key => {
            const val = drawerCurrentVal[key];
            const tr = document.createElement('tr');
            tr.className = 'kv-row';
            tr.setAttribute('data-key', key);

            // Key cell (editable key input)
            const tdKey = document.createElement('td');
            tdKey.className = 'kv-key-cell';
            const keyInput = document.createElement('input');
            keyInput.className = 'kv-key-input';
            keyInput.value = key;
            keyInput.onchange = function() {
              const newKey = keyInput.value.trim();
              if (newKey && newKey !== key) {
                const currentVal = drawerCurrentVal[key];
                delete drawerCurrentVal[key];
                drawerCurrentVal[newKey] = currentVal;
                renderDrawerGrid();
              }
            };
            tdKey.appendChild(keyInput);

            // Value cell
            const tdVal = document.createElement('td');
            tdVal.className = 'kv-val-cell';
            tdVal.appendChild(createKvValueInput(val, (newVal) => {
              drawerCurrentVal[key] = newVal;
            }));

            // Actions cell
            const tdAct = document.createElement('td');
            tdAct.className = 'kv-act-cell';
            const delBtn = document.createElement('button');
            delBtn.className = 'kv-del-btn';
            delBtn.title = 'Delete property';
            delBtn.textContent = '🗑️';
            delBtn.onclick = function() {
              delete drawerCurrentVal[key];
              renderDrawerGrid();
            };
            tdAct.appendChild(delBtn);

            tr.appendChild(tdKey);
            tr.appendChild(tdVal);
            tr.appendChild(tdAct);
            tbody.appendChild(tr);
          });
        }
      }

      function createKvValueInput(val, onChange) {
        if (typeof val === 'boolean') {
          const select = document.createElement('select');
          select.className = 'kv-val-input';
          const optTrue = document.createElement('option');
          optTrue.value = 'true';
          optTrue.textContent = 'true (boolean)';
          optTrue.selected = val === true;
          const optFalse = document.createElement('option');
          optFalse.value = 'false';
          optFalse.textContent = 'false (boolean)';
          optFalse.selected = val === false;
          select.appendChild(optTrue);
          select.appendChild(optFalse);
          select.onchange = () => onChange(select.value === 'true');
          return select;
        }

        if (val !== null && typeof val === 'object') {
          const wrapper = document.createElement('div');
          wrapper.style.display = 'flex';
          wrapper.style.alignItems = 'center';
          wrapper.style.gap = '6px';
          const chip = document.createElement('span');
          chip.className = 'chip';
          chip.textContent = Array.isArray(val) ? '[Array: ' + val.length + ']' : '{Map: ' + Object.keys(val).length + '}';
          wrapper.appendChild(chip);

          const editBtn = document.createElement('button');
          editBtn.className = 'secondary';
          editBtn.style.fontSize = '0.8em';
          editBtn.style.padding = '2px 6px';
          editBtn.textContent = 'Edit JSON';
          editBtn.onclick = function() {
            switchDrawerTab('json');
          };
          wrapper.appendChild(editBtn);
          return wrapper;
        }

        const input = document.createElement('input');
        input.type = typeof val === 'number' ? 'number' : 'text';
        if (typeof val === 'number') input.step = 'any';
        input.className = 'kv-val-input';
        input.value = val !== null && val !== undefined ? String(val) : '';
        input.placeholder = val === null ? 'null' : '';

        input.onchange = function() {
          const raw = input.value.trim();
          if (raw === 'null') onChange(null);
          else if (raw === 'true') onChange(true);
          else if (raw === 'false') onChange(false);
          else if (typeof val === 'number' || (!isNaN(Number(raw)) && raw !== '')) onChange(Number(raw));
          else onChange(input.value);
        };
        return input;
      }

      function syncGridToCurrentVal() {
        // Any active inputs already commit on change, but ensure state is valid
      }

      // Drawer Button Listeners
      document.getElementById('drawerCloseBtn').onclick = closeComplexDrawer;
      document.getElementById('drawerCancelBtn').onclick = closeComplexDrawer;
      document.getElementById('drawerBackdrop').onclick = closeComplexDrawer;

      document.getElementById('tabGrid').onclick = () => switchDrawerTab('grid');
      document.getElementById('tabJson').onclick = () => switchDrawerTab('json');

      document.getElementById('kvAddPropertyBtn').onclick = function() {
        if (!drawerCurrentVal) return;
        if (Array.isArray(drawerCurrentVal)) {
          drawerCurrentVal.push('');
        } else {
          let count = 1;
          while (drawerCurrentVal['newKey' + count] !== undefined) {
            count++;
          }
          drawerCurrentVal['newKey' + count] = '';
        }
        renderDrawerGrid();
      };

      document.getElementById('drawerOpenAsTableBtn').onclick = function() {
        if (!drawerDocPath || !drawerField) return;
        vscode.postMessage({
          command: 'openFieldAsTable',
          docPath: drawerDocPath,
          field: drawerField
        });
      };

      document.getElementById('drawerSaveBtn').onclick = function() {
        if (!drawerDocPath || !drawerField) return;

        let finalVal = drawerCurrentVal;
        if (drawerActiveTab === 'json') {
          const raw = document.getElementById('drawerRawJsonInput').value;
          try {
            finalVal = JSON.parse(raw);
          } catch (err) {
            alert('Invalid JSON syntax: ' + err.message);
            return;
          }
        }

        vscode.postMessage({
          command: 'updateField',
          docPath: drawerDocPath,
          field: drawerField,
          value: finalVal
        });

        closeComplexDrawer();
      };

      // ── Cell selection & In-place editing ──────────────────────────────
      let selectedCell = null;
      let activeEditingCell = null;

      function clearSelectedCell() {
        if (selectedCell) {
          selectedCell.classList.remove('selected');
          selectedCell = null;
        }
      }

      function startCellEdit(td) {
        if (!td || activeEditingCell) return;
        const field = td.getAttribute('data-field');
        const type = td.getAttribute('data-type');
        const tr = td.closest('tr');
        if (!tr || !field) return;

        // Open 2-Column Inspector Drawer for complex types
        if (type === 'map' || type === 'array') {
          openComplexDrawer(tr.getAttribute('data-path'), field, type);
          return;
        }

        const docPath = tr.getAttribute('data-path');
        const doc = allLoadedDocs.find(d => d.__path === docPath);
        const originalVal = doc ? doc[field] : undefined;

        activeEditingCell = td;
        td.classList.add('editing');

        if (type === 'boolean') {
          const currentBool = originalVal === true;
          const select = document.createElement('select');
          select.className = 'cell-input';
          const optTrue = document.createElement('option');
          optTrue.value = 'true';
          optTrue.textContent = 'true';
          optTrue.selected = currentBool;
          const optFalse = document.createElement('option');
          optFalse.value = 'false';
          optFalse.textContent = 'false';
          optFalse.selected = !currentBool;
          select.appendChild(optTrue);
          select.appendChild(optFalse);

          td.innerHTML = '';
          td.appendChild(select);
          select.focus();

          function commitBool() {
            const newVal = select.value === 'true';
            finishEdit(newVal);
          }
          select.onchange = commitBool;
          select.onblur = commitBool;
          select.onkeydown = function(e) {
            if (e.key === 'Enter') { e.preventDefault(); commitBool(); }
            if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
          };
          return;
        }

        const input = document.createElement('input');
        input.type = type === 'number' ? 'number' : 'text';
        if (type === 'number') input.step = 'any';
        input.className = 'cell-input';
        input.value = originalVal !== null && originalVal !== undefined ? String(originalVal) : '';

        td.innerHTML = '';
        td.appendChild(input);
        input.focus();
        input.select();

        let isDone = false;
        function finishEdit(forcedVal) {
          if (isDone) return;
          isDone = true;
          activeEditingCell = null;
          td.classList.remove('editing');

          let newVal;
          if (forcedVal !== undefined) {
            newVal = forcedVal;
          } else {
            const raw = input.value.trim();
            if (raw === '' && type !== 'string') {
              newVal = null;
            } else if (raw === 'null') {
              newVal = null;
            } else if (raw === 'true') {
              newVal = true;
            } else if (raw === 'false') {
              newVal = false;
            } else if (type === 'number' || (!isNaN(Number(raw)) && raw !== '' && (type !== 'string' || !isNaN(Number(raw))))) {
              newVal = Number(raw);
            } else {
              newVal = input.value;
            }
          }

          if (newVal === originalVal) {
            td.innerHTML = formatCell(originalVal);
            return;
          }

          // Optimistically show temporary pending state
          td.innerHTML = formatCell(newVal);
          vscode.postMessage({
            command: 'updateField',
            docPath,
            field,
            value: newVal
          });
        }

        function cancelEdit() {
          if (isDone) return;
          isDone = true;
          activeEditingCell = null;
          td.classList.remove('editing');
          td.innerHTML = formatCell(originalVal);
        }

        input.onblur = function() { finishEdit(); };
        input.onkeydown = function(e) {
          if (e.key === 'Enter') {
            e.preventDefault();
            finishEdit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            cancelEdit();
          }
        };
      }

      document.getElementById('table-body').addEventListener('click', function(event) {
        if (event.target.closest('.select-col') || event.target.closest('.row-checkbox')) {
          return;
        }

        // Parent Document link in collection group query
        const parentLink = event.target.closest('.parent-doc-link');
        if (parentLink) {
          const parentPath = parentLink.getAttribute('data-parent');
          if (parentPath) {
            vscode.postMessage({ command: 'openDoc', path: parentPath });
            return;
          }
        }

        // DocumentReference link -> open referenced document directly
        const docRefLink = event.target.closest('.doc-ref-link');
        if (docRefLink) {
          const refPath = docRefLink.getAttribute('data-ref');
          if (refPath) {
            vscode.postMessage({ command: 'openRef', refPath });
            return;
          }
        }

        // Document ID Link or 📄 Doc open button -> open raw JSON document in editor
        const docOpenBtn = event.target.closest('.doc-open-btn');
        const docIdLink = event.target.closest('.doc-id-link');
        if (docOpenBtn || docIdLink) {
          const tr = event.target.closest('tr');
          if (tr) {
            const path = tr.getAttribute('data-path');
            vscode.postMessage({ command: 'openDoc', path });
            return;
          }
        }

        // Data cell selection
        const dataCell = event.target.closest('td.data-cell');
        if (dataCell) {
          if (activeEditingCell && activeEditingCell !== dataCell) {
            return; // currently editing another cell
          }
          clearSelectedCell();
          selectedCell = dataCell;
          dataCell.classList.add('selected');
          return;
        }
      });

      document.getElementById('table-body').addEventListener('dblclick', function(event) {
        if (event.target.closest('.select-col') || event.target.closest('.row-checkbox')) {
          return;
        }
        const dataCell = event.target.closest('td.data-cell');
        if (dataCell) {
          startCellEdit(dataCell);
        }
      });

      // Keyboard navigation & quick edit trigger
      window.addEventListener('keydown', function(event) {
        if (activeEditingCell) return;
        if (!selectedCell) return;

        if (event.key === 'Enter' || event.key === 'F2') {
          event.preventDefault();
          startCellEdit(selectedCell);
          return;
        }

        if (event.key === 'ArrowRight' || event.key === 'Tab') {
          event.preventDefault();
          const next = selectedCell.nextElementSibling;
          if (next && next.classList.contains('data-cell')) {
            clearSelectedCell();
            selectedCell = next;
            selectedCell.classList.add('selected');
          }
          return;
        }

        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          const prev = selectedCell.previousElementSibling;
          if (prev && prev.classList.contains('data-cell')) {
            clearSelectedCell();
            selectedCell = prev;
            selectedCell.classList.add('selected');
          }
          return;
        }

        if (event.key === 'ArrowDown') {
          event.preventDefault();
          const tr = selectedCell.closest('tr');
          const nextTr = tr ? tr.nextElementSibling : null;
          if (nextTr) {
            const idx = Array.from(tr.children).indexOf(selectedCell);
            const targetCell = nextTr.children[idx];
            if (targetCell && targetCell.classList.contains('data-cell')) {
              clearSelectedCell();
              selectedCell = targetCell;
              selectedCell.classList.add('selected');
            }
          }
          return;
        }

        if (event.key === 'ArrowUp') {
          event.preventDefault();
          const tr = selectedCell.closest('tr');
          const prevTr = tr ? tr.previousElementSibling : null;
          if (prevTr) {
            const idx = Array.from(tr.children).indexOf(selectedCell);
            const targetCell = prevTr.children[idx];
            if (targetCell && targetCell.classList.contains('data-cell')) {
              clearSelectedCell();
              selectedCell = targetCell;
              selectedCell.classList.add('selected');
            }
          }
          return;
        }
      });

      document.getElementById('searchInput').addEventListener('keydown', function(event) {
        if (event.key === 'Enter') {
          if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
          document.getElementById('searchBtn').click();
        }
      });

      document.getElementById('jumpInput').addEventListener('keydown', function(event) {
        if (event.key === 'Enter') {
          document.getElementById('jumpBtn').click();
        }
      });

      function triggerLoadMore(count, loadingLabel) {
        setLoadMoreButtonsDisabled(true, loadingLabel || 'Loading...');
        vscode.postMessage({ command: 'loadMore', count });
      }

      const loadMoreBtn = document.getElementById('loadMoreBtn');
      if (loadMoreBtn) {
        loadMoreBtn.onclick = function() {
          triggerLoadMore(undefined, 'Loading...');
        };
      }

      const load50Btn = document.getElementById('load50Btn');
      if (load50Btn) {
        load50Btn.onclick = function() {
          triggerLoadMore(50, 'Loading 50...');
        };
      }

      const load100Btn = document.getElementById('load100Btn');
      if (load100Btn) {
        load100Btn.onclick = function() {
          triggerLoadMore(100, 'Loading 100...');
        };
      }

      const loadAllBtn = document.getElementById('loadAllBtn');
      if (loadAllBtn) {
        loadAllBtn.onclick = function() {
          triggerLoadMore(1000, 'Loading up to 1,000...');
        };
      }

      const emptyCreateDocBtn = document.getElementById('emptyCreateDocBtn');
      if (emptyCreateDocBtn) {
        emptyCreateDocBtn.onclick = function() {
          vscode.postMessage({ command: 'createDoc' });
        };
      }

      const emptyRefreshBtn = document.getElementById('emptyRefreshBtn');
      if (emptyRefreshBtn) {
        emptyRefreshBtn.onclick = function() {
          vscode.postMessage({ command: 'refresh' });
        };
      }

      const emptyClearFilterBtn = document.getElementById('emptyClearFilterBtn');
      if (emptyClearFilterBtn) {
        emptyClearFilterBtn.onclick = function() {
          document.getElementById('clearSearchBtn').click();
        };
      }

      // Tell the extension the page is (re)loaded so it can send the current data.
      vscode.postMessage({ command: 'ready' });
    })();
  `;
}

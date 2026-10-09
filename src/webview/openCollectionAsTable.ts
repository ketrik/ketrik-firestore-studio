import { QueryDocumentSnapshot, Query, WhereFilterOp } from "firebase-admin/firestore";
import * as vscode from "vscode";
import { CollectionItem } from "../explorer/items";
import { ConnectionManager } from "../connections/ConnectionManager";
import openPath from "../commands/openPath";

export interface QueryClause {
  field: string;
  op: WhereFilterOp;
  value: string;
}

export async function openCollectionAsTable(item: CollectionItem) {
  const panel = vscode.window.createWebviewPanel(
    "firestoreCollectionTable",
    `Collection: ${item.collectionId}`,
    vscode.ViewColumn.One,
    {
      enableScripts: true,
    }
  );

  const config = vscode.workspace.getConfiguration("ketrik-firestore-studio");
  const limit = (config.get<number>("pagingLimit") as number) || 10;
  const maxRows = Math.max(1, config.get<number>("maxTableRows") ?? 100);

  let loadedDocs: any[] = [];
  let lastDoc: QueryDocumentSnapshot | null = null;
  let headers: string[] = [];
  let activeQueryClauses: QueryClause[] = [];

  let isLoading = false;

  /**
   * Resolve the collection through the live connection on every query, so the table keeps
   * working after the connection was edited (its old Firestore instance is terminated).
   */
  async function getCollection() {
    const firestore = await ConnectionManager.getInstance().getFirestore(item.connectionId);
    return firestore.collection(item.reference.path);
  }

  function parseFilterValue(valStr: string): any {
    const trimmed = valStr.trim();
    if (trimmed === "true") { return true; }
    if (trimmed === "false") { return false; }
    if (trimmed === "null") { return null; }
    if (!isNaN(Number(trimmed)) && trimmed !== "") {
      return Number(trimmed);
    }
    // Try parsing JSON for array filters (e.g. [1, 2], ["a", "b"])
    if ((trimmed.startsWith("[") && trimmed.endsWith("]")) || (trimmed.startsWith("{") && trimmed.endsWith("}"))) {
      try {
        return JSON.parse(trimmed);
      } catch {}
    }
    return trimmed;
  }

  /** Build an executable Firestore query applying all active where clauses. */
  async function buildBaseQuery(): Promise<Query> {
    let q: Query = await getCollection();
    for (const clause of activeQueryClauses) {
      if (clause.field && clause.op) {
        const parsedVal = parseFilterValue(clause.value);
        q = q.where(clause.field, clause.op, parsedVal);
      }
    }
    return q;
  }

  /** Append the next page of documents from Firestore (never more than `maxRows` in total). */
  async function loadMoreDocs(): Promise<{ newDocs: any[]; hasMore: boolean }> {
    const pageSize = Math.min(limit, maxRows - loadedDocs.length);
    if (pageSize <= 0) {
      return { newDocs: [], hasMore: false };
    }

    try {
      let query = (await buildBaseQuery()).limit(pageSize);
      if (lastDoc) {
        query = query.startAfter(lastDoc);
      }
      const snapshot = await query.get();
      const docs = snapshot.docs.map((doc: QueryDocumentSnapshot) => ({
        ...doc.data(),
        __path: doc.ref.path,
        __id: doc.id,
      }));

      if (docs.length > 0 && headers.length === 0) {
        headers = Object.keys(docs[0]).filter((k) => k !== "__path" && k !== "__id");
      }

      // Merge any new header keys from subsequent pages.
      if (docs.length > 0) {
        const newKeys = Object.keys(docs[0]).filter((k) => k !== "__path" && k !== "__id" && !headers.includes(k));
        if (newKeys.length > 0) {
          headers = [...headers, ...newKeys];
        }
      }

      loadedDocs = loadedDocs.concat(docs);
      if (snapshot.docs.length > 0) {
        lastDoc = snapshot.docs[snapshot.docs.length - 1];
      }

      const reachedCap = loadedDocs.length >= maxRows;
      if (reachedCap && docs.length === pageSize) {
        vscode.window.showInformationMessage(
          `Table shows the first ${maxRows} documents (setting "ketrik-firestore-studio.maxTableRows"). Use Lookup or Query Builder to narrow results.`
        );
      }
      const hasMore = docs.length === pageSize && !reachedCap;
      return { newDocs: docs, hasMore };
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to load documents for '${item.collectionId}': ${err.message}`);
      return { newDocs: [], hasMore: false };
    }
  }

  /**
   * Search over already-loaded documents.
   */
  function filterDocs(value: string): any[] {
    return loadedDocs.filter((doc) =>
      Object.entries(doc).some(([key, val]) => {
        if (key === "__path") { return false; }
        if (key === "__id" && typeof val === "string") {
          return val.toLowerCase().includes(value);
        }
        return typeof val === "string"
          ? val.toLowerCase().includes(value)
          : typeof val === "object" && val !== null
          ? JSON.stringify(val).toLowerCase().includes(value)
          : false;
      })
    );
  }

  /** Build the initial full-page HTML (sent only once on first load). */
  function buildInitialHtml(): string {
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Collection: ${item.collectionId}</title>
        <style>
          :root {
            --font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif);
            --mono-font: var(--vscode-editor-font-family, SFMono-Regular, Consolas, "Liberation Mono", Menlo, Courier, monospace);
          }
          * {
            box-sizing: border-box;
          }
          body {
            font-family: var(--font-family);
            background: var(--vscode-editor-background);
            margin: 0;
            padding: 20px 24px 36px 24px;
            color: var(--vscode-editor-foreground);
            font-size: var(--vscode-font-size, 13px);
            line-height: 1.5;
          }
          .toolbar {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 12px;
            gap: 16px;
            flex-wrap: wrap;
            border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-panel-border, rgba(128,128,128,0.2)));
            padding-bottom: 14px;
          }
          .title-area {
            display: flex;
            align-items: center;
            gap: 10px;
          }
          h1 {
            font-size: 1.35em;
            margin: 0;
            font-weight: 600;
            letter-spacing: -0.01em;
            display: flex;
            align-items: center;
            gap: 8px;
          }
          .collection-name {
            color: var(--vscode-editor-foreground);
          }
          .badge {
            font-size: 0.7em;
            padding: 3px 8px;
            border-radius: 12px;
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            font-weight: 500;
            border: 1px solid var(--vscode-widget-border, transparent);
            letter-spacing: 0.02em;
          }
          .toolbar-actions {
            display: flex;
            gap: 8px;
            align-items: center;
            flex-wrap: wrap;
          }
          .search-wrapper {
            position: relative;
            display: flex;
            align-items: center;
          }
          input[type="text"], select {
            padding: 6px 12px;
            border-radius: 4px;
            border: 1px solid var(--vscode-input-border, rgba(128,128,128,0.3));
            font-size: 0.95em;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            outline: none;
            transition: border-color 0.15s ease, box-shadow 0.15s ease;
          }
          input[type="text"]:focus, select:focus {
            border-color: var(--vscode-focusBorder);
            box-shadow: 0 0 0 1px var(--vscode-focusBorder);
          }
          input[type="text"]::placeholder {
            color: var(--vscode-input-placeholderForeground);
          }
          button {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: 1px solid var(--vscode-button-border, transparent);
            border-radius: 4px;
            padding: 6px 14px;
            font-size: 0.92em;
            font-weight: 500;
            cursor: pointer;
            transition: background 0.12s ease, transform 0.05s ease;
            user-select: none;
          }
          button:hover {
            background: var(--vscode-button-hoverBackground);
          }
          button:active {
            transform: scale(0.98);
          }
          button:disabled {
            opacity: 0.45;
            cursor: not-allowed;
            transform: none;
          }
          button.secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: 1px solid var(--vscode-button-border, transparent);
          }
          button.secondary:hover {
            background: var(--vscode-button-secondaryHoverBackground);
          }
          button.icon-btn {
            padding: 5px 8px;
            font-size: 0.85em;
          }
          .query-builder-panel {
            background: var(--vscode-editorWidget-background, rgba(128,128,128,0.06));
            border: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.25));
            border-radius: 6px;
            padding: 12px 16px;
            margin-bottom: 14px;
          }
          .query-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 10px;
            font-weight: 600;
            font-size: 0.9em;
          }
          .clause-row {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 8px;
            flex-wrap: wrap;
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
          .info-bar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 12px;
            font-size: 0.88em;
            color: var(--vscode-descriptionForeground);
          }
          .info-text b {
            color: var(--vscode-editor-foreground);
          }
          .search-note {
            font-style: italic;
            opacity: 0.85;
          }
          .table-container {
            overflow: auto;
            max-height: calc(100vh - 240px);
            border-radius: 6px;
            border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border, rgba(128,128,128,0.25)));
            background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
            box-shadow: 0 2px 8px rgba(0,0,0,0.08);
          }
          table {
            width: 100%;
            border-collapse: collapse;
            font-variant-numeric: tabular-nums;
          }
          th, td {
            padding: 9px 14px;
            text-align: left;
            border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-panel-border, rgba(128,128,128,0.18)));
            font-size: 0.92em;
            max-width: 320px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          th {
            background: var(--vscode-editorGroupHeader-tabsBackground, var(--vscode-sideBar-background, rgba(128,128,128,0.1)));
            font-weight: 600;
            color: var(--vscode-editor-foreground);
            position: sticky;
            top: 0;
            z-index: 2;
            letter-spacing: 0.02em;
            text-transform: uppercase;
            font-size: 0.78em;
            border-bottom: 2px solid var(--vscode-focusBorder, rgba(128,128,128,0.3));
          }
          th.id-header {
            width: 190px;
            min-width: 170px;
          }
          tbody tr {
            transition: background 0.1s ease;
          }
          tbody tr:nth-child(even) {
            background: rgba(128, 128, 128, 0.035);
          }
          tbody tr:hover {
            background: var(--vscode-list-hoverBackground, rgba(128, 128, 128, 0.12));
            cursor: pointer;
          }
          .doc-id-cell {
            font-family: var(--mono-font);
            font-size: 0.88em;
            font-weight: 600;
            color: var(--vscode-textLink-foreground, #3794ff);
            display: flex;
            align-items: center;
            gap: 6px;
          }
          .doc-id-cell svg {
            flex-shrink: 0;
            opacity: 0.7;
          }
          .chip {
            display: inline-block;
            font-family: var(--mono-font);
            font-size: 0.85em;
            padding: 2px 6px;
            border-radius: 3px;
            background: var(--vscode-badge-background, rgba(128, 128, 128, 0.15));
            color: var(--vscode-badge-foreground, inherit);
            max-width: 280px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            vertical-align: middle;
            border: 1px solid var(--vscode-widget-border, transparent);
          }
          .empty-state {
            padding: 48px 24px;
            text-align: center;
            color: var(--vscode-descriptionForeground);
          }
          .empty-state svg {
            margin-bottom: 12px;
            opacity: 0.5;
          }
          .empty-state h3 {
            margin: 0 0 6px 0;
            color: var(--vscode-editor-foreground);
            font-weight: 500;
          }
          .empty-state p {
            margin: 0;
            font-size: 0.9em;
          }
          .actions {
            margin-top: 16px;
            display: flex;
            align-items: center;
            justify-content: center;
          }
        </style>
      </head>
      <body>
        <div class="toolbar">
          <div class="title-area">
            <h1>
              <span>📁</span>
              <span class="collection-name">${item.collectionId}</span>
            </h1>
            <span class="badge" title="Connection ID">${item.connectionId}</span>
          </div>
          <div class="toolbar-actions">
            <button id="toggleFilterBtn" class="secondary" title="Filter collection with server-side where query">
              <span>🔍</span> Query Filter
            </button>
            <div class="search-wrapper">
              <input id="searchInput" type="text" placeholder="Search loaded docs..." style="min-width: 180px;" />
            </div>
            <button id="searchBtn">Search</button>
            <button id="clearSearchBtn" class="secondary" style="display:none;">Clear</button>
            <div style="display:flex; align-items:center; gap:6px; margin-left:4px;">
              <input id="jumpInput" type="text" placeholder="Lookup Doc ID..." style="min-width:140px; max-width:180px;" />
              <button id="jumpBtn" class="secondary" title="Direct 1-read document lookup on server">Lookup</button>
            </div>
            <button id="exportBtn" class="secondary" title="Export as JSON file">
              <span>⬇</span> Export JSON
            </button>
          </div>
        </div>

        <div id="queryBuilderPanel" class="query-builder-panel" style="display:none;">
          <div class="query-header">
            <span>Server-Side Firestore Query Builder</span>
            <div style="display:flex; gap:8px;">
              <button id="addClauseBtn" class="secondary icon-btn">+ Add Clause</button>
              <button id="runQueryBtn">Run Query</button>
              <button id="resetQueryBtn" class="secondary">Reset</button>
            </div>
          </div>
          <div id="clauseList"></div>
        </div>

        <div class="info-bar">
          <div class="info-text">
            Showing <b id="doc-count">0</b> documents
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
          <div>Click any row to open and edit in VS Code</div>
        </div>

        <div class="table-container">
          <table>
            <thead id="table-head"><tr></tr></thead>
            <tbody id="table-body"></tbody>
          </table>
          <div id="empty-state" class="empty-state" style="display:none;">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M4 4h16v16H4zM4 9h16M9 4v16"/>
            </svg>
            <h3>No documents found</h3>
            <p id="empty-state-msg">This collection has no documents or no matches matched your query.</p>
          </div>
        </div>

        <div class="actions">
          <button id="loadMoreBtn" style="display:none;">Load More Documents</button>
        </div>

        <script>
          (function() {
            const vscode = acquireVsCodeApi();
            let isSearchMode = false;
            let isServerQueryMode = false;
            let currentHeaders = [];

            // ── helpers ──────────────────────────────────────────────────────
            function escapeHtml(val) {
              if (val === null || val === undefined) { return ''; }
              return String(val)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');
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
                return '<span class="chip">' + escapeHtml(JSON.stringify(value)) + '</span>';
              }
              if (typeof value === "boolean") {
                return '<span class="chip" style="font-weight:600;">' + (value ? 'true' : 'false') + '</span>';
              }
              return escapeHtml(String(value));
            }

            function renderRows(docs, headers) {
              return docs.map(doc => {
                const docId = doc.__id || (doc.__path ? doc.__path.split('/').pop() : '');
                const idCell = '<td><div class="doc-id-cell">' +
                  '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M4 1h8l3 3v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1zm7 1v3h3L11 2z"/></svg>' +
                  '<span>' + escapeHtml(docId) + '</span></div></td>';

                const dataCells = headers.map(h => {
                  return '<td>' + formatCell(doc[h]) + '</td>';
                }).join('');

                return '<tr data-path="' + escapeHtml(doc.__path || '') + '">' + idCell + dataCells + '</tr>';
              }).join('');
            }

            function updateEmptyState(count, customMsg) {
              const emptyState = document.getElementById('empty-state');
              const msgEl = document.getElementById('empty-state-msg');
              if (count === 0) {
                if (customMsg) {
                  msgEl.textContent = customMsg;
                } else {
                  msgEl.textContent = 'This collection has no documents or no matches matched your query.';
                }
                emptyState.style.display = 'block';
              } else {
                emptyState.style.display = 'none';
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
                { val: 'not-in', label: 'not-in' }
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

            // ── message handler ───────────────────────────────────────────
            window.addEventListener('message', function(event) {
              const msg = event.data;

              if (msg.type === 'init') {
                currentHeaders = msg.headers || [];
                const headRow = '<th class="id-header">Document ID</th>' +
                  currentHeaders.map(h => '<th>' + escapeHtml(h) + '</th>').join('');
                document.getElementById('table-head').innerHTML = '<tr>' + headRow + '</tr>';
                document.getElementById('table-body').innerHTML = renderRows(msg.docs, currentHeaders);
                document.getElementById('doc-count').textContent = msg.docs.length;
                document.getElementById('loadMoreBtn').style.display = msg.hasMore ? '' : 'none';
                updateEmptyState(msg.docs.length);
              }

              if (msg.type === 'appendRows') {
                const tbody = document.getElementById('table-body');
                currentHeaders = msg.headers || currentHeaders;
                if (msg.headersChanged) {
                  const headRow = '<th class="id-header">Document ID</th>' +
                    currentHeaders.map(h => '<th>' + escapeHtml(h) + '</th>').join('');
                  document.getElementById('table-head').innerHTML = '<tr>' + headRow + '</tr>';
                  tbody.innerHTML = renderRows(msg.allDocs, currentHeaders);
                } else {
                  tbody.innerHTML += renderRows(msg.newDocs, currentHeaders);
                }
                document.getElementById('doc-count').textContent = msg.totalCount;
                document.getElementById('loadMoreBtn').style.display = msg.hasMore ? '' : 'none';
                document.getElementById('loadMoreBtn').disabled = false;
                updateEmptyState(msg.totalCount);
              }

              if (msg.type === 'searchResults') {
                isSearchMode = true;
                document.getElementById('table-body').innerHTML = renderRows(msg.docs, msg.headers);
                document.getElementById('doc-count').textContent = msg.docs.length;
                document.getElementById('loadMoreBtn').style.display = 'none';
                document.getElementById('clearSearchBtn').style.display = '';
                document.getElementById('search-note').style.display = '';
                document.getElementById('lookup-note').style.display = 'none';
                updateEmptyState(msg.docs.length);
              }

              if (msg.type === 'lookupResult') {
                isSearchMode = true;
                currentHeaders = msg.headers || currentHeaders;
                const headRow = '<th class="id-header">Document ID</th>' +
                  currentHeaders.map(h => '<th>' + escapeHtml(h) + '</th>').join('');
                document.getElementById('table-head').innerHTML = '<tr>' + headRow + '</tr>';
                document.getElementById('table-body').innerHTML = renderRows([msg.doc], currentHeaders);
                document.getElementById('doc-count').textContent = '1';
                document.getElementById('loadMoreBtn').style.display = 'none';
                document.getElementById('clearSearchBtn').style.display = '';
                document.getElementById('search-note').style.display = 'none';
                document.getElementById('lookup-note').style.display = '';
                updateEmptyState(1);
              }

              if (msg.type === 'lookupNotFound') {
                isSearchMode = true;
                document.getElementById('table-body').innerHTML = '';
                document.getElementById('doc-count').textContent = '0';
                document.getElementById('loadMoreBtn').style.display = 'none';
                document.getElementById('clearSearchBtn').style.display = '';
                document.getElementById('search-note').style.display = 'none';
                document.getElementById('lookup-note').style.display = '';
                updateEmptyState(0, "Document '" + msg.docId + "' was not found in Firestore.");
              }

              if (msg.type === 'clearSearch') {
                isSearchMode = false;
                currentHeaders = msg.headers || currentHeaders;
                const headRow = '<th class="id-header">Document ID</th>' +
                  currentHeaders.map(h => '<th>' + escapeHtml(h) + '</th>').join('');
                document.getElementById('table-head').innerHTML = '<tr>' + headRow + '</tr>';
                document.getElementById('table-body').innerHTML = renderRows(msg.docs, currentHeaders);
                document.getElementById('doc-count').textContent = msg.docs.length;
                document.getElementById('loadMoreBtn').style.display = msg.hasMore ? '' : 'none';
                document.getElementById('clearSearchBtn').style.display = '';
                if (!isServerQueryMode) {
                  document.getElementById('clearSearchBtn').style.display = 'none';
                }
                document.getElementById('search-note').style.display = 'none';
                document.getElementById('lookup-note').style.display = 'none';
                document.getElementById('searchInput').value = '';
                document.getElementById('jumpInput').value = '';
                updateEmptyState(msg.docs.length);
              }

              if (msg.type === 'queryResult') {
                isServerQueryMode = msg.isActive;
                isSearchMode = false;
                currentHeaders = msg.headers || [];
                const headRow = '<th class="id-header">Document ID</th>' +
                  currentHeaders.map(h => '<th>' + escapeHtml(h) + '</th>').join('');
                document.getElementById('table-head').innerHTML = '<tr>' + headRow + '</tr>';
                document.getElementById('table-body').innerHTML = renderRows(msg.docs, currentHeaders);
                document.getElementById('doc-count').textContent = msg.docs.length;
                document.getElementById('loadMoreBtn').style.display = msg.hasMore ? '' : 'none';
                document.getElementById('loadMoreBtn').disabled = false;
                document.getElementById('search-note').style.display = 'none';
                document.getElementById('lookup-note').style.display = 'none';
                document.getElementById('query-note').style.display = isServerQueryMode ? '' : 'none';
                document.getElementById('clearSearchBtn').style.display = isServerQueryMode ? '' : 'none';
                updateEmptyState(msg.docs.length, isServerQueryMode ? "No documents match the specified where clauses." : undefined);
              }
            });

            // ── button handlers ───────────────────────────────────────────
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
              vscode.postMessage({ command: 'runServerQuery', clauses });
            };

            document.getElementById('resetQueryBtn').onclick = function() {
              document.getElementById('clauseList').innerHTML = '';
              createClauseRow();
              vscode.postMessage({ command: 'resetServerQuery' });
            };

            document.getElementById('exportBtn').onclick = function() {
              const rows = Array.from(document.querySelectorAll('#table-body tr'));
              const headers = Array.from(document.querySelectorAll('thead th')).map(th => th.textContent.trim());
              const data = rows.map(row => {
                const cells = Array.from(row.children);
                const obj = {};
                headers.forEach((h, i) => {
                  try { obj[h] = JSON.parse(cells[i].textContent); }
                  catch { obj[h] = cells[i].textContent; }
                });
                return obj;
              });
              vscode.postMessage({ command: 'exportJson', data });
            };

            document.getElementById('searchBtn').onclick = function() {
              const value = document.getElementById('searchInput').value.trim();
              vscode.postMessage({ command: 'search', value });
            };

            document.getElementById('jumpBtn').onclick = function() {
              const docId = document.getElementById('jumpInput').value.trim();
              if (docId) {
                vscode.postMessage({ command: 'jumpToId', docId });
              }
            };

            document.getElementById('clearSearchBtn').onclick = function() {
              vscode.postMessage({ command: 'clearSearch' });
            };

            document.getElementById('loadMoreBtn').onclick = function() {
              this.disabled = true;
              vscode.postMessage({ command: 'loadMore' });
            };

            document.getElementById('table-body').addEventListener('click', function(event) {
              const target = event.target.closest('tr');
              if (target) {
                const path = target.getAttribute('data-path');
                vscode.postMessage({ command: 'openDoc', path });
              }
            });

            document.getElementById('searchInput').addEventListener('keydown', function(event) {
              if (event.key === 'Enter') {
                document.getElementById('searchBtn').click();
              }
            });

            document.getElementById('jumpInput').addEventListener('keydown', function(event) {
              if (event.key === 'Enter') {
                document.getElementById('jumpBtn').click();
              }
            });

            // Tell the extension the page is (re)loaded so it can send the current data.
            vscode.postMessage({ command: 'ready' });
          })();
        </script>
      </body>
      </html>
    `;
  }

  // ── Initial load ──────────────────────────────────────────────────────────
  panel.webview.html = buildInitialHtml();

  // Start the first data fetch immediately; the webview is seeded once it reports 'ready'.
  let hasMoreState = false;
  const initialLoad = loadMoreDocs().then((r) => {
    hasMoreState = r.hasMore;
  });

  // ── Message handler ───────────────────────────────────────────────────────
  const messageSubscription = panel.webview.onDidReceiveMessage(async (message) => {
    if (message.command === "ready") {
      // Sent on every (re)load of the webview, e.g. when a hidden tab becomes visible again.
      await initialLoad;
      panel.webview.postMessage({
        type: "init",
        headers,
        docs: loadedDocs,
        hasMore: hasMoreState,
      });
      return;
    }

    if (message.command === "loadMore") {
      if (isLoading) {
        return;
      }
      isLoading = true;
      try {
        const prevHeaders = [...headers];
        const { newDocs, hasMore } = await loadMoreDocs();
        hasMoreState = hasMore;
        const headersChanged = headers.length !== prevHeaders.length;

        panel.webview.postMessage({
          type: "appendRows",
          headers,
          headersChanged,
          newDocs,
          allDocs: headersChanged ? loadedDocs : undefined,
          totalCount: loadedDocs.length,
          hasMore,
        });
      } finally {
        isLoading = false;
      }
    }

    if (message.command === "runServerQuery") {
      activeQueryClauses = (message.clauses as QueryClause[]) || [];
      loadedDocs = [];
      lastDoc = null;
      headers = [];
      isLoading = true;

      try {
        const { newDocs, hasMore } = await loadMoreDocs();
        hasMoreState = hasMore;
        panel.webview.postMessage({
          type: "queryResult",
          isActive: true,
          headers,
          docs: newDocs,
          hasMore,
        });
      } finally {
        isLoading = false;
      }
    }

    if (message.command === "resetServerQuery") {
      activeQueryClauses = [];
      loadedDocs = [];
      lastDoc = null;
      headers = [];
      isLoading = true;

      try {
        const { newDocs, hasMore } = await loadMoreDocs();
        hasMoreState = hasMore;
        panel.webview.postMessage({
          type: "queryResult",
          isActive: false,
          headers,
          docs: newDocs,
          hasMore,
        });
      } finally {
        isLoading = false;
      }
    }

    if (message.command === "openDoc" && message.path) {
      openPath(message.path, item.connectionId);
    }

    if (message.command === "exportJson") {
      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(`${item.collectionId}_export.json`),
        filters: { JSON: ["json"] },
      });
      if (uri) {
        await vscode.workspace.fs.writeFile(
          uri,
          Buffer.from(JSON.stringify(message.data, null, 2))
        );
        vscode.window.showInformationMessage("Exported JSON successfully!");
      }
    }

    if (message.command === "search") {
      const value = (message.value as string).trim().toLowerCase();
      if (!value) {
        panel.webview.postMessage({
          type: "clearSearch",
          headers,
          docs: loadedDocs,
          hasMore: hasMoreState,
        });
        return;
      }
      const filtered = filterDocs(value);
      panel.webview.postMessage({
        type: "searchResults",
        headers,
        docs: filtered,
      });
    }

    if (message.command === "jumpToId") {
      const docId = (message.docId as string || "").trim();
      if (!docId) {
        return;
      }
      try {
        const docRef = (await getCollection()).doc(docId);
        const snapshot = await docRef.get();
        if (!snapshot.exists) {
          panel.webview.postMessage({
            type: "lookupNotFound",
            docId,
          });
          return;
        }

        const docData = {
          ...snapshot.data(),
          __path: snapshot.ref.path,
          __id: snapshot.id,
        };

        const docKeys = Object.keys(snapshot.data() || {});
        const newHeaders = [...headers];
        for (const k of docKeys) {
          if (!newHeaders.includes(k)) {
            newHeaders.push(k);
          }
        }
        headers = newHeaders;

        panel.webview.postMessage({
          type: "lookupResult",
          headers,
          doc: docData,
        });
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to lookup document '${docId}': ${err.message}`);
      }
    }

    if (message.command === "clearSearch") {
      panel.webview.postMessage({
        type: "clearSearch",
        headers,
        docs: loadedDocs,
        hasMore: hasMoreState,
      });
    }
  });

  panel.onDidDispose(() => {
    messageSubscription.dispose();
    loadedDocs = [];
    headers = [];
    lastDoc = null;
    activeQueryClauses = [];
  });
}
import * as vscode from "vscode";
import { DocumentFieldItem } from "../explorer/items";
import openPath from "../commands/openPath";

/**
 * Open a DocumentFieldItem (Record<string, T> or T[]) as an interactive virtual Collection Table.
 *
 * Implements the Dual-Contract perspective:
 * - If Record<string, T> (Keyed Map / Registry): Dictionary keys become Row IDs.
 * - If T[] (Sequence / Array): Array indices or item.id become Row IDs.
 */
export async function openFieldAsTable(item: DocumentFieldItem) {
  const isArray = Array.isArray(item.value);
  const panelTitle = isArray
    ? `Array: ${item.fieldName} [${item.value?.length ?? 0}]`
    : `Registry: ${item.fieldName}`;

  const panel = vscode.window.createWebviewPanel(
    "firestoreFieldTable",
    panelTitle,
    vscode.ViewColumn.One,
    {
      enableScripts: true,
    }
  );

  let rawData = item.value;
  let rows: any[] = [];
  let headers: string[] = [];

  function parseRows(data: any): { rows: any[]; headers: string[] } {
    const parsedRows: any[] = [];
    const headerSet = new Set<string>();

    if (Array.isArray(data)) {
      data.forEach((entry, index) => {
        let rowObj: any = {};
        let rowId = String(index);

        if (entry !== null && typeof entry === "object") {
          rowObj = { ...entry };
          if ("id" in entry && (typeof entry.id === "string" || typeof entry.id === "number")) {
            rowId = String(entry.id);
          }
        } else {
          rowObj = { value: entry };
        }

        rowObj.__id = rowId;
        rowObj.__index = index;
        rowObj.__path = `${item.parentDocRef.path}/${item.fieldName}`;

        Object.keys(rowObj).forEach((k) => {
          if (k !== "__id" && k !== "__index" && k !== "__path") {
            headerSet.add(k);
          }
        });

        parsedRows.push(rowObj);
      });
    } else if (data !== null && typeof data === "object") {
      Object.entries(data).forEach(([key, val]) => {
        let rowObj: any = {};
        if (val !== null && typeof val === "object" && !Array.isArray(val)) {
          rowObj = { ...val };
        } else {
          rowObj = { value: val };
        }

        rowObj.__id = key;
        rowObj.__path = `${item.parentDocRef.path}/${item.fieldName}`;

        Object.keys(rowObj).forEach((k) => {
          if (k !== "__id" && k !== "__path") {
            headerSet.add(k);
          }
        });

        parsedRows.push(rowObj);
      });
    }

    return {
      rows: parsedRows,
      headers: Array.from(headerSet),
    };
  }

  const parsed = parseRows(rawData);
  rows = parsed.rows;
  headers = parsed.headers;

  function filterRows(searchTerm: string): any[] {
    const term = searchTerm.toLowerCase();
    return rows.filter((row) =>
      Object.entries(row).some(([key, val]) => {
        if (key === "__path" || key === "__index") {
          return false;
        }
        if (key === "__id" && typeof val === "string") {
          return val.toLowerCase().includes(term);
        }
        return typeof val === "string"
          ? val.toLowerCase().includes(term)
          : typeof val === "object" && val !== null
          ? JSON.stringify(val).toLowerCase().includes(term)
          : false;
      })
    );
  }

  function buildHtml(): string {
    const docPath = item.parentDocRef.path;
    const fieldName = item.fieldName;
    const substrateType = isArray ? "Sequence (Array)" : "Registry (Keyed Map)";
    const rowIdHeader = isArray ? "Index / ID" : "Key / ID";

    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${panelTitle}</title>
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
            margin-bottom: 16px;
            gap: 16px;
            flex-wrap: wrap;
            border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-panel-border, rgba(128,128,128,0.2)));
            padding-bottom: 16px;
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
          .field-name {
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
          .badge-substrate {
            background: rgba(128, 128, 128, 0.15);
            color: var(--vscode-editor-foreground);
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
          input[type="text"] {
            padding: 6px 12px;
            border-radius: 4px;
            border: 1px solid var(--vscode-input-border, rgba(128,128,128,0.3));
            font-size: 0.95em;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            outline: none;
            min-width: 220px;
            transition: border-color 0.15s ease, box-shadow 0.15s ease;
          }
          input[type="text"]:focus {
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
          button.secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: 1px solid var(--vscode-button-border, transparent);
          }
          button.secondary:hover {
            background: var(--vscode-button-secondaryHoverBackground);
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
          .doc-parent-link {
            cursor: pointer;
            color: var(--vscode-textLink-foreground, #3794ff);
            text-decoration: underline;
          }
          .table-container {
            overflow: auto;
            max-height: calc(100vh - 210px);
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
          .row-id-cell {
            font-family: var(--mono-font);
            font-size: 0.88em;
            font-weight: 600;
            color: var(--vscode-textLink-foreground, #3794ff);
            display: flex;
            align-items: center;
            gap: 6px;
          }
          .row-id-cell svg {
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
        </style>
      </head>
      <body>
        <div class="toolbar">
          <div class="title-area">
            <h1>
              <span>${isArray ? "📑" : "🗂️"}</span>
              <span class="field-name">${fieldName}</span>
            </h1>
            <span class="badge badge-substrate">${substrateType}</span>
            <span class="badge" title="Connection ID">${item.connectionId}</span>
          </div>
          <div class="toolbar-actions">
            <div class="search-wrapper">
              <input id="searchInput" type="text" placeholder="Search rows..." />
            </div>
            <button id="searchBtn">Search</button>
            <button id="clearSearchBtn" class="secondary" style="display:none;">Clear</button>
            <button id="openInEditorBtn" class="secondary" title="Open raw field in JSON editor">
              <span>{ }</span> Edit JSON
            </button>
            <button id="exportBtn" class="secondary" title="Export as JSON file">
              <span>⬇</span> Export JSON
            </button>
          </div>
        </div>
        <div class="info-bar">
          <div class="info-text">
            Parent doc: <span class="doc-parent-link" id="parentDocLink">${docPath}</span> &nbsp;|&nbsp;
            Showing <b id="row-count">0</b> items
            <span id="search-note" style="display:none; font-style:italic; opacity:0.85;">
              — (Filtered)
            </span>
          </div>
          <div>Click any row or 'Edit JSON' to edit in VS Code</div>
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
            <h3>No items found</h3>
            <p id="empty-state-msg">This field has no items or no items matched your search query.</p>
          </div>
        </div>

        <script>
          (function() {
            const vscode = acquireVsCodeApi();

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

            function renderRows(rows, headers) {
              return rows.map(row => {
                const rowId = row.__id || '';
                const idCell = '<td><div class="row-id-cell">' +
                  '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M4 1h8l3 3v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1zm7 1v3h3L11 2z"/></svg>' +
                  '<span>' + escapeHtml(rowId) + '</span></div></td>';

                const dataCells = headers.map(h => {
                  return '<td>' + formatCell(row[h]) + '</td>';
                }).join('');

                return '<tr data-id="' + escapeHtml(rowId) + '">' + idCell + dataCells + '</tr>';
              }).join('');
            }

            function updateEmptyState(count) {
              const emptyState = document.getElementById('empty-state');
              if (count === 0) {
                emptyState.style.display = 'block';
              } else {
                emptyState.style.display = 'none';
              }
            }

            window.addEventListener('message', function(event) {
              const msg = event.data;

              if (msg.type === 'init' || msg.type === 'clearSearch') {
                const headRow = '<th class="id-header">${rowIdHeader}</th>' +
                  msg.headers.map(h => '<th>' + escapeHtml(h) + '</th>').join('');
                document.getElementById('table-head').innerHTML = '<tr>' + headRow + '</tr>';
                document.getElementById('table-body').innerHTML = renderRows(msg.rows, msg.headers);
                document.getElementById('row-count').textContent = msg.rows.length;
                document.getElementById('search-note').style.display = 'none';
                document.getElementById('clearSearchBtn').style.display = 'none';
                document.getElementById('searchInput').value = '';
                updateEmptyState(msg.rows.length);
              }

              if (msg.type === 'searchResults') {
                document.getElementById('table-body').innerHTML = renderRows(msg.rows, msg.headers);
                document.getElementById('row-count').textContent = msg.rows.length;
                document.getElementById('search-note').style.display = '';
                document.getElementById('clearSearchBtn').style.display = '';
                updateEmptyState(msg.rows.length);
              }
            });

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

            document.getElementById('clearSearchBtn').onclick = function() {
              vscode.postMessage({ command: 'clearSearch' });
            };

            document.getElementById('openInEditorBtn').onclick = function() {
              vscode.postMessage({ command: 'openFieldInEditor' });
            };

            document.getElementById('parentDocLink').onclick = function() {
              vscode.postMessage({ command: 'openParentDoc' });
            };

            document.getElementById('table-body').addEventListener('click', function(event) {
              vscode.postMessage({ command: 'openFieldInEditor' });
            });

            document.getElementById('searchInput').addEventListener('keydown', function(event) {
              if (event.key === 'Enter') {
                document.getElementById('searchBtn').click();
              }
            });

            vscode.postMessage({ command: 'ready' });
          })();
        </script>
      </body>
      </html>
    `;
  }

  panel.webview.html = buildHtml();

  const messageSubscription = panel.webview.onDidReceiveMessage(async (message) => {
    if (message.command === "ready") {
      panel.webview.postMessage({
        type: "init",
        headers,
        rows,
      });
      return;
    }

    if (message.command === "search") {
      const term = (message.value as string).trim();
      if (!term) {
        panel.webview.postMessage({
          type: "clearSearch",
          headers,
          rows,
        });
        return;
      }
      const filtered = filterRows(term);
      panel.webview.postMessage({
        type: "searchResults",
        headers,
        rows: filtered,
      });
      return;
    }

    if (message.command === "clearSearch") {
      panel.webview.postMessage({
        type: "clearSearch",
        headers,
        rows,
      });
      return;
    }

    if (message.command === "openFieldInEditor") {
      openPath(item.parentDocRef.path, item.connectionId, item.fieldName);
      return;
    }

    if (message.command === "openParentDoc") {
      openPath(item.parentDocRef.path, item.connectionId);
      return;
    }

    if (message.command === "exportJson") {
      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(`${item.fieldName}_export.json`),
        filters: { JSON: ["json"] },
      });
      if (uri) {
        await vscode.workspace.fs.writeFile(
          uri,
          Buffer.from(JSON.stringify(message.data, null, 2))
        );
        vscode.window.showInformationMessage("Exported JSON successfully!");
      }
      return;
    }
  });

  panel.onDidDispose(() => {
    messageSubscription.dispose();
    rows = [];
    headers = [];
  });
}

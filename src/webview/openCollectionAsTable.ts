import { QueryDocumentSnapshot } from "firebase-admin/firestore";
import * as vscode from "vscode";
import { CollectionItem } from "../explorer/items";
import { ConnectionManager } from "../connections/ConnectionManager";
import openPath from "../commands/openPath";

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

  let isLoading = false;

  /**
   * Resolve the collection through the live connection on every query, so the table keeps
   * working after the connection was edited (its old Firestore instance is terminated).
   */
  async function getCollection() {
    const firestore = await ConnectionManager.getInstance().getFirestore(item.connectionId);
    return firestore.collection(item.reference.path);
  }

  /** Append the next page of documents from Firestore (never more than `maxRows` in total). */
  async function loadMoreDocs(): Promise<{ newDocs: any[]; hasMore: boolean }> {
    const pageSize = Math.min(limit, maxRows - loadedDocs.length);
    if (pageSize <= 0) {
      return { newDocs: [], hasMore: false };
    }

    try {
      let query = (await getCollection()).limit(pageSize);
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
          `Table shows the first ${maxRows} documents (setting "ketrik-firestore-studio.maxTableRows"). Use Lookup to fetch a specific document.`
        );
      }
      const hasMore = docs.length === pageSize && !reachedCap;
      return { newDocs: docs, hasMore };
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to load collection '${item.collectionId}': ${err.message}`);
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
          input[type="text"] {
            padding: 6px 12px;
            border-radius: 4px;
            border: 1px solid var(--vscode-input-border, rgba(128,128,128,0.3));
            font-size: 0.95em;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            outline: none;
            min-width: 240px;
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
            <div class="search-wrapper">
              <input id="searchInput" type="text" placeholder="Search loaded docs..." />
            </div>
            <button id="searchBtn">Search</button>
            <button id="clearSearchBtn" class="secondary" style="display:none;">Clear</button>
            <div style="display:flex; align-items:center; gap:6px; margin-left:4px;">
              <input id="jumpInput" type="text" placeholder="Lookup Doc ID..." style="min-width:160px; max-width:200px;" />
              <button id="jumpBtn" class="secondary" title="Direct 1-read document lookup on server">Lookup</button>
            </div>
            <button id="exportBtn" class="secondary" title="Export as JSON file">
              <span>⬇</span> Export JSON
            </button>
          </div>
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
            <p id="empty-state-msg">This collection has no documents or no matches matched your search query.</p>
          </div>
        </div>
        <div class="actions">
          <button id="loadMoreBtn" style="display:none;">Load More Documents</button>
        </div>
        <script>
          (function() {
            const vscode = acquireVsCodeApi();
            let isSearchMode = false;

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
                // Handle Firestore Timestamp objects
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
                  msgEl.textContent = 'This collection has no documents or no matches matched your search query.';
                }
                emptyState.style.display = 'block';
              } else {
                emptyState.style.display = 'none';
              }
            }

            // ── message handler ───────────────────────────────────────────
            window.addEventListener('message', function(event) {
              const msg = event.data;

              if (msg.type === 'init') {
                const headRow = '<th class="id-header">Document ID</th>' +
                  msg.headers.map(h => '<th>' + escapeHtml(h) + '</th>').join('');
                document.getElementById('table-head').innerHTML = '<tr>' + headRow + '</tr>';
                document.getElementById('table-body').innerHTML = renderRows(msg.docs, msg.headers);
                document.getElementById('doc-count').textContent = msg.docs.length;
                document.getElementById('loadMoreBtn').style.display = msg.hasMore ? '' : 'none';
                updateEmptyState(msg.docs.length);
              }

              if (msg.type === 'appendRows') {
                const tbody = document.getElementById('table-body');
                if (msg.headersChanged) {
                  const headRow = '<th class="id-header">Document ID</th>' +
                    msg.headers.map(h => '<th>' + escapeHtml(h) + '</th>').join('');
                  document.getElementById('table-head').innerHTML = '<tr>' + headRow + '</tr>';
                  tbody.innerHTML = renderRows(msg.allDocs, msg.headers);
                } else {
                  tbody.innerHTML += renderRows(msg.newDocs, msg.headers);
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
                const headRow = '<th class="id-header">Document ID</th>' +
                  msg.headers.map(h => '<th>' + escapeHtml(h) + '</th>').join('');
                document.getElementById('table-head').innerHTML = '<tr>' + headRow + '</tr>';
                document.getElementById('table-body').innerHTML = renderRows([msg.doc], msg.headers);
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
                document.getElementById('table-body').innerHTML = renderRows(msg.docs, msg.headers);
                document.getElementById('doc-count').textContent = msg.docs.length;
                document.getElementById('loadMoreBtn').style.display = msg.hasMore ? '' : 'none';
                document.getElementById('clearSearchBtn').style.display = 'none';
                document.getElementById('search-note').style.display = 'none';
                document.getElementById('lookup-note').style.display = 'none';
                document.getElementById('searchInput').value = '';
                document.getElementById('jumpInput').value = '';
                updateEmptyState(msg.docs.length);
              }
            });

            // ── button handlers ───────────────────────────────────────────
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
          hasMore: false,
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
        hasMore: false,
      });
    }
  });

  panel.onDidDispose(() => {
    messageSubscription.dispose();
    loadedDocs = [];
    headers = [];
    lastDoc = null;
  });
}
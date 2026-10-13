import { getSharedTableStyles } from "../common/tableStyles";

export function getCollectionTableStyles(): string {
  return `
    ${getSharedTableStyles()}

    .actions {
      display: flex;
      justify-content: center;
      margin-top: 18px;
    }
    .actions button {
      min-width: 200px;
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
      z-index: 4;
      background: var(--vscode-editor-background);
    }
    thead th.select-col {
      z-index: 6;
      background: var(--vscode-editor-background);
    }
    td.sticky-col {
      left: 36px !important;
    }
    thead th.id-header {
      left: 36px !important;
    }
    .row-checkbox {
      cursor: pointer;
      width: 15px;
      height: 15px;
      accent-color: var(--vscode-button-background, #007acc);
    }
  `;
}

export function getCollectionTableHtml(item: { collectionId: string; connectionId: string }): string {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Collection: ${item.collectionId}</title>
      <style>
        ${getCollectionTableStyles()}
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
          <button id="toggleProtoBtn" class="secondary toggle-btn" title="Toggle visibility of Operational Protocol (__) columns">
            <span>🛡️</span> __ Protocol
          </button>
          <button id="toggleEnvBtn" class="secondary toggle-btn" title="Toggle visibility of System Envelope (_) columns">
            <span>🏷️</span> _ Envelope
          </button>
          <button id="toggleFilterBtn" class="secondary" title="Build server-side Firestore query filters">
            <span>🔍</span> Filter / Where
          </button>
          <button id="toggleTimeTravelBtn" class="secondary toggle-btn" title="Simulate time-travel to preview live, scheduled, or expired documents">
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
          <button id="calcAggBtn" class="secondary" title="Compute Sum and Average on numeric fields">
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
        <div>Click any row to open and edit in VS Code</div>
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
        ${getCollectionTableClientScript()}
      </script>
    </body>
    </html>
  `;
}

export function getCollectionTableClientScript(): string {
  return `
    (function() {
      const vscode = acquireVsCodeApi();
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
        return '<th class="select-col"><input type="checkbox" id="selectAllCheckbox" class="row-checkbox" title="Select All Loaded Rows" /></th>' +
          '<th class="id-header">Document ID</th>' +
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
          const lc = computeLifecycleStatus(doc, simulatedTime);
          const pillHtml = lc
            ? '<span class="lifecycle-pill ' + lc.cls + '" title="Virtual Status: ' + lc.label + '">' + lc.icon + ' ' + lc.label + '</span>'
            : '';

          const isChecked = selectedDocIds.has(docId);
          const selectCell = '<td class="select-col"><input type="checkbox" class="row-checkbox row-select-checkbox" data-id="' + escapeHtml(docId) + '"' + (isChecked ? ' checked' : '') + ' /></td>';

          const idCell = '<td class="sticky-col"><div class="doc-id-cell">' +
            '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M4 1h8l3 3v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1zm7 1v3h3L11 2z"/></svg>' +
            '<span>' + escapeHtml(docId) + '</span>' + pillHtml + '</div></td>';

          const dataCells = headers.map(h => {
            const isProto = h.startsWith('__');
            const isEnv = h.startsWith('_') && !isProto;
            const tdCls = isProto ? ' class="col-proto"' : isEnv ? ' class="col-env"' : '';
            return '<td' + tdCls + '>' + formatCell(doc[h]) + '</td>';
          }).join('');

          return '<tr data-path="' + escapeHtml(doc.__path || '') + '" data-id="' + escapeHtml(docId) + '">' + selectCell + idCell + dataCells + '</tr>';
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

      let allLoadedDocs = [];
      let lastDocs = [];

      function reRenderCurrentTable() {
        document.getElementById('table-head').innerHTML = '<tr>' + renderHeaderRow(currentHeaders) + '</tr>';
        document.getElementById('table-body').innerHTML = renderRows(lastDocs, currentHeaders);
        updateBatchToolbar();
      }

      function filterCurrentDocs() {
        const searchTerm = (document.getElementById('searchInput').value || '').trim().toLowerCase();
        let docs = allLoadedDocs;

        if (searchTerm) {
          docs = docs.filter(d => JSON.stringify(d).toLowerCase().includes(searchTerm));
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
        document.getElementById('loadMoreBtn').style.display = (!isFiltering && hasMoreState) ? '' : 'none';
        updateEmptyState(lastDocs.length);
        updateBatchToolbar();
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
          document.getElementById('loadMoreBtn').style.display = hasMoreState ? '' : 'none';
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

        if (msg.type === 'aggregateResult') {
          const badge = document.getElementById('total-count-badge');
          if (badge) {
            const avgFormatted = msg.avg !== null && msg.avg !== undefined ? Number(msg.avg).toFixed(2) : 'N/A';
            badge.textContent = msg.field + ': Sum=' + (msg.sum ?? 0) + ' | Avg=' + avgFormatted;
            badge.style.display = 'inline-block';
          }
        }

        if (msg.type === 'batchSuccess') {
          selectedDocIds.clear();
          updateBatchToolbar();
          if (msg.docs) {
            allLoadedDocs = msg.docs;
            lastDocs = allLoadedDocs;
            reRenderCurrentTable();
            document.getElementById('doc-count').textContent = lastDocs.length;
          }
        }

        if (msg.type === 'bookmarksLoaded') {
          updateBookmarksDropdown(msg.bookmarks);
        }

        if (msg.type === 'appendRows') {
          currentHeaders = msg.headers || currentHeaders;
          hasMoreState = !!msg.hasMore;
          if (msg.headersChanged) {
            allLoadedDocs = msg.allDocs || [];
          } else {
            allLoadedDocs = allLoadedDocs.concat(msg.newDocs || []);
          }
          filterCurrentDocs();
          document.getElementById('loadMoreBtn').style.display = (!isSearchMode && hasMoreState) ? '' : 'none';
          document.getElementById('loadMoreBtn').disabled = false;
        }

        if (msg.type === 'searchResults') {
          isSearchMode = true;
          currentHeaders = msg.headers || currentHeaders;
          lastDocs = msg.docs || [];
          reRenderCurrentTable();
          document.getElementById('doc-count').textContent = lastDocs.length;
          document.getElementById('loadMoreBtn').style.display = 'none';
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
          document.getElementById('loadMoreBtn').style.display = 'none';
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
          document.getElementById('loadMoreBtn').style.display = 'none';
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
          document.getElementById('loadMoreBtn').style.display = hasMoreState ? '' : 'none';
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
          document.getElementById('loadMoreBtn').style.display = hasMoreState ? '' : 'none';
          document.getElementById('loadMoreBtn').disabled = false;
          document.getElementById('search-note').style.display = 'none';
          document.getElementById('lookup-note').style.display = 'none';
          document.getElementById('query-note').style.display = isServerQueryMode ? '' : 'none';
          document.getElementById('clearSearchBtn').style.display = isServerQueryMode ? '' : 'none';
          updateEmptyState(lastDocs.length, isServerQueryMode ? "No documents match the specified where clauses." : undefined);
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

        if (clauses.length === 0) {
          alert('Add at least one query clause before bookmarking.');
          return;
        }
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
        vscode.postMessage({ command: 'calculateAggregates' });
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
        checkboxes.forEach(cb => { (cb as any).checked = false; });
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
        const value = document.getElementById('searchInput').value;
        applyClientSearch(value);
      };

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

      document.getElementById('loadMoreBtn').onclick = function() {
        this.disabled = true;
        vscode.postMessage({ command: 'loadMore' });
      };

      document.getElementById('table-body').addEventListener('click', function(event) {
        if (event.target.closest('.select-col') || event.target.closest('.row-checkbox')) {
          return;
        }
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
  `;
}

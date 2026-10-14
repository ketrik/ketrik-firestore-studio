import { getSharedTableStyles } from "../common/tableStyles";

export function getFieldTableHtml(params: {
  panelTitle: string;
  fieldName: string;
  connectionId: string;
  docPath: string;
  isArray: boolean;
}): string {
  const { panelTitle, fieldName, connectionId, docPath, isArray } = params;
  const substrateType = isArray ? "Sequence (Array)" : "Registry (Keyed Map)";
  const rowIdHeader = isArray ? "Index / ID" : "Key / ID";

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: https:; font-src data:;">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${panelTitle}</title>
      <style>
        ${getSharedTableStyles()}
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
          <span class="badge" title="Connection ID">${connectionId}</span>
        </div>
        <div class="toolbar-actions" id="toolbarActions">
          <button id="toggleProtoBtn" class="secondary toggle-btn" title="Toggle visibility of Operational Protocol (__) columns" style="display:none;">
            <span>🛡️</span> __ Protocol
          </button>
          <button id="toggleEnvBtn" class="secondary toggle-btn" title="Toggle visibility of System Envelope (_) columns" style="display:none;">
            <span>🏷️</span> _ Envelope
          </button>
          <button id="toggleTimeTravelBtn" class="secondary toggle-btn" title="Simulate time-travel to preview live, scheduled, or expired items" style="display:none;">
            <span>⏱️</span> Simulate Time
          </button>
          <div class="search-wrapper" id="searchWrapper">
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
      <div class="info-bar" id="infoBar">
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
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:0.4; margin-bottom:10px;">
            <path d="M4 4h16v16H4zM4 9h16M9 4v16"/>
          </svg>
          <h3 id="empty-state-title" style="margin:0 0 6px 0;">This field is empty</h3>
          <p id="empty-state-msg" style="margin:0 0 16px 0; color:var(--vscode-descriptionForeground);">No items found in this field.</p>
          <div id="empty-state-actions" style="display:flex; gap:10px; justify-content:center;">
            <button id="emptyEditJsonBtn" style="padding:6px 16px;">
              <span>{ }</span> Edit in JSON Editor
            </button>
          </div>
          <div id="empty-state-filter-actions" style="display:none; justify-content:center;">
            <button id="emptyClearFilterBtn" class="secondary" style="padding:6px 14px;">
              Clear Active Filter
            </button>
          </div>
        </div>
      </div>

      <script>
        ${getFieldTableClientScript(rowIdHeader)}
      </script>
    </body>
    </html>
  `;
}

export function getFieldTableClientScript(rowIdHeader: string): string {
  return `
    (function() {
      const vscode = acquireVsCodeApi();

      let allRows = [];
      let currentRows = [];
      let currentHeaders = [];

      let isTimeTravelOpen = false;
      let simulatedTime = Date.now();
      let lifecycleFilter = 'all';

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

      function computeLifecycleStatus(row, refTime) {
        const proto = row.__ && typeof row.__ === 'object' ? row.__ : {};
        const active = proto.active !== undefined ? proto.active : row['__.active'];
        const fromVal = proto.from !== undefined ? proto.from : row['__.from'];
        const expVal = proto.exp !== undefined ? proto.exp : row['__.exp'];

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
        return '<th class="id-header">${rowIdHeader}</th>' +
          headers.map(h => renderHeaderCell(h)).join('');
      }

      function reRenderCurrentTable() {
        document.getElementById('table-head').innerHTML = '<tr>' + renderHeaderRow(currentHeaders) + '</tr>';
        document.getElementById('table-body').innerHTML = renderRows(currentRows, currentHeaders);
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
          const lc = computeLifecycleStatus(row, simulatedTime);
          const pillHtml = lc
            ? '<span class="lifecycle-pill ' + lc.cls + '" title="Virtual Status: ' + lc.label + '">' + lc.icon + ' ' + lc.label + '</span>'
            : '';

          const idCell = '<td class="sticky-col"><div class="row-id-cell">' +
            '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M4 1h8l3 3v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1zm7 1v3h3L11 2z"/></svg>' +
            '<span>' + escapeHtml(rowId) + '</span>' + pillHtml + '</div></td>';

          const dataCells = headers.map(h => {
            const isProto = h.startsWith('__');
            const isEnv = h.startsWith('_') && !isProto;
            const tdCls = isProto ? ' class="col-proto"' : isEnv ? ' class="col-env"' : '';
            return '<td' + tdCls + '>' + formatCell(row[h]) + '</td>';
          }).join('');

          return '<tr data-id="' + escapeHtml(rowId) + '">' + idCell + dataCells + '</tr>';
        }).join('');
      }

      function updateContextualButtons() {
        const hasProto = currentHeaders.some(h => h.startsWith('__'));
        const hasEnv = currentHeaders.some(h => h.startsWith('_') && !h.startsWith('__'));
        const hasLifecycle = allRows.some(d => d && (d.__ !== undefined || d['__.active'] !== undefined || d['__.from'] !== undefined || d['__.exp'] !== undefined));

        const protoBtn = document.getElementById('toggleProtoBtn');
        if (protoBtn) protoBtn.style.display = hasProto ? 'inline-flex' : 'none';

        const envBtn = document.getElementById('toggleEnvBtn');
        if (envBtn) envBtn.style.display = hasEnv ? 'inline-flex' : 'none';

        const timeBtn = document.getElementById('toggleTimeTravelBtn');
        if (timeBtn) timeBtn.style.display = hasLifecycle ? 'inline-flex' : 'none';
      }

      function updateEmptyState(count) {
        const emptyState = document.getElementById('empty-state');
        const titleEl = document.getElementById('empty-state-title');
        const msgEl = document.getElementById('empty-state-msg');
        const emptyActions = document.getElementById('empty-state-actions');
        const emptyFilterActions = document.getElementById('empty-state-filter-actions');
        const searchWrapper = document.getElementById('searchWrapper');
        const searchBtn = document.getElementById('searchBtn');
        const exportBtn = document.getElementById('exportBtn');
        const infoBar = document.getElementById('infoBar');
        const tableContainerTable = document.querySelector('.table-container table');

        updateContextualButtons();

        const isFiltered = (document.getElementById('searchInput').value || '').trim() || lifecycleFilter !== 'all';

        if (count === 0) {
          emptyState.style.display = 'block';
          if (tableContainerTable) tableContainerTable.style.display = 'none';

          if (isFiltered) {
            if (titleEl) titleEl.textContent = 'No matching items';
            if (msgEl) msgEl.textContent = 'No items in this field matched your search filter.';
            if (emptyActions) emptyActions.style.display = 'none';
            if (emptyFilterActions) emptyFilterActions.style.display = 'flex';
            if (searchWrapper) searchWrapper.style.display = 'flex';
            if (searchBtn) searchBtn.style.display = '';
            if (exportBtn) exportBtn.style.display = '';
            if (infoBar) infoBar.style.display = 'flex';
          } else {
            if (titleEl) titleEl.textContent = 'This field is empty';
            if (msgEl) msgEl.textContent = 'No items found in this field.';
            if (emptyActions) emptyActions.style.display = 'flex';
            if (emptyFilterActions) emptyFilterActions.style.display = 'none';
            if (searchWrapper) searchWrapper.style.display = 'none';
            if (searchBtn) searchBtn.style.display = 'none';
            if (exportBtn) exportBtn.style.display = 'none';
            if (infoBar) infoBar.style.display = 'none';
          }
        } else {
          emptyState.style.display = 'none';
          if (tableContainerTable) tableContainerTable.style.display = 'table';
          if (emptyActions) emptyActions.style.display = 'none';
          if (emptyFilterActions) emptyFilterActions.style.display = 'none';
          if (searchWrapper) searchWrapper.style.display = 'flex';
          if (searchBtn) searchBtn.style.display = '';
          if (exportBtn) exportBtn.style.display = '';
          if (infoBar) infoBar.style.display = 'flex';
        }
      }

      function rowMatchesSearch(row, term) {
        if (!term) return true;
        for (const k in row) {
          if (k === '__path' || k === '__index') continue;
          const v = row[k];
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

      function filterCurrentRows() {
        const searchTerm = (document.getElementById('searchInput').value || '').trim().toLowerCase();
        let list = allRows;

        if (searchTerm) {
          list = list.filter(row => rowMatchesSearch(row, searchTerm));
        }

        if (lifecycleFilter !== 'all') {
          list = list.filter(row => {
            const lc = computeLifecycleStatus(row, simulatedTime);
            return lc && lc.status === lifecycleFilter;
          });
        }

        currentRows = list;
        document.getElementById('table-body').innerHTML = renderRows(currentRows, currentHeaders);
        document.getElementById('row-count').textContent = currentRows.length;
        const isFiltering = !!searchTerm || lifecycleFilter !== 'all';
        document.getElementById('search-note').style.display = isFiltering ? '' : 'none';
        document.getElementById('clearSearchBtn').style.display = isFiltering ? '' : 'none';
        updateEmptyState(currentRows.length);
      }

      function applyClientSearch(term) {
        filterCurrentRows();
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
        filterCurrentRows();
      }

      window.addEventListener('message', function(event) {
        const msg = event.data;

        if (msg.type === 'init' || msg.type === 'clearSearch') {
          currentHeaders = msg.headers || [];
          allRows = msg.rows || [];
          currentRows = allRows;
          reRenderCurrentTable();
          document.getElementById('row-count').textContent = allRows.length;
          document.getElementById('search-note').style.display = 'none';
          document.getElementById('clearSearchBtn').style.display = 'none';
          document.getElementById('searchInput').value = '';
          updateEmptyState(allRows.length);
        }
      });

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
        filterCurrentRows();
      };

      document.getElementById('exportBtn').onclick = function() {
        const sourceRows = (currentRows && currentRows.length > 0) ? currentRows : allRows;
        const data = sourceRows.map(r => {
          const { __path, __index, ...rest } = r;
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

      document.getElementById('clearSearchBtn').onclick = function() {
        document.getElementById('searchInput').value = '';
        lifecycleFilter = 'all';
        const filterEl = document.getElementById('lifecycleFilterSelect');
        if (filterEl) filterEl.value = 'all';
        applyClientSearch('');
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
          if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
          document.getElementById('searchBtn').click();
        }
      });

      const emptyEditJsonBtn = document.getElementById('emptyEditJsonBtn');
      if (emptyEditJsonBtn) {
        emptyEditJsonBtn.onclick = function() {
          document.getElementById('openInEditorBtn').click();
        };
      }

      const emptyClearFilterBtn = document.getElementById('emptyClearFilterBtn');
      if (emptyClearFilterBtn) {
        emptyClearFilterBtn.onclick = function() {
          document.getElementById('clearSearchBtn').click();
        };
      }

      vscode.postMessage({ command: 'ready' });
    })();
  `;
}

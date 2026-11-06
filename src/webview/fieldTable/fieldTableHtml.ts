import { getSharedTableStyles } from "../common/tableStyles";

export function escapeHtml(val: any): string {
  if (val === null || val === undefined) return "";
  return String(val)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatCellHtml(val: any): string {
  if (val === null || val === undefined) {
    return '<span style="opacity:0.4; font-style:italic;">null</span>';
  }
  if (typeof val === "boolean") {
    return `<span class="chip" style="font-weight:600;">${val ? "true" : "false"}</span>`;
  }
  if (typeof val === "object") {
    if (val._seconds !== undefined && val._nanoseconds !== undefined) {
      try {
        const d = new Date(val._seconds * 1000);
        return `<span class="chip" title="${escapeHtml(d.toISOString())}">🕒 ${escapeHtml(d.toLocaleString())}</span>`;
      } catch {}
    }
    return `<span class="chip">${escapeHtml(JSON.stringify(val))}</span>`;
  }
  return escapeHtml(String(val));
}

export function getValType(val: any): string {
  if (val === null || val === undefined) return "null";
  if (typeof val === "boolean") return "boolean";
  if (typeof val === "number") return "number";
  if (typeof val === "object") {
    if (val._seconds !== undefined && val._nanoseconds !== undefined) return "timestamp";
    if (Array.isArray(val)) return "array";
    return "object";
  }
  return "string";
}

export function renderHeaderRowHtml(headers: string[], rowIdHeader: string): string {
  return `<th class="id-header">${escapeHtml(rowIdHeader)}</th>` +
    headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("") +
    `<th class="sticky-actions" style="width:70px; text-align:center;">Actions</th>`;
}

export function renderRowsHtml(rows: any[], headers: string[]): string {
  return rows.map((row) => {
    const rowId = row.__id !== undefined && row.__id !== null ? String(row.__id) : "";
    const rowIndex = row.__index !== undefined ? String(row.__index) : "";
    const idCell = `<td class="sticky-col"><div class="row-id-cell">` +
      `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M4 1h8l3 3v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1zm7 1v3h3L11 2z"/></svg>` +
      `<span>${escapeHtml(rowId)}</span></div></td>`;
    const dataCells = headers.map((h) => {
      const val = row[h];
      const type = getValType(val);
      return `<td class="editable-cell" data-field="${escapeHtml(h)}" data-type="${type}" data-row-id="${escapeHtml(rowId)}" data-index="${rowIndex}" title="Double-click to edit">${formatCellHtml(val)}</td>`;
    }).join("");
    const actionsCell = `<td class="sticky-actions" style="text-align:center;">` +
      `<button class="row-action-btn delete-btn" title="Delete entry" data-row-id="${escapeHtml(rowId)}" data-index="${rowIndex}">🗑️</button>` +
      `</td>`;
    return `<tr data-id="${escapeHtml(rowId)}" data-index="${rowIndex}">${idCell}${dataCells}${actionsCell}</tr>`;
  }).join("");
}

export function getFieldTableHtml(params: {
  panelTitle: string;
  fieldName: string;
  connectionId: string;
  docPath: string;
  isArray: boolean;
  initialData?: { headers: string[]; rows: any[] };
  errorMessage?: string;
}): string {
  const { panelTitle, fieldName, connectionId, docPath, isArray, initialData, errorMessage } = params;
  const substrateType = isArray ? "Sequence (Array)" : "Registry (Keyed Map)";
  const rowIdHeader = isArray ? "Index / ID" : "Key / ID";
  const initialRowCount = initialData?.rows?.length ?? 0;
  const hasInitialRows = initialRowCount > 0;
  const initialHeaders = initialData?.headers ?? [];
  const initialRows = initialData?.rows ?? [];

  const initialHeadHtml = hasInitialRows ? renderHeaderRowHtml(initialHeaders, rowIdHeader) : "";
  const initialBodyHtml = hasInitialRows ? renderRowsHtml(initialRows, initialHeaders) : "";

  const safeInitialData = initialData
    ? JSON.stringify(initialData)
        .replace(/<\/script/gi, '<\\/script')
        .replace(/<!--/g, '<\\!--')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029')
    : '{"headers":[],"rows":[]}';

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: https:; font-src data:;">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${escapeHtml(panelTitle)}</title>
      <style>
        ${getSharedTableStyles()}
        .error-banner {
          background: var(--vscode-inputValidation-errorBackground, #5a1d1d);
          color: var(--vscode-inputValidation-errorForeground, #ffffff);
          border: 1px solid var(--vscode-inputValidation-errorBorder, #f44336);
          border-radius: 4px;
          padding: 10px 14px;
          margin-bottom: 12px;
          font-family: var(--vscode-editor-font-family, monospace);
          font-size: 12px;
          white-space: pre-wrap;
          word-break: break-word;
        }
      </style>
    </head>
    <body>
      <div id="errorBanner" class="error-banner" style="${errorMessage ? 'display:block;' : 'display:none;'}">${errorMessage ? escapeHtml(errorMessage) : ''}</div>

      <div class="toolbar">
        <div class="title-area">
          <h1>
            <span>${isArray ? "📑" : "🗂️"}</span>
            <span class="field-name">${escapeHtml(fieldName)}</span>
          </h1>
          <span class="badge badge-substrate">${substrateType}</span>
          <span class="badge" title="Connection ID">${escapeHtml(connectionId)}</span>
        </div>
        <div class="toolbar-actions" id="toolbarActions">
          <button id="addEntryBtn" class="primary toggle-btn" title="Add a new entry to this field">
            <span>➕</span> Add Entry
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

      <div class="info-bar" id="infoBar">
        <div class="info-text">
          Parent doc: <span class="doc-parent-link" id="parentDocLink">${escapeHtml(docPath)}</span> &nbsp;|&nbsp;
          Showing <b id="row-count">${initialRowCount}</b> items
          <span id="search-note" style="display:none; font-style:italic; opacity:0.85;">
            — (Filtered)
          </span>
        </div>
        <div>Double-click any cell to edit | Click row ID to open in VS Code</div>
      </div>

      <div class="table-container">
        <table id="dataTable" style="${hasInitialRows ? '' : 'display:none;'}">
          <thead id="table-head"><tr>${initialHeadHtml}</tr></thead>
          <tbody id="table-body">${initialBodyHtml}</tbody>
        </table>
        <div id="empty-state" class="empty-state" style="${hasInitialRows ? 'display:none;' : 'display:block;'}">
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
        window.__INITIAL_DATA__ = ${safeInitialData};
      </script>
      <script>
        ${getFieldTableClientScript(rowIdHeader)}
      </script>
    </body>
    </html>
  `;
}

export function getFieldTableClientScript(rowIdHeader: string): string {
  const safeRowIdHeader = escapeHtml(rowIdHeader);
  return `
    (function() {
      // 1. Visual Error Boundary
      function showError(msg) {
        var el = document.getElementById('errorBanner');
        if (el) {
          el.style.display = 'block';
          el.textContent = '⚠️ ' + msg;
        }
      }

      window.onerror = function(msg, url, line, col, error) {
        showError('Script Error: ' + msg + ' (Line ' + line + ':' + col + ')' + (error && error.stack ? '\\n' + error.stack : ''));
      };

      window.addEventListener('unhandledrejection', function(e) {
        showError('Unhandled Rejection: ' + (e.reason ? (e.reason.stack || e.reason) : e));
      });

      const vscode = acquireVsCodeApi();

      let allRows = [];
      let currentRows = [];
      let currentHeaders = [];

      function escapeHtml(val) {
        if (val === null || val === undefined) { return ''; }
        return String(val)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      }

      function getValType(val) {
        if (val === null || val === undefined) return 'null';
        if (typeof val === 'boolean') return 'boolean';
        if (typeof val === 'number') return 'number';
        if (typeof val === 'object') {
          if (val._seconds !== undefined && val._nanoseconds !== undefined) return 'timestamp';
          if (Array.isArray(val)) return 'array';
          return 'object';
        }
        return 'string';
      }

      function formatCell(value) {
        if (value === null || value === undefined) {
          return '<span style="opacity:0.4; font-style:italic;">null</span>';
        }
        if (typeof value === 'boolean') {
          return '<span class="chip" style="font-weight:600;">' + (value ? 'true' : 'false') + '</span>';
        }
        if (typeof value === 'object') {
          if (value._seconds !== undefined && value._nanoseconds !== undefined) {
            try {
              const date = new Date(value._seconds * 1000);
              return '<span class="chip" title="' + escapeHtml(date.toISOString()) + '">🕒 ' + escapeHtml(date.toLocaleString()) + '</span>';
            } catch (e) {}
          }
          return '<span class="chip">' + escapeHtml(JSON.stringify(value)) + '</span>';
        }
        return escapeHtml(String(value));
      }

      function renderHeaderRow(headers) {
        return '<th class="id-header">${safeRowIdHeader}</th>' +
          headers.map(h => '<th>' + escapeHtml(h) + '</th>').join('') +
          '<th class="sticky-actions" style="width: 70px; text-align: center;">Actions</th>';
      }

      function renderRows(rows, headers) {
        return rows.map(row => {
          const rowId = row.__id !== undefined && row.__id !== null ? String(row.__id) : '';
          const rowIndex = row.__index !== undefined ? String(row.__index) : '';

          const idCell = '<td class="sticky-col"><div class="row-id-cell">' +
            '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M4 1h8l3 3v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1zm7 1v3h3L11 2z"/></svg>' +
            '<span>' + escapeHtml(rowId) + '</span></div></td>';

          const dataCells = headers.map(h => {
            const val = row[h];
            const type = getValType(val);
            return '<td class="editable-cell" data-field="' + escapeHtml(h) + '" data-type="' + type + '" data-row-id="' + escapeHtml(rowId) + '" data-index="' + rowIndex + '" title="Double-click to edit">' + formatCell(val) + '</td>';
          }).join('');

          const actionsCell = '<td class="sticky-actions" style="text-align: center;">' +
            '<button class="row-action-btn delete-btn" title="Delete entry" data-row-id="' + escapeHtml(rowId) + '" data-index="' + rowIndex + '">🗑️</button>' +
            '</td>';

          return '<tr data-id="' + escapeHtml(rowId) + '" data-index="' + rowIndex + '">' + idCell + dataCells + actionsCell + '</tr>';
        }).join('');
      }

      function reRenderCurrentTable() {
        const thead = document.getElementById('table-head');
        const tbody = document.getElementById('table-body');
        if (thead) thead.innerHTML = '<tr>' + renderHeaderRow(currentHeaders) + '</tr>';
        if (tbody) tbody.innerHTML = renderRows(currentRows, currentHeaders);
      }

      function updateEmptyState(count) {
        const emptyState = document.getElementById('empty-state');
        const titleEl = document.getElementById('empty-state-title');
        const msgEl = document.getElementById('empty-state-msg');
        const emptyActions = document.getElementById('empty-state-actions');
        const emptyFilterActions = document.getElementById('empty-state-filter-actions');
        const table = document.getElementById('dataTable');

        const isFiltered = !!((document.getElementById('searchInput').value || '').trim());

        if (count === 0) {
          if (emptyState) emptyState.style.display = 'block';
          if (table) table.style.display = 'none';

          if (isFiltered) {
            if (titleEl) titleEl.textContent = 'No matching items';
            if (msgEl) msgEl.textContent = 'No items in this field matched your search filter.';
            if (emptyActions) emptyActions.style.display = 'none';
            if (emptyFilterActions) emptyFilterActions.style.display = 'flex';
          } else {
            if (titleEl) titleEl.textContent = 'This field is empty';
            if (msgEl) msgEl.textContent = 'No items found in this field.';
            if (emptyActions) emptyActions.style.display = 'flex';
            if (emptyFilterActions) emptyFilterActions.style.display = 'none';
          }
        } else {
          if (emptyState) emptyState.style.display = 'none';
          if (table) table.style.display = 'table';
          if (emptyActions) emptyActions.style.display = 'none';
          if (emptyFilterActions) emptyFilterActions.style.display = 'none';
        }
      }

      function matchesSearchTermClient(val, term, depth) {
        if (!val || (depth || 0) > 6) return false;
        if (typeof val === 'string') return val.toLowerCase().includes(term);
        if (typeof val === 'number' || typeof val === 'boolean') return String(val).toLowerCase().includes(term);
        if (Array.isArray(val)) {
          for (let i = 0; i < val.length; i++) {
            if (matchesSearchTermClient(val[i], term, (depth || 0) + 1)) return true;
          }
          return false;
        }
        for (const k in val) {
          if (Object.prototype.hasOwnProperty.call(val, k)) {
            if (k.toLowerCase().includes(term) || matchesSearchTermClient(val[k], term, (depth || 0) + 1)) return true;
          }
        }
        return false;
      }

      function rowMatchesSearch(row, term) {
        if (!term) return true;
        for (const k in row) {
          if (k === '__path' || k === '__index') continue;
          if (k.toLowerCase().includes(term)) return true;
          const v = row[k];
          if (v === null || v === undefined) continue;
          if (typeof v === 'string') {
            if (v.toLowerCase().includes(term)) return true;
          } else if (typeof v === 'number' || typeof v === 'boolean') {
            if (String(v).toLowerCase().includes(term)) return true;
          } else if (typeof v === 'object') {
            if (matchesSearchTermClient(v, term, 0)) return true;
          }
        }
        return false;
      }

      function filterCurrentRows() {
        const searchTerm = (document.getElementById('searchInput').value || '').trim().toLowerCase();
        currentRows = searchTerm ? allRows.filter(row => rowMatchesSearch(row, searchTerm)) : allRows;
        const tbody = document.getElementById('table-body');
        if (tbody) tbody.innerHTML = renderRows(currentRows, currentHeaders);
        const countEl = document.getElementById('row-count');
        if (countEl) countEl.textContent = currentRows.length;
        const searchNote = document.getElementById('search-note');
        if (searchNote) searchNote.style.display = searchTerm ? '' : 'none';
        const clearBtn = document.getElementById('clearSearchBtn');
        if (clearBtn) clearBtn.style.display = searchTerm ? '' : 'none';
        updateEmptyState(currentRows.length);
      }

      window.addEventListener('message', function(event) {
        const msg = event.data;
        if (!msg) return;

        if (msg.type === 'error') {
          showError(msg.message || 'An error occurred');
          return;
        }

        if (msg.type === 'init' || msg.type === 'clearSearch') {
          currentHeaders = msg.headers || [];
          allRows = msg.rows || [];
          currentRows = allRows;
          reRenderCurrentTable();
          const countEl = document.getElementById('row-count');
          if (countEl) countEl.textContent = allRows.length;
          const searchNote = document.getElementById('search-note');
          if (searchNote) searchNote.style.display = 'none';
          const clearBtn = document.getElementById('clearSearchBtn');
          if (clearBtn) clearBtn.style.display = 'none';
          const searchInput = document.getElementById('searchInput');
          if (searchInput) searchInput.value = '';
          updateEmptyState(allRows.length);
        }

        if (msg.type === 'fieldEntryUpdated') {
          const { rowId, field, value } = msg;
          const target = allRows.find(r => String(r.__id) === String(rowId));
          if (target) {
            target[field] = value;
          }
          const tr = document.querySelector('tr[data-id="' + CSS.escape(String(rowId)) + '"]');
          if (tr) {
            const td = tr.querySelector('td[data-field="' + CSS.escape(String(field)) + '"]');
            if (td) {
              td.innerHTML = formatCell(value);
              td.classList.add('flash-update');
              setTimeout(() => td.classList.remove('flash-update'), 1500);
            }
          }
        }

        if (msg.type === 'fieldEntryDeleted') {
          const { rowId } = msg;
          allRows = allRows.filter(r => String(r.__id) !== String(rowId));
          filterCurrentRows();
        }
      });

      // Search listeners
      const searchBtn = document.getElementById('searchBtn');
      if (searchBtn) {
        searchBtn.onclick = function() { filterCurrentRows(); };
      }

      const searchInput = document.getElementById('searchInput');
      if (searchInput) {
        let debounce = null;
        searchInput.addEventListener('input', function() {
          if (debounce) clearTimeout(debounce);
          debounce = setTimeout(filterCurrentRows, 150);
        });
        searchInput.addEventListener('keydown', function(e) {
          if (e.key === 'Enter') {
            if (debounce) clearTimeout(debounce);
            filterCurrentRows();
          }
        });
      }

      const clearSearchBtn = document.getElementById('clearSearchBtn');
      if (clearSearchBtn) {
        clearSearchBtn.onclick = function() {
          if (searchInput) searchInput.value = '';
          filterCurrentRows();
        };
      }

      const emptyClearFilterBtn = document.getElementById('emptyClearFilterBtn');
      if (emptyClearFilterBtn) {
        emptyClearFilterBtn.onclick = function() {
          if (clearSearchBtn) clearSearchBtn.click();
        };
      }

      // Action buttons
      const exportBtn = document.getElementById('exportBtn');
      if (exportBtn) {
        exportBtn.onclick = function() {
          const sourceRows = (currentRows && currentRows.length > 0) ? currentRows : allRows;
          const data = sourceRows.map(r => {
            const { __path, __index, ...rest } = r;
            return rest;
          });
          vscode.postMessage({ command: 'exportJson', data });
        };
      }

      const openInEditorBtn = document.getElementById('openInEditorBtn');
      if (openInEditorBtn) {
        openInEditorBtn.onclick = function() {
          vscode.postMessage({ command: 'openFieldInEditor' });
        };
      }

      const emptyEditJsonBtn = document.getElementById('emptyEditJsonBtn');
      if (emptyEditJsonBtn) {
        emptyEditJsonBtn.onclick = function() {
          vscode.postMessage({ command: 'openFieldInEditor' });
        };
      }

      const parentDocLink = document.getElementById('parentDocLink');
      if (parentDocLink) {
        parentDocLink.onclick = function() {
          vscode.postMessage({ command: 'openParentDoc' });
        };
      }

      const addEntryBtn = document.getElementById('addEntryBtn');
      if (addEntryBtn) {
        addEntryBtn.onclick = function() {
          vscode.postMessage({ command: 'addFieldEntry' });
        };
      }

      // Inline Cell Editing
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
        const rowId = td.getAttribute('data-row-id');
        const rowIndex = td.getAttribute('data-index');
        if (!field || !rowId) return;

        if (type === 'object' || type === 'array') {
          vscode.postMessage({ command: 'openFieldInEditor' });
          return;
        }

        const row = allRows.find(r => String(r.__id) === String(rowId));
        const originalVal = row ? row[field] : undefined;

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
          } else if (type === 'string') {
            newVal = input.value;
          } else if (type === 'number') {
            const raw = input.value.trim();
            newVal = raw === '' ? null : Number(raw);
          } else {
            const raw = input.value.trim();
            if (raw === '' || raw === 'null') {
              newVal = null;
            } else if (raw === 'true') {
              newVal = true;
            } else if (raw === 'false') {
              newVal = false;
            } else if (!isNaN(Number(raw)) && raw !== '') {
              newVal = Number(raw);
            } else {
              newVal = input.value;
            }
          }

          if (newVal === originalVal) {
            td.innerHTML = formatCell(originalVal);
            return;
          }

          td.innerHTML = formatCell(newVal);
          vscode.postMessage({
            command: 'updateFieldEntry',
            rowId,
            field,
            value: newVal,
            index: rowIndex !== '' ? Number(rowIndex) : undefined
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

      // Table delegation listeners
      const tbody = document.getElementById('table-body');
      if (tbody) {
        tbody.addEventListener('click', function(event) {
          const delBtn = event.target.closest('.delete-btn');
          if (delBtn) {
            event.stopPropagation();
            const rowId = delBtn.getAttribute('data-row-id');
            const idxStr = delBtn.getAttribute('data-index');
            vscode.postMessage({
              command: 'deleteFieldEntry',
              rowId,
              index: idxStr !== '' ? Number(idxStr) : undefined
            });
            return;
          }

          const td = event.target.closest('.editable-cell');
          if (td) {
            clearSelectedCell();
            selectedCell = td;
            td.classList.add('selected');
            return;
          }

          const rowIdCell = event.target.closest('.row-id-cell');
          if (rowIdCell) {
            vscode.postMessage({ command: 'openFieldInEditor' });
          }
        });

        tbody.addEventListener('dblclick', function(event) {
          const td = event.target.closest('.editable-cell');
          if (td) {
            startCellEdit(td);
          }
        });
      }

      document.addEventListener('keydown', function(event) {
        if (!selectedCell || activeEditingCell) return;
        if (event.key === 'Enter' || event.key === 'F2') {
          event.preventDefault();
          startCellEdit(selectedCell);
        }
      });

      // Hydration from server-rendered initial data
      try {
        if (window.__INITIAL_DATA__ && Array.isArray(window.__INITIAL_DATA__.rows)) {
          currentHeaders = window.__INITIAL_DATA__.headers || [];
          allRows = window.__INITIAL_DATA__.rows || [];
          currentRows = allRows;
          const countEl = document.getElementById('row-count');
          if (countEl) countEl.textContent = allRows.length;
          updateEmptyState(allRows.length);
        }
      } catch (err) {
        showError('Hydration Error: ' + err.message);
      }

      vscode.postMessage({ command: 'ready' });
    })();
  `;
}

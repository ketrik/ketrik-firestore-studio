import { getSharedTableStyles } from "../common/tableStyles";

export interface DocumentFieldInfo {
  field: string;
  type: string;
  value: any;
}

export function escapeHtml(val: any): string {
  if (val === null || val === undefined) return "";
  return String(val)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function getValType(val: any): string {
  if (val === null || val === undefined) return "null";
  if (typeof val === "boolean") return "boolean";
  if (typeof val === "number") return "number";
  if (typeof val === "string") return "string";
  if (typeof val === "object") {
    if (val._seconds !== undefined && val._nanoseconds !== undefined) return "timestamp";
    if (val._latitude !== undefined && val._longitude !== undefined) return "geopoint";
    if (Array.isArray(val)) return "array";
    return "map";
  }
  return "string";
}

export function formatCellValueHtml(val: any, fieldName: string): string {
  if (val === null || val === undefined) {
    return '<span style="opacity:0.4; font-style:italic;">null</span>';
  }
  if (typeof val === "boolean") {
    return `<span class="chip" style="font-weight:600;">${val ? "true" : "false"}</span>`;
  }
  if (typeof val === "number") {
    return `<span class="chip" style="font-family:var(--mono-font);">${val}</span>`;
  }
  if (typeof val === "object") {
    if (val._seconds !== undefined && val._nanoseconds !== undefined) {
      try {
        const d = new Date(val._seconds * 1000);
        return `<span class="chip" title="${escapeHtml(d.toISOString())}">🕒 ${escapeHtml(d.toLocaleString())}</span>`;
      } catch {}
    }
    if (val._latitude !== undefined && val._longitude !== undefined) {
      return `<span class="chip">📍 GeoPoint(${val._latitude}, ${val._longitude})</span>`;
    }
    if (Array.isArray(val)) {
      const preview = escapeHtml(JSON.stringify(val).slice(0, 60));
      return (
        `<div style="display:flex; align-items:center; gap:8px;">` +
        `<span class="chip" title="${preview}">[${val.length} items]</span>` +
        `<button class="subtable-btn" data-field="${escapeHtml(fieldName)}" title="Open array as table">📑 Open Table</button>` +
        `</div>`
      );
    }
    const keys = Object.keys(val);
    const preview = escapeHtml(JSON.stringify(val).slice(0, 60));
    return (
      `<div style="display:flex; align-items:center; gap:8px;">` +
      `<span class="chip" title="${preview}">{${keys.length} keys}</span>` +
      `<button class="subtable-btn" data-field="${escapeHtml(fieldName)}" title="Open map as table">🗂️ Open Table</button>` +
      `</div>`
    );
  }
  return escapeHtml(String(val));
}

export function renderFieldsHeadHtml(): string {
  return (
    `<th class="id-header" style="width:220px;">Field Name</th>` +
    `<th style="width:110px;">Type</th>` +
    `<th>Value</th>` +
    `<th class="sticky-actions" style="width:70px; text-align:center;">Actions</th>`
  );
}

export function renderFieldsRowsHtml(fields: DocumentFieldInfo[]): string {
  return fields
    .map((item) => {
      const fName = item.field;
      const type = item.type;
      const val = item.value;
      const isScalar = type !== "map" && type !== "array";

      const idCell =
        `<td class="sticky-col"><div class="row-id-cell">` +
        `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M2 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2zm2-1a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H4z"/></svg>` +
        `<span style="font-weight:600;">${escapeHtml(fName)}</span></div></td>`;

      const typeCell = `<td><span class="badge-type ${type}">${type}</span></td>`;

      const valCell = isScalar
        ? `<td class="editable-cell" data-field="${escapeHtml(fName)}" data-type="${type}" title="Double-click to edit">${formatCellValueHtml(val, fName)}</td>`
        : `<td>${formatCellValueHtml(val, fName)}</td>`;

      const actionsCell =
        `<td class="sticky-actions" style="text-align:center;">` +
        `<button class="row-action-btn delete-btn" title="Delete field '${escapeHtml(fName)}'" data-field="${escapeHtml(fName)}">🗑️</button>` +
        `</td>`;

      return `<tr data-field="${escapeHtml(fName)}">${idCell}${typeCell}${valCell}${actionsCell}</tr>`;
    })
    .join("");
}

export function renderRecordHeadHtml(headers: string[]): string {
  return (
    `<th class="id-header">Document ID</th>` +
    headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("") +
    `<th class="sticky-actions" style="width:70px; text-align:center;">Actions</th>`
  );
}

export function renderRecordRowsHtml(docId: string, fields: DocumentFieldInfo[], headers: string[]): string {
  const map: Record<string, any> = {};
  fields.forEach((f) => {
    map[f.field] = f.value;
  });

  const idCell =
    `<td class="sticky-col"><div class="row-id-cell">` +
    `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M4 1h8l3 3v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1zm7 1v3h3L11 2z"/></svg>` +
    `<span>${escapeHtml(docId)}</span></div></td>`;

  const dataCells = headers
    .map((h) => {
      const val = map[h];
      const type = getValType(val);
      const isScalar = type !== "map" && type !== "array";
      return isScalar
        ? `<td class="editable-cell" data-field="${escapeHtml(h)}" data-type="${type}" title="Double-click to edit">${formatCellValueHtml(val, h)}</td>`
        : `<td>${formatCellValueHtml(val, h)}</td>`;
    })
    .join("");

  const actionsCell =
    `<td class="sticky-actions" style="text-align:center;">` +
    `<button class="row-action-btn delete-doc-btn" title="Delete Document">🗑️</button>` +
    `</td>`;

  return `<tr data-doc-id="${escapeHtml(docId)}">${idCell}${dataCells}${actionsCell}</tr>`;
}

export function getDocumentTableHtml(params: {
  documentId: string;
  docPath: string;
  parentCollectionPath: string;
  connectionId: string;
  fields: DocumentFieldInfo[];
  sizeInfoFormatted?: string;
  errorMessage?: string;
}): string {
  const {
    documentId,
    docPath,
    parentCollectionPath,
    connectionId,
    fields,
    sizeInfoFormatted,
    errorMessage,
  } = params;

  const fieldCount = fields.length;
  const hasFields = fieldCount > 0;
  const initialHeaders = fields.map((f) => f.field);

  const initialHeadHtml = hasFields ? renderFieldsHeadHtml() : "";
  const initialBodyHtml = hasFields ? renderFieldsRowsHtml(fields) : "";

  const safeInitialData = JSON.stringify({
    documentId,
    docPath,
    parentCollectionPath,
    connectionId,
    fields,
    headers: initialHeaders,
  })
    .replace(/<\/script/gi, "<\\/script")
    .replace(/<!--/g, "<\\!--")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: https:; font-src data:;">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Document: ${escapeHtml(documentId)}</title>
      <style>
        ${getSharedTableStyles()}

        .badge-type {
          font-family: var(--mono-font);
          font-size: 0.78em;
          padding: 2px 7px;
          border-radius: 4px;
          text-transform: uppercase;
          font-weight: 600;
          letter-spacing: 0.04em;
          display: inline-block;
        }
        .badge-type.string { background: rgba(59, 130, 246, 0.15); color: #60a5fa; }
        .badge-type.number { background: rgba(16, 185, 129, 0.15); color: #34d399; }
        .badge-type.boolean { background: rgba(168, 85, 247, 0.15); color: #c084fc; }
        .badge-type.timestamp { background: rgba(245, 158, 11, 0.15); color: #fbbf24; }
        .badge-type.map { background: rgba(6, 182, 212, 0.15); color: #22d3ee; }
        .badge-type.array { background: rgba(236, 72, 153, 0.15); color: #f472b6; }
        .badge-type.geopoint { background: rgba(239, 68, 68, 0.15); color: #f87171; }
        .badge-type.null { background: rgba(156, 163, 175, 0.15); color: #9ca3af; }

        .subtable-btn {
          font-size: 0.82em;
          padding: 2px 8px;
          background: var(--vscode-button-secondaryBackground, rgba(128,128,128,0.2));
          color: var(--vscode-button-secondaryForeground, inherit);
          border: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.3));
          border-radius: 4px;
          cursor: pointer;
          white-space: nowrap;
          display: inline-flex;
          align-items: center;
          gap: 4px;
        }
        .subtable-btn:hover {
          background: var(--vscode-button-secondaryHoverBackground, rgba(128,128,128,0.35));
        }

        .view-toggle {
          display: inline-flex;
          border: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.3));
          border-radius: 4px;
          overflow: hidden;
        }
        .view-toggle button {
          border-radius: 0;
          border: none;
          background: transparent;
          color: var(--vscode-editor-foreground);
          padding: 5px 12px;
          font-size: 0.9em;
          cursor: pointer;
        }
        .view-toggle button.active {
          background: var(--vscode-button-background);
          color: var(--vscode-button-foreground);
        }

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

        .link-text {
          cursor: pointer;
          text-decoration: underline;
          opacity: 0.9;
        }
        .link-text:hover {
          opacity: 1;
          color: var(--vscode-textLink-foreground);
        }
      </style>
    </head>
    <body>
      <div id="errorBanner" class="error-banner" style="${errorMessage ? "display:block;" : "display:none;"}">${errorMessage ? escapeHtml(errorMessage) : ""}</div>

      <div class="toolbar">
        <div class="title-area">
          <h1>
            <span>📄</span>
            <span class="field-name">${escapeHtml(documentId)}</span>
          </h1>
          <span class="badge">Document</span>
          <span class="badge" title="Connection ID">${escapeHtml(connectionId)}</span>
          ${sizeInfoFormatted ? `<span class="badge" title="Document Size">${escapeHtml(sizeInfoFormatted)}</span>` : ""}
        </div>
        <div class="toolbar-actions" id="toolbarActions">
          <div class="view-toggle">
            <button id="viewFieldsBtn" class="active" title="Fields View (Name, Type, Value)">
              <span>📑</span> Fields
            </button>
            <button id="viewRecordBtn" title="Record View (Single row with columns)">
              <span>🗃️</span> Record
            </button>
          </div>
          <button id="addFieldBtn" class="primary toggle-btn" title="Add a new field to this document">
            <span>➕</span> Add Field
          </button>
          <div class="search-wrapper" id="searchWrapper">
            <input id="searchInput" type="text" placeholder="Search fields..." />
          </div>
          <button id="searchBtn">Search</button>
          <button id="clearSearchBtn" class="secondary" style="display:none;">Clear</button>
          <button id="openInEditorBtn" class="secondary" title="Open document in JSON editor">
            <span>{ }</span> Edit JSON
          </button>
          <button id="exportBtn" class="secondary" title="Export as JSON file">
            <span>⬇</span> Export JSON
          </button>
          <button id="refreshBtn" class="secondary" title="Refresh document from Firestore">
            <span>🔄</span> Refresh
          </button>
        </div>
      </div>

      <div class="info-bar" id="infoBar">
        <div class="info-text">
          Path: <b>${escapeHtml(docPath)}</b>
          ${
            parentCollectionPath
              ? `&nbsp;|&nbsp; Parent collection: <span class="doc-parent-link link-text" id="parentColLink">${escapeHtml(parentCollectionPath)}</span>`
              : ""
          }
          &nbsp;|&nbsp; Showing <b id="field-count">${fieldCount}</b> fields
          <span id="search-note" style="display:none; font-style:italic; opacity:0.85;">
            — (Filtered)
          </span>
        </div>
        <div>Double-click any value cell to edit | Click field name to inspect</div>
      </div>

      <div class="table-container">
        <table id="dataTable" style="${hasFields ? "" : "display:none;"}">
          <thead id="table-head"><tr>${initialHeadHtml}</tr></thead>
          <tbody id="table-body">${initialBodyHtml}</tbody>
        </table>
        <div id="empty-state" class="empty-state" style="${hasFields ? "display:none;" : "display:block;"}">
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:0.4; margin-bottom:10px;">
            <path d="M4 4h16v16H4zM4 9h16M9 4v16"/>
          </svg>
          <h3 id="empty-state-title" style="margin:0 0 6px 0;">This document has no fields</h3>
          <p id="empty-state-msg" style="margin:0 0 16px 0; color:var(--vscode-descriptionForeground);">No fields found in this document.</p>
          <div id="empty-state-actions" style="display:flex; gap:10px; justify-content:center;">
            <button id="emptyAddFieldBtn" style="padding:6px 16px;">
              <span>➕</span> Add Field
            </button>
            <button id="emptyEditJsonBtn" class="secondary" style="padding:6px 16px;">
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
        ${getDocumentTableClientScript()}
      </script>
    </body>
    </html>
  `;
}

export function getDocumentTableClientScript(): string {
  return `
    (function() {
      // 1. Error Boundary
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

      let documentId = '';
      let docPath = '';
      let parentCollectionPath = '';
      let allFields = [];
      let currentFields = [];
      let currentMode = 'fields'; // 'fields' | 'record'

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
        if (typeof val === 'string') return 'string';
        if (typeof val === 'object') {
          if (val._seconds !== undefined && val._nanoseconds !== undefined) return 'timestamp';
          if (val._latitude !== undefined && val._longitude !== undefined) return 'geopoint';
          if (Array.isArray(val)) return 'array';
          return 'map';
        }
        return 'string';
      }

      function formatCellValue(val, fieldName) {
        if (val === null || val === undefined) {
          return '<span style="opacity:0.4; font-style:italic;">null</span>';
        }
        if (typeof val === 'boolean') {
          return '<span class="chip" style="font-weight:600;">' + (val ? 'true' : 'false') + '</span>';
        }
        if (typeof val === 'number') {
          return '<span class="chip" style="font-family:var(--mono-font);">' + val + '</span>';
        }
        if (typeof val === 'object') {
          if (val._seconds !== undefined && val._nanoseconds !== undefined) {
            try {
              const d = new Date(val._seconds * 1000);
              return '<span class="chip" title="' + escapeHtml(d.toISOString()) + '">🕒 ' + escapeHtml(d.toLocaleString()) + '</span>';
            } catch (e) {}
          }
          if (val._latitude !== undefined && val._longitude !== undefined) {
            return '<span class="chip">📍 GeoPoint(' + val._latitude + ', ' + val._longitude + ')</span>';
          }
          if (Array.isArray(val)) {
            const preview = escapeHtml(JSON.stringify(val).slice(0, 60));
            return '<div style="display:flex; align-items:center; gap:8px;">' +
              '<span class="chip" title="' + preview + '">[' + val.length + ' items]</span>' +
              '<button class="subtable-btn" data-field="' + escapeHtml(fieldName) + '" title="Open array as table">📑 Open Table</button>' +
              '</div>';
          }
          const keys = Object.keys(val);
          const preview = escapeHtml(JSON.stringify(val).slice(0, 60));
          return '<div style="display:flex; align-items:center; gap:8px;">' +
            '<span class="chip" title="' + preview + '">{' + keys.length + ' keys}</span>' +
            '<button class="subtable-btn" data-field="' + escapeHtml(fieldName) + '" title="Open map as table">🗂️ Open Table</button>' +
            '</div>';
        }
        return escapeHtml(String(val));
      }

      function renderFieldsHead() {
        return '<th class="id-header" style="width:220px;">Field Name</th>' +
          '<th style="width:110px;">Type</th>' +
          '<th>Value</th>' +
          '<th class="sticky-actions" style="width:70px; text-align:center;">Actions</th>';
      }

      function renderFieldsRows(fields) {
        return fields.map(item => {
          const fName = item.field;
          const type = item.type;
          const val = item.value;
          const isScalar = type !== 'map' && type !== 'array';

          const idCell = '<td class="sticky-col"><div class="row-id-cell">' +
            '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M2 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2zm2-1a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H4z"/></svg>' +
            '<span style="font-weight:600;">' + escapeHtml(fName) + '</span></div></td>';

          const typeCell = '<td><span class="badge-type ' + type + '">' + type + '</span></td>';

          const valCell = isScalar
            ? '<td class="editable-cell" data-field="' + escapeHtml(fName) + '" data-type="' + type + '" title="Double-click to edit">' + formatCellValue(val, fName) + '</td>'
            : '<td>' + formatCellValue(val, fName) + '</td>';

          const actionsCell = '<td class="sticky-actions" style="text-align:center;">' +
            '<button class="row-action-btn delete-btn" title="Delete field" data-field="' + escapeHtml(fName) + '">🗑️</button>' +
            '</td>';

          return '<tr data-field="' + escapeHtml(fName) + '">' + idCell + typeCell + valCell + actionsCell + '</tr>';
        }).join('');
      }

      function renderRecordHead(fields) {
        const headers = fields.map(f => f.field);
        return '<th class="id-header">Document ID</th>' +
          headers.map(h => '<th>' + escapeHtml(h) + '</th>').join('') +
          '<th class="sticky-actions" style="width:70px; text-align:center;">Actions</th>';
      }

      function renderRecordRows(fields) {
        const idCell = '<td class="sticky-col"><div class="row-id-cell">' +
          '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M4 1h8l3 3v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1zm7 1v3h3L11 2z"/></svg>' +
          '<span>' + escapeHtml(documentId) + '</span></div></td>';

        const dataCells = fields.map(item => {
          const fName = item.field;
          const type = item.type;
          const val = item.value;
          const isScalar = type !== 'map' && type !== 'array';
          return isScalar
            ? '<td class="editable-cell" data-field="' + escapeHtml(fName) + '" data-type="' + type + '" title="Double-click to edit">' + formatCellValue(val, fName) + '</td>'
            : '<td>' + formatCellValue(val, fName) + '</td>';
        }).join('');

        const actionsCell = '<td class="sticky-actions" style="text-align:center;">' +
          '<button class="row-action-btn delete-doc-btn" title="Delete Document">🗑️</button>' +
          '</td>';

        return '<tr data-doc-id="' + escapeHtml(documentId) + '">' + idCell + dataCells + actionsCell + '</tr>';
      }

      function reRenderTable() {
        const thead = document.getElementById('table-head');
        const tbody = document.getElementById('table-body');
        if (currentMode === 'fields') {
          if (thead) thead.innerHTML = '<tr>' + renderFieldsHead() + '</tr>';
          if (tbody) tbody.innerHTML = renderFieldsRows(currentFields);
        } else {
          if (thead) thead.innerHTML = '<tr>' + renderRecordHead(currentFields) + '</tr>';
          if (tbody) tbody.innerHTML = renderRecordRows(currentFields);
        }
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
            if (titleEl) titleEl.textContent = 'No matching fields';
            if (msgEl) msgEl.textContent = 'No fields in this document matched your search.';
            if (emptyActions) emptyActions.style.display = 'none';
            if (emptyFilterActions) emptyFilterActions.style.display = 'flex';
          } else {
            if (titleEl) titleEl.textContent = 'This document has no fields';
            if (msgEl) msgEl.textContent = 'No fields found in this document.';
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

      function fieldMatchesSearch(item, term) {
        if (!term) return true;
        if (item.field.toLowerCase().includes(term)) return true;
        if (item.type.toLowerCase().includes(term)) return true;
        const v = item.value;
        if (v === null || v === undefined) return false;
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
          if (String(v).toLowerCase().includes(term)) return true;
        } else if (typeof v === 'object') {
          try {
            if (JSON.stringify(v).toLowerCase().includes(term)) return true;
          } catch (e) {}
        }
        return false;
      }

      function filterFields() {
        const term = (document.getElementById('searchInput').value || '').trim().toLowerCase();
        currentFields = term ? allFields.filter(f => fieldMatchesSearch(f, term)) : allFields;
        reRenderTable();
        const countEl = document.getElementById('field-count');
        if (countEl) countEl.textContent = currentFields.length;
        const searchNote = document.getElementById('search-note');
        if (searchNote) searchNote.style.display = term ? '' : 'none';
        const clearBtn = document.getElementById('clearSearchBtn');
        if (clearBtn) clearBtn.style.display = term ? '' : 'none';
        updateEmptyState(currentFields.length);
      }

      // View Mode Toggle
      const viewFieldsBtn = document.getElementById('viewFieldsBtn');
      const viewRecordBtn = document.getElementById('viewRecordBtn');

      if (viewFieldsBtn && viewRecordBtn) {
        viewFieldsBtn.onclick = function() {
          if (currentMode === 'fields') return;
          currentMode = 'fields';
          viewFieldsBtn.classList.add('active');
          viewRecordBtn.classList.remove('active');
          reRenderTable();
        };

        viewRecordBtn.onclick = function() {
          if (currentMode === 'record') return;
          currentMode = 'record';
          viewRecordBtn.classList.add('active');
          viewFieldsBtn.classList.remove('active');
          reRenderTable();
        };
      }

      // Message listener
      window.addEventListener('message', function(event) {
        const msg = event.data;
        if (!msg) return;

        if (msg.type === 'error') {
          showError(msg.message || 'An error occurred');
          return;
        }

        if (msg.type === 'init') {
          documentId = msg.documentId || documentId;
          docPath = msg.docPath || docPath;
          parentCollectionPath = msg.parentCollectionPath || parentCollectionPath;
          allFields = msg.fields || [];
          currentFields = allFields;
          reRenderTable();
          const countEl = document.getElementById('field-count');
          if (countEl) countEl.textContent = allFields.length;
          updateEmptyState(allFields.length);
        }

        if (msg.type === 'fieldUpdated') {
          const { field, value } = msg;
          const target = allFields.find(f => f.field === field);
          if (target) {
            target.value = value;
            target.type = getValType(value);
          }
          filterFields();
        }

        if (msg.type === 'fieldDeleted') {
          const { field } = msg;
          allFields = allFields.filter(f => f.field !== field);
          filterFields();
        }
      });

      // Search listeners
      const searchBtn = document.getElementById('searchBtn');
      if (searchBtn) searchBtn.onclick = filterFields;

      const searchInput = document.getElementById('searchInput');
      if (searchInput) {
        let debounce = null;
        searchInput.addEventListener('input', function() {
          if (debounce) clearTimeout(debounce);
          debounce = setTimeout(filterFields, 150);
        });
        searchInput.addEventListener('keydown', function(e) {
          if (e.key === 'Enter') {
            if (debounce) clearTimeout(debounce);
            filterFields();
          }
        });
      }

      const clearSearchBtn = document.getElementById('clearSearchBtn');
      if (clearSearchBtn) {
        clearSearchBtn.onclick = function() {
          if (searchInput) searchInput.value = '';
          filterFields();
        };
      }

      const emptyClearFilterBtn = document.getElementById('emptyClearFilterBtn');
      if (emptyClearFilterBtn) {
        emptyClearFilterBtn.onclick = function() {
          if (clearSearchBtn) clearSearchBtn.click();
        };
      }

      // Toolbar buttons
      const addFieldBtn = document.getElementById('addFieldBtn');
      if (addFieldBtn) {
        addFieldBtn.onclick = function() {
          vscode.postMessage({ command: 'addField' });
        };
      }

      const emptyAddFieldBtn = document.getElementById('emptyAddFieldBtn');
      if (emptyAddFieldBtn) {
        emptyAddFieldBtn.onclick = function() {
          vscode.postMessage({ command: 'addField' });
        };
      }

      const openInEditorBtn = document.getElementById('openInEditorBtn');
      if (openInEditorBtn) {
        openInEditorBtn.onclick = function() {
          vscode.postMessage({ command: 'openInEditor' });
        };
      }

      const emptyEditJsonBtn = document.getElementById('emptyEditJsonBtn');
      if (emptyEditJsonBtn) {
        emptyEditJsonBtn.onclick = function() {
          vscode.postMessage({ command: 'openInEditor' });
        };
      }

      const exportBtn = document.getElementById('exportBtn');
      if (exportBtn) {
        exportBtn.onclick = function() {
          const obj = {};
          allFields.forEach(f => { obj[f.field] = f.value; });
          vscode.postMessage({ command: 'exportJson', data: obj });
        };
      }

      const refreshBtn = document.getElementById('refreshBtn');
      if (refreshBtn) {
        refreshBtn.onclick = function() {
          vscode.postMessage({ command: 'refresh' });
        };
      }

      const parentColLink = document.getElementById('parentColLink');
      if (parentColLink) {
        parentColLink.onclick = function() {
          vscode.postMessage({ command: 'openParentCollection' });
        };
      }

      // In-cell Editing
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
        if (!field) return;

        if (type === 'map' || type === 'array') {
          vscode.postMessage({ command: 'openFieldAsTable', field });
          return;
        }

        const targetField = allFields.find(f => f.field === field);
        const originalVal = targetField ? targetField.value : undefined;

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
            } else if (type === 'number' || (!isNaN(Number(raw)) && raw !== '' && type !== 'string')) {
              newVal = Number(raw);
            } else {
              newVal = input.value;
            }
          }

          if (newVal === originalVal) {
            td.innerHTML = formatCellValue(originalVal, field);
            return;
          }

          td.innerHTML = formatCellValue(newVal, field);
          vscode.postMessage({
            command: 'updateField',
            field,
            value: newVal
          });
        }

        function cancelEdit() {
          if (isDone) return;
          isDone = true;
          activeEditingCell = null;
          td.classList.remove('editing');
          td.innerHTML = formatCellValue(originalVal, field);
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

      // Table delegation
      const tbody = document.getElementById('table-body');
      if (tbody) {
        tbody.addEventListener('click', function(event) {
          const subtableBtn = event.target.closest('.subtable-btn');
          if (subtableBtn) {
            event.stopPropagation();
            const field = subtableBtn.getAttribute('data-field');
            if (field) {
              vscode.postMessage({ command: 'openFieldAsTable', field });
            }
            return;
          }

          const delBtn = event.target.closest('.delete-btn');
          if (delBtn) {
            event.stopPropagation();
            const field = delBtn.getAttribute('data-field');
            if (field) {
              vscode.postMessage({ command: 'deleteField', field });
            }
            return;
          }

          const delDocBtn = event.target.closest('.delete-doc-btn');
          if (delDocBtn) {
            event.stopPropagation();
            vscode.postMessage({ command: 'deleteDocument' });
            return;
          }

          const td = event.target.closest('.editable-cell');
          if (td) {
            clearSelectedCell();
            selectedCell = td;
            td.classList.add('selected');
            return;
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

      // Hydrate
      try {
        if (window.__INITIAL_DATA__) {
          documentId = window.__INITIAL_DATA__.documentId || '';
          docPath = window.__INITIAL_DATA__.docPath || '';
          parentCollectionPath = window.__INITIAL_DATA__.parentCollectionPath || '';
          allFields = window.__INITIAL_DATA__.fields || [];
          currentFields = allFields;
          const countEl = document.getElementById('field-count');
          if (countEl) countEl.textContent = allFields.length;
          updateEmptyState(allFields.length);
        }
      } catch (err) {
        showError('Hydration Error: ' + err.message);
      }

      vscode.postMessage({ command: 'ready' });
    })();
  `;
}

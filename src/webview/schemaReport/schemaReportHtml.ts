import { CollectionHealthReport } from "../../schema/schemaAnalyzer";

function escapeHtmlServer(val: any): string {
  if (val === null || val === undefined) return "";
  return String(val)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function getSchemaReportHtml(report: CollectionHealthReport, isReadOnly = false): string {
  const jsonReportStr = JSON.stringify(report)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Schema Drift &amp; Anomaly Health Report: ${escapeHtmlServer(report.collectionPath)}</title>
  <style>
    :root {
      --bg-color: var(--vscode-editor-background, #1e1e1e);
      --text-color: var(--vscode-editor-foreground, #d4d4d4);
      --card-bg: var(--vscode-editorWidget-background, rgba(255, 255, 255, 0.04));
      --card-border: var(--vscode-widget-border, var(--vscode-panel-border, rgba(128, 128, 128, 0.2)));
      --accent: var(--vscode-textLink-foreground, #3794ff);
      --success: #4ec9b0;
      --warning: #cca700;
      --danger: #f14c4c;
      --muted: var(--vscode-descriptionForeground, #888888);
      --font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
      --mono-font: var(--vscode-editor-font-family, Consolas, Monaco, monospace);
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      background-color: var(--bg-color);
      color: var(--text-color);
      font-family: var(--font-family);
      padding: 24px;
      line-height: 1.5;
    }

    .header-container {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 24px;
      border-bottom: 1px solid var(--card-border);
      padding-bottom: 16px;
      flex-wrap: wrap;
      gap: 16px;
    }

    .header-title {
      font-size: 1.45rem;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .header-subtitle {
      color: var(--muted);
      font-size: 0.9rem;
      margin-top: 4px;
    }

    .header-actions {
      display: flex;
      gap: 8px;
    }

    button {
      background: var(--vscode-button-background, #0e639c);
      color: var(--vscode-button-foreground, #ffffff);
      border: none;
      padding: 6px 14px;
      border-radius: 4px;
      font-size: 0.85rem;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-family: inherit;
    }

    button:hover {
      background: var(--vscode-button-hoverBackground, #1177bb);
    }

    button.secondary {
      background: var(--vscode-button-secondaryBackground, #3a3d41);
      color: var(--vscode-button-secondaryForeground, #cccccc);
    }

    button.secondary:hover {
      background: var(--vscode-button-secondaryHoverBackground, #45494e);
    }

    /* Health KPI Cards */
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }

    .kpi-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 6px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      position: relative;
    }

    .kpi-title {
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--muted);
      margin-bottom: 8px;
    }

    .kpi-value {
      font-size: 1.7rem;
      font-weight: 700;
      display: flex;
      align-items: baseline;
      gap: 6px;
    }

    .kpi-desc {
      font-size: 0.8rem;
      color: var(--muted);
      margin-top: 4px;
    }

    .score-high { color: var(--success); }
    .score-med { color: var(--warning); }
    .score-low { color: var(--danger); }

    /* Filter Bar */
    .filter-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
      gap: 12px;
      flex-wrap: wrap;
    }

    .search-box {
      padding: 6px 12px;
      border-radius: 4px;
      border: 1px solid var(--card-border);
      background: var(--vscode-input-background, #252526);
      color: var(--vscode-input-foreground, #cccccc);
      font-size: 0.85rem;
      min-width: 260px;
    }

    .pill-filters {
      display: flex;
      gap: 6px;
    }

    .filter-pill {
      padding: 4px 10px;
      border-radius: 14px;
      border: 1px solid var(--card-border);
      background: var(--card-bg);
      color: var(--text-color);
      font-size: 0.75rem;
      cursor: pointer;
      user-select: none;
    }

    .filter-pill.active {
      background: var(--accent);
      color: #fff;
      border-color: var(--accent);
    }

    /* Health Table */
    .table-container {
      border: 1px solid var(--card-border);
      border-radius: 6px;
      background: var(--card-bg);
      overflow-x: auto;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
      font-size: 0.85rem;
    }

    th {
      background: rgba(128, 128, 128, 0.08);
      color: var(--text-color);
      padding: 10px 14px;
      font-weight: 600;
      border-bottom: 1px solid var(--card-border);
      user-select: none;
    }

    td {
      padding: 10px 14px;
      border-bottom: 1px solid var(--card-border);
      vertical-align: middle;
    }

    tr:hover td {
      background: rgba(128, 128, 128, 0.04);
    }

    .field-name {
      font-family: var(--mono-font);
      font-weight: 600;
      color: var(--vscode-symbolIcon-fieldForeground, #75beff);
    }

    .progress-bar-container {
      width: 100%;
      height: 8px;
      background: rgba(128, 128, 128, 0.2);
      border-radius: 4px;
      overflow: hidden;
      margin-top: 4px;
    }

    .progress-bar-fill {
      height: 100%;
      background: var(--success);
      border-radius: 4px;
    }

    .progress-bar-fill.warning {
      background: var(--warning);
    }

    .progress-bar-fill.danger {
      background: var(--danger);
    }

    .type-chip {
      display: inline-block;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 0.75rem;
      font-family: var(--mono-font);
      background: rgba(128, 128, 128, 0.15);
      margin-right: 4px;
      margin-bottom: 2px;
      border: 1px solid rgba(128, 128, 128, 0.2);
    }

    .chip-mixed {
      background: rgba(241, 76, 76, 0.15);
      color: var(--danger);
      border-color: rgba(241, 76, 76, 0.4);
    }

    .badge-anomaly {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 0.75rem;
      font-weight: 500;
      background: rgba(204, 167, 0, 0.15);
      color: var(--warning);
      border: 1px solid rgba(204, 167, 0, 0.3);
      margin-right: 4px;
    }

    .badge-orphan {
      background: rgba(241, 76, 76, 0.15);
      color: var(--danger);
      border: 1px solid rgba(241, 76, 76, 0.3);
    }

    .btn-autofix {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px 8px;
      font-size: 0.75rem;
      border-radius: 4px;
      margin-top: 6px;
      background: var(--vscode-button-secondaryBackground, rgba(128, 128, 128, 0.2));
      color: var(--vscode-button-secondaryForeground, #ffffff);
      border: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.3));
      cursor: pointer;
    }
    .btn-autofix:hover {
      background: var(--vscode-button-secondaryHoverBackground, rgba(128, 128, 128, 0.35));
    }

    /* Exclusion / Document Filter Bar */
    .exclusion-bar {
      margin-top: 10px;
      padding: 8px 12px;
      background: rgba(128, 128, 128, 0.06);
      border: 1px dashed var(--card-border);
      border-radius: 6px;
      font-size: 0.82rem;
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    .exclusion-tags {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }
    .exclusion-tag {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      border-radius: 12px;
      background: rgba(241, 76, 76, 0.15);
      color: var(--danger);
      border: 1px solid rgba(241, 76, 76, 0.35);
      font-family: var(--mono-font);
      font-size: 0.8rem;
    }
    .exclusion-tag-remove {
      cursor: pointer;
      opacity: 0.7;
      font-weight: bold;
      padding: 0 2px;
    }
    .exclusion-tag-remove:hover {
      opacity: 1;
    }
    .btn-exclude-picker {
      background: var(--vscode-button-secondaryBackground, #3a3d41);
      color: var(--vscode-button-secondaryForeground, #cccccc);
      border: 1px solid var(--card-border);
      padding: 3px 8px;
      font-size: 0.8rem;
      border-radius: 4px;
      cursor: pointer;
    }
    .btn-exclude-picker:hover {
      background: var(--vscode-button-secondaryHoverBackground, #45494e);
    }

    /* Exclusion Modal */
    .modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.65);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
    }
    .modal-box {
      background: var(--bg-color);
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 20px;
      width: 480px;
      max-width: 90vw;
      max-height: 80vh;
      display: flex;
      flex-direction: column;
      gap: 12px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    }
    .modal-list {
      overflow-y: auto;
      max-height: 320px;
      border: 1px solid var(--card-border);
      border-radius: 4px;
      padding: 6px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .modal-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 6px;
      border-radius: 3px;
      cursor: pointer;
      font-family: var(--mono-font);
      font-size: 0.85rem;
    }
    .modal-item:hover {
      background: rgba(128, 128, 128, 0.1);
    }
  </style>
</head>
<body>
  <div class="header-container">
    <div>
      <div class="header-title">
        <span>🔬 Collection Schema Drift & Anomaly Analyzer</span>
      </div>
      <div class="header-subtitle">
        Collection: <b>${escapeHtmlServer(report.collectionPath)}</b> • Connection: <b>${escapeHtmlServer(report.connectionName)}</b> • Sampled: <b id="sampledCountHeader">${report.sampledCount}</b> documents
      </div>
      <div class="exclusion-bar" id="exclusionBar">
        <span>🚫 Excluded Documents (<span id="excludedCount">${report.excludedDocIds?.length || 0}</span>):</span>
        <div class="exclusion-tags" id="exclusionTags">
          <!-- Rendered via JS -->
        </div>
        <button id="btnManageExclusions" class="btn-exclude-picker">⚙️ Exclude Documents (e.g. metadata)...</button>
      </div>
    </div>
    <div class="header-actions">
      <button id="rescanBtn" class="secondary">🔄 Resample & Rescan</button>
      <button id="exportMdBtn">📄 Export Markdown</button>
      <button id="exportJsonBtn" class="secondary">📦 Export JSON</button>
    </div>
  </div>

  <!-- KPI Grid -->
  <div class="kpi-grid">
    <div class="kpi-card">
      <div class="kpi-title">Overall Health Score</div>
      <div id="kpiScoreVal" class="kpi-value ${report.overallHealthScore >= 80 ? 'score-high' : report.overallHealthScore >= 50 ? 'score-med' : 'score-low'}">
        ${report.overallHealthScore}<span style="font-size: 1rem;">/100</span>
      </div>
      <div id="kpiScoreDesc" class="kpi-desc">${report.overallHealthScore >= 80 ? 'Robust & Consistent Schema' : report.overallHealthScore >= 50 ? 'Moderate Schema Drift Detected' : 'Significant Inconsistencies / Anomalies'}</div>
    </div>

    <div class="kpi-card">
      <div class="kpi-title">Total Unique Keys</div>
      <div id="kpiKeysVal" class="kpi-value">${report.totalUniqueFields}</div>
      <div id="kpiKeysDesc" class="kpi-desc">Across ${report.sampledCount} sampled documents</div>
    </div>

    <div class="kpi-card">
      <div class="kpi-title">Mixed Type Conflicts</div>
      <div id="kpiMixedVal" class="kpi-value ${report.mixedTypesCount > 0 ? 'score-low' : 'score-high'}">
        ${report.mixedTypesCount}
      </div>
      <div class="kpi-desc">Keys with diverging non-null datatypes</div>
    </div>

    <div class="kpi-card">
      <div class="kpi-title">Orphan / Zombie Keys</div>
      <div id="kpiOrphansVal" class="kpi-value ${report.orphanKeysCount > 0 ? 'score-med' : 'score-high'}">
        ${report.orphanKeysCount}
      </div>
      <div class="kpi-desc">Obsolete fields (&lt; 5% occurrence)</div>
    </div>
  </div>

  <!-- Filter Controls -->
  <div class="filter-bar">
    <input type="text" id="searchInput" class="search-box" placeholder="Filter fields by name, type, or anomaly..." />
    <div class="pill-filters">
      <div class="filter-pill active" data-filter="all">All Fields (${report.totalUniqueFields})</div>
      <div class="filter-pill" data-filter="anomalies">Anomalies &amp; Warnings (${report.anomaliesCount})</div>
      <div class="filter-pill" data-filter="mixed">Mixed Types (${report.mixedTypesCount})</div>
      <div class="filter-pill" data-filter="orphans">Orphan Keys (${report.orphanKeysCount})</div>
      <div class="filter-pill" data-filter="perfect">100% Present</div>
    </div>
  </div>

  <!-- Table Container -->
  <div class="table-container">
    <table>
      <thead>
        <tr>
          <th>Field Path</th>
          <th style="width: 220px;">Presence & Frequency</th>
          <th>Type Distribution</th>
          <th>Health & Anomalies</th>
        </tr>
      </thead>
      <tbody id="tableBody">
        <!-- Rendered via JS -->
      </tbody>
    </table>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    let report = ${jsonReportStr};
    const isReadOnly = ${isReadOnly ? "true" : "false"};
    let currentFilter = 'all';
    let searchQuery = '';
    let searchDebounceTimer = null;

    const tbody = document.getElementById('tableBody');
    const searchInput = document.getElementById('searchInput');
    const pills = document.querySelectorAll('.filter-pill');
    const rescanBtn = document.getElementById('rescanBtn');
    const exportMdBtn = document.getElementById('exportMdBtn');
    const exportJsonBtn = document.getElementById('exportJsonBtn');

    function renderFields() {
      tbody.innerHTML = '';
      const q = searchQuery.toLowerCase().trim();

      const filtered = report.fields.filter(f => {
        // Pill filter
        if (currentFilter === 'anomalies' && f.sampleErrorsOrAnomalies.length === 0) return false;
        if (currentFilter === 'mixed' && !f.isPrimaryTypeMixed) return false;
        if (currentFilter === 'orphans' && !f.isZombieOrOrphan) return false;
        if (currentFilter === 'perfect' && f.presencePercentage !== 100) return false;

        // Search text
        if (q) {
          const matchName = f.fieldPath.toLowerCase().includes(q);
          const matchTypes = f.typeDistributions.some(t => t.type.toLowerCase().includes(q));
          const matchAnomalies = f.sampleErrorsOrAnomalies.some(a => a.toLowerCase().includes(q));
          return matchName || matchTypes || matchAnomalies;
        }
        return true;
      });

      if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 32px; color: var(--muted);">No fields match the current filters</td></tr>';
        return;
      }

      const frag = document.createDocumentFragment();
      filtered.forEach(f => {
        const tr = document.createElement('tr');

        // Progress bar class
        let barClass = '';
        if (f.presencePercentage < 10) barClass = 'danger';
        else if (f.presencePercentage < 60) barClass = 'warning';

        // Type distribution chips
        let typesHtml = '';
        f.typeDistributions.forEach(t => {
          typesHtml += '<span class="type-chip ' + (f.isPrimaryTypeMixed ? 'chip-mixed' : '') + '">' +
            escapeHtml(t.type) + ' (' + t.percentage + '%)' +
            '</span>';
        });

        // Anomalies & Badges
        let anomalyHtml = '';
        if (f.isZombieOrOrphan) {
          anomalyHtml += '<span class="badge-anomaly badge-orphan">🧟 Orphan Key</span>';
        }
        if (f.isPrimaryTypeMixed) {
          anomalyHtml += '<span class="badge-anomaly" style="color:var(--danger); border-color:var(--danger);">⚠️ Mixed Types</span>';
        }
        if (f.nullCount > 0 && f.nullCount === f.occurrenceCount) {
          anomalyHtml += '<span class="badge-anomaly">💀 100% Null</span>';
        }

        f.sampleErrorsOrAnomalies.forEach(a => {
          anomalyHtml += '<div style="font-size:0.75rem; color:var(--muted); margin-top:2px;">• ' + escapeHtml(a) + '</div>';
        });

        if (!anomalyHtml) {
          anomalyHtml = '<span style="color:var(--success); font-size:0.8rem;">✓ Healthy</span>';
        } else if (!isReadOnly) {
          // Add 1-Click Auto-Fix action button to trigger bulk transformer
          let suggestedAction = 'cast_string_to_number';
          if (f.isZombieOrOrphan || (f.nullCount > 0 && f.nullCount === f.occurrenceCount)) {
            suggestedAction = 'delete_field';
          } else if (f.isPrimaryTypeMixed) {
            const hasNum = f.typeDistributions.some(t => t.type === 'number' || t.type === 'integer');
            const hasStr = f.typeDistributions.some(t => t.type === 'string');
            const hasTs = f.typeDistributions.some(t => t.type === 'Timestamp');
            if (hasNum && hasStr) suggestedAction = 'cast_string_to_number';
            else if (hasTs && hasStr) suggestedAction = 'cast_string_to_timestamp';
          } else if (f.missingCount > 0) {
            suggestedAction = 'backfill_default';
          }
          anomalyHtml += '<button class="btn-autofix" data-field="' + escapeHtml(f.fieldPath) + '" data-action="' + suggestedAction + '">⚡ Auto-Fix in Transformer...</button>';
        }

        tr.innerHTML = \`
          <td>
            <span class="field-name">\${escapeHtml(f.fieldPath)}</span>
          </td>
          <td>
            <div style="display:flex; justify-content:space-between; font-size:0.8rem;">
              <span>\${f.presencePercentage}%</span>
              <span style="color:var(--muted);">\${f.occurrenceCount} of \${report.sampledCount}</span>
            </div>
            <div class="progress-bar-container">
              <div class="progress-bar-fill \${barClass}" style="width: \${f.presencePercentage}%;"></div>
            </div>
          </td>
          <td>\${typesHtml}</td>
          <td>\${anomalyHtml}</td>
        \`;
        frag.appendChild(tr);
      });
      tbody.appendChild(frag);
    }

    function escapeHtml(str) {
      if (str === null || str === undefined) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    // Pill clicks
    pills.forEach(p => {
      p.addEventListener('click', () => {
        pills.forEach(x => x.classList.remove('active'));
        p.classList.add('active');
        currentFilter = p.getAttribute('data-filter');
        renderFields();
      });
    });

    // Search input (debounced)
    searchInput.addEventListener('input', () => {
      searchQuery = searchInput.value;
      if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(() => {
        renderFields();
      }, 120);
    });

    rescanBtn.addEventListener('click', () => {
      vscode.postMessage({ command: 'rescan' });
    });

    exportMdBtn.addEventListener('click', () => {
      vscode.postMessage({ command: 'exportMarkdown' });
    });

    exportJsonBtn.addEventListener('click', () => {
      vscode.postMessage({ command: 'exportJson' });
    });

    tbody.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-autofix');
      if (btn) {
        const fieldPath = btn.getAttribute('data-field');
        const suggestedAction = btn.getAttribute('data-action');
        if (fieldPath && suggestedAction) {
          launchAutoFix(fieldPath, suggestedAction);
        }
      }
    });

    function launchAutoFix(fieldPath, suggestedAction) {
      vscode.postMessage({
        command: 'launchTransformer',
        fieldPath: fieldPath,
        suggestedAction: suggestedAction
      });
    }

    // Exclusion Management
    const exclusionTagsEl = document.getElementById('exclusionTags');
    const btnManageExclusions = document.getElementById('btnManageExclusions');
    let excludedDocs = new Set(report.excludedDocIds || []);

    function renderExclusionTags() {
      if (!exclusionTagsEl) return;
      exclusionTagsEl.innerHTML = '';
      if (excludedDocs.size === 0) {
        exclusionTagsEl.innerHTML = '<span style="color:var(--muted); font-style:italic;">None (all sampled documents included)</span>';
        return;
      }
      excludedDocs.forEach(id => {
        const tag = document.createElement('span');
        tag.className = 'exclusion-tag';
        tag.innerHTML = '<span>' + escapeHtml(id) + '</span><span class="exclusion-tag-remove" data-id="' + escapeHtml(id) + '" title="Remove exclusion">&times;</span>';
        exclusionTagsEl.appendChild(tag);
      });
    }

    if (exclusionTagsEl) {
      exclusionTagsEl.addEventListener('click', (e) => {
        const removeBtn = e.target.closest('.exclusion-tag-remove');
        if (removeBtn) {
          const id = removeBtn.getAttribute('data-id');
          if (id) {
            excludedDocs.delete(id);
            renderExclusionTags();
            vscode.postMessage({
              command: 'updateExclusions',
              excludedDocIds: Array.from(excludedDocs)
            });
          }
        }
      });
    }

    if (btnManageExclusions) {
      btnManageExclusions.addEventListener('click', () => {
        showExclusionModal();
      });
    }

    function showExclusionModal() {
      const allDocIds = report.sampledDocIds || [];
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.id = 'exclusionModalOverlay';

      let itemsHtml = '';
      if (allDocIds.length === 0) {
        itemsHtml = '<div style="color:var(--muted); padding:10px;">No sampled document IDs found.</div>';
      } else {
        allDocIds.forEach(id => {
          const isChecked = excludedDocs.has(id);
          itemsHtml += '<label class="modal-item">' +
            '<input type="checkbox" class="exclude-doc-checkbox" value="' + escapeHtml(id) + '" ' + (isChecked ? 'checked' : '') + ' />' +
            '<span>' + escapeHtml(id) + '</span>' +
            (id.toLowerCase().includes('meta') || id.toLowerCase().includes('config') ? ' <span style="font-size:0.75rem; color:var(--warning);">(Likely Metadata)</span>' : '') +
            '</label>';
        });
      }

      overlay.innerHTML = '<div class="modal-box">' +
        '<h3 style="margin:0; font-size:1.1rem; display:flex; align-items:center; gap:8px;">' +
        '<span>🚫</span> Exclude Documents from Schema Analysis</h3>' +
        '<p style="margin:0; font-size:0.85rem; color:var(--muted);">' +
        'Select singleton or metadata documents (e.g. <code>metadata</code>, <code>_config</code>) to exclude them from calculations so data fields are not flagged as orphans.</p>' +
        '<div class="modal-list">' + itemsHtml + '</div>' +
        '<div style="display:flex; justify-content:flex-end; gap:8px; margin-top:8px;">' +
        '<button id="modalCancelBtn" class="secondary">Cancel</button>' +
        '<button id="modalApplyBtn">Apply Exclusions</button>' +
        '</div>' +
        '</div>';

      document.body.appendChild(overlay);

      const cancelBtn = overlay.querySelector('#modalCancelBtn');
      const applyBtn = overlay.querySelector('#modalApplyBtn');

      const closeModal = () => {
        document.removeEventListener('keydown', onKeyDown);
        overlay.remove();
      };

      const onKeyDown = (ev) => {
        if (ev.key === 'Escape') {
          closeModal();
        }
      };
      document.addEventListener('keydown', onKeyDown);

      overlay.addEventListener('click', (ev) => {
        if (ev.target === overlay) {
          closeModal();
        }
      });

      cancelBtn.addEventListener('click', closeModal);

      applyBtn.addEventListener('click', () => {
        const checkboxes = overlay.querySelectorAll('.exclude-doc-checkbox');
        const newExcluded = new Set();
        checkboxes.forEach(cb => {
          if (cb.checked) newExcluded.add(cb.value);
        });
        excludedDocs = newExcluded;
        closeModal();
        renderExclusionTags();
        vscode.postMessage({
          command: 'updateExclusions',
          excludedDocIds: Array.from(excludedDocs)
        });
      });
    }

    function updateReportSummary(newReport) {
      report = newReport;
      excludedDocs = new Set(report.excludedDocIds || []);

      const sampledHeader = document.getElementById('sampledCountHeader');
      if (sampledHeader) sampledHeader.textContent = report.sampledCount;

      const excludedCountEl = document.getElementById('excludedCount');
      if (excludedCountEl) excludedCountEl.textContent = excludedDocs.size;

      const scoreVal = document.getElementById('kpiScoreVal');
      const scoreDesc = document.getElementById('kpiScoreDesc');
      if (scoreVal) {
        scoreVal.className = 'kpi-value ' + (report.overallHealthScore >= 80 ? 'score-high' : report.overallHealthScore >= 50 ? 'score-med' : 'score-low');
        scoreVal.innerHTML = report.overallHealthScore + '<span style="font-size: 1rem;">/100</span>';
      }
      if (scoreDesc) {
        scoreDesc.textContent = report.overallHealthScore >= 80
          ? 'Robust & Consistent Schema'
          : report.overallHealthScore >= 50
            ? 'Moderate Schema Drift Detected'
            : 'Significant Inconsistencies / Anomalies';
      }

      const keysVal = document.getElementById('kpiKeysVal');
      const keysDesc = document.getElementById('kpiKeysDesc');
      if (keysVal) keysVal.textContent = report.totalUniqueFields;
      if (keysDesc) keysDesc.textContent = 'Across ' + report.sampledCount + ' sampled documents';

      const mixedVal = document.getElementById('kpiMixedVal');
      if (mixedVal) {
        mixedVal.className = 'kpi-value ' + (report.mixedTypesCount > 0 ? 'score-low' : 'score-high');
        mixedVal.textContent = report.mixedTypesCount;
      }

      const orphansVal = document.getElementById('kpiOrphansVal');
      if (orphansVal) {
        orphansVal.className = 'kpi-value ' + (report.orphanKeysCount > 0 ? 'score-med' : 'score-high');
        orphansVal.textContent = report.orphanKeysCount;
      }

      pills.forEach(p => {
        const f = p.getAttribute('data-filter');
        if (f === 'all') p.textContent = 'All Fields (' + report.totalUniqueFields + ')';
        else if (f === 'anomalies') p.textContent = 'Anomalies & Warnings (' + report.anomaliesCount + ')';
        else if (f === 'mixed') p.textContent = 'Mixed Types (' + report.mixedTypesCount + ')';
        else if (f === 'orphans') p.textContent = 'Orphan Keys (' + report.orphanKeysCount + ')';
      });

      renderExclusionTags();
      renderFields();
    }

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg && msg.command === 'updateReport' && msg.report) {
        updateReportSummary(msg.report);
      }
    });

    renderExclusionTags();

    // Initial render
    renderFields();
  </script>
</body>
</html>`;
}

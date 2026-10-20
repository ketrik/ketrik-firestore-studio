/**
 * Shared CSS styles for Firestore Table webviews (Collection Table and Field Table).
 */
export function getSharedTableStyles(): string {
  return `
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
    .collection-name, .field-name {
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
    .doc-parent-link {
      cursor: pointer;
      color: var(--vscode-textLink-foreground, #3794ff);
      text-decoration: underline;
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
      background-color: var(--vscode-editor-background);
      background-image: linear-gradient(
        var(--vscode-editorGroupHeader-tabsBackground, var(--vscode-sideBar-background, rgba(128,128,128,0.1))),
        var(--vscode-editorGroupHeader-tabsBackground, var(--vscode-sideBar-background, rgba(128,128,128,0.1)))
      );
      font-weight: 600;
      color: var(--vscode-editor-foreground);
      position: sticky;
      top: 0;
      z-index: 8;
      letter-spacing: 0.02em;
      text-transform: uppercase;
      font-size: 0.78em;
      border-bottom: 2px solid var(--vscode-focusBorder, rgba(128,128,128,0.3));
    }
    th.envelope-header {
      background-color: var(--vscode-editor-background);
      background-image: linear-gradient(rgba(157, 107, 240, 0.08), rgba(157, 107, 240, 0.08));
      border-bottom-color: #9d6bf0;
    }
    th.protocol-header {
      background-color: var(--vscode-editor-background);
      background-image: linear-gradient(rgba(240, 98, 146, 0.08), rgba(240, 98, 146, 0.08));
      border-bottom-color: #f06292;
    }
    .th-tag {
      display: inline-block;
      font-size: 0.85em;
      padding: 1px 4px;
      border-radius: 3px;
      margin-right: 4px;
      text-transform: none;
      font-family: var(--mono-font);
    }
    .th-tag.envelope {
      background: rgba(157, 107, 240, 0.2);
      color: #b388ff;
    }
    .th-tag.protocol {
      background: rgba(240, 98, 146, 0.2);
      color: #ff80ab;
    }
    .toggle-btn.active {
      background: var(--vscode-badge-background, #4d4d4d);
      color: var(--vscode-badge-foreground, #fff);
    }
    table.hide-proto .col-proto,
    table.hide-proto th.col-proto,
    table.hide-proto td.col-proto {
      display: none !important;
    }
    table.hide-env .col-env,
    table.hide-env th.col-env,
    table.hide-env td.col-env {
      display: none !important;
    }
    th.id-header {
      width: 190px;
      min-width: 170px;
      position: sticky;
      left: 0;
      top: 0;
      z-index: 11;
      background-color: var(--vscode-editor-background);
      background-image: linear-gradient(
        var(--vscode-editorGroupHeader-tabsBackground, var(--vscode-sideBar-background, #1e1e1e)),
        var(--vscode-editorGroupHeader-tabsBackground, var(--vscode-sideBar-background, #1e1e1e))
      );
      border-right: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.25));
    }
    td.sticky-col {
      position: sticky;
      left: 0;
      z-index: 4;
      background-color: var(--vscode-editor-background);
      border-right: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.25));
    }
    tbody tr:nth-child(even) td.sticky-col {
      background-color: var(--vscode-editor-background);
      background-image: linear-gradient(rgba(128, 128, 128, 0.035), rgba(128, 128, 128, 0.035));
    }
    tbody tr:hover td.sticky-col {
      background-color: var(--vscode-editor-background) !important;
      background-image: linear-gradient(
        var(--vscode-list-hoverBackground, rgba(128, 128, 128, 0.15)),
        var(--vscode-list-hoverBackground, rgba(128, 128, 128, 0.15))
      ) !important;
    }
    th.sticky-actions, td.sticky-actions {
      position: sticky;
      right: 0;
      border-left: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.25));
    }
    th.sticky-actions {
      z-index: 11;
      background-color: var(--vscode-editor-background);
      background-image: linear-gradient(
        var(--vscode-editorGroupHeader-tabsBackground, var(--vscode-sideBar-background, #1e1e1e)),
        var(--vscode-editorGroupHeader-tabsBackground, var(--vscode-sideBar-background, #1e1e1e))
      );
    }
    td.sticky-actions {
      z-index: 4;
      background-color: var(--vscode-editor-background);
    }
    tbody tr:nth-child(even) td.sticky-actions {
      background-color: var(--vscode-editor-background);
      background-image: linear-gradient(rgba(128, 128, 128, 0.035), rgba(128, 128, 128, 0.035));
    }
    tbody tr:hover td.sticky-actions {
      background-color: var(--vscode-editor-background) !important;
      background-image: linear-gradient(
        var(--vscode-list-hoverBackground, rgba(128, 128, 128, 0.15)),
        var(--vscode-list-hoverBackground, rgba(128, 128, 128, 0.15))
      ) !important;
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
    .doc-id-cell, .row-id-cell {
      font-family: var(--mono-font);
      font-size: 0.88em;
      font-weight: 600;
      color: var(--vscode-textLink-foreground, #3794ff);
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .doc-id-cell svg, .row-id-cell svg {
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
    .lifecycle-pill {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 0.76em;
      font-weight: 600;
      padding: 1px 6px;
      border-radius: 10px;
      letter-spacing: 0.02em;
      text-transform: uppercase;
      user-select: none;
      flex-shrink: 0;
    }
    .lifecycle-pill.pill-active {
      background: rgba(46, 204, 113, 0.18);
      color: #2ecc71;
      border: 1px solid rgba(46, 204, 113, 0.4);
    }
    .lifecycle-pill.pill-scheduled {
      background: rgba(241, 196, 15, 0.18);
      color: #f1c40f;
      border: 1px solid rgba(241, 196, 15, 0.4);
    }
    .lifecycle-pill.pill-expired {
      background: rgba(231, 76, 60, 0.18);
      color: #e74c3c;
      border: 1px solid rgba(231, 76, 60, 0.4);
    }
    .lifecycle-pill.pill-inactive {
      background: rgba(149, 165, 166, 0.18);
      color: #95a5a6;
      border: 1px solid rgba(149, 165, 166, 0.4);
    }
    .time-travel-panel {
      background: var(--vscode-editorWidget-background, rgba(128, 128, 128, 0.08));
      border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border, rgba(128, 128, 128, 0.25)));
      border-radius: 6px;
      padding: 10px 14px;
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
    }
    .time-travel-controls {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .time-travel-title {
      display: flex;
      align-items: center;
      gap: 6px;
      font-weight: 600;
      font-size: 0.9em;
      color: var(--vscode-editor-foreground);
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
    .cell-input {
      width: 100%;
      padding: 3px 6px;
      font-size: 0.9em;
      font-family: inherit;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-focusBorder);
      outline: none;
      border-radius: 2px;
    }
    td.editing {
      padding: 2px 4px !important;
      background: var(--vscode-editor-background) !important;
    }
    td.selected {
      outline: 2px solid var(--vscode-focusBorder);
      outline-offset: -2px;
    }
    .row-action-btn {
      opacity: 0.7;
      background: transparent;
      border: none;
      cursor: pointer;
      padding: 3px 6px;
      border-radius: 3px;
      color: var(--vscode-editor-foreground);
      font-size: 1.05em;
      transition: opacity 0.15s ease, background 0.15s ease;
    }
    .row-action-btn:hover {
      opacity: 1;
      background: rgba(231, 76, 60, 0.2);
      color: #e74c3c;
    }
    .flash-update {
      animation: cellFlash 1.2s ease-out;
    }
    @keyframes cellFlash {
      0% { background-color: rgba(46, 204, 113, 0.4); }
      100% { background-color: transparent; }
    }
  `;
}

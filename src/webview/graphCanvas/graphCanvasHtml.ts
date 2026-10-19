import { GraphData } from "../../graph/graphModel.js";

export function getGraphCanvasHtml(graphData: GraphData): string {
  const initialDataJson = JSON.stringify(graphData).replace(/</g, "\\u003c");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: https:; font-src data:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Data Graph Canvas: ${graphData.rootPath}</title>
  <style>
    :root {
      --bg-color: var(--vscode-editor-background, #1e1e1e);
      --fg-color: var(--vscode-editor-foreground, #cccccc);
      --card-bg: var(--vscode-editorWidget-background, #252526);
      --card-border: var(--vscode-widget-border, rgba(128, 128, 128, 0.3));
      --accent: var(--vscode-textLink-foreground, #3794ff);
      --edge-color: var(--vscode-charts-blue, #3794ff);
      --edge-ref-color: var(--vscode-charts-orange, #e67e22);
      --font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
      --mono-font: var(--vscode-editor-font-family, Consolas, Monaco, monospace);
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body, html {
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: var(--bg-color);
      color: var(--fg-color);
      font-family: var(--font-family);
      user-select: none;
    }
    /* Toolbar header */
    .graph-toolbar {
      position: absolute;
      top: 14px;
      left: 16px;
      right: 16px;
      height: 44px;
      z-index: 100;
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: var(--vscode-editorWidget-background, #252526);
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 0 14px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
    }
    .toolbar-left {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .toolbar-title {
      font-weight: 600;
      font-size: 1.05em;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .toolbar-badge {
      font-size: 0.78em;
      padding: 2px 7px;
      border-radius: 12px;
      background: var(--vscode-badge-background, rgba(128, 128, 128, 0.2));
      color: var(--vscode-badge-foreground);
    }
    .toolbar-stats {
      font-size: 0.85em;
      color: var(--vscode-descriptionForeground, #888);
    }
    .toolbar-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    button {
      background: var(--vscode-button-secondaryBackground, #3a3d41);
      color: var(--vscode-button-secondaryForeground, #ffffff);
      border: 1px solid var(--vscode-button-border, transparent);
      padding: 4px 10px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.85em;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      transition: background 0.1s ease;
    }
    button:hover {
      background: var(--vscode-button-secondaryHoverBackground, #45494e);
    }
    button.primary {
      background: var(--vscode-button-background, #007acc);
      color: var(--vscode-button-foreground, #ffffff);
    }
    button.primary:hover {
      background: var(--vscode-button-hoverBackground, #0062a3);
    }
    .search-input {
      background: var(--vscode-input-background, #3c3c3c);
      color: var(--vscode-input-foreground, #cccccc);
      border: 1px solid var(--vscode-input-border, rgba(128, 128, 128, 0.3));
      border-radius: 4px;
      padding: 4px 8px;
      font-size: 0.85em;
      width: 160px;
    }
    .search-input:focus {
      outline: 1px solid var(--vscode-focusBorder, #007acc);
    }

    /* Viewport pan/zoom container */
    #viewport {
      width: 100%;
      height: 100%;
      position: relative;
      cursor: grab;
      background-image: radial-gradient(var(--card-border) 1px, transparent 1px);
      background-size: 24px 24px;
    }
    #viewport.dragging {
      cursor: grabbing;
    }

    /* Transform layer holding both SVG and HTML nodes */
    #canvas-layer {
      position: absolute;
      top: 0;
      left: 0;
      transform-origin: 0 0;
      will-change: transform;
    }

    /* SVG edge layer */
    #edge-svg {
      position: absolute;
      top: 0;
      left: 0;
      width: 10000px;
      height: 10000px;
      pointer-events: none;
      overflow: visible;
    }
    .graph-edge {
      fill: none;
      stroke: var(--edge-color);
      stroke-width: 2px;
      opacity: 0.65;
      transition: stroke 0.15s ease, opacity 0.15s ease, stroke-width 0.15s ease;
    }
    .graph-edge.ref-edge {
      stroke: var(--edge-ref-color);
      stroke-dasharray: 6 3;
    }
    .graph-edge.highlighted {
      stroke-width: 3.5px !important;
      opacity: 1 !important;
      filter: drop-shadow(0 0 4px var(--edge-color));
    }
    .edge-label-bg {
      fill: var(--card-bg);
      rx: 4px;
      ry: 4px;
      stroke: var(--card-border);
      stroke-width: 1px;
    }
    .edge-label-text {
      font-size: 11px;
      font-family: var(--mono-font);
      fill: var(--fg-color);
      text-anchor: middle;
      dominant-baseline: middle;
      pointer-events: none;
    }

    /* HTML Box Nodes */
    .graph-node {
      position: absolute;
      width: 250px;
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 8px;
      box-shadow: 0 6px 18px rgba(0, 0, 0, 0.28);
      cursor: pointer;
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .graph-node:hover {
      border-color: var(--accent);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
    }
    .graph-node.selected {
      border: 2px solid var(--accent);
      box-shadow: 0 0 0 3px rgba(55, 148, 255, 0.35);
    }
    .graph-node.collection-node {
      border-top: 4px solid var(--vscode-charts-orange, #f39c12);
      width: 220px;
    }
    .graph-node.subcollection-node {
      border-top: 4px solid var(--vscode-charts-purple, #9b59b6);
      width: 200px;
    }
    .graph-node.document-node {
      border-top: 4px solid var(--vscode-charts-blue, #3498db);
    }

    .node-header {
      padding: 9px 12px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid var(--card-border);
      background: rgba(128, 128, 128, 0.05);
    }
    .node-header-title {
      font-weight: 600;
      font-size: 0.9em;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .node-header-badge {
      font-size: 0.72em;
      padding: 1px 5px;
      border-radius: 4px;
      background: rgba(128, 128, 128, 0.15);
      color: var(--vscode-descriptionForeground);
      text-transform: uppercase;
      font-weight: 500;
    }
    .node-body {
      padding: 8px 12px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      max-height: 220px;
      overflow-y: auto;
    }
    .node-field-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 0.82em;
      padding: 2px 0;
      border-bottom: 1px solid rgba(128, 128, 128, 0.08);
    }
    .node-field-name {
      font-family: var(--mono-font);
      color: var(--vscode-editor-foreground);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 100px;
    }
    .node-field-val {
      font-family: var(--mono-font);
      color: var(--vscode-descriptionForeground);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 120px;
      text-align: right;
    }
    .node-field-val.is-ref {
      color: var(--edge-ref-color);
      font-weight: 600;
      cursor: pointer;
    }
    .node-field-val.is-ref:hover {
      text-decoration: underline;
    }
    .node-footer {
      padding: 6px 12px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: rgba(128, 128, 128, 0.03);
      border-top: 1px solid var(--card-border);
      font-size: 0.76em;
      color: var(--vscode-descriptionForeground);
    }
    .node-action-link {
      color: var(--accent);
      cursor: pointer;
      text-decoration: none;
    }
    .node-action-link:hover {
      text-decoration: underline;
    }

    /* Port circles for connections */
    .node-port {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--accent);
      border: 2px solid var(--card-bg);
      position: absolute;
    }
    .port-left {
      left: -5px;
      top: 50%;
      transform: translateY(-50%);
    }
    .port-right {
      right: -5px;
      top: 50%;
      transform: translateY(-50%);
    }

    /* Mini-map */
    .mini-map-box {
      position: absolute;
      bottom: 18px;
      right: 18px;
      width: 180px;
      height: 120px;
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 6px;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
      z-index: 100;
      overflow: hidden;
      opacity: 0.9;
    }
    .mini-map-viewport {
      position: absolute;
      border: 1.5px solid var(--accent);
      background: rgba(55, 148, 255, 0.15);
      pointer-events: none;
    }
  </style>
</head>
<body>

  <!-- Top Graph Toolbar -->
  <div class="graph-toolbar">
    <div class="toolbar-left">
      <div class="toolbar-title">
        <span>🕸️</span> Data Graph: <code>${graphData.rootPath}</code>
      </div>
      <span class="toolbar-badge">${graphData.connectionId}</span>
      <div class="toolbar-stats" id="graphStats">0 nodes • 0 edges</div>
    </div>
    <div class="toolbar-actions">
      <input type="text" id="nodeSearch" class="search-input" placeholder="Search node ID..." />
      <button id="zoomInBtn" title="Zoom In (+)">➕</button>
      <button id="zoomOutBtn" title="Zoom Out (-)">➖</button>
      <button id="resetZoomBtn" title="Fit to View">🎯 Reset</button>
      <button id="autoLayoutBtn" class="primary" title="Re-arrange nodes hierarchically">🔄 Auto Layout</button>
    </div>
  </div>

  <!-- Main Viewport Canvas -->
  <div id="viewport">
    <div id="canvas-layer">
      <svg id="edge-svg">
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="var(--edge-color)" />
          </marker>
          <marker id="arrow-ref" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="var(--edge-ref-color)" />
          </marker>
        </defs>
        <g id="edge-group"></g>
      </svg>
      <div id="nodes-container"></div>
    </div>
  </div>

  <!-- Mini Map -->
  <div class="mini-map-box" id="miniMap">
    <svg id="mini-map-svg" width="180" height="120"></svg>
    <div class="mini-map-viewport" id="miniMapViewport"></div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    let graphData = ${initialDataJson};

    // Viewport transform state
    let panX = 120;
    let panY = 100;
    let zoom = 1.0;
    const MIN_ZOOM = 0.2;
    const MAX_ZOOM = 2.5;

    const viewport = document.getElementById('viewport');
    const canvasLayer = document.getElementById('canvas-layer');
    const edgeGroup = document.getElementById('edge-group');
    const nodesContainer = document.getElementById('nodes-container');
    const graphStats = document.getElementById('graphStats');
    const miniMapSvg = document.getElementById('mini-map-svg');
    const miniMapViewport = document.getElementById('miniMapViewport');

    // Node positioning and layout
    const nodePositions = new Map(); // id -> { x, y, width, height }
    let selectedNodeId = null;

    function updateTransform() {
      canvasLayer.style.transform = 'translate(' + panX + 'px, ' + panY + 'px) scale(' + zoom + ')';
      updateMiniMap();
    }

    // Auto-layout algorithm (Hierarchical layered tree)
    function runAutoLayout() {
      const rootNode = graphData.nodes.find(n => n.id === graphData.rootPath) || graphData.nodes[0];
      if (!rootNode) return;

      const levels = new Map(); // level -> GraphNode[]
      const visited = new Set();

      function assignLevel(nodeId, level) {
        if (visited.has(nodeId)) return;
        visited.add(nodeId);

        if (!levels.has(level)) levels.set(level, []);
        const node = graphData.nodes.find(n => n.id === nodeId);
        if (node) {
          levels.get(level).push(node);
        }

        // Outgoing edges
        const outEdges = graphData.edges.filter(e => e.source === nodeId);
        outEdges.forEach(e => {
          assignLevel(e.target, level + 1);
        });
      }

      assignLevel(rootNode.id, 0);

      // Remaining unvisited nodes
      graphData.nodes.forEach(n => {
        if (!visited.has(n.id)) {
          assignLevel(n.id, 1);
        }
      });

      // Position nodes by level (columns)
      const X_SPACING = 360;
      const Y_SPACING = 210;

      levels.forEach((nodesInLevel, level) => {
        const startY = 80;
        nodesInLevel.forEach((n, idx) => {
          const x = 100 + (level * X_SPACING);
          const y = startY + (idx * Y_SPACING);
          nodePositions.set(n.id, {
            x,
            y,
            width: n.type === 'collection' ? 220 : 250,
            height: 160
          });
        });
      });

      renderGraph();
    }

    function renderGraph() {
      // 1. Render HTML Nodes
      nodesContainer.innerHTML = '';
      graphData.nodes.forEach(node => {
        const pos = nodePositions.get(node.id) || { x: 100, y: 100, width: 250, height: 160 };
        const card = document.createElement('div');
        card.className = 'graph-node ' + (node.type + '-node');
        if (selectedNodeId === node.id) card.classList.add('selected');
        card.id = 'node-' + CSS.escape(node.id);
        card.style.left = pos.x + 'px';
        card.style.top = pos.y + 'px';

        let typeBadge = node.type === 'collection' ? 'Coll' : node.type === 'subcollection' ? 'Sub' : 'Doc';
        let icon = node.type === 'collection' ? '📁' : node.type === 'subcollection' ? '🗂️' : '📄';

        let fieldsHtml = '';
        if (node.fields && node.fields.length > 0) {
          fieldsHtml = node.fields.map(f => \`
            <div class="node-field-row">
              <span class="node-field-name">\${escapeHtml(f.name)}</span>
              <span class="node-field-val \${f.isRef ? 'is-ref' : ''}" data-ref="\${f.refPath ? escapeHtml(f.refPath) : ''}" title="\${escapeHtml(f.valuePreview)}">
                \${escapeHtml(f.valuePreview)}
              </span>
            </div>
          \`).join('');
        } else if (node.type === 'collection') {
          fieldsHtml = '<div style="font-size: 0.8em; color: var(--vscode-descriptionForeground); padding: 8px 0;">Collection partition root</div>';
        } else {
          fieldsHtml = '<div style="font-size: 0.8em; color: var(--vscode-descriptionForeground); padding: 8px 0;">Empty document or map</div>';
        }

        let footerActions = '';
        if (node.type === 'document') {
          footerActions = \`
            <span class="node-action-link open-doc-btn" data-path="\${escapeHtml(node.id)}">↗ Edit Document</span>
            <span>\${node.referenceCount ? '🔗 ' + node.referenceCount + ' refs' : ''}</span>
          \`;
        } else {
          footerActions = \`
            <span class="node-action-link open-col-btn" data-path="\${escapeHtml(node.id)}">↗ Open Table</span>
            <span></span>
          \`;
        }

        card.innerHTML = \`
          <div class="node-header">
            <span class="node-header-title" title="\${escapeHtml(node.id)}">
              <span>\${icon}</span> \${escapeHtml(node.label)}
            </span>
            <span class="node-header-badge">\${typeBadge}</span>
          </div>
          <div class="node-body">\${fieldsHtml}</div>
          <div class="node-footer">\${footerActions}</div>
          <div class="node-port port-left"></div>
          <div class="node-port port-right"></div>
        \`;

        // Node drag handling
        let isNodeDragging = false;
        let startNodeMouseX = 0;
        let startNodeMouseY = 0;
        let startPosX = pos.x;
        let startPosY = pos.y;

        card.addEventListener('mousedown', (e) => {
          if (e.target.closest('.node-action-link') || e.target.closest('.is-ref')) return;
          e.stopPropagation();
          isNodeDragging = true;
          startNodeMouseX = e.clientX;
          startNodeMouseY = e.clientY;
          startPosX = pos.x;
          startPosY = pos.y;
          selectNode(node.id);
        });

        window.addEventListener('mousemove', (e) => {
          if (!isNodeDragging) return;
          const dx = (e.clientX - startNodeMouseX) / zoom;
          const dy = (e.clientY - startNodeMouseY) / zoom;
          pos.x = startPosX + dx;
          pos.y = startPosY + dy;
          card.style.left = pos.x + 'px';
          card.style.top = pos.y + 'px';
          renderEdges();
          updateMiniMap();
        });

        window.addEventListener('mouseup', () => {
          isNodeDragging = false;
        });

        nodesContainer.appendChild(card);
      });

      // 2. Render SVG Edges
      renderEdges();

      // Update toolbar stats
      graphStats.textContent = graphData.nodes.length + ' nodes • ' + graphData.edges.length + ' relationships';
      updateMiniMap();
    }

    function renderEdges() {
      edgeGroup.innerHTML = '';

      graphData.edges.forEach(edge => {
        const sourcePos = nodePositions.get(edge.source);
        const targetPos = nodePositions.get(edge.target);
        if (!sourcePos || !targetPos) return;

        // Calculate connector curve from source right to target left
        const x1 = sourcePos.x + (sourcePos.width || 250);
        const y1 = sourcePos.y + ((sourcePos.height || 160) / 2);
        const x2 = targetPos.x;
        const y2 = targetPos.y + ((targetPos.height || 160) / 2);

        const dx = Math.max(40, Math.abs(x2 - x1) * 0.45);
        const pathData = 'M ' + x1 + ' ' + y1 + ' C ' + (x1 + dx) + ' ' + y1 + ', ' + (x2 - dx) + ' ' + y2 + ', ' + x2 + ' ' + y2;

        const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        pathEl.setAttribute('d', pathData);
        pathEl.setAttribute('class', 'graph-edge' + (edge.type === 'reference' ? ' ref-edge' : ''));
        pathEl.setAttribute('marker-end', edge.type === 'reference' ? 'url(#arrow-ref)' : 'url(#arrow)');

        if (selectedNodeId && (edge.source === selectedNodeId || edge.target === selectedNodeId)) {
          pathEl.classList.add('highlighted');
        }

        edgeGroup.appendChild(pathEl);

        // Edge label (if reference field name exists)
        if (edge.label) {
          const midX = (x1 + x2) / 2;
          const midY = (y1 + y2) / 2;

          const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          rect.setAttribute('x', midX - 35);
          rect.setAttribute('y', midY - 9);
          rect.setAttribute('width', 70);
          rect.setAttribute('height', 18);
          rect.setAttribute('class', 'edge-label-bg');
          edgeGroup.appendChild(rect);

          const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          text.setAttribute('x', midX);
          text.setAttribute('y', midY);
          text.setAttribute('class', 'edge-label-text');
          text.textContent = edge.label;
          edgeGroup.appendChild(text);
        }
      });
    }

    function selectNode(nodeId) {
      selectedNodeId = nodeId;
      document.querySelectorAll('.graph-node').forEach(n => n.classList.remove('selected'));
      const activeEl = document.getElementById('node-' + CSS.escape(nodeId));
      if (activeEl) activeEl.classList.add('selected');
      renderEdges();
    }

    // Mini Map rendering
    function updateMiniMap() {
      miniMapSvg.innerHTML = '';
      if (graphData.nodes.length === 0) return;

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      nodePositions.forEach(p => {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x + p.width);
        maxY = Math.max(maxY, p.y + p.height);
      });

      const pad = 80;
      const boundsW = Math.max(1000, maxX - minX + pad * 2);
      const boundsH = Math.max(600, maxY - minY + pad * 2);
      const scaleX = 180 / boundsW;
      const scaleY = 120 / boundsH;
      const scale = Math.min(scaleX, scaleY);

      nodePositions.forEach(p => {
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', (p.x - minX + pad) * scale);
        rect.setAttribute('y', (p.y - minY + pad) * scale);
        rect.setAttribute('width', Math.max(4, p.width * scale));
        rect.setAttribute('height', Math.max(3, p.height * scale));
        rect.setAttribute('fill', 'var(--accent)');
        rect.setAttribute('rx', 1);
        miniMapSvg.appendChild(rect);
      });

      // Viewport indicator in mini-map
      const vpW = (window.innerWidth / zoom) * scale;
      const vpH = (window.innerHeight / zoom) * scale;
      const vpX = (-panX - minX + pad) * scale;
      const vpY = (-panY - minY + pad) * scale;

      miniMapViewport.style.left = Math.max(0, vpX) + 'px';
      miniMapViewport.style.top = Math.max(0, vpY) + 'px';
      miniMapViewport.style.width = Math.min(180, vpW) + 'px';
      miniMapViewport.style.height = Math.min(120, vpH) + 'px';
    }

    // Canvas panning and zooming
    let isPanning = false;
    let panStartX = 0;
    let panStartY = 0;

    viewport.addEventListener('mousedown', (e) => {
      if (e.target.closest('.graph-node') || e.target.closest('.graph-toolbar') || e.target.closest('.mini-map-box')) return;
      isPanning = true;
      viewport.classList.add('dragging');
      panStartX = e.clientX - panX;
      panStartY = e.clientY - panY;
    });

    window.addEventListener('mousemove', (e) => {
      if (!isPanning) return;
      panX = e.clientX - panStartX;
      panY = e.clientY - panStartY;
      updateTransform();
    });

    window.addEventListener('mouseup', () => {
      isPanning = false;
      viewport.classList.remove('dragging');
    });

    viewport.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
      const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * zoomFactor));

      // Zoom towards mouse pointer
      const mouseX = e.clientX;
      const mouseY = e.clientY;
      panX = mouseX - (mouseX - panX) * (newZoom / zoom);
      panY = mouseY - (mouseY - panY) * (newZoom / zoom);
      zoom = newZoom;

      updateTransform();
    }, { passive: false });

    // Toolbar controls
    document.getElementById('zoomInBtn').onclick = () => {
      zoom = Math.min(MAX_ZOOM, zoom * 1.2);
      updateTransform();
    };
    document.getElementById('zoomOutBtn').onclick = () => {
      zoom = Math.max(MIN_ZOOM, zoom * 0.8);
      updateTransform();
    };
    document.getElementById('resetZoomBtn').onclick = () => {
      panX = 120;
      panY = 100;
      zoom = 1.0;
      updateTransform();
    };
    document.getElementById('autoLayoutBtn').onclick = () => {
      runAutoLayout();
      updateTransform();
    };

    // Node search
    document.getElementById('nodeSearch').addEventListener('input', (e) => {
      const q = e.target.value.trim().toLowerCase();
      if (!q) return;
      const match = graphData.nodes.find(n => n.id.toLowerCase().includes(q) || n.label.toLowerCase().includes(q));
      if (match) {
        selectNode(match.id);
        const pos = nodePositions.get(match.id);
        if (pos) {
          panX = window.innerWidth / 2 - pos.x * zoom - 120;
          panY = window.innerHeight / 2 - pos.y * zoom - 80;
          updateTransform();
        }
      }
    });

    // Delegated link clicks to open document / table in VS Code
    document.addEventListener('click', (e) => {
      const openDocBtn = e.target.closest('.open-doc-btn');
      if (openDocBtn) {
        const path = openDocBtn.getAttribute('data-path');
        vscode.postMessage({ command: 'openDocument', path });
        return;
      }
      const openColBtn = e.target.closest('.open-col-btn');
      if (openColBtn) {
        const path = openColBtn.getAttribute('data-path');
        vscode.postMessage({ command: 'openCollection', path });
        return;
      }
      const refVal = e.target.closest('.is-ref');
      if (refVal) {
        const refPath = refVal.getAttribute('data-ref');
        if (refPath) {
          // If node already exists on canvas, focus it; otherwise request backend expansion
          if (nodePositions.has(refPath)) {
            selectNode(refPath);
            const pos = nodePositions.get(refPath);
            if (pos) {
              panX = window.innerWidth / 2 - pos.x * zoom - 120;
              panY = window.innerHeight / 2 - pos.y * zoom - 80;
              updateTransform();
            }
          } else {
            vscode.postMessage({ command: 'expandReference', refPath });
          }
        }
      }
    });

    // Message handler from extension host
    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'nodeAdded') {
        if (!graphData.nodes.some(n => n.id === msg.node.id)) {
          graphData.nodes.push(msg.node);
          // Position to the right of source
          const sourcePos = nodePositions.get(msg.sourcePath) || { x: 300, y: 200, width: 250, height: 160 };
          nodePositions.set(msg.node.id, {
            x: sourcePos.x + 360,
            y: sourcePos.y + (Math.random() * 80 - 40),
            width: 250,
            height: 160
          });
        }
        if (msg.edges) {
          msg.edges.forEach(e => {
            if (!graphData.edges.some(ge => ge.id === e.id)) {
              graphData.edges.push(e);
            }
          });
        }
        renderGraph();
        selectNode(msg.node.id);
      }
    });

    function escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    // Initialize layout and transform
    runAutoLayout();
    updateTransform();
  </script>
</body>
</html>`;
}

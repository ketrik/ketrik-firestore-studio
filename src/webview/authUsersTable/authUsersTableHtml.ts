import { getSharedTableStyles } from "../common/tableStyles";

export function getAuthUsersTableHtml(connectionId: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: https:; font-src data:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Auth Users: ${connectionId}</title>
  <style>
    ${getSharedTableStyles()}

    .actions-col {
      white-space: nowrap;
      text-align: center;
      width: 52px;
      min-width: 52px;
    }
    .user-menu-btn {
      padding: 2px 8px;
      font-size: 1.1em;
      line-height: 1.2;
      border-radius: 4px;
      background: transparent;
      border: 1px solid transparent;
      color: var(--vscode-editor-foreground);
      cursor: pointer;
      opacity: 0.85;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .user-menu-btn:hover {
      background: var(--vscode-toolbar-hoverBackground, rgba(128, 128, 128, 0.2));
      border-color: var(--vscode-widget-border, rgba(128, 128, 128, 0.3));
      opacity: 1;
    }
    .user-menu-btn.active {
      background: var(--vscode-toolbar-activeBackground, rgba(128, 128, 128, 0.3));
      border-color: var(--vscode-focusBorder, #007acc);
      opacity: 1;
    }
    /* Single-instance floating context menu */
    .auth-context-menu {
      position: fixed;
      display: none;
      z-index: 1000;
      min-width: 200px;
      max-width: 280px;
      background: var(--vscode-menu-background, var(--vscode-editorWidget-background, #252526));
      color: var(--vscode-menu-foreground, var(--vscode-editor-foreground, #cccccc));
      border: 1px solid var(--vscode-menu-border, var(--vscode-widget-border, rgba(128, 128, 128, 0.35)));
      border-radius: 6px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
      padding: 4px 0;
      font-size: 0.88em;
      animation: menuFadeIn 0.12s ease-out;
    }
    @keyframes menuFadeIn {
      from { opacity: 0; transform: translateY(-4px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .auth-context-menu-header {
      padding: 6px 12px;
      font-size: 0.8em;
      font-weight: 600;
      color: var(--vscode-descriptionForeground, #888888);
      border-bottom: 1px solid var(--vscode-menu-separatorBackground, rgba(128, 128, 128, 0.15));
      margin-bottom: 3px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .auth-context-menu-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 12px;
      cursor: pointer;
      user-select: none;
      transition: background 0.08s ease;
      color: inherit;
    }
    .auth-context-menu-item:hover {
      background: var(--vscode-menu-selectionBackground, #094771);
      color: var(--vscode-menu-selectionForeground, #ffffff) !important;
    }
    .auth-context-menu-item.danger {
      color: var(--vscode-charts-red, #ff5555);
    }
    .auth-context-menu-item.danger:hover {
      background: var(--vscode-inputValidation-errorBackground, #5a1d1d);
      color: #ffffff !important;
    }
    .auth-context-menu-sep {
      height: 1px;
      background: var(--vscode-menu-separatorBackground, rgba(128, 128, 128, 0.15));
      margin: 4px 0;
    }
    .badge-claim {
      background: var(--vscode-badge-background, rgba(128, 128, 128, 0.2));
      color: var(--vscode-badge-foreground);
      border-radius: 4px;
      padding: 2px 6px;
      font-size: 0.8em;
      margin-right: 4px;
      display: inline-block;
      font-family: var(--mono-font);
    }
    .badge-admin {
      background: rgba(220, 53, 69, 0.2);
      color: var(--vscode-charts-red, #ff5555);
      border: 1px solid rgba(220, 53, 69, 0.4);
    }
    .badge-role {
      background: rgba(40, 167, 69, 0.2);
      color: var(--vscode-charts-green, #55ff55);
      border: 1px solid rgba(40, 167, 69, 0.4);
    }
    .status-active {
      color: var(--vscode-charts-green, #4ec9b0);
      font-weight: 500;
    }
    .status-disabled {
      color: var(--vscode-charts-red, #f44747);
      font-weight: 500;
    }
    .user-cell {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .user-avatar {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      object-fit: cover;
      background: var(--vscode-badge-background, rgba(128, 128, 128, 0.25));
      border: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.3));
      flex-shrink: 0;
    }
    .user-avatar-fallback {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: var(--vscode-badge-background, rgba(128, 128, 128, 0.2));
      color: var(--vscode-editor-foreground);
      font-size: 0.85em;
      font-weight: 600;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      border: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.3));
    }
    .user-details {
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .btn-icon {
      padding: 3px 8px;
      font-size: 0.85em;
      margin-left: 4px;
    }
    .load-more-bar {
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 12px;
      margin-top: 18px;
      padding: 12px;
    }
    .stat-text {
      color: var(--vscode-descriptionForeground);
      font-size: 0.9em;
    }
    .provider-chip {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      padding: 1px 5px;
      border-radius: 10px;
      font-size: 0.76em;
      margin-right: 3px;
      margin-top: 2px;
      font-weight: 500;
      user-select: none;
    }
    .provider-google { background: rgba(234, 67, 53, 0.15); color: #ea4335; border: 1px solid rgba(234, 67, 53, 0.35); }
    .provider-github { background: rgba(128, 128, 128, 0.18); color: var(--vscode-foreground); border: 1px solid rgba(128, 128, 128, 0.35); }
    .provider-apple { background: rgba(255, 255, 255, 0.12); color: var(--vscode-foreground); border: 1px solid rgba(255, 255, 255, 0.25); }
    .provider-password { background: rgba(55, 148, 255, 0.15); color: #3794ff; border: 1px solid rgba(55, 148, 255, 0.35); }
    .provider-phone { background: rgba(46, 204, 113, 0.15); color: #2ecc71; border: 1px solid rgba(46, 204, 113, 0.35); }
    .provider-anonymous { background: rgba(155, 89, 182, 0.15); color: #9b59b6; border: 1px solid rgba(155, 89, 182, 0.35); }
    .mfa-chip {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      padding: 1px 6px;
      border-radius: 10px;
      font-size: 0.76em;
      font-weight: 600;
      background: rgba(243, 156, 18, 0.18);
      color: #f39c12;
      border: 1px solid rgba(243, 156, 18, 0.4);
      cursor: pointer;
    }
    .provider-filter-select {
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.3));
      border-radius: 4px;
      padding: 4px 8px;
      font-size: 0.88em;
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <div class="title-area">
      <h1>
        <span>🛡️</span>
        <span class="collection-name">Authentication Users</span>
      </h1>
      <span class="badge" title="Connection ID">${connectionId}</span>
    </div>
    <div class="toolbar-actions">
      <div class="search-wrapper">
        <input id="searchInput" type="text" placeholder="Filter by email, UID, role, name..." style="width: 230px;" />
      </div>
      <select id="providerFilter" class="provider-filter-select" title="Filter users by sign-in provider">
        <option value="">All Providers</option>
        <option value="password">Password (Email)</option>
        <option value="google.com">Google</option>
        <option value="github.com">GitHub</option>
        <option value="apple.com">Apple</option>
        <option value="phone">Phone / SMS</option>
        <option value="anonymous">Anonymous</option>
        <option value="mfa">MFA Enrolled 🔐</option>
      </select>
      <button id="searchBtn">Filter</button>
      <button id="clearSearchBtn" class="secondary" style="display:none;">Clear</button>

      <button id="importWizardBtn" class="secondary" title="Bulk Import Users from JSON or CSV with Password Hashes (SCRYPT, BCRYPT, PBKDF2)">
        <span>⬆</span> Import Users...
      </button>

      <button id="refreshBtn" class="secondary" title="Reload from Firebase Auth">
        <span>🔄</span> Reload
      </button>

      <button id="fetchAllBtn" class="secondary" title="Stream all remaining users into table">
        <span>⚡</span> Fetch All (Bulk)
      </button>

      <button id="exportBtn" class="secondary" title="Export currently displayed users to JSON">
        <span>⬇</span> Export JSON
      </button>
    </div>
  </div>

  <div class="status-bar" id="statusBar">
    <span>Loading users...</span>
  </div>

  <div class="table-container">
    <table id="usersTable">
      <thead>
        <tr>
          <th class="th-sortable id-header" data-col="email" style="min-width: 220px;">Email / Name <span id="sort-email"></span></th>
          <th class="th-sortable" data-col="uid">UID <span id="sort-uid"></span></th>
          <th class="th-sortable" data-col="createdAt">Created Date <span id="sort-createdAt">▼</span></th>
          <th class="th-sortable" data-col="lastSignInTime">Last Sign-in <span id="sort-lastSignInTime"></span></th>
          <th class="th-sortable" data-col="disabled">Status <span id="sort-disabled"></span></th>
          <th>Providers / MFA</th>
          <th>Custom Claims (RBAC)</th>
          <th>Profile Doc</th>
          <th class="actions-col sticky-actions">Actions</th>
        </tr>
      </thead>
      <tbody id="tableBody">
      </tbody>
    </table>
  </div>

  <div class="load-more-bar" id="loadMoreBar" style="display:none;">
    <span class="stat-text" id="pagingStats"></span>
    <button id="loadMoreBtn">Load Next 1,000 Users</button>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    let allUsers = [];
    let currentFilter = '';
    let sortCol = 'createdAt';
    let sortAsc = false; // Default: newest registered first
    let hasMore = false;
    let nextPageToken = null;
    let isFetching = false;

    const tbody = document.getElementById('tableBody');
    const statusBar = document.getElementById('statusBar');
    const searchInput = document.getElementById('searchInput');
    const searchBtn = document.getElementById('searchBtn');
    const clearSearchBtn = document.getElementById('clearSearchBtn');
    const providerFilter = document.getElementById('providerFilter');
    const refreshBtn = document.getElementById('refreshBtn');
    const fetchAllBtn = document.getElementById('fetchAllBtn');
    const importWizardBtn = document.getElementById('importWizardBtn');
    const exportBtn = document.getElementById('exportBtn');
    const loadMoreBar = document.getElementById('loadMoreBar');
    const loadMoreBtn = document.getElementById('loadMoreBtn');
    const pagingStats = document.getElementById('pagingStats');

    // Header sort listeners
    document.querySelectorAll('.th-sortable').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.getAttribute('data-col');
        if (sortCol === col) {
          sortAsc = !sortAsc;
        } else {
          sortCol = col;
          sortAsc = (col === 'email' || col === 'uid'); // Default text cols asc, dates desc
        }
        updateSortIcons();
        renderTable();
      });
    });

    function updateSortIcons() {
      ['email', 'uid', 'createdAt', 'lastSignInTime', 'disabled'].forEach(col => {
        const span = document.getElementById('sort-' + col);
        if (span) {
          if (sortCol === col) {
            span.textContent = sortAsc ? ' ▲' : ' ▼';
          } else {
            span.textContent = '';
          }
        }
      });
    }

    function formatDate(isoStr) {
      if (!isoStr) return '—';
      try {
        const d = new Date(isoStr);
        if (isNaN(d.getTime())) return isoStr;
        return d.toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });
      } catch (e) {
        return isoStr;
      }
    }

    function renderTable() {
      // Filter by text search & provider
      const selectedProv = providerFilter ? providerFilter.value : '';
      let filtered = allUsers;
      if (selectedProv) {
        filtered = filtered.filter(u => {
          if (selectedProv === 'mfa') {
            return Array.isArray(u.multiFactor) && u.multiFactor.length > 0;
          }
          if (selectedProv === 'anonymous') {
            return !u.providerData || u.providerData.length === 0;
          }
          return Array.isArray(u.providerData) && u.providerData.some(p => p.providerId === selectedProv);
        });
      }

      if (currentFilter.trim()) {
        const q = currentFilter.toLowerCase().trim();
        filtered = filtered.filter(u => {
          const email = (u.email || '').toLowerCase();
          const name = (u.displayName || '').toLowerCase();
          const uid = (u.uid || '').toLowerCase();
          const claims = JSON.stringify(u.customClaims || {}).toLowerCase();
          return email.includes(q) || name.includes(q) || uid.includes(q) || claims.includes(q);
        });
      }

      // Sort
      filtered.sort((a, b) => {
        let valA = a[sortCol];
        let valB = b[sortCol];

        if (sortCol === 'createdAt') {
          valA = a.metadata?.creationMs !== undefined ? a.metadata.creationMs : (a.metadata?.creationTime ? Date.parse(a.metadata.creationTime) || 0 : 0);
          valB = b.metadata?.creationMs !== undefined ? b.metadata.creationMs : (b.metadata?.creationTime ? Date.parse(b.metadata.creationTime) || 0 : 0);
        } else if (sortCol === 'lastSignInTime') {
          valA = a.metadata?.lastSignInMs !== undefined ? a.metadata.lastSignInMs : (a.metadata?.lastSignInTime ? Date.parse(a.metadata.lastSignInTime) || 0 : 0);
          valB = b.metadata?.lastSignInMs !== undefined ? b.metadata.lastSignInMs : (b.metadata?.lastSignInTime ? Date.parse(b.metadata.lastSignInTime) || 0 : 0);
        } else if (sortCol === 'email') {
          valA = (a.email || a.displayName || a.uid).toLowerCase();
          valB = (b.email || b.displayName || b.uid).toLowerCase();
        } else if (sortCol === 'disabled') {
          valA = a.disabled ? 1 : 0;
          valB = b.disabled ? 1 : 0;
        }

        if (valA < valB) return sortAsc ? -1 : 1;
        if (valA > valB) return sortAsc ? 1 : -1;
        return 0;
      });

      // Render rows
      tbody.innerHTML = '';
      if (filtered.length === 0) {
        const tr = document.createElement('tr');
        tr.innerHTML = '<td colspan="8" style="text-align:center; padding: 24px; color: var(--vscode-descriptionForeground);">' +
          (allUsers.length === 0 ? 'No users found in Firebase Authentication' : 'No users match filter "' + escapeHtml(currentFilter) + '"') +
          '</td>';
        tbody.appendChild(tr);
      } else {
        filtered.forEach(u => {
          const tr = document.createElement('tr');

          // Claims badges
          const claims = u.customClaims || {};
          let claimsHtml = '';
          if (claims.admin === true) {
            claimsHtml += '<span class="badge-claim badge-admin">🛡️ admin</span>';
          }
          if (claims.role) {
            claimsHtml += '<span class="badge-claim badge-role">🔑 ' + escapeHtml(String(claims.role)) + '</span>';
          }
          Object.keys(claims).forEach(k => {
            if (k !== 'admin' && k !== 'role') {
              claimsHtml += '<span class="badge-claim">' + escapeHtml(k) + ': ' + escapeHtml(JSON.stringify(claims[k])) + '</span>';
            }
          });
          if (!claimsHtml) {
            claimsHtml = '<span style="color:var(--vscode-descriptionForeground); font-style:italic;">(none)</span>';
          }

          const statusHtml = u.disabled
            ? '<span class="status-disabled">⛔ Disabled</span>'
            : '<span class="status-active">✓ Active</span>';

          const emailTitle = u.email ? (u.email + (u.emailVerified ? ' (Verified)' : ' (Unverified)')) : 'No email';
          const nameHtml = u.displayName ? '<div style="font-size:0.85em; color:var(--vscode-descriptionForeground);">' + escapeHtml(u.displayName) + '</div>' : '';

          const profileHtml = u.hasProfileDoc === true
            ? '<span style="color:var(--vscode-charts-green, #4ec9b0);">📄 Exists</span>'
            : (u.hasProfileDoc === false
              ? '<span style="color:var(--vscode-charts-yellow, #cca700);">⚠️ Missing</span>'
              : '<button class="secondary btn-icon check-profile-btn" data-uid="' + escapeHtml(u.uid) + '" title="Check Firestore doc">Check</button>');

          const initial = ((u.displayName || u.email || u.uid || '?')[0] || '?').toUpperCase();
          const avatarHtml = u.photoURL
            ? '<img class="user-avatar" src="' + escapeHtml(u.photoURL) + '" alt="' + escapeHtml(initial) + '" onerror="this.style.display=\\'none\\'; this.nextElementSibling.style.display=\\'inline-flex\\';" /><span class="user-avatar-fallback" style="display:none;">' + escapeHtml(initial) + '</span>'
            : '<span class="user-avatar-fallback">' + escapeHtml(initial) + '</span>';

          // Provider chips & MFA
          let providersHtml = '';
          const provs = Array.isArray(u.providerData) ? u.providerData : [];
          if (provs.length === 0) {
            providersHtml = '<span class="provider-chip provider-anonymous">Anonymous</span>';
          } else {
            provs.forEach(p => {
              const pid = p.providerId || 'password';
              let cls = 'provider-password';
              let label = pid;
              if (pid === 'google.com') { cls = 'provider-google'; label = 'Google'; }
              else if (pid === 'github.com') { cls = 'provider-github'; label = 'GitHub'; }
              else if (pid === 'apple.com') { cls = 'provider-apple'; label = 'Apple'; }
              else if (pid === 'phone') { cls = 'provider-phone'; label = 'Phone'; }
              else if (pid === 'password') { cls = 'provider-password'; label = 'Password'; }
              providersHtml += '<span class="provider-chip ' + cls + '">' + escapeHtml(label) + '</span>';
            });
          }
          if (Array.isArray(u.multiFactor) && u.multiFactor.length > 0) {
            providersHtml += '<span class="mfa-chip" title="Multi-Factor Authentication Enrolled">🛡️ MFA (' + u.multiFactor.length + ')</span>';
          }

          tr.innerHTML = \`
            <td class="sticky-col">
              <div class="user-cell">
                \${avatarHtml}
                <div class="user-details">
                  <div style="font-weight: 500;">\${escapeHtml(u.email || u.uid)}</div>
                  \${nameHtml}
                </div>
              </div>
            </td>
            <td><code style="font-size: 0.85em; user-select: all;">\${escapeHtml(u.uid)}</code></td>
            <td>\${formatDate(u.metadata?.creationTime)}</td>
            <td>\${formatDate(u.metadata?.lastSignInTime)}</td>
            <td>\${statusHtml}</td>
            <td>\${claimsHtml}</td>
            <td>\${providersHtml}</td>
            <td id="profile-cell-\${escapeHtml(u.uid)}">\${profileHtml}</td>
            <td class="actions-col sticky-actions">
              <button class="user-menu-btn" data-uid="\${escapeHtml(u.uid)}" title="User Actions (Claims, Profile, Token, etc.)">⋯</button>
            </td>
          \`;
          tbody.appendChild(tr);
        });
      }

      // Update status & pagination
      statusBar.innerHTML = 'Showing <b>' + filtered.length + '</b> of <b>' + allUsers.length + '</b> loaded users' +
        (currentFilter ? ' (filtered)' : '') +
        (hasMore ? ' • <i>More users available in Firebase Auth</i>' : ' • <i>All users loaded</i>');

      if (hasMore) {
        loadMoreBar.style.display = 'flex';
        pagingStats.textContent = allUsers.length + ' loaded so far';
      } else {
        loadMoreBar.style.display = 'none';
      }
    }

    // --- Floating Single-Instance Context Menu ---
    const contextMenu = document.createElement('div');
    contextMenu.className = 'auth-context-menu';
    contextMenu.id = 'authContextMenu';
    document.body.appendChild(contextMenu);

    let activeMenuUid = null;
    let activeMenuBtn = null;

    function closeContextMenu() {
      if (contextMenu.style.display === 'block') {
        contextMenu.style.display = 'none';
        if (activeMenuBtn) {
          activeMenuBtn.classList.remove('active');
        }
        activeMenuUid = null;
        activeMenuBtn = null;
      }
    }

    function openContextMenu(btn, uid) {
      const user = allUsers.find(u => u.uid === uid);
      if (!user) return;

      if (activeMenuUid === uid && contextMenu.style.display === 'block') {
        closeContextMenu();
        return;
      }

      closeContextMenu();

      activeMenuUid = uid;
      activeMenuBtn = btn;
      btn.classList.add('active');

      const email = user.email || '';
      const userLabel = email || user.uid;
      const isDisabled = !!user.disabled;

      contextMenu.innerHTML = \`
        <div class="auth-context-menu-header" title="\${escapeHtml(userLabel)}">\${escapeHtml(userLabel)}</div>
        <div class="auth-context-menu-item" data-action="claims">🛡️ Edit Custom Claims...</div>
        <div class="auth-context-menu-item" data-action="profile">📄 Open / Create Profile Doc</div>
        <div class="auth-context-menu-item" data-action="mintToken">🔑 Mint Custom Token (Login As)</div>
        <div class="auth-context-menu-item" data-action="cloneUser">📋 Clone User to Connection...</div>
        <div class="auth-context-menu-sep"></div>
        <div class="auth-context-menu-item" data-action="verifyEmail">✉️ Generate Verification Link</div>
        <div class="auth-context-menu-item" data-action="signinLink">🔗 Passwordless Sign-In Link...</div>
        <div class="auth-context-menu-item" data-action="resetPassword">🔄 Generate Password Reset Link</div>
        <div class="auth-context-menu-sep"></div>
        <div class="auth-context-menu-item" data-action="toggleDisable">
          \${isDisabled ? '✅ Enable User Account' : '⏸️ Disable User Account'}
        </div>
        <div class="auth-context-menu-item danger" data-action="deleteUser">
          🗑️ Delete User & Profile...
        </div>
      \`;

      contextMenu.style.display = 'block';

      // Position near button with viewport boundary protection
      const rect = btn.getBoundingClientRect();
      const menuWidth = 230;
      const menuHeight = contextMenu.offsetHeight || 340;

      let left = rect.left - menuWidth + rect.width;
      if (left < 10) left = 10;
      if (left + menuWidth > window.innerWidth - 10) {
        left = window.innerWidth - menuWidth - 10;
      }

      let top = rect.bottom + 4;
      if (top + menuHeight > window.innerHeight - 10) {
        // Open upwards if overflowing bottom
        top = Math.max(10, rect.top - menuHeight - 4);
      }

      contextMenu.style.left = left + 'px';
      contextMenu.style.top = top + 'px';
    }

    // Context menu item click handler
    contextMenu.addEventListener('click', (e) => {
      const item = e.target.closest('.auth-context-menu-item');
      if (!item || !activeMenuUid) return;

      const action = item.getAttribute('data-action');
      const user = allUsers.find(u => u.uid === activeMenuUid);
      const uid = activeMenuUid;
      const email = user ? (user.email || '') : '';
      const isDisabled = user ? !!user.disabled : false;

      closeContextMenu();

      switch (action) {
        case 'claims':
          vscode.postMessage({ command: 'editClaims', uid });
          break;
        case 'profile':
          vscode.postMessage({ command: 'openProfile', uid });
          break;
        case 'mintToken':
          vscode.postMessage({ command: 'mintToken', uid });
          break;
        case 'cloneUser':
          vscode.postMessage({ command: 'cloneUser', uid });
          break;
        case 'verifyEmail':
          vscode.postMessage({ command: 'generateVerificationLink', uid, email });
          break;
        case 'signinLink':
          vscode.postMessage({ command: 'generateSignInLink', uid, email });
          break;
        case 'resetPassword':
          vscode.postMessage({ command: 'resetPassword', uid, email });
          break;
        case 'toggleDisable':
          vscode.postMessage({ command: 'toggleDisable', uid, disabled: !isDisabled });
          break;
        case 'deleteUser':
          vscode.postMessage({ command: 'deleteUser', uid, email });
          break;
      }
    });

    // Close menu when clicking outside or scrolling
    window.addEventListener('click', (e) => {
      if (!contextMenu.contains(e.target) && !e.target.closest('.user-menu-btn')) {
        closeContextMenu();
      }
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeContextMenu();
      }
    });
    document.querySelector('.table-container').addEventListener('scroll', () => {
      closeContextMenu();
    }, { passive: true });

    // Delegated event listener on tbody handles menu open and direct cell links
    tbody.addEventListener('click', (e) => {
      const menuBtn = e.target.closest('.user-menu-btn');
      if (menuBtn) {
        e.stopPropagation();
        const uid = menuBtn.getAttribute('data-uid');
        openContextMenu(menuBtn, uid);
        return;
      }

      const checkProfileBtn = e.target.closest('.check-profile-btn');
      if (checkProfileBtn) {
        const uid = checkProfileBtn.getAttribute('data-uid');
        vscode.postMessage({ command: 'checkProfile', uid });
        return;
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

    // Filter controls with debouncing
    let searchDebounceTimer = null;
    function applySearch() {
      currentFilter = searchInput.value;
      clearSearchBtn.style.display = currentFilter ? 'inline-flex' : 'none';
      renderTable();
    }

    searchInput.addEventListener('input', () => {
      if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(applySearch, 150);
    });
    searchBtn.addEventListener('click', () => {
      if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
      applySearch();
    });
    clearSearchBtn.addEventListener('click', () => {
      if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
      searchInput.value = '';
      applySearch();
    });

    if (providerFilter) {
      providerFilter.addEventListener('change', () => {
        renderTable();
      });
    }

    refreshBtn.addEventListener('click', () => {
      vscode.postMessage({ command: 'refresh' });
    });

    loadMoreBtn.addEventListener('click', () => {
      vscode.postMessage({ command: 'loadMore' });
    });

    fetchAllBtn.addEventListener('click', () => {
      vscode.postMessage({ command: 'fetchAll' });
    });

    if (importWizardBtn) {
      importWizardBtn.addEventListener('click', () => {
        vscode.postMessage({ command: 'importUsersWizard' });
      });
    }

    exportBtn.addEventListener('click', () => {
      vscode.postMessage({ command: 'exportJson', users: allUsers });
    });

    // Handle messages from VS Code extension host
    window.addEventListener('message', event => {
      const msg = event.data;
      switch (msg.type) {
        case 'setUsers':
          allUsers = msg.users || [];
          hasMore = !!msg.hasMore;
          nextPageToken = msg.pageToken;
          renderTable();
          break;

        case 'appendUsers':
          allUsers = allUsers.concat(msg.users || []);
          hasMore = !!msg.hasMore;
          nextPageToken = msg.pageToken;
          renderTable();
          break;

        case 'profileStatus':
          const user = allUsers.find(u => u.uid === msg.uid);
          if (user) {
            user.hasProfileDoc = msg.exists;
          }
          const cell = document.getElementById('profile-cell-' + msg.uid);
          if (cell) {
            cell.innerHTML = msg.exists
              ? '<span style="color:var(--vscode-charts-green, #4ec9b0);">📄 Exists</span>'
              : '<span style="color:var(--vscode-charts-yellow, #cca700);">⚠️ Missing</span>';
          }
          break;

        case 'userUpdated':
          const idx = allUsers.findIndex(u => u.uid === msg.user.uid);
          if (idx !== -1) {
            allUsers[idx] = { ...allUsers[idx], ...msg.user };
            renderTable();
          }
          break;

        case 'userDeleted':
          allUsers = allUsers.filter(u => u.uid !== msg.uid);
          renderTable();
          break;

        case 'setLoading':
          if (msg.loading) {
            statusBar.innerHTML = '<span>⏳ ' + escapeHtml(msg.text || 'Loading users...') + '</span>';
          }
          break;
      }
    });

    // Initial ready signal to extension host
    vscode.postMessage({ command: 'ready' });
  </script>
</body>
</html>`;
}

import { getSharedTableStyles } from "../common/tableStyles";

export function getAuthUsersTableHtml(connectionId: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Auth Users: ${connectionId}</title>
  <style>
    ${getSharedTableStyles()}

    .actions-col {
      white-space: nowrap;
      text-align: right;
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
    .th-sortable {
      cursor: pointer;
      user-select: none;
    }
    .th-sortable:hover {
      background: rgba(128, 128, 128, 0.15);
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
        <input id="searchInput" type="text" placeholder="Filter by email, UID, role, name..." style="width: 250px;" />
      </div>
      <button id="searchBtn">Filter</button>
      <button id="clearSearchBtn" class="secondary" style="display:none;">Clear</button>

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
    const refreshBtn = document.getElementById('refreshBtn');
    const fetchAllBtn = document.getElementById('fetchAllBtn');
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
      // Filter
      let filtered = allUsers;
      if (currentFilter.trim()) {
        const q = currentFilter.toLowerCase().trim();
        filtered = allUsers.filter(u => {
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
          valA = a.metadata?.creationTime ? new Date(a.metadata.creationTime).getTime() : 0;
          valB = b.metadata?.creationTime ? new Date(b.metadata.creationTime).getTime() : 0;
        } else if (sortCol === 'lastSignInTime') {
          valA = a.metadata?.lastSignInTime ? new Date(a.metadata.lastSignInTime).getTime() : 0;
          valB = b.metadata?.lastSignInTime ? new Date(b.metadata.lastSignInTime).getTime() : 0;
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
            <td id="profile-cell-\${escapeHtml(u.uid)}">\${profileHtml}</td>
            <td class="actions-col sticky-actions">
              <button class="secondary btn-icon claims-btn" data-uid="\${escapeHtml(u.uid)}" title="Edit Custom Claims">Claims</button>
              <button class="secondary btn-icon profile-btn" data-uid="\${escapeHtml(u.uid)}" title="Open / Create Firestore Profile Doc">Profile</button>
              <button class="secondary btn-icon clone-user-btn" data-uid="\${escapeHtml(u.uid)}" title="Clone User to Another Connection">Clone</button>
              <button class="secondary btn-icon mint-token-btn" data-uid="\${escapeHtml(u.uid)}" title="Mint Custom Token (Login As User)">Token</button>
              <button class="secondary btn-icon reset-pwd-btn" data-uid="\${escapeHtml(u.uid)}" data-email="\${escapeHtml(u.email || '')}" title="Generate Password Reset Link">Reset</button>
              <button class="secondary btn-icon toggle-disable-btn" data-uid="\${escapeHtml(u.uid)}" data-disabled="\${u.disabled}" title="\${u.disabled ? 'Enable User' : 'Disable User'}">\${u.disabled ? 'Enable' : 'Disable'}</button>
              <button class="secondary btn-icon delete-user-btn" data-uid="\${escapeHtml(u.uid)}" data-email="\${escapeHtml(u.email || u.uid)}" title="Delete Auth User & Profile" style="color:var(--vscode-charts-red, #ff5555);">Delete</button>
            </td>
          \`;
          tbody.appendChild(tr);
        });
      }

      // Wire row action buttons
      tbody.querySelectorAll('.claims-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const uid = btn.getAttribute('data-uid');
          vscode.postMessage({ command: 'editClaims', uid });
        });
      });

      tbody.querySelectorAll('.profile-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const uid = btn.getAttribute('data-uid');
          vscode.postMessage({ command: 'openProfile', uid });
        });
      });

      tbody.querySelectorAll('.clone-user-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const uid = btn.getAttribute('data-uid');
          vscode.postMessage({ command: 'cloneUser', uid });
        });
      });

      tbody.querySelectorAll('.mint-token-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const uid = btn.getAttribute('data-uid');
          vscode.postMessage({ command: 'mintToken', uid });
        });
      });

      tbody.querySelectorAll('.reset-pwd-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const uid = btn.getAttribute('data-uid');
          const email = btn.getAttribute('data-email');
          vscode.postMessage({ command: 'resetPassword', uid, email });
        });
      });

      tbody.querySelectorAll('.toggle-disable-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const uid = btn.getAttribute('data-uid');
          const currentDisabled = btn.getAttribute('data-disabled') === 'true';
          vscode.postMessage({ command: 'toggleDisable', uid, disabled: !currentDisabled });
        });
      });

      tbody.querySelectorAll('.delete-user-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const uid = btn.getAttribute('data-uid');
          const email = btn.getAttribute('data-email');
          vscode.postMessage({ command: 'deleteUser', uid, email });
        });
      });

      tbody.querySelectorAll('.check-profile-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const uid = btn.getAttribute('data-uid');
          vscode.postMessage({ command: 'checkProfile', uid });
        });
      });

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

    function escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    // Filter controls
    function applySearch() {
      currentFilter = searchInput.value;
      clearSearchBtn.style.display = currentFilter ? 'inline-flex' : 'none';
      renderTable();
    }

    searchInput.addEventListener('input', applySearch);
    searchBtn.addEventListener('click', applySearch);
    clearSearchBtn.addEventListener('click', () => {
      searchInput.value = '';
      applySearch();
    });

    refreshBtn.addEventListener('click', () => {
      vscode.postMessage({ command: 'refresh' });
    });

    loadMoreBtn.addEventListener('click', () => {
      vscode.postMessage({ command: 'loadMore' });
    });

    fetchAllBtn.addEventListener('click', () => {
      vscode.postMessage({ command: 'fetchAll' });
    });

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

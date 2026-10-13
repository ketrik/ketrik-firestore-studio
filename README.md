# Ketrik Firestore Studio

A powerful Visual Studio Code extension for exploring, querying, and editing multiple Firebase / Google Cloud Firestore databases directly inside VS Code.

---

## Features

- **Security Rules Inspector, Diff & AST Badging**: Inspect live `firestore.rules`, compare live against local workspace rules, and deploy rules. Visual single-character security badges (`🚨`, `⚠️ 🌐`, `👤`, `🛡️`, `🔑`, `🔒`) in the Explorer tree with rich hover tooltips (`📖 Read:` / `✍️ Write:` role indicators) immediately expose public or restricted collections.
- **Firebase Authentication & User Management Suite**:
  - Dedicated **Authentication (Users & Claims)** tree branch with cursor-based pagination.
  - Interactive **Auth Users Table View** with real-time filtering, instant sorting (Created Date newest-first, Sign-in date, Email), and user avatars (`photoURL`).
  - **Edit Custom Claims** (`admin`, roles) directly from context menus or table rows.
  - **Link / Jump to Firestore Profile**: Instantly open or create the `/users/{uid}` profile document.
  - **Cross-Environment User Cloning**: Clone complete user accounts (credentials, metadata, custom claims, and Firestore profile document) across connections (e.g., *Production $\rightarrow$ Staging*).
  - **Custom JWT Token Minter**: 1-click generation of custom auth tokens to impersonate any user in frontend apps or REST clients.
  - **Session Revocation / Force Logout**: Instantly revoke all active refresh tokens for an account.
  - **Password Reset Links**: Generate secure password reset links directly to clipboard.
  - **Cascade Deletion**: Safely delete Auth user accounts alongside their Firestore profile documents.
- **Dual-Prefix Architecture & Pinned Sticky Tables**: Filter and organize System Envelope (`_*`) and Operational Protocol (`__*`) fields, with sticky column headers and sticky identifier/action columns.
- **Multiple Firestore Connections**: Connect to multiple Firestore instances simultaneously (Production, Staging, Dev, Local Emulators, and custom Database IDs).
- **Interactive Tree Explorer**: Browse collections, documents, sub-collections, and root document fields across all your connections in one sidebar view.
- **Root Variables as Virtual Subdocuments**: Open top-level document fields and nested structures independently in dedicated JSON editors—no need to navigate massive documents.
- **Atomic Partial Updates**: Saving an edited root field uses Firestore's atomic `.update({ [field]: value })` rather than overwriting the entire document.
- **Smart Modal Editing for Primitives**: Click any boolean in the tree to toggle via QuickPick (`true` / `false`), or edit numbers/strings via instant modal input with live validation.
- **Field Context Actions**: Add new fields with type assistance (`Object`, `Array`, `String`, `Number`, `Boolean`, or custom `JSON`), copy field paths, or delete fields directly from tree context menus.
- **Auto-Sync & Live Refresh**: Changes saved to documents or sub-fields immediately reflect in the Explorer tree view in real-time.
- **Direct Document Editing**: Open and edit any full document as native JSON with full VS Code editor features. Saving the file (`Cmd+S` / `Ctrl+S`) writes updates back to Firestore immediately.
- **Table View with Server-Side Query Builder**: View collection documents in a tabular format, run multi-clause server queries (`==`, `!=`, `<`, `>`, `array-contains`, `in`), and paginate with zero quota waste.
- **Document Cloning & Cross-Connection Copying**: Duplicate documents within the same collection or copy/paste them across different environments (e.g., copy from Production to Local Emulator) with automatic ID handling.
- **Copy as JSON**: Copy formatted document JSON directly to your clipboard from the tree menu without opening tabs.
- **Export**: Export collection data directly to JSON files.
- **Custom Ordering & Pagination**: Sort collections by any field in ascending or descending order.

---

## Getting Started

1. Open the **Ketrik Firestore Studio** view from the VS Code Activity Bar.
2. Click **Add Connection** (`+`) in the view title bar or run `Firestore Studio: Add Connection` from the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`).
3. Choose your connection method:
   - **Service Account Key (JSON)**: Select your downloaded Firebase service account JSON key file.
   - **Local Firestore Emulator**: Specify emulator host (e.g., `localhost:8080`) and project ID.
4. (Optional) Provide a custom Database ID if using named databases (defaults to `(default)`).
5. Explore collections, view Security Rules, manage Auth users, and edit data live!

---

## Extension Commands

| Command | Title | Description |
|---|---|---|
| `ketrik-firestore-studio.addConnection` | Add Connection | Configure a new Firestore connection |
| `ketrik-firestore-studio.editConnection` | Edit Connection | Edit connection settings |
| `ketrik-firestore-studio.deleteConnection` | Delete Connection | Remove a configured connection |
| `ketrik-firestore-studio.testConnection` | Test Connection | Test connection credentials and connectivity |
| `ketrik-firestore-studio.refreshExplorer` | Refresh Explorer | Refresh collections, security rules, and auth trees |
| `ketrik-firestore-studio.openSecurityRules` | Open Live Security Rules | Open deployed `firestore.rules` in virtual editor |
| `ketrik-firestore-studio.diffSecurityRules` | Diff Security Rules | Compare deployed rules against local workspace rules |
| `ketrik-firestore-studio.deploySecurityRules` | Deploy Security Rules | Deploy local `firestore.rules` to active connection |
| `ketrik-firestore-studio.openAuthUsersAsTable` | Open Auth Users as Table | Interactive table with sorting, search, claims & avatar display |
| `ketrik-firestore-studio.cloneAuthUser` | Clone User to Connection... | Clone an Auth user (and optional profile) across connections |
| `ketrik-firestore-studio.mintCustomToken` | Mint Custom Auth Token | Generate signed JWT custom token to log in as user |
| `ketrik-firestore-studio.revokeUserSessions` | Force Logout (Revoke Sessions) | Revoke all active refresh tokens for an account |
| `ketrik-firestore-studio.resetAuthUserPassword` | Generate Password Reset Link | Create password reset link and copy to clipboard |
| `ketrik-firestore-studio.deleteAuthUser` | Delete User & Profile... | Cascade deletion of Auth account and Firestore profile |
| `ketrik-firestore-studio.openAuthUserClaims` | Edit Custom Claims | Edit custom claims (`admin`, roles) for an account |
| `ketrik-firestore-studio.createAuthUserProfile` | Create Firestore Profile | Scaffold new `/users/{uid}` profile document |
| `ketrik-firestore-studio.openAuthUserProfile` | Open Firestore Profile Document | Jump directly to `/users/{uid}` document in editor |
| `ketrik-firestore-studio.openCollectionAsTable` | Open Collection as Table | Open interactive table grid view with server-side query builder |
| `ketrik-firestore-studio.jumpToDocument` | Jump to Document ID... | Direct 1-read document lookup on server by ID |
| `ketrik-firestore-studio.createDocument` | Create Document | Create a new document in the selected collection |
| `ketrik-firestore-studio.deleteDocument` | Delete Document | Delete a selected document |
| `ketrik-firestore-studio.duplicateDocument` | Duplicate Document... | Clone document within collection with new ID |
| `ketrik-firestore-studio.copyDocument` | Copy Document | Copy document to internal clipboard for cross-collection/connection paste |
| `ketrik-firestore-studio.pasteDocument` | Paste Document | Paste copied document into any target collection or connection |
| `ketrik-firestore-studio.copyDocumentJson` | Copy as JSON | Copy formatted document JSON directly to OS clipboard |
| `ketrik-firestore-studio.addField` | Add Field... | Add a new root field to a document with type picker |
| `ketrik-firestore-studio.openField` | Edit Value / Open Field | Quick-edit primitive value or open subdocument |
| `ketrik-firestore-studio.openFieldAsTable` | Open as Table View | View Map (`Record<string, T>`) or Array (`T[]`) field as a virtual collection table |
| `ketrik-firestore-studio.openFieldInEditor` | Open in JSON Editor | Open any field directly into a dedicated JSON tab |
| `ketrik-firestore-studio.renameField` | Rename Field... | Rename a root field atomically via batch copy and delete |
| `ketrik-firestore-studio.refreshItem` | Refresh | Refresh a specific document or field without reloading the entire tree |
| `ketrik-firestore-studio.deleteField` | Delete Field | Delete a root field using `FieldValue.delete()` |
| `ketrik-firestore-studio.addCollection` | Add Collection | Create a root or sub-collection |


---

## Extension Settings

- `ketrik-firestore-studio.connections`: List of configured Firestore connections (ID, Name, Service Account Path, Project ID, Database ID, Emulator settings).
- `ketrik-firestore-studio.pagingLimit`: Number of documents to show per page in the tree view (default: `10`).
- `ketrik-firestore-studio.maxTableRows`: Maximum number of documents to load in the collection table view (default: `100`).
- `ketrik-firestore-studio.cacheTTLSeconds`: Memory cache duration in seconds for tree browsing and virtual docs (default: `30`).
- `ketrik-firestore-studio.initialFoldLevel`: Initial folding level when opening documents in editor (`0` for none, `1` for root keys, etc.).
- `ketrik-firestore-studio.checkRemoteChangesOnSave`: Check for remote changes before saving (default: `false`).
- `ketrik-firestore-studio.documentTemplates`: Custom JSON templates for fast document creation.

---

## Notice

This extension relies on the [Firebase Admin SDK](https://firebase.google.com/docs/admin/setup) and its usage will generate reads and writes that may impact your Firebase billing.

---

## Roadmap & Release Schedule

See [ROADMAP.md](ROADMAP.md) for historical release dates, active milestones, and upcoming feature specifications.

---

## License

[MIT](LICENSE)

# Change Log

All notable changes to the "Ketrik Firestore Studio" extension will be documented in this file.

## [1.9.1] - 2026-10-13

### Added
- **Multi-Document Batch Operations in Table View (`WriteBatch`)**:
  - Sticky selection checkbox column (`.select-col`) with "Select All" and individual row selection state.
  - Floating batch actions toolbar with selection counter and clear selection button.
  - **Batch Field Update**: Update a single field (value or `FieldValue.delete()`) or merge a JSON payload across all selected documents.
  - **Batch Delete**: High-throughput deletion using chunked Firestore `WriteBatch` (400 documents per batch) with confirmation dialog showing affected document count and write operations.
- **Native Firestore Aggregations (`count()`, `sum()`, `avg()`)**:
  - **Collection Count (`count().get()`)**: Instant total document count at ultra-low cost (1 read per 1,000 index entries) with clear quota reporting.
  - **Numeric Aggregates (`sum()` and `avg()`)**: Calculate server-side numeric sum and average on any collection field without downloading document bodies.
- **TypeScript Interface & Zod Schema Generator (`ketrik-firestore-studio.generateSchema`)**:
  - Context menu on collections and documents to reverse-engineer schemas from live data.
  - Samples $N$ documents (10–50), deducing unified keys, optional fields (`?`), enum string literals, and Firestore primitive types (`Timestamp`, `GeoPoint`, `DocumentReference`).
  - Generates TypeScript interfaces (`interface <Name> { ... }`) or Zod validation schemas (`z.object({ ... })`).
  - Output to clipboard, new editor tab, or save directly to a `.d.ts` / `.ts` workspace file.
- **Data Import & Export Wizard (CSV, JSON, NDJSON)**:
  - **Export Collection (`ketrik-firestore-studio.exportCollection`)**: Stream entire collections to CSV, formatted JSON, or newline-delimited JSON (NDJSON) with progress reporting.
  - **Import Data (`ketrik-firestore-studio.importCollection`)**: Import datasets into collections with custom Document ID strategy (Auto-generated Firestore ID, specific property/column, or row index) and automatic type coercion (ISO dates $\rightarrow$ Timestamps, numbers, booleans) executed via chunked `WriteBatch`.
- **Query Bookmarks & Saved Presets**:
  - Save multi-clause `where` filter queries as named bookmarks directly from the Collection Table view.
  - Saved to `.vscode/firestore-queries.json` in the workspace root for team sharing and version control.
  - Quick-load saved bookmarks directly from the Query Builder dropdown.
- **Firebase Auth Suite Enhancements**:
  - **Create Auth User Dialog (`ketrik-firestore-studio.createAuthUser`)**: Scaffold new users directly within VS Code with email, password, display name, photo URL, phone number, and custom claims.
  - **Project Auth Security & Policies Inspector (`ketrik-firestore-studio.inspectProjectAuthConfig`)**: View project-wide authentication configuration including password complexity policies, email privacy protection, SMS region policies, and multi-factor auth factors.

## [1.9.0] - 2026-10-13

### Added
- **Cross-Environment Auth User Cloning (`ketrik-firestore-studio.cloneAuthUser`)**:
  - Clone any user account directly across connections (e.g. *Production $\rightarrow$ Staging* or *Local Emulator*).
  - Copies account metadata (`uid`, `email`, `displayName`, `photoURL`, `phoneNumber`, `disabled`, `emailVerified`) and custom claims.
  - Option to simultaneously clone their associated Firestore profile document (`/users/{uid}`).
  - Automatically copies a freshly generated password reset link for the target environment to the clipboard.
- **Custom Auth Token Minter (`ketrik-firestore-studio.mintCustomToken`)**:
  - 1-click minting of signed custom JWT auth tokens for any user (`auth.createCustomToken(uid)`).
  - Enables instant login as any user in client frontends or REST testing to verify security rules and app permissions.
- **Session Revocation / Force Logout (`ketrik-firestore-studio.revokeUserSessions`)**:
  - Immediately revokes all active refresh tokens for an account across all sessions and devices.
- **Password Reset Link Generator (`ketrik-firestore-studio.resetAuthUserPassword`)**:
  - Generates secure out-of-band password reset links directly from tree context menus or table rows, copied straight to clipboard with optional browser jump.
- **Cascade User & Profile Deletion (`ketrik-firestore-studio.deleteAuthUser`)**:
  - Delete an Auth user with intelligent prompt to also delete their `/users/{uid}` Firestore profile document.
- **Ergonomic Icon-Only Security Badges & Rich Tooltips**:
  - Replaced bulky text badges in the Explorer tree with clean single-character status icons (`🚨`, `⚠️ 🌐`, `👤`, `🛡️`, `🔑`, `🔒`).
  - Rich hover tooltips with operation & role icons (`📖 Read:` / `✍️ Write:`) and immediate visual role identification (`🌐 Public`, `🔒 Logged-in`, `👤 Owner`, `🔑 Admin`, `🛡️ Backend Only`).
  - Prominent threat warning alerts for public unauthenticated read/write exposures.

## [1.8.0] - 2026-10-13

### Added
- **Live Security Rules Inspector, Diff & Deploy (`firestore.rules`)**:
  - Pulls currently deployed security rules directly from active Google Cloud / Firebase project via the Firebase Rules API (`firebase.securityRules.get`).
  - View live rules in a virtual file tab (`ketrik-firestore-studio://rules/firestore.rules`) with full syntax highlighting.
  - **Rules Diff**: Compare deployed remote rules against your local `firestore.rules` file in the workspace to spot uncommitted or drift changes.
  - **Rules Deploy**: Deploy workspace `firestore.rules` directly to the active Firestore connection with confirmation and feedback.
  - **Full Syntax Highlighting Grammar**: Added comprehensive TextMate syntax grammar for `.rules` and `firestore.rules` files (keywords, functions, match blocks, operators, comments).
  - **AST Rules Permission Parser**: Parse rules with nested match blocks, wildcards (`{document=**}`), functions (`isAuthenticated()`, `isAdmin()`), and fallback permissions to dynamically indicate locked vs readable collections.
- **Firebase Authentication & User Management Suite**:
  - Added dedicated **Authentication (Users & Claims)** tree branch under each connection.
  - Cursor-based tree pagination (`listUsers(pageSize, pageToken)`) in safe batches (25 users) with `Load more users...` button to handle projects with thousands of users without lag or memory exhaustion.
  - **Webview Auth Users Table View (`ketrik-firestore-studio.openAuthUsersAsTable`)**:
    - High-performance bulk fetching (up to 1,000 users per request, zero Firestore quota cost).
    - In-memory instantaneous sorting by **Created Date (Newest First)**, **Last Sign-in**, **Email / Name**, and **Status**.
    - Real-time client-side filter by email, UID, display name, and custom claims.
    - Interactive row actions: Edit Custom Claims (`admin`, roles), Check/Create Firestore Profile (`users/{uid}`), and Disable/Enable user.
    - JSON Export of loaded/filtered users.
- **Sticky Column Layout Across All Webview Tables**:
  - Pinned left-hand identifier column (`Document ID`, `Email / Name`, `Row ID`) with `position: sticky; left: 0;` across horizontal scrolling.
  - Pinned right-hand `Actions` column with `position: sticky; right: 0;` on Auth Users Table.
  - Pinned top header rows across vertical scrolling.
- **Substrate Migrations & Tombstone Purge Tools**:
  - **Explode Field to Subcollection**: Migrate an embedded Map/Array to a standalone subcollection.
  - **Consolidate Collection to Field**: Collapse a collection of documents into an embedded array or keyed map in a parent doc.
  - **Purge Tombstones**: Safely clean deleted/tombstoned entries (`__deleted: true`).

## [1.7.0] - 2026-10-10

### Added
- **Dual-Prefix Protocol (`_` and `__`) Support & Semantic Badging**:
  - Operational Protocol fields (`__key` or `"__": { ... }`) render in the Explorer Tree with a dedicated operational shield badge (`$(shield)`) in `charts.red`.
  - System Envelope index anchors (`_key`, e.g. `_cat`, `_kind`, `_ts`, `_ch`) render with an index tag badge (`$(tag)`) in `charts.purple`.
  - Expanding documents now deterministically groups fields into architectural tiers: Operational Protocol (`__`) $\rightarrow$ System Envelope (`_`) $\rightarrow$ Domain Content (alphabetical).
- **Table Column Partitioning & Noise Filter Toggles**:
  - Both Collection Table (`openCollectionAsTable`) and Field Table (`openFieldAsTable`) order columns by tier: Pinned `id` $\rightarrow$ System Envelope (`_*`) $\rightarrow$ Domain Content $\rightarrow$ Operational Protocol (`__*`).
  - Added header badges (`<envelope>` and `<protocol>`) with distinct border accents.
  - Added toolbar toggle buttons: **`🛡️ __ Protocol`** and **`🏷️ _ Envelope`** to instantly hide/show system metadata so content editors can focus purely on domain data.
- **Server-Side Query Builder Protocol Shortcuts**:
  - Added 1-click query presets in the Query Builder: **`[⚡ Active Only]`** (`__.active == true`) and **`[⏱ Inactive]`** (`__.active == false`).
- **Cross-Substrate Clipboard (Dual-Contract Paste)**:
  - Copy any document from a collection $\rightarrow$ Right-click an in-document Map (`Record<string, T>`) or Array (`T[]`) field $\rightarrow$ **Paste Document**. Automatically sets the key in the registry or appends to the array.
- **Safe Mode: System Key Mutation Guard**:
  - Added setting `ketrik-firestore-studio.protectSystemKeys` (default: `true`).
  - Warns and requires explicit confirmation before deleting or renaming any System Envelope (`_`) or Operational Protocol (`__`) key.
- **Modular Architecture & Extension Refactoring**:
  - Decoupled commands into dedicated domain modules: `documentCommands.ts`, `fieldCommands.ts`, and `collectionCommands.ts`.
  - Introduced `DocumentClipboard` and `TemplateService` for clean state isolation.
  - Reduced `extension.ts` by over 80% (from 1,130 lines to ~200 lines).

## [1.5.0] - 2026-10-09

### Added
- **Server-Side Query Builder in Table View**: Interactive query panel to construct multi-clause Firestore `where` queries with rich operators (`==`, `!=`, `<`, `<=`, `>`, `>=`, `array-contains`, `array-contains-any`, `in`, `not-in`). Queries execute directly against Firestore on the server with intelligent type casting (booleans, numbers, and JSON arrays), paginated fetching, and query reset actions.
- **Open Map / Array Field as Table View (`ketrik-firestore-studio.openFieldAsTable`)**: View Map (`Record<string, T>`) and Array (`T[]`) root variables directly in a dedicated collection table view, supporting the Dual-Contract substrate pattern (Registry keys or sequence indices as row IDs, tabular column breakdown, in-memory search, raw JSON editor jump, and JSON export).

### Fixed & Improved
- **Smart `null` Field Handling**: Clicking a `null` field in the tree now opens an interactive type picker allowing instant conversion to Object (`{}`), Array (`[]`), String, Number, Boolean, or opening directly in the JSON editor (fixing a bug where it previously assumed string input).
- **Rename Field (`ketrik-firestore-studio.renameField`)**: Right-click any root field to rename it. Atomically copies the value to the new field name and deletes the old key using `FieldValue.delete()` with conflict/overwrite safety checks.
- **Granular Node Refresh (`ketrik-firestore-studio.refreshItem`)**: Right-click on any document or field to refresh just that target item and its subfields, without triggering a full tree rebuild or resetting collection pagination and sort orders.
- **Streamlined Field Context Menus**: Removed duplicate "Edit Value / Open Field" action from right-click context menu (since clicking the node already triggers it), exposing a clean set of actions: Table View (for Maps/Arrays), Open in JSON Editor, Rename Field, Add Field, Refresh, and Delete Field.

## [1.4.0] - 2026-10-09

### Added
- **Deep Delete (Subcollections Recursive Deletion)**: Deleting a document with nested subcollections automatically detects them and prompts for **Deep Delete (Doc + Subcollections)** or **Delete Document Only**, leveraging batched `firestore.recursiveDelete`.
- **Duplicate Document**: Clone any document within the same collection via right-click $\rightarrow$ **Duplicate Document...** with instant ID prompt and automatic editor opening.
- **Cross-Connection Copy & Paste**: Copy a document from any connection (e.g., Production) via **Copy Document** and paste it into any other collection or connection (e.g., Local Emulator or Staging) via **Paste Document**.
- **Copy as JSON**: Export/copy formatted JSON of any document straight to the OS clipboard directly from the tree view context menu without opening an editor tab.
- **Enhanced Tree Visual Hierarchy**: Added distinct color coding for tree items: collections use a warm amber folder (`charts.orange`), documents use a vibrant blue file-code icon (`charts.blue`), and sub-fields use semantic type colors, making items instantly distinguishable.
- **Initial Document Folding (`initialFoldLevel`)**: Added setting `ketrik-firestore-studio.initialFoldLevel` (default `0`, configurable to `1` or `2`) to automatically fold opened documents to the desired hierarchy level upon opening.
- **Configurable Caching & Read Quota Safeguards**: Added `ketrik-firestore-studio.cacheTTLSeconds` (default 30s) for snappy tree browsing without redundant queries, and `ketrik-firestore-studio.maxTableRows` (default 100) to cap collection table read costs.
- **Optional Overwrite Protection**: Added setting `ketrik-firestore-studio.checkRemoteChangesOnSave` (default `false`) if you wish to verify remote changes before saving.

### Performance & Fixed
- **Memory & Lifecycle Cleanup**: Properly terminates active Firestore gRPC instances and deletes Firebase apps on connection change or extension deactivation.
- **Webview Memory & Table DOM Optimization**: Released webview message subscriptions and array buffers on panel disposal and removed persistent hidden context retention.
- **Preserved Tree Paging & Order State**: Saving virtual document files in the editor now refreshes tree node content without wiping out user pagination offsets or sort direction.
- **Independent Emulator Connections**: Configures emulator host and SSL settings directly per connection instance, allowing emulator and production connections to coexist without global environment variable conflicts.

## [1.3.0] - 2026-10-08

### Added
- **Jump to Document ID (Tree View)**: Direct single-read lookup on collections via context menu or `$(search)` action (`ketrik-firestore-studio.jumpToDocument`), bypassing large collection scans. If the document does not exist, offers an option to create it immediately.
- **Server-Side Direct Lookup (Table View)**: Added **Lookup Doc ID** toolbar input in the Collection Table view that directly retrieves documents from Firestore with 1 read, bypassing client pagination and displaying lookup status badges.

## [1.2.1] - 2026-10-08

### Added
- **Smart Modal Editing for Primitives**: Clicking or editing a boolean immediately presents a QuickPick (`true` / `false`), and numbers/strings present a modal input with validation, saving atomically without cluttering editor tabs.
- **Open in JSON Editor Context Action**: Dedicated option to open any field directly into a virtual JSON editor tab when raw syntax editing is preferred.

### Fixed
- **Auto-Refresh on Document/Field Save**: Fixed tree view cache issue where modified field values (such as booleans, strings, or numbers) did not immediately reflect the updated state in the tree after saving in the editor.

## [1.2.0] - 2026-10-08

### Added
- **Root Variables as Virtual Subdocuments**: Open top-level document fields and nested structures independently in dedicated JSON editors.
- **Atomic Partial Updates**: Saving an edited root field uses Firestore's atomic `.update({ [field]: value })` rather than overwriting the entire document.
- **Tree View Document Field Explorer**: Expanding any document now displays all its root variables/fields with type badges (e.g. `{14 keys}`, `[5]`, strings, numbers), alongside subcollections.
- **Field Context Actions**: Add new root fields with type assistance (`Object`, `Array`, `String`, `Number`, `Boolean`, or custom `JSON`), open fields in editor, copy field paths, or delete fields directly from tree context menus.

## [1.1.1] - 2026-10-07

### Fixed
- Broadened VS Code engine compatibility (`^1.85.0`) to ensure support across all modern and LTS versions of Visual Studio Code, Cursor, and VSCodium.

## [1.1.0] - 2026-10-05

### Added
- Multi-connection management: Connect to multiple Firestore instances and emulators simultaneously.
- Interactive Collection Table View with live search, pagination, and JSON export.
- Custom modern geometric database icon (`media/logo.png`).
- Type chips and document ID shortcuts in Table View.

### Changed
- Rebranded extension to **Ketrik Firestore Studio**.
- Migrated build system to **esbuild** for sub-100ms bundling and smaller package footprint.
- Modernized TypeScript configuration to `ESNext` and strict type checks.
- Overhauled command palette and context menus for smoother developer workflow.

### Fixed
- Fixed typo in `orderBy` command module and bindings.
- Resolved dependency vulnerabilities and streamlined node dependencies.

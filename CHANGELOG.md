# Change Log

All notable changes to the "Ketrik Firestore Studio" extension will be documented in this file.

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

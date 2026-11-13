# Change Log

All notable changes to the "Ketrik Firestore Studio" extension will be documented in this file.

## [1.20.0] - 2026-11-13

### Added
- **Database Configuration & PITR Management Webview (`ketrik-firestore-studio.openDatabaseConfiguration`)**:
  * Dedicated interactive configuration inspector accessible from Connection context menus (`$(gear) Database Configuration & PITR Settings...`) and table toolbars.
  * **1-Click Point-in-Time Recovery (PITR) Toggle**: Inspect PITR activation state, 7-day retention period, earliest recoverable timestamp (`earliestVersionTime`), and enable/disable PITR with live safety confirmation.
  * **Delete Protection Safeguard**: 1-click toggle (`DELETE_PROTECTION_ENABLED` / `DELETE_PROTECTION_DISABLED`) to shield production Firestore databases against accidental deletion.
  * **Concurrency Mode Control**: Switch seamlessly between **Optimistic** and **Pessimistic** locking concurrency control.
  * **Infrastructure Metadata**: Inspect GCP Region (`locationId`), Database Type (`FIRESTORE_NATIVE` vs `DATASTORE_MODE`), UID, CMEK KMS Key references, and creation/update timestamps.
  * **Local JSON & Emulator Introspection**: Inspect mock database file paths, disk sizes, active document counts, in-memory cache health, and emulator ports (Firestore, Auth, Storage).
- **Time-Travel Explorer Suite (`readTime`)**:
  * Dedicated Time-Travel command (`ketrik-firestore-studio.openTimeTravel`) on connections, collections, and documents.
  * Seamlessly inspect database state at any microsecond in the past 7 days using read-only Firestore snapshot transactions.
  * **Time-Travel Quick Presets & Custom Timestamp**: Quick jump buttons (*15 min ago*, *1 hr ago*, *6 hrs ago*, *24 hrs ago*, *3 days ago*, *7 days ago*) or interactive timestamp picker with microsecond precision.
  * **Read-Only Safety Guard**: Visual gold/amber historical status banner preventing unintended mutations while browsing past snapshots.
- **Side-by-Side Historical Diff Viewer (`ketrik-firestore-studio.compareDocumentWithLive`)**:
  * 1-Click native side-by-side diff comparing the historical document snapshot at `readTime` against current live database state.
  * Color-coded JSON highlighting additions, modifications, and deletions.
- **1-Click Document Restore & Rollback (`ketrik-firestore-studio.restoreDocumentFromHistory`)**:
  * Atomically revert live documents back to any historical snapshot.
  * Recover deleted documents: automatically detects deleted documents in live state when browsing historical snapshots with 1-click **Restore Deleted Document**.

## [1.19.2] - 2026-11-06

### Optimized & Performance
- **Zero-Allocation Search Substrate**: Replaced client-side stringified JSON filtering in table webviews with recursive tree matcher, eliminating GC pressure and input latency.
- **Explorer Tree Subfield Caching**: Added targeted caching for nested Map items with granular branch invalidation on document mutations.
- **$O(1)$ Tabgroup Evaluation**: Optimized virtual file system batch invalidation to pre-collect open editor tabs once.
- **Live Reactive Table Sync**: Subscribed Document & Field Table webviews to virtual file system events with debounced live reload.
- **Resource Lifecycle Management**: Implemented disposable lifecycle for SecretManagerService and RAF-debounced graph canvas wheel zooming.

### Fixed & Improved
- **In-Cell Typing Preservation**: Preserved string types (`"true"`, `"false"`, `"null"`, numeric strings) across all table cell editors without unintended type coercion.
- **macOS Root Save Fix (`EROFS`)**: Centralized `getDefaultExportUri` across export dialogs to anchor saves to workspace folders instead of root `/`.
- **Local JSON Full Parity**: Added Local JSON support to collection table (`createDoc`, `jumpToId`, `openFieldAsTable`, `countCollection`, `estimateQueryCost`, `calculateAggregates`, batch updates/deletes).
- **Subcollection Path Safety**: Fixed subcollection path truncation in document & collection commands.
- **Array Index Protection**: Protected nested array indices from map conversion during field table updates.
- **Document Deletion Lifecycle**: Emitted `FileChangeType.Deleted` on document deletes so open virtual tabs close cleanly.
- **CostService Accounting**: Added operation tracking across batch replications, document pastes, and synthetic generation.

## [1.19.1] - 2026-11-02

### Added
- **Interactive Document-as-Table Webview (`ketrik-firestore-studio.openDocumentAsTable`)**:
  * Open any Firestore or Local JSON document directly as an interactive webview table from the Explorer Tree (`inline@1` or context menu `1_open@2`), editor title bar (`$(table)` on virtual document tabs), or command palette with interactive connection & path pickers.
  * **Dual-View Substrate**:
    * **Vertical Property Sheet (Fields View)**: Inspect all fields in a structured key-type-value view with inline cell editing, field type badges, and atomic property deletion.
    * **Horizontal Record View**: Single-row spreadsheet layout matching collection grid column semantics.
  * **Direct Breadcrumb & Field Drill-Down**: 1-click navigation to parent collection table (`openCollectionAsTable`) and nested field tables (`openFieldAsTable`) for Maps and Arrays.
  * **Atomic Partial Updates**: Double-click cell editing writes partial updates via `FieldPath` without rewriting or downloading the entire document.

### Fixed & Improved
- **Field Table View Initial Data Hydration & SSR (`openFieldAsTable`)**:
  * Fixed empty table render race conditions on first open: pre-renders initial table header and rows server-side (`renderHeaderRowHtml`, `renderRowsHtml`) embedded directly in the webview HTML.
  * Added resilient stringified JSON parsing for string-encoded maps/arrays.
  * Added error banner reporting directly inside the webview when snapshot retrieval or JSON parsing encounters an error.
- **Resource & Memory Optimization**:
  * Replaced object iterations with indexed loops and reusable escaping utilities in table webview renderers.

## [1.19.0] - 2026-10-27

### Added
- **Google Secret Manager Suite & Dedicated Tree Explorer (`🔐 Google Secret Manager`)**:
  * Dedicated top-level Secret Manager tree item under each active GCP / Firebase connection.
  * Paged listing of all secrets (`projects/{projectId}/secrets`) with search, filter, and in-tree replication policy badges.
  * Expandable secret nodes to inspect and manage individual versions (`v1 [Enabled]`, `v2 [Disabled]`, `v3 [Destroyed]`).
  * Dedicated version lifecycle actions: Create Secret (`ketrik-firestore-studio.createSecret`), Add Version (`ketrik-firestore-studio.addSecretVersion`), Enable Version, Disable Version, and Destroy Version with enterprise confirmation.
- **Document Field Secret Linking & Smart Badging**:
  * Automatic detection of Google Secret Manager resource paths (`projects/.../secrets/...`) across Explorer Tree, Table View, and Virtual JSON editor.
  * Visual in-tree & in-table `🔐` secret badges with hover metadata (secret ID, version state).
  * 1-Click "Link Field to Google Secret..." (`ketrik-firestore-studio.linkFieldToSecret`): interactive picker to link any document field to an existing secret.
  * 1-Click "Migrate Field to Secret Manager (Extract & Mask)" (`ketrik-firestore-studio.migrateFieldToSecret`): safely exports sensitive plaintext fields (API keys, connection strings) to Secret Manager and atomically replaces them with secure resource links.
- **In-Place Ephemeral Secret Reveal & Secure Clipboard**:
  * Inline `$(eye) Reveal Secret Value` (`ketrik-firestore-studio.revealFieldSecretPayload`): inspect decrypted payloads in a safe, ephemeral masked modal without writing to disk or Firestore document.
  * 1-Click payload copy with optional automated 15-second clipboard wipe timer.
- **Zero-Plaintext Connection Credentials & VS Code SecretStorage**:
  * Native integration with VS Code encrypted OS Keychain (`vscode.SecretStorage` / `useSecretStorage: true`) to store service account credentials securely without saving tokens into `.vscode/settings.json`.
  * Support for dynamic service account credential resolution directly from Google Secret Manager (`secretUri: "projects/.../secrets/..."`).
- **Single Document Cross-Instance Replication (`ketrik-firestore-studio.copyDocumentToInstance`)**:
  * 1-click replication of an individual document from one Firestore / Local JSON instance to another with optional deep subcollection traversal and merge/overwrite options.

## [1.18.0] - 2026-10-25

### Added
- **Deterministic AI Scratchpads (`ketrik-firestore-studio.openAiScratchpad`)**:
  * 1-click zero-prompt scratchpad generation under `.firestore/<connectionId>/<collectionPath>/<docId>/[<fieldPath>.json]`.
  * Eliminates manual directory creation, file picking dialogs, and document ID collisions across different collections.
  * Automatically binds origin metadata in `.firestore/snapshots.json` and ensures `.firestore/` is gitignored.
- **Field-Level Isolation (Token Optimization for 1MB Documents)**:
  * Extract and isolate a single document field (e.g. `config.groups` or `sidebar_finance`) into its own scratchpad file.
  * Reduces AI LLM token consumption by up to 99.8% (e.g. 2 KB instead of 1 MB / ~250k tokens).
  * On save, pushes atomic partial updates via Firestore `FieldPath(...segments)` without re-uploading or risking the rest of the document.
- **Unpack Monolithic Document Fields (`ketrik-firestore-studio.unpackDocumentFields`)**:
  * 1-click unpack of all top-level keys in a document into individual modular files (`header.json`, `sidebar.json`, `metadata.json`), each independently tracked and auto-synced.
- **Dual-Mode Document Architecture (`ketrik-firestore-studio.openMode`)**:
  * `"virtual"` (default): 100% in-memory virtual tabs (`ketrik-firestore-studio://`) with zero files written to disk.
  * `"workspace"`: Directly opens `.firestore/...` scratchpad files on tree clicks for seamless 0-click AI assistant editing.
- **Live Automatic Synchronization (`ketrik-firestore-studio.autoSyncLocalSnapshots`)**:
  * When enabled, saving any tracked snapshot or scratchpad file immediately pushes changes back to Firestore or Local JSON.
- **Privacy & Scratchpad Cleanup (`ketrik-firestore-studio.cleanScratchpads`)**:
  * 1-click command to recursively delete `.firestore/` and clear all bindings.
- **Interactive Collection Filter on Tree (`ketrik-firestore-studio.filterCollection`)**:
  * Filter any collection directly on the Explorer Tree by Doc ID prefix, substring, or content without having to open and scroll through all items.
  * Dedicated inline filter action (`$(filter)`), active badge indicator (`[🔍 "filter"]`), context menu action, and 1-click filter clearing (`$(clear-all)`).
  * Empty state guidance with direct action to reset the filter.
- **Expandable Array Tree Items & In-Place Item Mutations**:
  * Arrays on the Explorer Tree are now collapsible and expandable into indexed individual elements (`[0]`, `[1]`, etc.).
  * Edit single array items directly from the tree (primitives via type-validated input prompts, maps/arrays via inline editor/JSON prompt).
  * Dedicated inline and context menu actions: Edit Array Item (`$(edit)`), Duplicate Array Item (`$(copy)`), Add Item to Array (`$(add)`), and Delete Array Item (`$(trash)`).
  * Atomic Firestore array mutation preserving index ordering across both Cloud Firestore and Local JSON.
- **Tree Context Menu Overhaul & Logical Grouping Tiers**:
  * Complete restructuring of Explorer Tree context menus across Connections, Collections, Documents, Fields, and Array Items into logical, beautifully separated tiers (`1_open`, `2_ai`, `3_edit`, `4_clipboard`, `5_tools`, `6_sync`, `7_refresh`, `9_danger`).
  * Replaces cluttered, unordered menus with clean separators and predictable action placements.
- **Field Table View Data Hydration & Sanitization (`openFieldAsTable`)**:
  * Fixed empty view ("0 items") when opening arrays or maps as tables: embedded initial data directly into webview HTML (`window.__INITIAL_DATA__`) to eliminate `postMessage` race conditions.
  * Added deep serialization and sanitization (`sanitizeFirestoreValue`) preventing complex/circular Firestore SDK objects and timestamps from breaking webview structured cloning.
  * Fixed nested dot-path resolution (e.g. `config.groups`) when opening field tables from the collection grid.
- **Side-by-Side Diffing, Push & Pull Suite**:
  * Dedicated toolbar and context menu actions for tracked files: `$(diff) Compare with Firestore`, `$(cloud-upload) Push to Firestore`, `$(cloud-download) Pull Latest from Firestore`.

### Optimized & Hardened
- **Zero-Allocation Traversals & Sizing Loops**:
  * Replaced `Object.keys()` and `Object.entries()` allocations with zero-allocation `for..in` loops and `hasOwnProperty` across document sizing (`calculateValueSize`), field items, table filtering (`filterObjects`), and schema analysis (`extractDocumentFieldEntries`).
  * Converted `tableUtils.filterObjects` excluded keys check to an $O(1)$ `Set` with early exit on primitive matches, eliminating tens of thousands of tuple allocations during search keystrokes.
- **Shared Timestamp Revival & Bulk Operations**:
  * Unified and exported `reviveTimestamps()` in `timestampUtils.ts` with zero intermediate array allocations, reducing heap pressure during large collection copies, local syncs, and virtual file saves.
- **Rules AST Parser & Cache Bounds**:
  * Precompiled helper function replacement regexes in `RulesParser.ts` to avoid constructing dynamic `RegExp` objects inside rule evaluation loops.
  * Bounded `RulesParser._accessCache` to 500 entries with LRU eviction to prevent unbounded memory growth on large subcollection graphs.
  * Automated cleanup of rules parsers and virtual rules on connection deletion.
- **Resource Disposal & Memory Leak Prevention**:
  * Added `OverviewService` connection listener disposal and bound `overviewService` to extension context subscriptions.
  * Canceled pending TTL timers in `DocumentFileSystemProvider` on document invalidations, updates, and provider disposal.
  * Replaced module-level text document close listener leak in `TimestampEditorDecorations.ts` with a disposable subscription registered on extension activate.
  * Cached `.gitignore` validation in `SnapshotSyncService` to eliminate redundant synchronous disk I/O on every save.
  * Streamlined collection search filtering in `ExplorerDataProvider` with early-exit recursive term matching (`matchesSearchTerm`), avoiding full-document `JSON.stringify` allocations.

## [1.17.0] - 2026-10-23

### Added
- **Multi-Collection Batch Replication Suite (`ketrik-firestore-studio.copyMultipleCollections`)**:
  * Checkbox multi-select checklist (`canPickMany: true`) to replicate multiple collections simultaneously across Firestore connections or local JSON instances.
  * Deep recursive subcollection copying with clean cross-substrate translation across Cloud Firestore, Local Emulators, and Local JSON stores.
  * Smart naming rules (Keep Identical, Prefix, Suffix) with collision prevention to guard against accidental self-overwrites.
  * Safety-chunked `WriteBatch` operations (400 docs/batch) with live progress reporting and cancellation handling.
- **Bulk & Single Collection Permanent Deletion (`deleteMultipleCollections` & `deleteCollection`)**:
  * Checkbox multi-select to delete multiple collections atomically with explicit warning modals.
  * Single-collection deep delete (`$(trash)`) available from Explorer Tree context menus.
  * Automatic cache invalidation (`invalidateAndNotifyCollectionDeleted`) and targeted tree node refresh.

### Fixed & Improved
- **Nested Document Field Virtual File System & Editor (`ketrik-firestore-studio.openFieldInEditor`)**:
  * Fixed virtual file URI resolution for nested Map properties (e.g. `sidebar_finance.options`): now correctly maps to `ketrik-firestore-studio://<conn>/<docPath>/<fieldPath>.json` instead of wrongly truncating to the leaf field name.
  * `DocumentFileSystemProvider` now properly parses dot-delimited field paths and resolves nested object hierarchies in both live Firestore and Local JSON modes without throwing `FileNotFound`.
  * Auto-dispatches `FileChangeType.Changed` events to open sub-field virtual JSON editor tabs when the parent document changes, ensuring open field tabs live-reload immediately.
  * Added URI fragment (`#fieldPath`) parsing support in virtual file system provider.
- **Hierarchical Tree Reveal for Nested Fields (`ExplorerDataProvider.revealDocument`)**:
  * Dot-notation path splitting (`targetSegments`) and iterative recursive traversal down nested Map structures.
  * Automatically expands and registers parent branches (`_expandedFieldIds`) so selecting or switching to nested field tabs expands and highlights the targeted field directly in the Explorer Tree.
- **Atomic Field Mutations Across All Contexts**:
  * Updated `tombstoneCommands`, `migrationCommands` (`explodeField`), and `documentCommands` (`pasteDocument`) to use `new FieldPath(...segments)` and `LocalJsonService` dot paths, ensuring safe atomic operations on deeply nested fields without key collisions.
- **Studio Overview & Analytics CPU/Memory Optimization**:
  * Added bounded LRU caching to `OverviewService` and `TrafficMetricsProvider` to eliminate memory retention during continuous polling.
  * Correct unref and disposal of background interval timers upon dashboard webview closure.

## [1.16.0] - 2026-10-22

### Added & Improved
- **Unified Studio Overview & Insights Dashboard (`ketrik-firestore-studio.openOverviewDashboard`)**:
  * **Summary KPI Cards**: Top-level overview displaying Root Collections count, sampled documents, today's total operation volume, and Auth user statistics.
  * **Database & Collection Breakdown**:
    * Low-cost server-side `count()` aggregations across root collections (1 read per 1,000 index entries) with in-memory caching (60s TTL).
    * Top 5 largest collections by document volume with 1-click **"↗ Open Table"** jump to `openCollectionAsTable`.
    * **Storage Footprint Gauge**: Projected database storage size calculated from UTF-8 byte serialization rules with percentage of 1.0 GiB Spark Free Tier allowance.
    * **Daily Quota Burn Rate**: Real-time progress meters for Document Reads (vs. 50k), Document Writes (vs. 20k), and Document Deletes (vs. 20k) with dynamic green, amber, and red warning threshold styling.
  * **Network & Traffic Analytics Suite**:
    * **Throughput & Operations**: Interactive SVG multi-line time series charts showing 7-day reads, writes, and deletes with delegated hover tooltips.
    * **Bandwidth & Payload Size**: Sent bytes (egress) vs. received bytes (ingress) area charts tracking payload trends over time.
    * **Real-Time Client Connections**: Live tracker of active `onSnapshot` client streams (`firestore.googleapis.com/listen/realtime_connections_count`).
    * **Security Rule Traffic**: Visual ratio of allowed vs. denied security rules evaluations (`firestore.googleapis.com/rules/evaluation_count`).
    * **Multi-Tier Fallback**: Automatically pulls from Google Cloud Monitoring API, Local Firebase Emulator telemetry, or active Studio session accounting with zero disruption.
  * **Firebase Auth & Growth Insights**:
    * Account breakdown meters: Active vs. disabled users, verified email percentage, and 7-day active sign-in velocity.
    * Provider distribution breakdown (Email/Password, Google, Apple, Anonymous, Phone).
  * **Export & Sharing**:
    * 1-click export of complete overview and traffic audit to formatted **Markdown** or raw **JSON**.
  * **Offline Local JSON Support**: Full database metric compatibility inspecting local collections, document counts, and projected byte sizes without requiring cloud credentials.

## [1.15.1] - 2026-10-20

### Added & Improved
- **Field Table In-Place Spreadsheet Cell Editing (`openFieldAsTable`)**:
  * Double-click or press `Enter`/`F2` on any scalar cell (string, number, boolean, timestamp, null) in Map and Array tables to edit in place.
  * Type-safe inputs with boolean dropdowns, numeric validation, and optimistic `.flash-update` styling.
  * Atomic Firestore writes via `FieldPath(...segments, rowId, field)` for Maps and in-memory element updates for Arrays with live `invalidateAndNotify` cache syncing.
- **Field Table Entry Addition (`➕ Add Entry`)**:
  * Dedicated toolbar action in Map and Array table views to add new properties or elements.
  * Full interactive type picker (String, Number, Boolean, Timestamp, Object, Array, Custom JSON) with validation.
- **Field Table Row Deletion (`🗑️ Delete Entry`)**:
  * Per-row action button (`🗑️`) with confirmation dialog.
  * Atomically deletes Map keys via `FieldValue.delete()` or splices Array elements by index.
- **Duplicate Field Command (`ketrik-firestore-studio.duplicateField`)**:
  * Clone any document field or nested property directly from the Explorer Tree context menu.
  * Key collision checks, custom name prompt, and atomic write-back via `new FieldPath(...targetSegments)`.

## [1.15.0] - 2026-10-20

### Added & Improved
- **Recursive Expandable Map Field Nodes in Explorer Tree**:
  * First-class collapsible tree items (`vscode.TreeItemCollapsibleState.Collapsed`) for Map fields with properties (`{ n keys }`).
  * Zero-quota reads: expanding Map fields browses child properties recursively in memory from the cached document snapshot without extra Firestore read billing.
  * Two-phase interaction: single-click expands the map branch; clicking an already expanded map opens the virtual JSON editor tab.
  * Parent hierarchy navigation and tree reveal support back to parent maps or documents.
- **Context-Aware "Add Nested Property..." on Map Fields (`ketrik-firestore-studio.addNestedProperty`)**:
  * Dedicated nested property creation command and inline `$(add)` quick action icon on Map tree rows.
  * Prompts for new property name with input validation and full type picker (String, Number, Boolean, Timestamp, GeoPoint, Map, Array, Custom JSON).
  * Atomic Firestore writes via `docRef.update(new FieldPath(...segments), value)` without touching sibling map keys.
- **Scoped "Delete Multiple Properties..." for Maps (`ketrik-firestore-studio.deleteMultipleFields`)**:
  * Scoped QuickPick checklist displaying only the properties inside the selected map.
  * Safe Mode warning and modal confirmation when system envelope (`_`) or protocol (`__`) keys are selected.
  * Atomic multi-key deletions using `FieldValue.delete()` across all selected nested paths.
- **Field Clipboard Parity ("Copy as JSON" & Nested Dotted Paths)**:
  * Added **"Copy as JSON"** (`ketrik-firestore-studio.copyFieldJson`) to copy clean formatted JSON for any field value.
  * Enhanced **"Copy Path"** (`ketrik-firestore-studio.copyPath`) to copy complete dot-delimited paths for nested fields (e.g. `users/123/address.street`) and enabled across all field item types.
- **Arbitrary Dot-Delimited Path Support in Virtual File System & Local JSON**:
  * Enhanced `DocumentFileSystemProvider` (`getNestedFieldValue`): `stat`, `readFile`, baseline hash conflict detection, and `writeFile` now resolve and mutate arbitrarily nested property paths via `new FieldPath(...segments)`.
  * Enhanced `LocalJsonService` to support deep dotted path traversal and atomic mutations for offline JSON connections.

---

> For historical release notes prior to v1.15.0 (v1.0.0 through v1.14.0), please refer to git release tags and [GitHub Releases](https://github.com/ketrik/ketrik-firestore-studio/releases).


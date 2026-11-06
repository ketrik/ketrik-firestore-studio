# Ketrik Firestore Studio

[![Visual Studio Marketplace](https://img.shields.io/badge/VS%20Code-Extension-007acc?style=flat-square&logo=visual-studio-code)](https://marketplace.visualstudio.com/items?itemName=ketrik.ketrik-firestore-studio)
[![Version](https://img.shields.io/badge/Release-v1.19.2-2ecc71?style=flat-square)](ROADMAP.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)

The definitive, enterprise-grade Visual Studio Code extension for exploring, querying, mutating, and managing **Google Cloud Firestore**, **Firebase Authentication**, **Security Rules**, and **Local Emulators** directly inside your IDE.

---

## ⚡ Why Ketrik Firestore Studio?

Unlike basic viewers that only render static JSON trees, **Ketrik Firestore Studio** is built as a complete database workbench:

- 📊 **Spreadsheet-Grade Table Grids**: Real-time filtering, multi-clause server query builder, inline cell editing, and slide-out Property Inspector.
- 📡 **Real-Time Live Watch Mode**: Stream live `onSnapshot` mutations with animated visual flash feedback (green for added, amber for updated, red for deleted).
- 🎲 **Synthetic Mock Data Generator**: Seed 1 to 5,000 realistic documents in seconds with domain-aware schema inference (emails, avatars, geo coordinates, prices).
- 🗂️ **Firestore Composite Indexes Suite**: Introspect deployed cloud/emulator indexes, 1-click JSON inspection, and 2-way sync with workspace `firestore.indexes.json`.
- 💾 **100% Offline Local JSON Store**: Connect to local `.json` mock files with full table and editor parity—zero cloud billing, zero network needed.
- 👥 **Firebase Auth User Suite**: Bulk user explorer, avatar previews, custom claims editor (`admin: true`), JWT custom token minter, and cross-environment user cloner.
- 🛡️ **Live Security Rules & Diff**: Virtual editor for `firestore.rules` with live deployment, AST-level permission badges (`🚨 Public`, `🔒 Locked`), and side-by-side diff.
- 🔐 **Google Secret Manager & Field Links**: Dedicated secret tree explorer, document field secret links (`projects/.../secrets/...`), 1-click secret migration, and zero-plaintext OS Keychain credentials.
- ⚡ **Quota & Memory Protection**: Native document storage size monitoring (bytes & limit warnings), direct 1-read document ID lookups, and auto-pausing listeners.

---

## 🚀 Feature Highlights at a Glance

### 1. Tabular Grid & Spreadsheet Suite
* **Interactive Webview Tables**: Open any Collection or Collection Group into a high-density tabular grid with pinned ID columns and column-zone toggles.
* **Server-Side Query Builder**: Multi-clause `where` filters (`==`, `!=`, `<`, `<=`, `>`, `>=`, `array-contains`, `in`, `array-contains-any`, `starts-with`) with logical `AND` / `OR` support.
* **Live Watch Mode (`📡 Live Watch`)**: Real-time listener (`onSnapshot`) with animated mutation highlights (green added, amber modified, red removed) and 5-min inactivity quota watchdog.
* **In-Cell & Drawer Editing**: Double-click scalar cells for instant inline mutation; open nested Maps and Arrays in a slide-out Key-Value Property Inspector drawer.
* **Batch Operations**: Checkbox multi-select for bulk field updates, atomic removals (`FieldValue.delete()`), and chunked `WriteBatch` deletions.
* **Single-Read Document Lookup**: Fetch any document by ID directly from the server using 1 billable read without scanning collections.

### 2. Firestore Composite Indexes Suite
* **Dedicated Tree Branch**: Live view of all deployed indexes under each connection with status badges (`READY` ✅, `Building` ⏳, `Needs Repair` ⚠️) and query scopes (`📁 Collection` vs `🌐 Group`).
* **Two-Way `firestore.indexes.json` Sync**: Snapshot live indexes into your workspace, compare via graphical side-by-side diff, and deploy changes directly to Cloud Firestore.
* **Visual Index Builder & Error Catcher**: 1-click launcher when queries encounter `FAILED_PRECONDITION` index required errors, parsing field specifications instantly.

### 3. Data Synthesis, Import & Schema Generation
* **Synthetic Mock Data Generator**: Right-click any collection $\rightarrow$ generate up to 5,000 documents with intelligent type detection (names, emails, phones, avatars, prices, statuses, IDs, geo coordinates, timestamps).
* **TypeScript & Zod Contract Generator**: Introspect document structures to generate type-safe TypeScript interfaces or runtime Zod schemas with union enum deduction.
* **Data Import/Export Wizard**: Export collections to CSV, JSON, or NDJSON; batch import datasets with customizable ID generation strategies.

### 4. Virtual JSON File System & Document Size Monitor
* **Native JSON Editor Tabs**: Open documents as virtual `.json` files (`ketrik-firestore-studio://...`) with full VS Code autocomplete, linting, and formatting.
* **Atomic Partial Updates**: Saving sub-fields or root variables executes targeted `.update()` operations rather than overwriting entire documents.
* **Exact Storage Size Badges & Status Bar**: Real-time byte calculation following Google Cloud specs. In-tree size indicators turn **red** (`⚠️ <size>`) when documents approach the 750 KB quota threshold.
* **Timestamp Inlay Hints**: Automatically formats `{ _seconds, _nanoseconds }` into relative human-readable dates with rich hover breakdowns.

### 5. Local JSON Database & Mock Store (Offline)
* Connect directly to a single `mock-db.json` or directory of seed data files (`./seed-data/*.json`).
* Full parity with live Firestore: collections, subdocuments, table views, and in-place virtual editing.
* Bi-directional sync: push local seed data into Cloud Firestore / Emulators, or snapshot live cloud data into local JSON files.

### 6. Firebase Auth User Suite & Identity Management
* **Auth Users Table View**: High-density grid with profile pictures, sign-in providers, MFA status, creation dates, and last sign-in timestamps.
* **Provider Identity Chips & Filter**: Visual badges (`Google`, `GitHub`, `Apple`, `Phone`, `Password`, `Anonymous`) with instant dropdown filtering by identity provider or enrolled MFA.
* **Enrolled MFA Viewer**: Inspect Multi-Factor Authentication second factors (phone, authenticator apps) enrolled on any user account.
* **Email Verification & Passwordless Sign-In**: Generate out-of-band email verification links (`generateEmailVerificationLink`) and passwordless email sign-in links (`generateSignInWithEmailLink`) copied directly to clipboard.
* **Bulk User Import/Export Wizard**: Import user datasets from JSON or CSV files with optional password hash configuration (SCRYPT, BCRYPT, PBKDF2), or export loaded users to JSON with 1 click.
* **Custom Claims Editor**: View and modify role claims (`{ "admin": true, "role": "editor" }`) in real-time.
* **Login Impersonation**: Mint signed custom JWT tokens directly to your clipboard to test user permissions in frontend apps.
* **Cross-Environment User Cloning**: Clone complete accounts with custom claims and linked Firestore `/users/{uid}` documents from Production to Staging.
* **Security & Session Revocation**: Force-logout accounts by revoking refresh tokens; generate password reset links with 1 click.

### 7. Security Rules Governance
* **Live Rules Inspector**: Pull deployed `firestore.rules` directly from Firebase Rules API into a virtual editor.
* **Side-by-Side Diff**: Compare live cloud rules against your local workspace `firestore.rules` before deployment.
* **AST Permission Badges**: Visual indicators in the tree (`🚨 Public Read/Write`, `🔒 Restricted`) warn of open security rules instantly.

### 8. Firestore Vector Search & Embeddings Explorer (kNN)
Explore, inspect, and perform similarity search on AI embeddings stored in Firestore (`FieldValue.vector`):
* **Vector Chips & Inspector**: Visual table badges (`⚡ Vector[1536d] | 1.000`) detailing dimension count and L2 norm magnitude. Double-click any vector cell or open the slide-out inspector to view or edit embedding floats in tabular grid or raw JSON.
* **Interactive kNN Search Panel (`findNearest`)**: Click **"🧠 Vector Search (kNN)"** in the table toolbar to execute nearest-neighbor searches:
  * Select your embedding field path (e.g. `embedding`, `text_vector`).
  * Paste a query vector as a JSON array (`[0.024, -0.158, 0.892, ...]`) or comma-separated numbers (`0.024, -0.158, 0.892`).
  * Choose your distance metric: `COSINE`, `EUCLIDEAN`, or `DOT_PRODUCT`.
  * Set top-K limit (1–100) and optional distance threshold cutoff.
* **Live Similarity Scores**: Displays the calculated distance in a dedicated badge column (`🎯 0.0412`) ranked by proximity.
* **Add & Edit Vectors in Tree**: Right-click any document $\rightarrow$ **Add Field** $\rightarrow$ select **Vector (FieldValue.vector)** to store embeddings directly from VS Code.
* **Full Local JSON Parity**: In-memory vector similarity calculations for offline development and mock databases without requiring active Cloud Firestore credentials.

### 9. Collection Schema Drift & Anomaly Analyzer
Scan and evaluate document consistency across collections:
* **Interactive Health Reports**: Generates an overall Collection Health Score (0–100) based on schema stability, type divergences, and obsolete attributes.
* **Presence & Frequency Meters**: Visual progress bars representing key occurrence rates across sampled documents.
* **Type Inconsistency Matrix**: Identifies divergent scalar types across documents (e.g. `age: number (85%)` vs `string (15%)`).
* **Zombie / Orphan Key Detection**: Surfaces dead keys and obsolete attributes found in $< 5\%$ of sampled records.
* **1-Click Audit Export**: Export reports directly to GitHub Flavored Markdown or structured JSON.

### 10. AI Scratchpad, Field-Level Isolation & Workspace Sync
Supercharge your pair-programming with AI coding assistants (Antigravity, GitHub Copilot, Cursor) while eliminating token bloat:
* **Deterministic AI Scratchpads (`$(sparkle) Edit with AI`)**: 1-click zero-prompt scratchpad generation under `.firestore/<connectionId>/<collectionPath>/<docId>/[<fieldPath>.json]`. Eliminates manual directory creation and prevents document ID collisions across different collections.
* **Field-Level Isolation (99.8% Token Optimization)**: For large (up to 1 MB / ~250,000 tokens) documents, right-click any targeted field to extract **only that property** (e.g. 2 KB). Drops LLM input tokens from 250,000+ to under 1,000 tokens.
* **Atomic Field Sync**: Edits to a field scratchpad push back atomically via `FieldPath(...segments)` update without risking or re-uploading the entire 1 MB document.
* **Unpack Monolithic Documents (`$(split-horizontal)`)**: 1-click splitting of monolithic documents into modular field files (`header.json`, `sidebar.json`, `metadata.json`), each independently tracked.
* **Dual-Mode Architecture (`ketrik-firestore-studio.openMode`)**:
  * `"virtual"` *(default)*: 100% in-memory virtual tabs (`ketrik-firestore-studio://`) with zero files written to disk. Perfect for ephemeral browsing and production compliance.
  * `"workspace"`: Directly opens `.firestore/...` scratchpad files on tree clicks for seamless 0-click AI assistant editing.
* **Auto-Sync on Save**: When enabled (`ketrik-firestore-studio.autoSyncLocalSnapshots`), saving any tracked file immediately pushes changes back to Firestore / Local JSON.
* **Privacy & Cleanup (`$(trash) Clean All AI Scratchpads`)**: 1-click command in the Command Palette to completely wipe `.firestore/` and reset all bindings.

### 11. Google Secret Manager & Field Links
Enterprise secret governance, document field secret links, and zero-plaintext credential security:
* **Dedicated Tree Explorer (`🔐 Google Secret Manager`)**: Inspect secrets, versions (`Version 1 [ENABLED]`, `[DISABLED]`, `[DESTROYED]`), replication policies, and metadata directly under each connection.
* **Document Field Secret Links**: Automatically detects fields containing Google Secret Manager resource paths (`projects/.../secrets/...`), rendering dedicated `🔐 [Secret: name]` visual badges and tooltips.
* **1-Click "Link to Google Secret..."**: Right-click any document field $\rightarrow$ search and select from existing secrets in your GCP project via QuickPick.
* **1-Click "Migrate Field to Secret Manager (Extract & Mask)"**: Extracts plaintext API keys or tokens into a new Google Secret and atomically replaces the Firestore field with the secure secret reference path.
* **Ephemeral In-Place Reveal & Auto-Wipe Copy**: Inspect live decrypted payloads in masked modals without writing them to disk; copy secret values with an automated **20-second security auto-wipe timer**.
* **Zero-Plaintext Connection Credentials**: Store Service Account credentials encrypted in your OS Keychain via `vscode.SecretStorage` (`"useSecretStorage": true`), or dynamically resolve keys from Secret Manager (`"secretUri": "projects/.../secrets/.../versions/latest"`).

---

## 🛠️ Getting Started in 3 Steps

1. **Install the Extension** from the VS Code Marketplace.
2. **Open the Activity Bar** and click the **Ketrik Firestore Studio** icon.
3. **Add a Connection** (`+`):
   * **Service Account Key (JSON)**: Select your downloaded Firebase service account key.
   * **Local Emulator**: Connect to `localhost:8080` (or custom host) with zero credentials.
   * **Local JSON File / Directory**: Connect to offline mock JSON datasets for offline development.

---

## ⌨️ Essential Commands

| Command | Palette / Context | Description |
| :--- | :--- | :--- |
| `ketrik-firestore-studio.openCollectionAsTable` | Collection Menu / Table Icon | Open collection in interactive table grid with query builder |
| `ketrik-firestore-studio.analyzeCollectionSchema` | Collection Menu / Table Toolbar | Scan collection for schema drift, type conflicts & orphan keys |
| `ketrik-firestore-studio.generateSyntheticData` | Collection Context Menu | Generate 1 to 5,000 realistic mock documents |
| `ketrik-firestore-studio.jumpToDocument` | Connection / Collection Menu | Single-read document lookup by exact Doc ID |
| `ketrik-firestore-studio.openAuthUsersAsTable` | Auth Branch / Palette | Interactive Firebase Auth user management grid |
| `ketrik-firestore-studio.openSecurityRules` | Connection Menu | Inspect live deployed `firestore.rules` |
| `ketrik-firestore-studio.diffSecurityRules` | Connection Menu | Side-by-side diff between deployed and local rules |
| `ketrik-firestore-studio.refreshIndexes` | Indexes Branch | Fetch and introspect all deployed composite indexes |
| `ketrik-firestore-studio.generateSchema` | Collection / Document Menu | Reverse-engineer documents into TypeScript & Zod schemas |
| `ketrik-firestore-studio.copyCollectionToInstance` | Collection Context Menu | Batch copy collection across connections or emulator |
| `ketrik-firestore-studio.copyMultipleCollections` | Connection & Collection Menu | Selectively copy multiple collections across instances with naming rules & deep subcollection support |
| `ketrik-firestore-studio.exportCollection` | Collection Context Menu | Export collection to CSV, JSON, or NDJSON |
| `ketrik-firestore-studio.importCollection` | Collection Context Menu | Import external datasets with type coercion |
| `ketrik-firestore-studio.openAiScratchpad` | Tree Item / Editor Title (`$(sparkle)`) | Instant zero-prompt local scratchpad for whole document or isolated field |
| `ketrik-firestore-studio.unpackDocumentFields` | Document Context / Title (`$(split-horizontal)`) | Split monolithic 1MB document into modular, isolated field files for AI |
| `ketrik-firestore-studio.cleanScratchpads` | Command Palette (`$(trash)`) | Recursively wipe all local `.firestore/` scratchpads and bindings |
| `ketrik-firestore-studio.diffSnapshotWithFirestore` | Snapshot Editor Title (`$(diff)`) | Side-by-side graphical diff between local snapshot/field and live Firestore |
| `ketrik-firestore-studio.pushSnapshotToFirestore` | Snapshot Editor Title (`$(cloud-upload)`) | Push local snapshot or field atomically to Firestore / Local JSON |
| `ketrik-firestore-studio.pullSnapshotFromFirestore` | Snapshot Editor Title (`$(cloud-download)`) | Refresh local snapshot from remote Firestore without losing bindings |
| `ketrik-firestore-studio.deleteCollection` | Collection Context Menu | Permanently delete a collection and all nested documents/subcollections with safety confirmation |
| `ketrik-firestore-studio.deleteMultipleCollections` | Connection & Collection Menu | Multi-select and batch-delete multiple collections with safety confirmation |
| `ketrik-firestore-studio.createSecret` | Secret Manager Branch Menu (`$(add)`) | Provision a new secret in Google Cloud Secret Manager |
| `ketrik-firestore-studio.addSecretVersion` | Secret Item Menu (`$(plus)`) | Add a new payload version via text or file upload |
| `ketrik-firestore-studio.inspectSecretPayload` | Secret & Version Item (`$(eye)`) | Decrypt and inspect live secret payload with auto-wipe copy |
| `ketrik-firestore-studio.linkFieldToSecret` | Field Context Menu (`$(key)`) | 1-Click QuickPick to bind a document field to a Google Secret |
| `ketrik-firestore-studio.migrateFieldToSecret` | Field Context Menu (`$(shield-lock)`) | Extract sensitive plaintext field into a new Google Secret |
| `ketrik-firestore-studio.revealFieldSecretPayload` | Secret Field Menu (`$(eye)`) | Inline inspection of linked secret values directly from document fields |

---

## ⚙️ Configuration & Settings

Fine-tune extension behavior in your VS Code `settings.json`:

```jsonc
{
  // Document open target: "virtual" (in-memory, 0 disk files) or "workspace" (direct .firestore/ scratchpad)
  "ketrik-firestore-studio.openMode": "virtual",

  // Automatically push local changes to Firestore on file save
  "ketrik-firestore-studio.autoSyncLocalSnapshots": true,

  // Maximum rows to load in collection table views (prevents unbounded quota usage)
  "ketrik-firestore-studio.maxTableRows": 100,

  // Default number of documents fetched per page in tree view
  "ketrik-firestore-studio.pagingLimit": 10,

  // Memory cache duration in seconds for tree nodes and virtual document snapshots
  "ketrik-firestore-studio.cacheTTLSeconds": 30,

  // Initial folding level when opening virtual JSON document tabs
  "ketrik-firestore-studio.initialFoldLevel": 1,

  // Verify remote document has not changed externally before writing save
  "ketrik-firestore-studio.checkRemoteChangesOnSave": false
}
```

---

## 🔒 Quota & Billing Safety

This extension uses official Firebase Admin SDK APIs and REST interfaces. Operations respect strict safety thresholds:
* Document lookups by ID use exact 1-read document queries rather than scanning parent collections.
* Live Watch listeners auto-pause after 5 minutes of inactivity to protect Firebase quota.
* Large documents exceeding **750 KB** display prominent visual warning badges to prevent exceeding Firestore's 1 MB write limits.

---

## 🗺️ Roadmap & Community

We are actively expanding Ketrik Firestore Studio. See [ROADMAP.md](ROADMAP.md) for milestone timelines and upcoming releases.

- **Found a bug or need a feature?** [Open an issue on GitHub](https://github.com/ketrik/ketrik-firestore-studio/issues)
- **License**: [MIT](LICENSE)

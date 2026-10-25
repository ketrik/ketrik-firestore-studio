---
title: AI Scratchpad, Field Isolation & Workspace Sync
description: Zero-prompt AI scratchpad extraction, field-level token optimization, deterministic workspace mirrors, and live two-way sync.
sidebar_position: 6
---

# AI Scratchpad, Field Isolation & Workspace Sync

Large language models (e.g. Claude 3.5 Sonnet, GPT-4o, Gemini 1.5 Pro) and AI coding assistants (GitHub Copilot, Cursor, Gemini Code Assist) excel at refactoring, migrating, and editing application data. However, interacting with Cloud Firestore in modern IDEs poses two fundamental challenges:

1. **Virtual Buffer Invisibility**: By default, Firestore Studio serves documents as virtual in-memory tabs (`ketrik-firestore-studio://...`). AI assistants operating strictly on the local filesystem cannot see, grep, or edit these in-memory buffers.
2. **Context Window & Token Burn**: Monolithic Firestore documents can reach up to **1 MB in size** (equivalent to ~250,000+ tokens). Feeding an entire 1 MB document into an AI context window just to modify a single nested configuration object wastes tokens, increases LLM inference latency, and risks unwanted mutations to sibling fields.

**Ketrik Firestore Studio** solves both challenges with **Deterministic AI Scratchpads**, **Field-Level Isolation**, and **Automatic Live Sync**.

```
┌────────────────────────────────────────────────────────────────────────┐
│               Firestore Studio AI Scratchpad Architecture              │
│                                                                        │
│   Remote Cloud Firestore / Firebase Emulator                           │
│   Document: doc("dashboard/broker/session") [Size: 1 MB, 250k tokens]   │
│         │                                                              │
│         ├─► $(sparkle) Edit with AI (Open Scratchpad)                  │
│         │   Target: Field "config" [Size: 2 KB, 500 tokens]            │
│         │   (99.8% Context Token Reduction!)                           │
│         ▼                                                              │
│   Deterministic Local Workspace Path:                                  │
│   .firestore/conn_123/dashboard/broker/session/config.json             │
│         │                                                              │
│         ▼                                                              │
│   AI Assistant Edits File (Cursor, Copilot, Gemini, Claude)            │
│         │                                                              │
│         ▼ (Cmd+S / Auto-Save)                                          │
│   SnapshotSyncService: Atomic Live Sync                                │
│   firestore.doc(...).update(new FieldPath('config'), newPayload)       │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 1. Zero-Prompt Deterministic AI Scratchpad

Instead of prompting you to pick a folder or choose a destination filename for every snapshot, Firestore Studio deterministically maps your remote document structure into your workspace under `.firestore/`:

```
.firestore/
├── snapshots.json                        # Metadata registry tracking active origin bindings
└── <connectionId>/
    └── <collectionPath>/
        └── <docId>/
            ├── [fieldPath].json          # Targeted field scratchpad (isolated token context)
            └── _index.json               # Field manifest index (when unpacked)
```

### Deterministic Path Advantages
- **Zero Collision Risk**: Two documents named `settings` residing in different collections (e.g. `users/settings` vs `tenants/settings`) or across different database connections (e.g. `production` vs `staging`) never collide.
- **Zero Configuration**: No file dialogs, no directory path navigation, and no manual naming.
- **Automatic Git Safety**: When the first scratchpad is created, Firestore Studio automatically verifies or appends `.firestore/` to your workspace `.gitignore`, guaranteeing private credentials and production records are never committed to version control.

---

## 2. Field-Level Isolation (Token Optimization)

When working with large Firestore documents, extracting only the relevant field isolates your AI assistant's attention and slashes token usage by up to **99.8%**.

### Extracting a Single Field
1. In the **Explorer Tree View**, expand the target document to view its root fields.
2. Click the **$(sparkle)** icon next to the field name, or right-click the field $\rightarrow$ select **"Edit with AI (Open Scratchpad)"** (`ketrik-firestore-studio.openAiScratchpad`).
3. Firestore Studio extracts that field to `.firestore/<conn>/<path>/<field>.json` and opens it in an active editor tab.
4. Prompt your AI assistant directly on the tab (e.g. *"Format all timestamps to ISO-8601"* or *"Add validation schemas to these nested parameters"*).

### Atomic Server Updates
When you or your AI assistant saves a field scratchpad, Firestore Studio does **not** overwrite the whole document. Instead, it issues an atomic Firestore field update:

```typescript
// Atomic field mutation via FieldPath
await firestore
  .doc('dashboard/broker/session')
  .update(new FieldPath('metadata', 'sessionConfig'), payload);
```

Sibling fields, concurrent modifications by other users, and document metadata remain completely untouched.

---

## 3. Unpacking Monolithic Documents (`unpackDocumentFields`)

For documents containing dozens of complex nested objects and arrays, you can unpack the entire document into modular field files with one click:

1. Right-click any document in the tree view $\rightarrow$ select **"Unpack Document Fields for AI..."** (`ketrik-firestore-studio.unpackDocumentFields`).
2. Firestore Studio creates a dedicated folder `.firestore/<conn>/<collection>/<docId>/` and writes:
   - Each top-level field as an individual JSON file (`userProfile.json`, `preferences.json`, `auditLog.json`).
   - A master `_index.json` manifest listing all field names, data types, and byte sizes.
3. You can edit any individual field file independently, or allow AI agents to navigate the structured folder hierarchy.

---

## 4. Dual-Mode Architecture: Pure Virtual vs. Workspace Mode

Firestore Studio supports two distinct operational modes governed by the `ketrik-firestore-studio.openMode` configuration setting:

| Mode | Configuration | Disk Footprint | Caching & Lifetime | Best Used For |
| :--- | :--- | :--- | :--- | :--- |
| **Pure Virtual** *(Default)* | `"ketrik-firestore-studio.openMode": "virtual"` | **0 bytes** on disk | In-memory RAM buffer; expires after `cacheTTLSeconds` (default: 30s). Saving writes straight to Firestore. | Daily inspection, production databases, secure workstations where saving customer data to local disk is prohibited. |
| **Workspace Mode** | `"ketrik-firestore-studio.openMode": "workspace"` | Tracked in `.firestore/` | Persisted locally in workspace; auto-syncs on save. | Fast AI workflows, multi-file refactoring, batch prompting with Cursor, Copilot, or Gemini. |

> **Seamless Promotion**: Even when operating in **Pure Virtual** mode, you can promote any document or field into an AI scratchpad on demand simply by clicking the **$(sparkle)** toolbar icon.

### Automatic Virtual Document Mirroring (Optional)
If you prefer operating in virtual mode but want background AI agent awareness without clicking **$(sparkle)**, enable:
```json
{
  "ketrik-firestore-studio.autoMirrorVirtualDocuments": true
}
```
When enabled, opening any virtual document tab automatically mirrors the file to `.firestore/` in the background so local AI file search tools can immediately discover it.

---

## 5. Live Two-Way Sync (`autoSyncLocalSnapshots`)

By default, `ketrik-firestore-studio.autoSyncLocalSnapshots` is set to `true`.

- **On Save (`Cmd+S` / `Ctrl+S`)**: Whenever you or an AI agent modifies and saves a tracked snapshot file, Firestore Studio immediately serializes the changes and pushes them back to the remote Cloud Firestore database, Firebase Emulator, or Local JSON store.
- **Silent Background Execution**: A subtle status bar animation displays `$(sync~spin) Pushing...` and confirms with `$(check) Synced` without interrupting your editing flow.
- **Conflict Prevention**: If `checkRemoteChangesOnSave` is enabled, Firestore Studio verifies the remote document's `updateTime` before pushing to avoid overwriting remote updates.

---

## 6. Manual Snapshot Governance: Diff, Push & Pull

Whenever you need explicit control over how local edits reconcile with the remote database, use the snapshot actions available in the editor title bar and status bar:

```
┌────────────────────────────────────────────────────────────────────────┐
│  Editor Toolbar Actions:                                               │
│  [$(diff) Diff]   [$(cloud-upload) Push]   [$(cloud-download) Pull]    │
└────────────────────────────────────────────────────────────────────────┘
```

### Side-by-Side Graphical Diff (`diffSnapshotWithFirestore`)
Click the **$(diff)** icon in the editor toolbar to open VS Code's native side-by-side diff editor. The left panel shows the live remote document on Firestore; the right panel shows your local workspace snapshot.

### Push with Strategy Selection (`pushSnapshotToFirestore`)
Click **$(cloud-upload)** to push local changes to Firestore:
- **Merge / Patch**: Updates only modified keys, leaving omitted remote properties intact.
- **Overwrite**: Atomically replaces the remote document payload with your local JSON structure.

### Pull Latest from Firestore (`pullSnapshotFromFirestore`)
Click **$(cloud-download)** to refresh your local snapshot with the latest remote data. If you have unpushed local changes, Firestore Studio alerts you and prompts to confirm before overwriting.

---

## 7. 1-Click Privacy Cleanup (`cleanScratchpads`)

When you finish an AI editing session, you can remove all local snapshot files and origin bindings with a single command:

1. Open the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`).
2. Run **"Firestore: Clean All AI Scratchpads (.firestore)..."** (`ketrik-firestore-studio.cleanScratchpads`).
3. You can also trigger this command from the Status Bar snapshot menu.
4. All files within `.firestore/` are purged immediately, leaving zero local footprint.

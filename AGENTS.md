# Ketrik Firestore Studio — Agent Guidelines & Architecture

This repository contains **Ketrik Firestore Studio**, an enterprise-grade Visual Studio Code extension for exploring, querying, and mutating Google Cloud Firestore and Firebase databases.

## 1. Core Architecture

- **Runtime & Compilation**: TypeScript targeting VS Code Extension API (`^1.85.0`). Bundled using `webpack` / `tsc`.
- **Explorer Tree Provider** (`src/explorer/ExplorerDataProvider.ts`):
  - Renders Connections $\rightarrow$ Root Collections $\rightarrow$ Documents $\rightarrow$ Fields / Subcollections.
  - Maintains `expandedStateCache` and granular `refreshNode(item)` for targeted branch refreshes without jarring full-tree redraws.
- **Virtual File System** (`src/editor/DocumentFileSystemProvider.ts`):
  - Uses the custom URI scheme `ketrik-firestore-studio://<connectionId>/<docPath>.json`.
  - Serves Firestore documents as virtual JSON buffers.
  - Supports smart in-memory snapshot caching governed by `ketrik-firestore-studio.cacheTTLSeconds`.
  - When saving, converts edits into partial atomic updates or full set depending on config.
  - `invalidateAndNotify(connectionId, docPath)` must be called after field mutations (renames, deletions) to emit `FileChangeType.Changed` so open editor tabs live-reload.
- **Webview Tables**:
  - `src/webview/openCollectionAsTable.ts`: Collection-level tabular grid with pagination, sort, search, single-read Doc ID lookup, and multi-clause Firestore server-side `where` query builder (`==`, `!=`, `<`, `<=`, `>`, `>=`, `array-contains`, `in`, `array-contains-any`).
  - `src/webview/openFieldAsTable.ts`: Dual-contract substrate viewer for in-document Maps (`Record<string, T>`) and Arrays (`T[]`).

## 2. Key Coding Standards & Patterns

### Atomic Operations
- When renaming or deleting fields in a document, use atomic Firestore operations (`FieldValue.delete()`, targeted field sets) rather than downloading, modifying locally, and blindly replacing the entire document.
- Always check for target key collision before renaming a field.

### Quota & Memory Safety
- Firestore charges per document read. Never perform unbounded collection scans or deep recursive crawls without explicit paging limits or user consent.
- Always respect `ketrik-firestore-studio.pagingLimit` and `ketrik-firestore-studio.maxTableRows`.
- Use the single-read document lookup feature whenever checking for a known document ID instead of querying the collection.

### Type Conversions
- When editing scalar fields or adding fields, use the interactive type pickers in `src/commands/fieldCommands.ts` (String, Number, Boolean, Timestamp, GeoPoint, Map, Array, Null).
- When a field is currently `null`, allow the user to select the new concrete type when setting a value.

### Releases & Version Bumps
- Release script is located at `./scripts/release.sh`.
- The script interactively prompts for the version bump (Minor, Patch, Major, or Custom), verifies git working directory status, runs test/build, updates `package.json`, stamps `CHANGELOG.md`, creates a git tag, and commits.

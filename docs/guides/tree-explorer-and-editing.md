---
title: Tree Explorer & Document Editing
description: Navigating collections, editing documents, managing root fields, AI scratchpads, and granular cache controls.
sidebar_position: 1
---

# Tree Explorer & Document Editing

The **Ketrik Firestore Studio** Tree View provides hierarchical browsing of your entire database architecture.

```
📁 users                           [Collection: amber folder]
  ├── 📄 user_101                  [Document: vibrant blue file-code]
  │    ├── 📁 orders               [Subcollection]
  │    │    └── 📄 order_9001
  │    ├── 🏷️ address              {4 keys}  (Map)
  │    ├── 🏷️ roles                [3]       (Array)
  │    ├── 🏷️ email                "alice@example.com" (String)
  │    └── 🏷️ isActive             true      (Boolean)
```

---

## 1. Document Editing Workflows

### Dual Document Modes (`openMode`)
When you click on a document, Firestore Studio opens it according to your `ketrik-firestore-studio.openMode` configuration:
- **Pure Virtual Mode (`"virtual"`, default)**: Serves the document as an in-memory virtual buffer (`ketrik-firestore-studio://...`) with **zero files written to your disk**. Caching is RAM-only governed by `cacheTTLSeconds` (30s). Saving writes directly to Firestore.
- **Workspace Mode (`"workspace"`)**: Directly opens or creates a deterministic workspace snapshot file under `.firestore/<connectionId>/<collectionPath>/<docId>.json`. This gives 0-click file discovery to local AI assistants (Cursor, Copilot, Gemini).

### AI Scratchpad & Token Isolation (`$(sparkle)`)
Even when operating in Pure Virtual mode, you can instantly promote any document or root field into an isolated AI scratchpad:
- Click the **$(sparkle)** icon next to the document or field, or right-click $\rightarrow$ **"Edit with AI (Open Scratchpad)"**.
- Creates a dedicated file in `.firestore/` and opens it in an editor tab.
- Saving automatically pushes changes back to Cloud Firestore with atomic precision (via `FieldPath` for field scratchpads).

### Unpacking Monolithic Documents (`unpackDocumentFields`)
For documents with dozens of fields, right-click the document $\rightarrow$ select **"Unpack Document Fields for AI..."**. Firestore Studio unpacks every field into individual modular JSON files inside `.firestore/<conn>/<path>/<docId>/` alongside an `_index.json` manifest, slashing AI context token consumption by up to **99.8%**.

### Virtual Subdocuments (Root Field Editing)
When dealing with large Firestore documents ($>100\text{ KB}$), opening the entire document is slow and creates clutter.
- Expanding a document reveals all its root variables/fields with semantic type chips.
- Right-click an Object or Array field $\rightarrow$ **Open in JSON Editor**.
- A virtual file opens (e.g. `/users/user_101/address.json`).
- **Atomic Partial Update**: Saving this virtual tab calls:
  ```typescript
  firestore.doc('users/user_101').update({ address: jsonPayload });
  ```
  Only the targeted field is mutated on the server, completely eliminating dirty overwrite risks for sibling fields.

---

## 2. Smart Modal Editing for Primitives

You do not need to open editor tabs to edit primitive values:
- **Booleans (`true` / `false`)**: Click directly on a boolean field in the tree to trigger an instant QuickPick:
  ```
  Select: [ true ] / [ false ]
  ```
- **Numbers**: Click a numeric field to open an inline modal with number validation.
- **Strings**: Click a string field to open an inline text editor.
- **Vectors (`FieldValue.vector`)**: Click a vector field to open an inline modal showing its dimension count and allowing you to edit coordinates directly (as a JSON array or comma-separated numbers).
- **Null Fields**: Clicking a `null` field presents a type selector allowing you to convert the field to an `Object ({})`, `Array ([])`, `String`, `Number`, `Boolean`, or open a raw JSON editor.

---

## 3. Field & Document Context Actions

Right-click any document or field item to access operations:

| Action | Applies To | Description |
|---|---|---|
| **Edit with AI (Open Scratchpad)** | Documents & Fields | Extracts item into a deterministic `.firestore/` scratchpad with automatic live sync and git safety. |
| **Unpack Document Fields for AI...** | Documents | Splits monolithic document into individual field files with `_index.json` manifest to optimize LLM tokens. |
| **Rename Field...** | Root Fields | Atomically transfers value to new field name and deletes old key using `FieldValue.delete()`. Overwrite protection included. |
| **Add Field...** | Documents & Fields | Create a new root field with type assistance (`Object`, `Array`, `Vector`, `Timestamp`, `String`, `Number`, `Boolean`, or custom `JSON`). |
| **Add Nested Property...** | Map Fields | Adds a new nested key into an existing Map object. |
| **Delete Field** | Root Fields | Permanently removes a key from the document using `FieldValue.delete()`. |
| **Delete Multiple Fields...** | Documents | Multi-select dialog to delete several fields in a single batch write. |
| **Duplicate Field...** | Root Fields | Duplicates an existing field under a new key. |
| **Duplicate Document...** | Documents | Clone document within collection with an instant ID prompt. |
| **Copy Document** | Documents | Copy document to internal clipboard for cross-collection/connection paste. |
| **Paste Document** | Collections & Docs | Paste copied document into any target collection or connection. |
| **Copy as JSON** | Documents & Fields | Export formatted JSON directly to OS clipboard without opening an editor tab. |
| **Deep Delete** | Documents | Detects nested subcollections and prompts for **Deep Delete (Doc + Subcollections)** or **Delete Document Only**. |
| **Explode Field to Collection...** | Map / Array Fields | Migrates an in-document Map or Array into a standalone subcollection. |
| **Consolidate Collection to Field...** | Collections | Flattens a subcollection into a single parent document Map or Array field. |
| **Refresh** | Documents & Fields | Granularly refreshes only that document and its fields from Firestore, preserving collection scroll position and pagination. |

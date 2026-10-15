---
title: Composite Indexes Management
description: Inspecting, diagnosing, and managing Cloud Firestore and Emulator composite indexes directly in VS Code.
sidebar_position: 5
---

# Composite Indexes Management

**Ketrik Firestore Studio** provides first-class composite index governance, enabling you to inspect deployed indexes, diagnose query index requirements, examine raw index definitions, and delete obsolete indexes without having to switch to the Google Cloud or Firebase web consoles.

```
▾ 🗂️ Production (default)
  ▸ 🛡️ Authentication (Users & Claims)
  ▾ 🗂️ Composite Indexes                      [list-tree icon]
      ✓ users (status ASC, createdAt DESC)   • 📁 Collection • READY
      ✓ posts (tags ⋲ [CONTAINS], date DESC) • 🌐 Group • READY
      ✓ knowledge_chunks (__name__ ASC, embedding) • 📁 Collection • READY
  ▸ 📁 users
  ▸ 📁 orders
```

---

## 1. Features & Capabilities

- **Dedicated Explorer Branch**: Each configured connection features a top-level **"Composite Indexes"** branch alongside collections and authentication.
- **Query Scope Awareness**: Clearly differentiates between:
  - `📁 Collection`: Single collection-scoped composite indexes.
  - `🌐 Group`: Database-wide collection group composite indexes (used by `collectionGroup()` queries).
- **Multi-Type Field Support**:
  - Multi-field sorting orders (`ASC` / `DESC`).
  - Multikey array queries (`⋲ [CONTAINS]`).
  - Vector search index embeddings (e.g. `__name__ ASC, embedding`).
- **Live Status Badges**:
  - `READY` (`check` icon): Fully built and serving production queries.
  - `⏳ Building` (`sync~spin` icon): Currently compiling on Google Cloud.
  - `⚠️ Needs Repair` (`warning` icon): Index build encountered an issue or requires attention.
- **REST API Integration**: Communicates directly with Cloud Firestore Admin v1 API (`collectionGroups/-/indexes`) using your connection's credentials or routes to local emulators (`localhost:8080`).

---

## 2. Inspecting Index Definitions

Click on any composite index in the tree (or right-click $\rightarrow$ **"Inspect Composite Index Definition"**) to open the index specification as a formatted, read-only JSON document:

```json
{
  "name": "projects/my-project/databases/(default)/collectionGroups/knowledge_chunks/indexes/CICAgJiUpoMK",
  "queryScope": "COLLECTION",
  "fields": [
    {
      "fieldPath": "__name__",
      "order": "ASCENDING"
    },
    {
      "fieldPath": "embedding"
    }
  ],
  "state": "READY",
  "collectionGroup": "knowledge_chunks",
  "indexId": "CICAgJiUpoMK"
}
```

This lets you quickly inspect exact field paths, orders, and Google Cloud resource identifiers for use in your infrastructure-as-code or deployment configuration.

---

## 3. Deleting Composite Indexes

To eliminate unused or redundant indexes:

1. Hover over the index item in the tree and click the **Delete** icon (`$(trash)`), or right-click the item $\rightarrow$ select **"Delete Composite Index"**.
2. A modal confirmation dialog will display:
   > *"Are you sure you want to delete composite index for 'collection' [field1 (ASC), ...]? This action cannot be undone."*
3. Confirming sends a `DELETE` request via the Cloud Firestore REST API and immediately updates your tree view without requiring a full connection refresh.

---

## 4. Refreshing Composite Indexes

To reload indexes after creating one in the cloud or through the Firebase CLI:
- Click the inline **Refresh** icon (`$(refresh)`) on the **Composite Indexes** branch header.
- Granular invalidation ensures only the indexes branch reloads without disrupting open documents or collection tables.

---

## 5. Two-Way Sync with `firestore.indexes.json`

Ketrik Firestore Studio integrates directly with your repository's local `firestore.indexes.json` configuration file:

### Pull / Snapshot Live Cloud Indexes
Right-click the **Composite Indexes** node $\rightarrow$ click **"Snapshot Live Indexes to Workspace (firestore.indexes.json)..."**:
- **Merge**: Intelligently appends new deployed indexes from the cloud while preserving existing single-field overrides and local indexes.
- **Overwrite**: Replaces local workspace index definitions with the exact live cloud snapshot.

### Side-by-Side Graphical Diff
Right-click the **Composite Indexes** node $\rightarrow$ click **"Diff Indexes (Live Cloud ⇄ Local Workspace)"**:
- Launches VS Code's native side-by-side diff editor comparing live deployed cloud indexes against your local `firestore.indexes.json` file.
- Inspect differences, additions, or omissions before pushing changes to production.

### Deploy to Cloud Firestore
Right-click the **Composite Indexes** node $\rightarrow$ click **"Deploy firestore.indexes.json to Cloud Firestore..."**:
- Reads local indexes from your workspace file, identifies which indexes do not yet exist in the target database, and calls the Google Cloud Firestore Admin REST API to trigger asynchronous index builds.

---

## 6. Interactive Visual Index Builder GUI

Construct complex composite indexes without manually writing JSON schemas:

1. Click the **`+`** icon on the **Composite Indexes** branch or run **"Create Composite Index..."** from the Command Palette.
2. Follow the interactive multi-step prompt:
   - **Step 1 (Collection Group)**: Enter the target collection name (e.g. `orders`, `posts`).
   - **Step 2 (Query Scope)**: Select `COLLECTION` (default) or `COLLECTION_GROUP`.
   - **Step 3 (Field Specifications)**: Specify each field path and indexing mode (`ASCENDING`, `DESCENDING`, or `ARRAY_CONTAINS`).
   - **Step 4 (Save Destination)**: Choose whether to deploy immediately to Cloud Firestore, append to your workspace `firestore.indexes.json`, or perform both actions simultaneously.

---

## 7. Missing Index Error Catcher & Auto-Fixer

When querying collections or collection groups in the **Interactive Collection Table** with multi-field filters or orderings that lack a composite index, Firestore returns a `FAILED_PRECONDITION` error.

Ketrik Firestore Studio intercepts this error and provides a 1-click notification:
- **Build / Add to firestore.indexes.json**: Opens the Visual Index Builder pre-seeded with the required collection and filter parameters to append to your workspace file or trigger an immediate build.
- **Create Index in Firebase Console**: Directly opens the Firebase Console index builder URL.
- **Copy Index URL**: Copies the direct console URL to your clipboard.


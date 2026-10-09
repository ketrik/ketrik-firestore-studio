---
title: Collection Table & Server Query Builder
description: Tabular collection visualization, server-side multi-clause where query builder, and 1-read document lookup.
sidebar_position: 4
---

# Collection Table & Server Query Builder

Clicking the table icon on any collection or running **"Open Collection as Table"** launches a dedicated, high-performance webview grid view.

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│ 📁 users [Production]   [🔍 Query Filter] [Search...] [Lookup Doc ID...] [⬇ Export JSON] │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│ ▼ Server-Side Firestore Query Builder                                                   │
│   status           == (Equals)            active                                [✕]     │
│   createdAt        >= (Greater or equal)  1700000000                            [✕]     │
│   [+ Add Clause]   [Run Query]   [Reset]                                                │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│ Document ID       │ email               │ status    │ role       │ createdAt            │
├───────────────────┼─────────────────────┼───────────┼────────────┼──────────────────────┤
│ usr_9210          │ user@domain.com     │ active    │ admin      │ 🕒 2026-10-08 14:22  │
│ usr_9211          │ dev@domain.com      │ active    │ member     │ 🕒 2026-10-09 09:15  │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. Server-Side Query Builder

Rather than downloading large collections into client memory, Firestore Studio's **Query Builder** executes multi-clause queries directly on the Firestore server:

### Supported Filter Operators
- **Equality & Comparison**: `==`, `!=`, `<`, `<=`, `>`, `>=`
- **Array Containment**: `array-contains`, `array-contains-any`
- **Membership**: `in`, `not-in`

### Automatic Value Casting
The query runner intelligently parses filter values before sending them to the Firebase Admin SDK:
- `true` / `false` $\rightarrow$ Native Boolean
- `42` / `99.5` $\rightarrow$ Native Number
- `null` $\rightarrow$ JavaScript `null`
- `["admin", "owner"]` $\rightarrow$ Native parsed Array (for `in` and `array-contains-any` queries)
- Text strings $\rightarrow$ Native String

### Server Paging with Queries
When a server query is active, clicking **Load More Documents** seamlessly uses `query.startAfter(lastDoc)` to fetch the next batch of matching records without losing filter state.

---

## 2. Direct 1-Read Document Lookup

When you know a specific Document ID in a collection containing thousands of documents, scanning or paginating through pages is wasteful:
- Enter the Document ID into the **Lookup Doc ID...** toolbar input.
- Click **Lookup** (or press Enter).
- Executes a direct `collection.doc(id).get()` with exactly **1 read operation**.
- Displays the document immediately in the table grid.

---

## 3. In-Memory Search & JSON Export

- **Instant Search**: The search input provides instant keyword filtering across all loaded documents and fields.
- **Export as JSON**: Click **Export JSON** to save the currently visible table rows to a structured JSON file.
- **Row Click Navigation**: Clicking any table row immediately opens the full document in a VS Code editor tab for instant editing.

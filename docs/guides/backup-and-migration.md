---
title: Backup, Export & Migration
description: Data extraction, backup strategies, multi-collection replication, and migration patterns between collections and document substrates.
sidebar_position: 5
---

# Backup, Export & Migration

Ketrik Firestore Studio provides comprehensive client-side data export tools, cross-instance replication wizards, and architectural workflows for backing up, migrating, and seeding your Firestore datasets.

---

## 1. Batch Multi-Collection Replication & Deletion

Managing multiple collections across environments (e.g. replicating production seed datasets into staging or local Firebase Emulators) is streamlined with multi-collection batch tools.

### Batch Copy Multiple Collections (`copyMultipleCollections`)
1. Right-click any connection node in the Explorer tree $\rightarrow$ select **"Copy Multiple Collections to Instance..."** (or run `ketrik-firestore-studio.copyMultipleCollections`).
2. A multi-select QuickPick displays all root collections with document counts.
3. Check the collections you want to replicate and click **OK**.
4. Select the target destination connection (e.g. `Local Emulator`).
5. Choose your collision strategy:
   - **Merge / Patch**: Updates matching documents without overwriting omitted fields.
   - **Overwrite**: Atomically replaces target documents with the copied payload.
6. Firestore Studio executes chunked batch writes (`WriteBatch`, 400 documents/batch) with a live progress indicator and cancellation controls.

### Batch Delete Multiple Collections (`deleteMultipleCollections`)
1. Right-click any connection node $\rightarrow$ select **"Delete Multiple Collections..."** (or run `ketrik-firestore-studio.deleteMultipleCollections`).
2. Select the collections to delete from the multi-select QuickPick.
3. A modal confirmation warns with the collection names and document totals.
4. Confirming purges the selected collections in safety-chunked batch operations.

---

## 2. Interactive Data Export & Import

### Collection Table Export (CSV, JSON, NDJSON)
When viewing any collection or filtered query in the **Collection Table Webview**:
1. Click **Export CSV** in the header toolbar to download loaded documents as comma-separated values. Nested map objects and arrays are safely serialized as JSON strings.
2. Click **Export JSON** to download a formatted array of documents, ideal for seeding development environments or analyzing in external tools.
3. Use command `ketrik-firestore-studio.exportCollection` to export entire collections to CSV, JSON, or NDJSON (Newline Delimited JSON).

### Bulk Data Import (`importCollection`)
To seed collections from existing datasets:
- Run **"Firestore: Import Data (CSV, JSON, NDJSON)..."** (`ketrik-firestore-studio.importCollection`).
- Choose your input file and configure field type mappings.
- Data is validated and ingested using chunked batch writes.

---

## 3. Local JSON Offline Store & Seed

For offline development, unit tests, and mock backends:
- **Snapshot Collection to Local JSON**: Right-click any collection $\rightarrow$ **"Snapshot Collection to Local JSON Store..."** (`ketrik-firestore-studio.snapshotFirestoreToLocalJson`). Writes a clean, serialized JSON array to your local workspace.
- **Push / Seed to Firestore**: Right-click a snapshot file or collection $\rightarrow$ **"Push / Seed to Firestore (Cloud or Emulator)..."** (`ketrik-firestore-studio.pushLocalCollectionToFirestore`). Batches the local documents directly into your target connection.

---

## 4. Substrate Migration: Explode & Consolidate

When refactoring document architectures between **discrete subcollections** and **in-document aggregated maps/arrays**:

### Explode Field to Collection (`explodeField`)
Transforms an in-document Map (`Record<string, T>`) or Array (`T[]`) into a standalone Firestore subcollection:
- Each key/index becomes an individual document ID.
- Automatically handles deep batch creation without locking the parent document.

### Consolidate Collection to Field (`consolidateCollection`)
Flattens all documents in a subcollection into a single aggregated Map or Array field in the parent document:
- Minimizes future read query costs ($O(N) \rightarrow O(1)$).
- Optionally prompts to clean up the source subcollection documents after consolidation.

---

## 5. Managed Cloud Backups vs. Client-Side Tools

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Backup Strategy Comparison                      │
├───────────────────────────────────┬────────────────────────────────────┤
│   Client-Side Extension Export    │   Managed Cloud Firestore Export   │
├───────────────────────────────────┼────────────────────────────────────┤
│ • Best for dev/test data & seeds  │ • Best for production DR & cold    │
│ • Exports readable JSON / CSV     │   storage archiving                │
│ • Runs within local VS Code env   │ • Zero impact on local network     │
│ • Recursively traverses sub-      │ • Preserves internal metadata and  │
│   collections via Batched Reads   │   indexes to Google Cloud Storage  │
└───────────────────────────────────┴────────────────────────────────────┘
```

### Production Recommendation (GCP Managed Exports)
For production databases with millions of documents, use Google Cloud's native scheduled export command:

```bash
gcloud firestore export gs://my-backup-bucket/firestore-backups-$(date +%Y%m%d)
```

This exports data server-side directly to Cloud Storage buckets without incurring local network latency or saturating client bandwidth.

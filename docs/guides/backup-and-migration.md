---
title: Backup, Export & Migration
description: Data extraction, backup strategies, and migration patterns between collections and document substrates.
sidebar_position: 4
---

# Backup, Export & Migration

Ketrik Firestore Studio provides lightweight client-side data export tools and architectural workflows for backing up and migrating your Firestore datasets.

---

## Interactive Data Export

### 1. Collection Table Export
When viewing any collection or filtered query in the **Collection Table Webview**:
1. Click the **Export CSV** button in the header toolbar to download all currently loaded documents as a comma-separated values file. Nested map objects and arrays are safely serialized as JSON strings.
2. Click the **Export JSON** button to download a formatted array of documents, ideal for seeding development environments or analyzing in external tools.

### 2. In-Document Map & Array Substrate Export
When inspecting large in-document registry maps (`Record<string, T>`) or arrays (`T[]`) via **View as Table**:
- Use the table toolbar to copy or export the structured fields to JSON.
- This allows rapid data auditing without writing one-off scripts.

---

## Recursive Subcollection Backup vs. Managed Cloud Backups

When planning full backups of Firestore databases, it is essential to distinguish between **client-side tree crawling** and **managed cloud infrastructure**:

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

### Local & Subcollection Seeds (Roadmap Feature)
For developer seeding, testing, and isolated staging environments, Ketrik Firestore Studio is introducing native **Recursive Tree Export**:
- Recursively traverses root documents and all subcollections (`doc.listCollections()`).
- Bundles documents and their subcollection trees into a single structured archive file (`.firestore.json`).
- Supports one-click **Restore / Seed** into local Firebase Emulators or target staging databases with batch writes.

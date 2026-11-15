---
title: Time-Travel Explorer & PITR Management
description: Inspect historical Firestore snapshots at any microsecond in the past 7 days, compare with live state, restore deleted documents, and manage PITR & Delete Protection.
sidebar_position: 9
---

# Time-Travel Explorer & PITR Management

Ketrik Firestore Studio includes a full **Time-Travel Explorer** (`readTime`) and **Database Configuration & PITR Management** suite, allowing you to inspect past database states, diff historical snapshots against live documents, recover deleted documents, and configure Point-in-Time Recovery (PITR) and Delete Protection directly from VS Code.

---

## Database Configuration & PITR Management

Open the interactive configuration inspector from any Connection context menu (**Database Configuration & PITR Settings...**) or from table toolbars (`ketrik-firestore-studio.openDatabaseConfiguration`).

### Capabilities
- **1-Click PITR Toggle**: Inspect PITR activation state, 7-day retention period, earliest recoverable timestamp (`earliestVersionTime`), and enable or disable PITR with live safety confirmation.
- **Delete Protection Safeguard**: 1-click toggle (`DELETE_PROTECTION_ENABLED` / `DELETE_PROTECTION_DISABLED`) to shield production Firestore databases against accidental deletion.
- **Concurrency Mode Control**: Switch seamlessly between **Optimistic** and **Pessimistic** locking concurrency control.
- **Infrastructure Metadata**: Inspect GCP Region (`locationId`), Database Type (`FIRESTORE_NATIVE` vs `DATASTORE_MODE`), UID, CMEK KMS Key references, and creation/update timestamps.
- **Local JSON & Emulator Introspection**: Inspect mock database file paths, disk sizes, active document counts, in-memory cache health, and emulator ports (Firestore, Auth, Storage).

---

## Time-Travel Explorer (`readTime`)

Launch Time-Travel from any Connection, Collection, or Document context menu (**Time-Travel Explorer...** / `ketrik-firestore-studio.openTimeTravel`).

### Features
- **Quick Presets & Custom Timestamp**: Jump to *15 min ago*, *1 hr ago*, *6 hrs ago*, *24 hrs ago*, *3 days ago*, *7 days ago*, or enter a custom timestamp with microsecond precision.
- **Read-Only Safety Guard**: A gold/amber historical status banner prevents unintended mutations while browsing past snapshots.
- **Side-by-Side Historical Diff (`ketrik-firestore-studio.compareDocumentWithLive`)**: 1-click native side-by-side diff comparing the historical document snapshot at `readTime` against the current live database state, with color-coded additions, modifications, and deletions.
- **1-Click Document Restore & Rollback (`ketrik-firestore-studio.restoreDocumentFromHistory`)**:
  - Atomically revert live documents back to any historical snapshot.
  - **Recover Deleted Documents**: Automatically detects documents that were deleted in live state when browsing historical snapshots, with a 1-click **Restore Deleted Document** action.

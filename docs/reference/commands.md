---
title: Commands Reference
description: Complete listing of all commands and keyboard shortcuts provided by Ketrik Firestore Studio.
sidebar_position: 2
---

# Commands Reference

All commands can be executed via the VS Code Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`) or directly through tree view actions and context menus.

---

## Connection Management

| Command ID | Title | Context / Location | Description |
| :--- | :--- | :--- | :--- |
| `ketrik-firestore-studio.addConnection` | **Firestore: Add Connection** | Explorer Title Bar / Palette | Add a new Firestore connection via Service Account JSON, Application Default Credentials (ADC), or local Emulator host:port. |
| `ketrik-firestore-studio.editConnection` | **Firestore: Edit Connection** | Connection Context Menu | Update connection label, credentials file path, or emulator endpoints. |
| `ketrik-firestore-studio.deleteConnection` | **Firestore: Delete Connection** | Connection Context Menu | Remove an existing connection profile from VS Code settings. |
| `ketrik-firestore-studio.refreshExplorer` | **Firestore: Refresh Explorer** | Explorer Title Bar | Clears connection cache and re-enumerates all root collections across active databases. |

---

## Collections & Query Views

| Command ID | Title | Context / Location | Description |
| :--- | :--- | :--- | :--- |
| `ketrik-firestore-studio.openCollectionAsTable` | **Firestore: Open Collection as Table** | Collection Context Menu / Inline Icon | Launches the interactive collection table webview with sorting, search, single-read doc ID lookup, and server-side where query builder. |
| `ketrik-firestore-studio.queryCollectionGroup` | **Firestore: Query Collection Group...** | Connection / Collection Menu / Palette | Flattens all subcollections with the given ID database-wide into a unified collection group table view with origin parent document links. |
| `ketrik-firestore-studio.createDocument` | **Firestore: Create Document** | Collection Context Menu / Inline Icon | Creates a new document within the selected collection. Prompts for auto-generated ID or manual ID and opens in a virtual `.json` editor. |
| `ketrik-firestore-studio.generateSyntheticData` | **Firestore: Generate Synthetic Mock Data...** | Collection Context Menu / Palette | Ingests 1 to 5,000 realistic mock documents using domain-aware schema inference and chunked batch writes. |
| `ketrik-firestore-studio.deleteCollection` | **Firestore: Delete Collection** | Collection Context Menu | Batch deletes all documents within the collection (prompts for confirmation). |

---

## Firebase Emulator Suite

| Command ID | Title | Context / Location | Description |
| :--- | :--- | :--- | :--- |
| `ketrik-firestore-studio.emulatorStatusMenu` | **Firestore: Firebase Emulator Status & Actions...** | Status Bar / Title Bar / Palette | Opens interactive status dashboard showing emulator port states, UI links, and fast actions. |
| `ketrik-firestore-studio.startEmulator` | **Firestore: Start Local Firebase Emulator** | Palette / Status Menu | Launches the local emulator in an integrated VS Code terminal using workspace `firebase.json` configuration. |
| `ketrik-firestore-studio.stopEmulator` | **Firestore: Stop Local Firebase Emulator** | Palette / Status Menu | Safely terminates running emulator processes in the terminal. |
| `ketrik-firestore-studio.restartEmulator` | **Firestore: Restart Local Firebase Emulator** | Palette / Status Menu | Restarts the local emulator process cycle. |
| `ketrik-firestore-studio.openEmulatorUi` | **Firestore: Open Firebase Emulator UI** | Palette / Status Menu | Launches the Firebase Emulator UI web dashboard (`http://localhost:4000`) in the default browser. |
| `ketrik-firestore-studio.discoverEmulators` | **Firestore: Discover & Connect Local Emulator** | Palette / Status Menu | Probes active ports and connects to running Firestore and Auth emulators without needing credentials. |

---

## Document Operations

| Command ID | Title | Context / Location | Description |
| :--- | :--- | :--- | :--- |
| `ketrik-firestore-studio.openDocument` | **Firestore: Open Document** | Document Node Click | Opens the document in a virtual `.json` editor tab (`firestore://...`) for inline editing and saving. |
| `ketrik-firestore-studio.copyDocumentId` | **Firestore: Copy Document ID** | Document Context Menu | Copies the document ID to the system clipboard. |
| `ketrik-firestore-studio.copyPath` | **Firestore: Copy Document Path** | Document Context Menu | Copies the full path (e.g. `users/usr_123/logs/log_99`) to the system clipboard. |
| `ketrik-firestore-studio.deleteDocument` | **Firestore: Delete Document** | Document Context Menu / Inline Icon | Permanently deletes the document from Firestore. |
| `ketrik-firestore-studio.addSubcollection` | **Firestore: Add Subcollection** | Document Context Menu | Creates a new subcollection under the selected document. |
| `ketrik-firestore-studio.refreshItem` | **Firestore: Refresh Item** | Context Menu | Granularly invalidates cached state for the selected document or collection node without resetting the entire tree. |

---

## Field-Level Operations

| Command ID | Title | Context / Location | Description |
| :--- | :--- | :--- | :--- |
| `ketrik-firestore-studio.openFieldAsTable` | **Firestore: View as Table** | Map & Array Field Context Menu / Inline Icon | Opens an in-document map (`Record<string, T>`) or sequence list (`T[]`) as an interactive tabular grid. |
| `ketrik-firestore-studio.renameField` | **Firestore: Rename Field** | Field Context Menu | Atomically renames a document field using Firestore field delete + set, validating destination collisions and refreshing open editor tabs. |
| `ketrik-firestore-studio.openField` | **Firestore: Edit Value / Open Field** | Field Double-Click / Context Menu | Quick-edit a scalar field value with type-preserving input. |
| `ketrik-firestore-studio.addField` | **Firestore: Add Field** | Document / Map Context Menu | Adds a new field with type selection (String, Number, Boolean, Timestamp, GeoPoint, Map, Array, Null). |
| `ketrik-firestore-studio.deleteField` | **Firestore: Delete Field** | Field Context Menu | Atomically removes a field from the document via `FieldValue.delete()`. |
| `ketrik-firestore-studio.copyFieldValue` | **Firestore: Copy Field Value** | Field Context Menu | Copies the serialized value of the field to the clipboard. |

---

## Composite Indexes Management

| Command ID | Title | Context / Location | Description |
| :--- | :--- | :--- | :--- |
| `ketrik-firestore-studio.refreshIndexes` | **Firestore: Refresh Composite Indexes** | Composite Indexes Branch Context / Inline Icon | Granularly re-queries the Cloud Firestore Admin API to refresh index states and definitions. |
| `ketrik-firestore-studio.inspectIndexDefinition` | **Firestore: Inspect Composite Index Definition** | Composite Index Click / Context Menu | Opens the complete index JSON structure in a virtual preview editor tab. |
| `ketrik-firestore-studio.deleteIndex` | **Firestore: Delete Composite Index** | Composite Index Context Menu / Inline Trash Icon | Safely deletes an index via Cloud Firestore REST API with modal confirmation. |
| `ketrik-firestore-studio.snapshotLiveIndexes` | **Firestore: Snapshot Live Indexes to Workspace...** | Composite Indexes Branch Menu | Pull deployed cloud indexes into workspace `firestore.indexes.json` (Merge / Overwrite). |
| `ketrik-firestore-studio.diffIndexes` | **Firestore: Diff Indexes (Live Cloud ⇄ Local Workspace)** | Composite Indexes Branch Menu | Graphical side-by-side diff between deployed cloud indexes and local file. |
| `ketrik-firestore-studio.deployIndexes` | **Firestore: Deploy firestore.indexes.json to Cloud...** | Composite Indexes Branch Menu | Deploy local index definitions directly to Firestore via Admin REST API. |
| `ketrik-firestore-studio.buildCompositeIndex` | **Firestore: Create Composite Index...** | Composite Indexes Branch Menu / Inline `+` / Palette | Guided multi-step wizard to construct composite indexes and deploy or stage locally. |



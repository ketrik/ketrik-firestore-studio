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
| `ketrik-firestore-studio.createDocument` | **Firestore: Create Document** | Collection Context Menu / Inline Icon | Creates a new document within the selected collection. Prompts for auto-generated ID or manual ID and opens in a virtual `.json` editor. |
| `ketrik-firestore-studio.deleteCollection` | **Firestore: Delete Collection** | Collection Context Menu | Batch deletes all documents within the collection (prompts for confirmation). |

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
| `ketrik-firestore-studio.openFieldAsTable` | **Firestore: View as Table** | Map & Array Field Context Menu | Opens an in-document map (`Record<string, T>`) or sequence list (`T[]`) as an interactive tabular grid. |
| `ketrik-firestore-studio.renameField` | **Firestore: Rename Field** | Field Context Menu | Atomically renames a document field using Firestore field delete + set, validating destination collisions and refreshing open editor tabs. |
| `ketrik-firestore-studio.openField` | **Firestore: Edit Value / Open Field** | Field Double-Click / Context Menu | Quick-edit a scalar field value with type-preserving input. |
| `ketrik-firestore-studio.addField` | **Firestore: Add Field** | Document / Map Context Menu | Adds a new field with type selection (String, Number, Boolean, Timestamp, GeoPoint, Map, Array, Null). |
| `ketrik-firestore-studio.deleteField` | **Firestore: Delete Field** | Field Context Menu | Atomically removes a field from the document via `FieldValue.delete()`. |
| `ketrik-firestore-studio.copyFieldValue` | **Firestore: Copy Field Value** | Field Context Menu | Copies the serialized value of the field to the clipboard. |

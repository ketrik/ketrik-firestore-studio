---
title: Configuration Reference
description: Complete reference of workspace settings and options for Ketrik Firestore Studio.
sidebar_position: 1
---

# Configuration Reference

Ketrik Firestore Studio provides granular workspace and user-level settings to customize network behavior, caching timeouts, AI scratchpad synchronization, editor ergonomics, and table limits. All settings can be configured either via the Visual Studio Code Settings UI (`Cmd+,` / `Ctrl+,`) under **Ketrik Firestore Studio** or directly in `.vscode/settings.json`.

---

## Settings Schema

```json
{
  "ketrik-firestore-studio.openMode": "virtual",
  "ketrik-firestore-studio.autoSyncLocalSnapshots": true,
  "ketrik-firestore-studio.autoMirrorVirtualDocuments": false,
  "ketrik-firestore-studio.cacheTTLSeconds": 30,
  "ketrik-firestore-studio.pagingLimit": 10,
  "ketrik-firestore-studio.maxTableRows": 100,
  "ketrik-firestore-studio.initialFoldLevel": 0,
  "ketrik-firestore-studio.retainWebviewTabs": true,
  "ketrik-firestore-studio.autoRevealDocumentInTree": true,
  "ketrik-firestore-studio.protectSystemKeys": true,
  "ketrik-firestore-studio.checkRemoteChangesOnSave": false,
  "ketrik-firestore-studio.autoDiscoverEmulators": true,
  "ketrik-firestore-studio.emulatorStartupCommand": "firebase emulators:start",
  "ketrik-firestore-studio.emulatorAutoConnect": true,
  "ketrik-firestore-studio.promptStartEmulator": true,
  "ketrik-firestore-studio.showEmulatorStatusBar": true,
  "ketrik-firestore-studio.costAlerts.dailyReadThreshold": 40000,
  "ketrik-firestore-studio.costAlerts.dailyWriteThreshold": 16000,
  "ketrik-firestore-studio.costAlerts.enableNotifications": true,
  "ketrik-firestore-studio.documentTemplates": [
    {
      "label": "User Profile",
      "data": {
        "displayName": "New User",
        "email": "",
        "role": "member"
      }
    }
  ]
}
```

---

## AI Scratchpad & Document Modes

### `ketrik-firestore-studio.openMode`
- **Type**: `string` (`"virtual"` | `"workspace"`)
- **Default**: `"virtual"`
- **Description**: Default behavior when clicking or opening documents from the Explorer Tree View:
  - `"virtual"`: Opens document as an in-memory virtual tab (`ketrik-firestore-studio://...`) with 0 disk bytes.
  - `"workspace"`: Directly opens or creates a deterministic workspace snapshot file under `.firestore/<connectionId>/<collectionPath>/<docId>.json` for immediate 0-click AI coding assistant compatibility (Cursor, Copilot, Gemini).

### `ketrik-firestore-studio.autoSyncLocalSnapshots`
- **Type**: `boolean`
- **Default**: `true`
- **Description**: Automatically pushes modifications back to Cloud Firestore, Firebase Emulator, or Local JSON store whenever a tracked snapshot or AI scratchpad file is saved.

### `ketrik-firestore-studio.autoMirrorVirtualDocuments`
- **Type**: `boolean`
- **Default**: `false`
- **Description**: When enabled, opening any virtual document tab automatically mirrors the file to `.firestore/` in the background so local AI file search tools can immediately discover it. Disabled by default so virtual mode leaves zero files on your disk.

---

## Caching & Quota Controls

### `ketrik-firestore-studio.cacheTTLSeconds`
- **Type**: `number`
- **Default**: `30`
- **Description**: Cache lifetime in seconds for virtual document files and tree browsing. Keeps browsing snappy and saves Firestore read quota. Saves invalidate the cache immediately. Set to `0` to disable in-memory document caching entirely.

### `ketrik-firestore-studio.pagingLimit`
- **Type**: `number`
- **Default**: `10`
- **Description**: Number of documents fetched per page when expanding a collection in the Explorer tree view.
- **Behavior**: When a collection exceeds this limit, a **Load More...** button appears at the bottom of the list.

### `ketrik-firestore-studio.maxTableRows`
- **Type**: `number`
- **Default**: `100`
- **Description**: Maximum number of documents the collection table view will load in total. Every loaded document is a billed Firestore read, so keep this low; use Lookup to fetch specific documents.

### `ketrik-firestore-studio.checkRemoteChangesOnSave`
- **Type**: `boolean`
- **Default**: `false`
- **Description**: If enabled, performs an extra Firestore read before saving to warn if the document was modified remotely by another client.

---

## Editor & Webview Ergonomics

### `ketrik-firestore-studio.initialFoldLevel`
- **Type**: `number`
- **Default**: `0` (Fully expanded)
- **Description**: Initial folding level when opening a Firestore document in the JSON editor. Set to `1` to fold root keys by default, or `0` to keep fully expanded.

### `ketrik-firestore-studio.retainWebviewTabs`
- **Type**: `boolean`
- **Default**: `true`
- **Description**: Preserves background webview DOM and scroll position in memory for collection tables and cost simulator tabs. If experiencing high memory usage on constrained machines, set to `false` to allow VS Code to aggressively reclaim background tab memory.

### `ketrik-firestore-studio.autoRevealDocumentInTree`
- **Type**: `boolean`
- **Default**: `true`
- **Description**: Automatically reveals, expands to, and highlights documents in the Explorer Tree View when opened from the collection table view or editor tabs.

### `ketrik-firestore-studio.protectSystemKeys`
- **Type**: `boolean`
- **Default**: `true`
- **Description**: Safe Mode: Warns and requires explicit confirmation when deleting or renaming System Envelope (`_`) or Operational Protocol (`__`) keys.

---

## Firebase Emulator Suite

### `ketrik-firestore-studio.autoDiscoverEmulators`
- **Type**: `boolean`
- **Default**: `true`
- **Description**: Automatically detects Firebase configuration (`firebase.json`) and running emulators on workspace open.

### `ketrik-firestore-studio.emulatorStartupCommand`
- **Type**: `string`
- **Default**: `"firebase emulators:start"`
- **Description**: Shell command used to start the Firebase Local Emulator in the integrated VS Code terminal.

### `ketrik-firestore-studio.emulatorAutoConnect`
- **Type**: `boolean`
- **Default**: `true`
- **Description**: Automatically creates or connects to the Firestore connection when a local emulator is running.

### `ketrik-firestore-studio.promptStartEmulator`
- **Type**: `boolean`
- **Default**: `true`
- **Description**: Prompts to start the local emulator when opening a workspace with `firebase.json` if not already running.

### `ketrik-firestore-studio.showEmulatorStatusBar`
- **Type**: `boolean`
- **Default**: `true`
- **Description**: Shows the Firebase Local Emulator status indicator in the VS Code status bar.

---

## Cost & Quota Alerts

### `ketrik-firestore-studio.costAlerts.dailyReadThreshold`
- **Type**: `number`
- **Default**: `40000`
- **Description**: Daily Firestore document read threshold to trigger warning indicators in the status bar and modal alerts (Default: 40,000, 80% of Spark free tier).

### `ketrik-firestore-studio.costAlerts.dailyWriteThreshold`
- **Type**: `number`
- **Default**: `16000`
- **Description**: Daily Firestore document write threshold to trigger warning indicators in the status bar and modal alerts (Default: 16,000, 80% of Spark free tier).

### `ketrik-firestore-studio.costAlerts.enableNotifications`
- **Type**: `boolean`
- **Default**: `true`
- **Description**: Displays a notification alert when daily Firestore read/write quota exceeds configured budget thresholds.

---

## Document Templates

### `ketrik-firestore-studio.documentTemplates`
- **Type**: `array`
- **Default**: `[]`
- **Description**: Predefined JSON templates for quick document creation. Each item specifies a `label` and a default `data` object.

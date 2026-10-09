---
title: Configuration Reference
description: Complete reference of workspace settings and options for Ketrik Firestore Studio.
sidebar_position: 1
---

# Configuration Reference

Ketrik Firestore Studio provides granular workspace and user-level settings to customize network behavior, caching timeouts, editor ergonomics, and table limits. All settings can be configured either via the Visual Studio Code Settings UI (`Cmd+,` / `Ctrl+,`) under **Ketrik Firestore Studio** or directly in `.vscode/settings.json`.

---

## Settings Schema

```json
{
  "ketrik-firestore-studio.cacheTTLSeconds": 30,
  "ketrik-firestore-studio.pagingLimit": 10,
  "ketrik-firestore-studio.maxTableRows": 100,
  "ketrik-firestore-studio.initialFoldLevel": 0,
  "ketrik-firestore-studio.checkRemoteChangesOnSave": false,
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

## Detailed Settings

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

### `ketrik-firestore-studio.initialFoldLevel`
- **Type**: `number`
- **Default**: `0` (Fully expanded)
- **Description**: Initial folding level when opening a Firestore document in the JSON editor. Set to `1` to fold root keys by default, or `0` to keep fully expanded.

### `ketrik-firestore-studio.checkRemoteChangesOnSave`
- **Type**: `boolean`
- **Default**: `false`
- **Description**: If enabled, performs an extra Firestore read before saving to warn if the document was modified remotely by another client.

### `ketrik-firestore-studio.documentTemplates`
- **Type**: `array`
- **Default**: `[]`
- **Description**: Predefined JSON templates for quick document creation.

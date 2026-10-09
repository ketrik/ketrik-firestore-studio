---
title: Tree Explorer & Document Editing
description: Navigating collections, editing documents, managing root fields, and granular cache controls.
sidebar_position: 3
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

### Full Document Editing
- Click on any document node (`📄 user_101`) to open the full document as native JSON.
- **Save Live to Firestore**: Pressing `Cmd+S` (`Ctrl+S`) saves the file and immediately calls `document.set(data)` on Firestore.
- **Initial Folding**: Use setting `ketrik-firestore-studio.initialFoldLevel` (e.g. `1`) to automatically collapse top-level fields upon opening for instant scanning of large documents.

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
- **Null Fields**: Clicking a `null` field presents a type selector allowing you to convert the field to an `Object ({})`, `Array ([])`, `String`, `Number`, `Boolean`, or open a raw JSON editor.

---

## 3. Field & Document Context Actions

Right-click any document or field item to access operations:

| Action | Applies To | Description |
|---|---|---|
| **Rename Field...** | Root Fields | Atomically transfers value to new field name and deletes old key using `FieldValue.delete()`. Overwrite protection included. |
| **Add Field...** | Documents & Fields | Create a new root field with type assistance (`Object`, `Array`, `String`, `Number`, `Boolean`, or custom `JSON`). |
| **Delete Field** | Root Fields | Permanently removes a key from the document using `FieldValue.delete()`. |
| **Duplicate Document...** | Documents | Clone document within collection with an instant ID prompt. |
| **Copy Document** | Documents | Copy document to internal clipboard for cross-collection/connection paste. |
| **Paste Document** | Collections & Docs | Paste copied document into any target collection or connection. |
| **Copy as JSON** | Documents | Export formatted document JSON directly to OS clipboard without opening an editor tab. |
| **Deep Delete** | Documents | Detects nested subcollections and prompts for **Deep Delete (Doc + Subcollections)** or **Delete Document Only**. |
| **Refresh** | Documents & Fields | Granularly refreshes only that document and its fields from Firestore, preserving collection scroll position and pagination. |

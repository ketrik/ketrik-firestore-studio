---
name: firestore-studio-workflow
description: Expert workflows, debugging runbooks, and extension development best practices for Ketrik Firestore Studio VS Code extension.
---

# Ketrik Firestore Studio Workflow Skill

This skill provides step-by-step procedures for developing, debugging, extending, and testing the Ketrik Firestore Studio VS Code extension.

---

## 1. Local Development & Watch Mode

### Compiling and Testing Extension
- **Start TypeScript Watcher**:
  ```bash
  npm run watch
  ```
- **Type Check**:
  ```bash
  npm run check-types
  ```
- **Compile Production Bundle**:
  ```bash
  npm run compile
  ```
- **Package VSIX**:
  ```bash
  npm run package
  ```

---

## 2. Extension Architecture & Data Flow

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Extension Architecture                          │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  ConnectionManager (Singleton)                                         │
│    └── Manages gRPC Firestore instances per Connection ID             │
│                                                                        │
│  ExplorerDataProvider (vscode.TreeDataProvider<Item>)                  │
│    ├── ConnectionItem                                                  │
│    │     └── CollectionItem (paginated via showMoreItems)              │
│    │           └── DocumentItem                                        │
│    │                 ├── FieldItem (scalar, null, map, array)          │
│    │                 └── SubcollectionItem                             │
│    └── refreshNode(item) -> Invalidation without root reload           │
│                                                                        │
│  DocumentFileSystemProvider (vscode.FileSystemProvider)                │
│    ├── Scheme: 'ketrik-firestore-studio'                              │
│    ├── readFile() -> cached or live Firestore doc snapshot            │
│    ├── writeFile() -> partial update or full overwrite                │
│    └── invalidateAndNotify() -> triggers onDidChangeFile for editor   │
│                                                                        │
│  Webviews:                                                             │
│    ├── openCollectionAsTable -> Collection grid + Where query builder  │
│    └── openFieldAsTable -> Record<string, T> & T[] substrate viewer   │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Extension Modification Checklist

When modifying or adding features:

1. **New Commands**:
   - Register command ID in `package.json` under `contributes.commands`.
   - Add menu placement under `contributes.menus` (`view/title`, `view/item/context`, or `commandPalette`).
   - Register execution handler in `src/extension.ts` with `context.subscriptions.push(...)`.
2. **Document & Field Updates**:
   - Always notify the `DocumentFileSystemProvider` when modifying or renaming fields:
     ```typescript
     DocumentFileSystemProvider.getInstance().invalidateAndNotify(connectionId, docPath);
     ```
   - Invalidate only the targeted explorer branch using `explorerDataProvider.refreshNode(parentItem)` rather than a full `refreshExplorer()`.
3. **Webview Scripts**:
   - Ensure CSP (Content Security Policy) nonces and URI sanitization are maintained when passing HTML/CSS/JS to webview panels.
   - Post messages between extension host and webview via `vscode.postMessage` / `webviewPanel.webview.onDidReceiveMessage`.

---

## 4. Release Runbook

To cut a new version:
1. Run `./scripts/release.sh`.
2. Select the release type when prompted:
   - `1) Minor (v1.5.0)` — New features, webviews, query builders
   - `2) Patch (v1.4.1)` — Bug fixes and performance tuning
   - `3) Major` / `4) Custom`
3. Verify git tag, commit, and release artifacts.

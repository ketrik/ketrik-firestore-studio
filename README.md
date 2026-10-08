# Ketrik Firestore Studio

A powerful Visual Studio Code extension for exploring, querying, and editing multiple Firebase / Google Cloud Firestore databases directly inside VS Code.

---

## Features

- **Multiple Firestore Connections**: Connect to multiple Firestore instances simultaneously (Production, Staging, Dev, Local Emulators, and custom Database IDs).
- **Interactive Tree Explorer**: Browse collections, documents, sub-collections, and root document fields across all your connections in one sidebar view.
- **Root Variables as Virtual Subdocuments**: Open top-level document fields and nested structures independently in dedicated JSON editors—no need to navigate massive documents.
- **Atomic Partial Updates**: Saving an edited root field uses Firestore's atomic `.update({ [field]: value })` rather than overwriting the entire document.
- **Smart Modal Editing for Primitives**: Click any boolean in the tree to toggle via QuickPick (`true` / `false`), or edit numbers/strings via instant modal input with live validation.
- **Field Context Actions**: Add new fields with type assistance (`Object`, `Array`, `String`, `Number`, `Boolean`, or custom `JSON`), copy field paths, or delete fields directly from tree context menus.
- **Auto-Sync & Live Refresh**: Changes saved to documents or sub-fields immediately reflect in the Explorer tree view in real-time.
- **Direct Document Editing**: Open and edit any full document as native JSON with full VS Code editor features. Saving the file (`Cmd+S` / `Ctrl+S`) writes updates back to Firestore immediately.
- **Table View with Search**: View collection documents in a tabular format, search across fields, and paginate with ease.
- **Document & Field Management**: Create new documents (with optional JSON templates), add fields, and delete documents or fields safely.
- **Export**: Export collection data directly to JSON files.
- **Custom Ordering & Pagination**: Sort collections by any field in ascending or descending order.

---

## Getting Started

1. Open the **Ketrik Firestore Studio** view from the VS Code Activity Bar.
2. Click **Add Connection** (`+`) in the view title bar or run `Firestore Studio: Add Connection` from the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`).
3. Choose your connection method:
   - **Service Account Key (JSON)**: Select your downloaded Firebase service account JSON key file.
   - **Local Firestore Emulator**: Specify emulator host (e.g., `localhost:8080`) and project ID.
4. (Optional) Provide a custom Database ID if using named databases (defaults to `(default)`).
5. Explore collections, expand documents to view top-level fields, and click to edit live!

---

## Extension Commands

| Command | Title | Description |
|---|---|---|
| `ketrik-firestore-studio.addConnection` | Add Connection | Configure a new Firestore connection |
| `ketrik-firestore-studio.editConnection` | Edit Connection | Edit connection settings |
| `ketrik-firestore-studio.deleteConnection` | Delete Connection | Remove a configured connection |
| `ketrik-firestore-studio.testConnection` | Test Connection | Test connection credentials and connectivity |
| `ketrik-firestore-studio.refreshExplorer` | Refresh Explorer | Refresh collections and document tree |
| `ketrik-firestore-studio.openCollectionAsTable` | Open Collection as Table | Open interactive table grid view |
| `ketrik-firestore-studio.jumpToDocument` | Jump to Document ID... | Direct 1-read document lookup on server by ID |
| `ketrik-firestore-studio.createDocument` | Create Document | Create a new document in the selected collection |
| `ketrik-firestore-studio.deleteDocument` | Delete Document | Delete a selected document |
| `ketrik-firestore-studio.addField` | Add Field... | Add a new root field to a document with type picker |
| `ketrik-firestore-studio.openField` | Edit Value / Open Field | Quick-edit primitive value or open subdocument |
| `ketrik-firestore-studio.openFieldInEditor` | Open in JSON Editor | Open any field directly into a dedicated JSON tab |
| `ketrik-firestore-studio.deleteField` | Delete Field | Delete a root field using `FieldValue.delete()` |
| `ketrik-firestore-studio.addCollection` | Add Collection | Create a root or sub-collection |

---

## Extension Settings

- `ketrik-firestore-studio.connections`: List of configured Firestore connections (ID, Name, Service Account Path, Project ID, Database ID, Emulator settings).
- `ketrik-firestore-studio.pagingLimit`: Number of documents to show per page (default: `10`).
- `ketrik-firestore-studio.documentTemplates`: Custom JSON templates for fast document creation.

---

## Notice

This extension relies on the [Firebase Admin SDK](https://firebase.google.com/docs/admin/setup) and its usage will generate reads and writes that may impact your Firebase billing.

---

## License

[MIT](LICENSE)

# Ketrik Firestore Studio

A powerful Visual Studio Code extension for exploring, querying, and editing multiple Firebase / Google Cloud Firestore databases directly inside VS Code.

---

## Features

- **Multiple Firestore Connections**: Connect to multiple Firestore instances simultaneously (Production, Staging, Dev, Local Emulators, and custom Database IDs).
- **Interactive Tree Explorer**: Browse collections, documents, and sub-collections across all your connections in one sidebar view.
- **Direct Document Editing**: Open and edit any document as native JSON with full VS Code editor features. Saving the file (`Cmd+S` / `Ctrl+S`) writes updates back to Firestore immediately.
- **Table View with Search**: View collection documents in a tabular format, search across fields, and paginate with ease.
- **Document Management**: Create new documents (with optional JSON templates) and delete documents safely.
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
5. Explore collections and click on documents to open and edit them live!

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
| `ketrik-firestore-studio.createDocument` | Create Document | Create a new document in the selected collection |
| `ketrik-firestore-studio.deleteDocument` | Delete Document | Delete a selected document |
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

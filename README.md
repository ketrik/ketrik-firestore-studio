# Firestore Studio

A Visual Studio Code Extension for listing, viewing, creating/deleting, and editing multiple Firebase Firestore Database collections and documents using JSON syntax.

## Features

- **Multiple Firestore Connections**: Connect to multiple Firestore instances simultaneously (Production, Staging, Dev, Local Emulators, and custom Database IDs).
- **Tree Explorer**: Browse collections, sub-collections, and documents across all your connections in one place.
- **Direct Document Editing**: View and edit any document as a JSON file with full VS Code editor features. Saving the file immediately updates the document in Firestore.
- **Table View with Search**: View collection documents in a tabular format, search across fields, and paginate with ease.
- **Export**: Export collection data to JSON files.
- **Document Management**: Create new documents (with optional JSON templates) and delete documents.
- **Custom Ordering & Pagination**: Sort collections by any field in ascending/descending order.

## How to use

1. Open the **Ketrik Firestore Studio** view from the Activity Bar.
2. Click **Add Connection** (`+`) in the view title bar or run `Firestore Studio: Add Connection`.
3. Choose your connection method:
   - **Service Account Key (JSON)**: Select your downloaded Firebase service account JSON key file.
   - **Local Firestore Emulator**: Specify emulator host (e.g., `localhost:8080`) and project ID.
4. (Optional) Provide a custom Database ID if using named databases (defaults to `(default)`).
5. Explore collections and click on documents to open and edit them live!

## Extension Settings

- `ketrik-firestore-studio.connections`: List of configured Firestore connections (ID, Name, Service Account Path, Project ID, Database ID, Emulator settings).
- `ketrik-firestore-studio.pagingLimit`: Number of documents to show per page (default: `10`).
- `ketrik-firestore-studio.documentTemplates`: Custom document templates for fast document creation.

## Notice

This extension relies on the [Firebase Admin SDK](https://firebase.google.com/docs/admin/setup) and its usage will generate reads and writes that may impact your Firebase billing.

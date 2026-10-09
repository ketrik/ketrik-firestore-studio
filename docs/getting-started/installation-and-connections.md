---
title: Installation & Connections
description: How to install Ketrik Firestore Studio and configure Service Account or Emulator connections.
sidebar_position: 2
---

# Installation & Connections

## Installation

### Option A: From VS Code Marketplace
1. Open the **Extensions** view (`Cmd+Shift+X` on macOS / `Ctrl+Shift+X` on Windows & Linux).
2. Search for `Ketrik Firestore Studio`.
3. Click **Install**.

### Option B: Download VSIX from GitHub Releases
1. Download the latest `.vsix` package from [GitHub Releases](https://github.com/ketrik/ketrik-firestore-studio/releases).
2. Install via terminal:
   ```bash
   code --install-extension ketrik-firestore-studio-*.vsix
   ```
   Or inside VS Code: Open the **Extensions** view $\rightarrow$ click the three dots (`...`) in the top-right corner $\rightarrow$ select **Install from VSIX...** $\rightarrow$ choose the downloaded file.

### Option C: Build & Package Locally
You can also package the extension directly from source:
```bash
npm install
npm run package # Generates ketrik-firestore-studio-<version>.vsix
code --install-extension ketrik-firestore-studio-*.vsix
```

---

## Configuring Firestore Connections

Firestore Studio supports unlimited simultaneous connections. You can connect to live Google Cloud Firestore projects or local Firebase Emulators.

### Option 1: Firebase Service Account Key (Production / Staging / Dev)

1. Navigate to the **Firebase Console** $\rightarrow$ **Project Settings** $\rightarrow$ **Service Accounts**.
2. Click **Generate New Private Key** to download your JSON credentials file.
3. In the Activity Bar on the left, click the **Ketrik Firestore Studio** icon to open the **Firestore Connections** tree.
4. Click the **+** (**Add Connection**) icon on the view title bar (or run `Firestore Studio: Add Connection` via `Cmd+Shift+P` / `Ctrl+Shift+P`).
5. Choose **$(key) Service Account Key (JSON)**.
6. A file dialog will prompt you to select your downloaded JSON key file.
7. Enter a connection name (defaults to the `project_id` parsed from your JSON key).
8. *(Optional)* If your project uses named databases, specify your custom **Database ID** (defaults to `(default)`).

```json
{
  "name": "Production - US Central",
  "serviceAccountPath": "/Users/developer/keys/firebase-prod-key.json",
  "databaseId": "(default)"
}
```

---

### Option 2: Local Firebase Firestore Emulator (Development & Testing)

1. Launch your local Firebase Emulator Suite:
   ```bash
   firebase emulators:start --only firestore
   ```
2. In VS Code, click **Add Connection** (`+`).
3. Choose **Local Firestore Emulator**.
4. Enter your emulator parameters:
   - **Connection Name**: `Local Emulator`
   - **Project ID**: Your local project ID (e.g. `demo-project` or `my-app-dev`)
   - **Host & Port**: Host and port (e.g. `localhost:8080`)
   - **Database ID**: Database ID (defaults to `(default)`)

> **Note on Emulator Isolation**: Connections are fully isolated per instance. Connecting to an emulator sets instance-specific gRPC settings without polluting global process environment variables, allowing emulator and production connections to run safely side-by-side.

---

## Managing Connections

Right-click any connection node in the sidebar to perform operations:
- **Test Connection**: Verifies gRPC connectivity, project credentials, and database reachability with live status notifications.
- **Add Collection**: Create a new root collection under the connection.
- **Edit Connection**: Modify connection name, service account path, or port settings.
- **Delete Connection**: Remove the connection configuration from your workspace.

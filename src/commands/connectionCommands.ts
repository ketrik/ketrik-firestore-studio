import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import {
  ConnectionManager,
  FirestoreConnectionConfig,
} from "../connections/ConnectionManager";
import { ConnectionTreeItem } from "../explorer/items";
import { EmulatorService } from "../emulator/EmulatorService";
import { parseHostPort, probePort } from "../emulator/portUtils";

export async function addConnectionCommand(): Promise<void> {
  const connectionManager = ConnectionManager.getInstance();

  const typePick = await vscode.window.showQuickPick(
    [
      {
        label: "$(search) Auto-Detect from Workspace",
        description: "Inspect firebase.json and connect to local emulator",
        detail: "Auto-detects emulator configuration from firebase.json in current workspace",
        type: "auto_detect",
      },
      {
        label: "$(server-process) Local Firestore Emulator (Connect to Existing)",
        description: "Connect client to an already running emulator (e.g. localhost:8080)",
        detail: "Connects to a running emulator process (does not start an emulator)",
        type: "emulator",
      },
      {
        label: "$(key) Service Account Key (JSON)",
        description: "Connect via Firebase Service Account Key file",
        detail: "Authenticate directly with a cloud Firebase / GCP project",
        type: "service_account",
      },
      {
        label: "$(file-code) Local JSON Database / Mock Store",
        description: "Connect directly to a local JSON file or folder of JSON datasets",
        detail: "Zero-quota offline store for mock data, prototyping, and seed migration",
        type: "local_json",
      },
    ],
    { placeHolder: "Select connection method" }
  );

  if (!typePick) {
    return;
  }

  if (typePick.type === "auto_detect") {
    await EmulatorService.getInstance().discoverAndConnect(true);
    return;
  }

  if (typePick.type === "service_account") {
    const fileUris = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      openLabel: "Select Key File",
      filters: { "JSON Files": ["json"] },
      title: "Select Firebase Service Account Key File",
    });

    if (!fileUris || fileUris.length === 0) {
      return;
    }

    const keyPath = fileUris[0].fsPath;
    let projectId = "";
    let defaultName = path.basename(keyPath, ".json");

    try {
      const parsed = JSON.parse(fs.readFileSync(keyPath, "utf8"));
      projectId = parsed.project_id || "";
      if (projectId) {
        defaultName = `${projectId}`;
      }
    } catch {
      vscode.window.showErrorMessage("Invalid JSON file selected.");
      return;
    }

    const name = await vscode.window.showInputBox({
      prompt: "Connection Name / Label",
      value: defaultName,
      placeHolder: "e.g. Production, Staging",
      validateInput: (val) => (val && val.trim().length > 0 ? null : "Name cannot be empty"),
    });

    if (!name) {
      return;
    }

    const databaseId = await vscode.window.showInputBox({
      prompt: "Database ID (leave empty or '(default)' for default database)",
      value: "(default)",
      placeHolder: "(default) or custom database name",
    });

    const newConnection: FirestoreConnectionConfig = {
      id: `conn_${Date.now()}`,
      name: name.trim(),
      serviceAccountKeyPath: keyPath,
      projectId: projectId || undefined,
      databaseId: databaseId && databaseId.trim() !== "" ? databaseId.trim() : "(default)",
      isEmulator: false,
    };

    // Test connection
    const testResult = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Testing connection '${newConnection.name}'...`,
      },
      () => connectionManager.testConnection(newConnection)
    );

    if (!testResult.success) {
      const proceed = await vscode.window.showWarningMessage(
        `Connection test failed: ${testResult.message}. Do you still want to save it?`,
        { modal: true },
        "Save Anyway",
        "Cancel"
      );
      if (proceed !== "Save Anyway") {
        return;
      }
    }

    await connectionManager.addConnection(newConnection);
    vscode.window.showInformationMessage(`Firestore connection '${newConnection.name}' added successfully!`);
  } else if (typePick.type === "local_json") {
    const fileOrFolder = await vscode.window.showQuickPick(
      [
        {
          label: "$(file) Single JSON File",
          description: "e.g. mock-db.json, seed-data.json",
          detail: "Top-level keys represent collections, nested objects represent documents",
          mode: "file",
        },
        {
          label: "$(folder) Folder of JSON Files",
          description: "e.g. ./mock-data/ (users.json, products.json)",
          detail: "Each .json file in the folder becomes a distinct collection",
          mode: "folder",
        },
      ],
      { placeHolder: "Select local JSON storage structure" }
    );

    if (!fileOrFolder) return;

    const dialogUris = await vscode.window.showOpenDialog({
      canSelectFiles: fileOrFolder.mode === "file",
      canSelectFolders: fileOrFolder.mode === "folder",
      canSelectMany: false,
      openLabel: fileOrFolder.mode === "file" ? "Select JSON File" : "Select Data Folder",
      filters: fileOrFolder.mode === "file" ? { "JSON Files": ["json"] } : undefined,
      title: fileOrFolder.mode === "file" ? "Select Local JSON Database File" : "Select Data Folder",
    });

    if (!dialogUris || dialogUris.length === 0) return;
    const targetPath = dialogUris[0].fsPath;
    const baseName = path.basename(targetPath, fileOrFolder.mode === "file" ? ".json" : undefined);

    const name = await vscode.window.showInputBox({
      prompt: "Connection Name / Label",
      value: `Local (${baseName})`,
      placeHolder: "e.g. Local Mock Store, Seed Data",
      validateInput: (val) => (val && val.trim().length > 0 ? null : "Name cannot be empty"),
    });

    if (!name) return;

    const newConnection: FirestoreConnectionConfig = {
      id: `conn_${Date.now()}`,
      name: name.trim(),
      isLocalJson: true,
      localJsonPath: targetPath,
    };

    await connectionManager.addConnection(newConnection);
    vscode.window.showInformationMessage(
      `Local JSON Database '${newConnection.name}' added successfully! File: ${targetPath}`
    );
  } else {
    // Emulator
    const name = await vscode.window.showInputBox({
      prompt: "Connection Name / Label",
      value: "Local Emulator",
      placeHolder: "e.g. Local Emulator",
      validateInput: (val) => (val && val.trim().length > 0 ? null : "Name cannot be empty"),
    });

    if (!name) {
      return;
    }

    const host = await vscode.window.showInputBox({
      prompt: "Emulator Host (host:port) — Note: requires a running emulator instance",
      value: "localhost:8080",
      placeHolder: "localhost:8080",
    });

    if (!host) {
      return;
    }

    const authHost = await vscode.window.showInputBox({
      prompt: "Auth Emulator Host (leave empty or 'localhost:9099')",
      value: "localhost:9099",
      placeHolder: "localhost:9099 or empty",
    });

    const projectId = await vscode.window.showInputBox({
      prompt: "Project ID for Emulator",
      value: "demo-project",
      placeHolder: "demo-project",
    });

    const newConnection: FirestoreConnectionConfig = {
      id: `conn_${Date.now()}`,
      name: name.trim(),
      isEmulator: true,
      emulatorHost: host.trim(),
      authEmulatorHost: authHost && authHost.trim().length > 0 ? authHost.trim() : undefined,
      projectId: projectId?.trim() || "demo-project",
    };

    // Fast-probe emulator port reachability
    const { host: probeH, port: probeP } = parseHostPort(newConnection.emulatorHost);
    const isOnline = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Checking emulator at ${newConnection.emulatorHost}...`,
      },
      () => probePort(probeH, probeP, 1200)
    );

    if (!isOnline) {
      const choice = await vscode.window.showWarningMessage(
        `No Firebase emulator is currently running at ${newConnection.emulatorHost}. This connection is a client endpoint and requires an active emulator process.`,
        "Save Anyway",
        "Start Emulator Now",
        "Cancel"
      );

      if (choice === "Cancel" || !choice) {
        return;
      }

      if (choice === "Start Emulator Now") {
        await connectionManager.addConnection(newConnection);
        await EmulatorService.getInstance().startEmulator();
        return;
      }
    }

    await connectionManager.addConnection(newConnection);
    vscode.window.showInformationMessage(
      isOnline
        ? `Emulator connection '${newConnection.name}' (${newConnection.emulatorHost}) added and verified!`
        : `Emulator connection '${newConnection.name}' saved. Note: Start the emulator before exploring collections.`
    );
  }
}

export async function editConnectionCommand(item?: ConnectionTreeItem): Promise<void> {
  const connectionManager = ConnectionManager.getInstance();
  const connections = connectionManager.getConnections();

  let targetId = item?.config.id;
  if (!targetId) {
    if (connections.length === 0) {
      vscode.window.showInformationMessage("No connections to edit.");
      return;
    }
    const picked = await vscode.window.showQuickPick(
      connections.map((c) => ({ label: c.name, description: c.id, connectionId: c.id })),
      { placeHolder: "Select connection to edit" }
    );
    if (!picked) {
      return;
    }
    targetId = picked.connectionId;
  }

  const conn = connectionManager.getConnection(targetId);
  if (!conn) {
    vscode.window.showErrorMessage(`Connection '${targetId}' not found.`);
    return;
  }

  const actions: (vscode.QuickPickItem & { action: string })[] = [
    { label: "$(edit) Rename Connection", action: "rename" },
  ];

  if (conn.isEmulator) {
    actions.push(
      { label: "$(server-process) Change Emulator Host", action: "emulatorHost" },
      { label: "$(shield) Change Auth Emulator Host", action: "authEmulatorHost" },
      { label: "$(symbol-constant) Change Project ID", action: "projectId" }
    );
  } else {
    actions.push(
      { label: "$(key) Change Key File Path", action: "keyPath" },
      { label: "$(database) Change Database ID", action: "databaseId" }
    );
  }

  actions.push({ label: "$(zap) Test Connection", action: "test" });

  const action = await vscode.window.showQuickPick(actions, {
    placeHolder: `Edit connection: ${conn.name}`,
  });

  if (!action) {
    return;
  }

  if (action.action === "rename") {
    const newName = await vscode.window.showInputBox({
      prompt: "New connection name",
      value: conn.name,
      validateInput: (val) => (val && val.trim().length > 0 ? null : "Name cannot be empty"),
    });
    if (newName) {
      conn.name = newName.trim();
      await connectionManager.updateConnection(conn);
      vscode.window.showInformationMessage("Connection updated!");
    }
  } else if (action.action === "emulatorHost") {
    const newHost = await vscode.window.showInputBox({
      prompt: "Emulator Host (host:port)",
      value: conn.emulatorHost || "localhost:8080",
    });
    if (newHost) {
      conn.emulatorHost = newHost.trim();
      await connectionManager.updateConnection(conn);
      vscode.window.showInformationMessage("Emulator host updated!");
    }
  } else if (action.action === "authEmulatorHost") {
    const newAuth = await vscode.window.showInputBox({
      prompt: "Auth Emulator Host (host:port, or empty to disable)",
      value: conn.authEmulatorHost || "localhost:9099",
    });
    if (newAuth !== undefined) {
      conn.authEmulatorHost = newAuth.trim() || undefined;
      await connectionManager.updateConnection(conn);
      vscode.window.showInformationMessage("Auth emulator host updated!");
    }
  } else if (action.action === "projectId") {
    const newPid = await vscode.window.showInputBox({
      prompt: "Project ID",
      value: conn.projectId || "demo-project",
    });
    if (newPid) {
      conn.projectId = newPid.trim();
      await connectionManager.updateConnection(conn);
      vscode.window.showInformationMessage("Project ID updated!");
    }
  } else if (action.action === "keyPath") {
    const fileUris = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      openLabel: "Select New Key File",
      filters: { "JSON Files": ["json"] },
      title: "Select Firebase Service Account Key File",
    });

    if (fileUris && fileUris.length > 0) {
      conn.serviceAccountKeyPath = fileUris[0].fsPath;
      await connectionManager.updateConnection(conn);
      vscode.window.showInformationMessage("Key file path updated!");
    }
  } else if (action.action === "databaseId") {
    const newDb = await vscode.window.showInputBox({
      prompt: "Database ID",
      value: conn.databaseId || "(default)",
    });
    if (newDb !== undefined) {
      conn.databaseId = newDb.trim() || "(default)";
      await connectionManager.updateConnection(conn);
      vscode.window.showInformationMessage("Database ID updated!");
    }
  } else if (action.action === "test") {
    await testConnectionCommand(item);
  }
}

export async function deleteConnectionCommand(item?: ConnectionTreeItem): Promise<void> {
  const connectionManager = ConnectionManager.getInstance();
  const connections = connectionManager.getConnections();

  let targetId = item?.config.id;
  let targetName = item?.config.name;

  if (!targetId) {
    if (connections.length === 0) {
      vscode.window.showInformationMessage("No connections to remove.");
      return;
    }
    const picked = await vscode.window.showQuickPick(
      connections.map((c) => ({ label: c.name, description: c.id, connectionId: c.id })),
      { placeHolder: "Select connection to remove" }
    );
    if (!picked) {
      return;
    }
    targetId = picked.connectionId;
    targetName = picked.label;
  }

  const confirm = await vscode.window.showWarningMessage(
    `Are you sure you want to remove the Firestore connection "${targetName}"?`,
    { modal: true },
    "Remove",
    "Cancel"
  );

  if (confirm === "Remove") {
    await connectionManager.deleteConnection(targetId);
    vscode.window.showInformationMessage(`Connection "${targetName}" removed.`);
  }
}

export async function testConnectionCommand(item?: ConnectionTreeItem): Promise<void> {
  const connectionManager = ConnectionManager.getInstance();
  const connections = connectionManager.getConnections();

  let conn = item?.config;
  if (!conn) {
    if (connections.length === 0) {
      vscode.window.showInformationMessage("No connections to test.");
      return;
    }
    const picked = await vscode.window.showQuickPick(
      connections.map((c) => ({ label: c.name, description: c.id, config: c })),
      { placeHolder: "Select connection to test" }
    );
    if (!picked) {
      return;
    }
    conn = picked.config;
  }

  const result = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Testing connection to '${conn.name}'...`,
    },
    () => connectionManager.testConnection(conn!)
  );

  if (result.success) {
    vscode.window.showInformationMessage(`Connection to '${conn.name}' succeeded!`);
  } else {
    vscode.window.showErrorMessage(`Connection test failed: ${result.message}`);
  }
}

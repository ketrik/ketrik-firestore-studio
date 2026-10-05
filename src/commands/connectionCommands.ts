import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import {
  ConnectionManager,
  FirestoreConnectionConfig,
} from "../connections/ConnectionManager";
import { ConnectionTreeItem } from "../explorer/items";

export async function addConnectionCommand(): Promise<void> {
  const connectionManager = ConnectionManager.getInstance();

  const typePick = await vscode.window.showQuickPick(
    [
      {
        label: "$(key) Service Account Key (JSON)",
        description: "Connect via Firebase Service Account Key file",
        type: "service_account",
      },
      {
        label: "$(server-process) Local Firestore Emulator",
        description: "Connect to local Firebase emulator (e.g. localhost:8080)",
        type: "emulator",
      },
    ],
    { placeHolder: "Select connection method" }
  );

  if (!typePick) {
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
      prompt: "Emulator Host (host:port)",
      value: "localhost:8080",
      placeHolder: "localhost:8080",
    });

    if (!host) {
      return;
    }

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
      projectId: projectId?.trim() || "demo-project",
    };

    await connectionManager.addConnection(newConnection);
    vscode.window.showInformationMessage(`Emulator connection '${newConnection.name}' added!`);
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

  const action = await vscode.window.showQuickPick(
    [
      { label: "$(edit) Rename Connection", action: "rename" },
      { label: "$(key) Change Key File Path", action: "keyPath" },
      { label: "$(database) Change Database ID", action: "databaseId" },
      { label: "$(zap) Test Connection", action: "test" },
    ],
    { placeHolder: `Edit connection: ${conn.name}` }
  );

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

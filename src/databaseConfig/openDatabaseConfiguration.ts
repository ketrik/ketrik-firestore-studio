import * as vscode from "vscode";
import { ConnectionManager } from "../connections/ConnectionManager";
import { DatabaseConfigService } from "./DatabaseConfigService";
import { getDatabaseConfigHtml } from "./databaseConfigHtml";

// Registry of active database config webview panels keyed by connectionId
const activeConfigPanels = new Map<string, vscode.WebviewPanel>();

export async function openDatabaseConfiguration(target?: { connectionId?: string; id?: string; config?: { id?: string } } | string) {
  const connectionManager = ConnectionManager.getInstance();
  const connections = connectionManager.getConnections();

  if (connections.length === 0) {
    vscode.window.showWarningMessage("No Firestore connections configured. Add a connection first.");
    return;
  }

  let selectedConnectionId: string | undefined;

  if (typeof target === "string") {
    selectedConnectionId = target;
  } else if (target) {
    if (typeof target.connectionId === "string") {
      selectedConnectionId = target.connectionId;
    } else if (typeof target.id === "string") {
      selectedConnectionId = target.id;
    } else if (target.config && typeof target.config.id === "string") {
      selectedConnectionId = target.config.id;
    }
  }

  if (!selectedConnectionId) {
    if (connections.length === 1) {
      selectedConnectionId = connections[0].id;
    } else {
      const picks = connections.map((c) => ({
        label: c.name,
        description: c.projectId || (c.isEmulator ? "Emulator" : "Local JSON"),
        detail: `Database: ${c.databaseId || "(default)"}`,
        id: c.id,
      }));
      const picked = await vscode.window.showQuickPick(picks, {
        placeHolder: "Select a Firestore connection for Database Configuration & PITR",
      });
      if (!picked) return;
      selectedConnectionId = picked.id;
    }
  }

  const conn = connectionManager.getConnection(selectedConnectionId);
  if (!conn) {
    vscode.window.showErrorMessage(`Connection '${selectedConnectionId}' not found.`);
    return;
  }

  const existingPanel = activeConfigPanels.get(conn.id);
  if (existingPanel) {
    existingPanel.reveal(vscode.ViewColumn.One);
    return;
  }

  const configService = DatabaseConfigService.getInstance();
  let initialConfig;
  try {
    initialConfig = await configService.getDatabaseConfig(conn.id);
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to load database configuration for ${conn.name}: ${err?.message || err}`);
    return;
  }

  const vsConfig = vscode.workspace.getConfiguration("ketrik-firestore-studio");
  const retainContextWhenHidden = vsConfig.get<boolean>("retainWebviewTabs", true);

  const panel = vscode.window.createWebviewPanel(
    "firestoreDatabaseConfig",
    `Database Config: ${conn.name}`,
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden,
    }
  );

  activeConfigPanels.set(conn.id, panel);
  panel.webview.html = getDatabaseConfigHtml(initialConfig, conn.name);

  let messageSub: vscode.Disposable | undefined;

  panel.onDidDispose(() => {
    activeConfigPanels.delete(conn.id);
    messageSub?.dispose();
  });

  // Handle messages from the webview
  messageSub = panel.webview.onDidReceiveMessage(async (message) => {
    if (message.command === "refresh") {
      try {
        const freshConfig = await configService.getDatabaseConfig(conn.id, true);
        panel.webview.html = getDatabaseConfigHtml(freshConfig, conn.name);
        vscode.window.showInformationMessage(`Refreshed database configuration for '${conn.name}'.`);
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to refresh database configuration: ${err?.message || err}`);
      }
    }

    if (message.command === "updateSetting") {
      if (!ConnectionManager.getInstance().ensureWritable(conn.id, "update database configuration")) {
        try {
          const fresh = await configService.getDatabaseConfig(conn.id, true);
          panel.webview.html = getDatabaseConfigHtml(fresh, conn.name);
        } catch {}
        return;
      }
      const setting = message.setting;
      const value = message.value;
      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Updating ${setting} on '${conn.name}'...`,
            cancellable: false,
          },
          async () => {
            const updated = await configService.updateDatabaseConfig(conn.id, { [setting]: value });
            panel.webview.html = getDatabaseConfigHtml(updated, conn.name);
          }
        );
        vscode.window.showInformationMessage(`Successfully updated ${setting} to ${value}.`);
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to update ${setting}: ${err?.message || err}`);
        // Reload previous config to reset UI toggles
        try {
          const fresh = await configService.getDatabaseConfig(conn.id);
          panel.webview.html = getDatabaseConfigHtml(fresh, conn.name);
        } catch {}
      }
    }

    if (message.command === "copyText") {
      if (message.text) {
        await vscode.env.clipboard.writeText(message.text);
        vscode.window.showInformationMessage("Copied gcloud command to clipboard.");
      }
    }

    if (message.command === "openTimeTravel") {
      await vscode.commands.executeCommand("ketrik-firestore-studio.openTimeTravel", { connectionId: conn.id });
    }
  });
}


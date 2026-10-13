import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { probePort as probePortUtil } from "./portUtils";
import {
  ConnectionManager,
  FirestoreConnectionConfig,
} from "../connections/ConnectionManager";

export interface DetectedEmulatorConfig {
  rootUri: vscode.Uri;
  rootPath: string;
  hasFirebaseJson: boolean;
  hasFirebaserc: boolean;
  projectId: string;
  firestorePort: number;
  firestoreHost: string;
  authPort?: number;
  authHost?: string;
  storagePort?: number;
  storageHost?: string;
  uiPort?: number;
  uiHost?: string;
  uiEnabled: boolean;
  rawFirebaseJson?: any;
}

/**
 * Safely parses JSON strings that may contain single-line or multi-line comments.
 */
function parseJsonWithComments(content: string): any {
  const cleaned = content.replace(/\/\*[\s\S]*?\*\/|([^:]|^)\/\/.*$/gm, "$1");
  return JSON.parse(cleaned);
}

/**
 * Service for local Firebase emulator auto-discovery, health probing,
 * terminal lifecycle management, and 1-click connection synchronization.
 */
export class EmulatorService implements vscode.Disposable {
  private static instance: EmulatorService;
  private statusBarItem: vscode.StatusBarItem | null = null;
  private fileWatcher: vscode.FileSystemWatcher | null = null;
  private disposables: vscode.Disposable[] = [];
  private cachedConfigs: DetectedEmulatorConfig[] | null = null;
  private lastKnownOnline = false;

  private constructor() {}

  public static getInstance(): EmulatorService {
    if (!EmulatorService.instance) {
      EmulatorService.instance = new EmulatorService();
    }
    return EmulatorService.instance;
  }

  public isLastKnownOnline(): boolean {
    return this.lastKnownOnline;
  }

  /**
   * Initialize service, status bar item, watchers, and startup discovery.
   */
  public async init(context: vscode.ExtensionContext): Promise<void> {
    // 1. Status bar item
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      99
    );
    this.statusBarItem.command = "ketrik-firestore-studio.emulatorStatusMenu";
    this.statusBarItem.name = "Ketrik Firestore Studio Emulator Status";
    this.disposables.push(this.statusBarItem);

    // 2. Watcher for firebase.json and .firebaserc changes
    this.fileWatcher = vscode.workspace.createFileSystemWatcher("**/{firebase.json,.firebaserc}");
    this.fileWatcher.onDidChange(() => this.onWorkspaceConfigChanged());
    this.fileWatcher.onDidCreate(() => this.onWorkspaceConfigChanged());
    this.fileWatcher.onDidDelete(() => this.onWorkspaceConfigChanged());
    this.disposables.push(this.fileWatcher);

    // 3. Listen to terminal closures to immediately detect when emulator process is stopped
    this.disposables.push(
      vscode.window.onDidCloseTerminal((t) => {
        if (t.name === "Firebase Emulator") {
          setTimeout(() => this.refreshStatus(), 1000);
        }
      })
    );

    // 4. Initial status refresh and startup discovery
    await this.refreshStatus();
    await this.handleStartupDiscovery(context);
  }

  private async onWorkspaceConfigChanged(): Promise<void> {
    this.cachedConfigs = null;
    await this.refreshStatus();
  }

  /**
   * Scans open workspace folders and subtrees to extract Firebase emulator configurations.
   */
  public async detectWorkspaceConfigs(): Promise<DetectedEmulatorConfig[]> {
    if (this.cachedConfigs) {
      return this.cachedConfigs;
    }

    const results: DetectedEmulatorConfig[] = [];
    const folders = vscode.workspace.workspaceFolders || [];

    for (const folder of folders) {
      const firebaseJsonUri = vscode.Uri.joinPath(folder.uri, "firebase.json");
      const firebasercUri = vscode.Uri.joinPath(folder.uri, ".firebaserc");

      const hasFirebaseJson = fs.existsSync(firebaseJsonUri.fsPath);
      const hasFirebaserc = fs.existsSync(firebasercUri.fsPath);

      if (hasFirebaseJson || hasFirebaserc) {
        const config = this.parseConfigFromPaths(
          folder.uri,
          folder.uri.fsPath,
          hasFirebaseJson ? firebaseJsonUri.fsPath : undefined,
          hasFirebaserc ? firebasercUri.fsPath : undefined
        );
        if (config) {
          results.push(config);
        }
      }
    }

    // Fallback: If no root firebase.json, search workspace for nested firebase.json (monorepos)
    if (results.length === 0 && folders.length > 0) {
      try {
        const found = await vscode.workspace.findFiles("**/firebase.json", "**/node_modules/**", 3);
        for (const fileUri of found) {
          const dirPath = path.dirname(fileUri.fsPath);
          const dirUri = vscode.Uri.file(dirPath);
          const rcPath = path.join(dirPath, ".firebaserc");
          const hasRc = fs.existsSync(rcPath);
          const config = this.parseConfigFromPaths(
            dirUri,
            dirPath,
            fileUri.fsPath,
            hasRc ? rcPath : undefined
          );
          if (config) {
            results.push(config);
          }
        }
      } catch (err) {
        console.warn("[EmulatorService] Error searching for nested firebase.json:", err);
      }
    }

    this.cachedConfigs = results;
    return results;
  }

  private parseConfigFromPaths(
    rootUri: vscode.Uri,
    rootPath: string,
    firebaseJsonPath?: string,
    firebasercPath?: string
  ): DetectedEmulatorConfig | null {
    let rawJson: any = null;
    if (firebaseJsonPath && fs.existsSync(firebaseJsonPath)) {
      try {
        const raw = fs.readFileSync(firebaseJsonPath, "utf8");
        rawJson = parseJsonWithComments(raw);
      } catch (e) {
        console.warn(`[EmulatorService] Failed to parse ${firebaseJsonPath}:`, e);
      }
    }

    let projectId = "demo-project";
    if (firebasercPath && fs.existsSync(firebasercPath)) {
      try {
        const rcRaw = fs.readFileSync(firebasercPath, "utf8");
        const rcJson = parseJsonWithComments(rcRaw);
        if (rcJson?.projects?.default) {
          projectId = rcJson.projects.default;
        } else if (rcJson?.projects && typeof rcJson.projects === "object") {
          const keys = Object.keys(rcJson.projects);
          if (keys.length > 0 && rcJson.projects[keys[0]]) {
            projectId = rcJson.projects[keys[0]];
          }
        }
      } catch (e) {
        console.warn(`[EmulatorService] Failed to parse ${firebasercPath}:`, e);
      }
    }

    const emulators = rawJson?.emulators || {};
    const firestorePort = Number(emulators?.firestore?.port) || 8080;
    const firestoreHost = emulators?.firestore?.host || "127.0.0.1";
    const authPort = emulators?.auth?.port ? Number(emulators.auth.port) : 9099;
    const authHost = emulators?.auth?.host || "127.0.0.1";
    const storagePort = emulators?.storage?.port ? Number(emulators.storage.port) : 9199;
    const storageHost = emulators?.storage?.host || "127.0.0.1";
    const uiPort = emulators?.ui?.port ? Number(emulators.ui.port) : 4000;
    const uiHost = emulators?.ui?.host || "127.0.0.1";
    const uiEnabled = emulators?.ui?.enabled !== false;

    return {
      rootUri,
      rootPath,
      hasFirebaseJson: !!firebaseJsonPath,
      hasFirebaserc: !!firebasercPath,
      projectId,
      firestorePort,
      firestoreHost,
      authPort,
      authHost,
      storagePort,
      storageHost,
      uiPort,
      uiHost,
      uiEnabled,
      rawFirebaseJson: rawJson,
    };
  }

  /**
   * Get the primary or first detected emulator configuration.
   */
  public async getPrimaryConfig(): Promise<DetectedEmulatorConfig | null> {
    const configs = await this.detectWorkspaceConfigs();
    return configs.length > 0 ? configs[0] : null;
  }

  /**
   * Probe whether a given host and port are actively listening.
   */
  public async probePort(host: string, port: number, timeoutMs = 1500): Promise<boolean> {
    return probePortUtil(host, port, timeoutMs);
  }

  /**
   * Check if the Firestore emulator is currently running.
   */
  public async isEmulatorRunning(config?: DetectedEmulatorConfig | null): Promise<boolean> {
    const cfg = config !== undefined ? config : await this.getPrimaryConfig();
    const host = cfg?.firestoreHost || "127.0.0.1";
    const port = cfg?.firestorePort || 8080;
    return this.probePort(host, port);
  }

  /**
   * Refresh the status bar indicator state and tooltip.
   */
  public async refreshStatus(): Promise<void> {
    if (!this.statusBarItem) {
      return;
    }

    const vsConfig = vscode.workspace.getConfiguration("ketrik-firestore-studio");
    const showStatusBar = vsConfig.get<boolean>("showEmulatorStatusBar", true);
    if (!showStatusBar) {
      this.statusBarItem.hide();
      return;
    }

    const config = await this.getPrimaryConfig();
    const isOnline = await this.isEmulatorRunning(config);
    this.lastKnownOnline = isOnline;

    if (isOnline) {
      const host = config?.firestoreHost || "localhost";
      const port = config?.firestorePort || 8080;
      this.statusBarItem.text = `$(server-process) Emulator: ${port} (Online)`;
      this.statusBarItem.tooltip = `Firebase Local Emulator is ONLINE\nHost: ${host}:${port}\nProject: ${
        config?.projectId || "demo-project"
      }\nClick for options (Connect, Open UI, Stop)`;
      this.statusBarItem.color = new vscode.ThemeColor("charts.blue");
      this.statusBarItem.show();
    } else if (config) {
      this.statusBarItem.text = `$(server-process) Start Emulator`;
      this.statusBarItem.tooltip = `Firebase workspace detected (${config.projectId})\nClick to start local emulator suite`;
      this.statusBarItem.color = undefined;
      this.statusBarItem.show();
    } else {
      // Workspace has no firebase.json, keep status bar item hidden to avoid clutter
      this.statusBarItem.hide();
    }
  }

  /**
   * Launch the Firebase emulator in an integrated VS Code terminal and poll until ready.
   */
  public async startEmulator(
    customCommand?: string,
    targetConfig?: DetectedEmulatorConfig | null
  ): Promise<boolean> {
    const config = targetConfig !== undefined ? targetConfig : await this.getPrimaryConfig();
    const vsConfig = vscode.workspace.getConfiguration("ketrik-firestore-studio");
    const commandToRun =
      customCommand ||
      vsConfig.get<string>("emulatorStartupCommand", "firebase emulators:start");

    let terminal = vscode.window.terminals.find((t) => t.name === "Firebase Emulator");
    if (!terminal) {
      terminal = vscode.window.createTerminal({
        name: "Firebase Emulator",
        cwd: config?.rootPath,
      });
    }

    terminal.show(true);
    terminal.sendText(commandToRun);

    const host = config?.firestoreHost || "127.0.0.1";
    const port = config?.firestorePort || 8080;

    const isReady = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Starting Firebase Emulator...",
        cancellable: true,
      },
      async (progress, token) => {
        const startTime = Date.now();
        const timeoutMs = 45000;

        while (Date.now() - startTime < timeoutMs) {
          if (token.isCancellationRequested) {
            return false;
          }
          const elapsed = Math.round((Date.now() - startTime) / 1000);
          progress.report({ message: `Waiting for ${host}:${port} (${elapsed}s)...` });

          const online = await this.probePort(host, port, 1200);
          if (online) {
            return true;
          }
          await new Promise((r) => setTimeout(r, 1500));
        }
        return false;
      }
    );

    await this.refreshStatus();

    if (isReady) {
      const autoConnect = vsConfig.get<boolean>("emulatorAutoConnect", true);
      if (autoConnect) {
        await this.connectToEmulator(config);
      } else {
        vscode.window
          .showInformationMessage(
            `Firebase Emulator is now online on ${host}:${port}!`,
            "Connect in Studio",
            "Open Emulator UI"
          )
          .then((choice) => {
            if (choice === "Connect in Studio") {
              this.connectToEmulator(config);
            } else if (choice === "Open Emulator UI") {
              this.openEmulatorUi(config);
            }
          });
      }
      return true;
    } else {
      vscode.window.showWarningMessage(
        "Emulator startup command was sent, but the port timed out. Check the 'Firebase Emulator' terminal output for errors."
      );
      return false;
    }
  }

  /**
   * Stop the running emulator terminal gracefully.
   */
  public async stopEmulator(): Promise<void> {
    const terminal = vscode.window.terminals.find((t) => t.name === "Firebase Emulator");
    if (terminal) {
      terminal.sendText("\x03"); // Send SIGINT / Ctrl+C
      vscode.window.showInformationMessage("Sent stop signal (SIGINT) to Firebase Emulator terminal.");
      setTimeout(() => this.refreshStatus(), 2000);
    } else {
      vscode.window.showInformationMessage("No active 'Firebase Emulator' terminal found.");
    }
  }

  /**
   * Restart the emulator terminal.
   */
  public async restartEmulator(): Promise<void> {
    await this.stopEmulator();
    await new Promise((r) => setTimeout(r, 2000));
    await this.startEmulator();
  }

  /**
   * Open the Firebase Emulator Suite web UI in the browser.
   */
  public async openEmulatorUi(config?: DetectedEmulatorConfig | null): Promise<void> {
    const cfg = config !== undefined ? config : await this.getPrimaryConfig();
    const port = cfg?.uiPort || 4000;
    const host = cfg?.uiHost || "localhost";
    const url = `http://${host}:${port}`;
    try {
      await vscode.env.openExternal(vscode.Uri.parse(url));
    } catch (e: any) {
      vscode.window.showErrorMessage(`Failed to open Emulator UI: ${e.message}`);
    }
  }

  /**
   * Connect to the detected emulator, automatically creating or selecting
   * the connection in ConnectionManager without manual data entry.
   */
  public async connectToEmulator(
    config?: DetectedEmulatorConfig | null
  ): Promise<FirestoreConnectionConfig> {
    const cfg = config !== undefined && config !== null ? config : await this.getPrimaryConfig();
    const hostPort = `${cfg?.firestoreHost || "127.0.0.1"}:${cfg?.firestorePort || 8080}`;
    const authHostPort = cfg?.authPort
      ? `${cfg.authHost || "127.0.0.1"}:${cfg.authPort}`
      : undefined;
    const projectId = cfg?.projectId || "demo-project";

    const connectionManager = ConnectionManager.getInstance();
    const existing = connectionManager.getConnections().find(
      (c) =>
        c.isEmulator &&
        (c.emulatorHost === hostPort ||
          c.emulatorHost === `localhost:${cfg?.firestorePort || 8080}`)
    );

    if (existing) {
      vscode.window
        .showInformationMessage(
          `Connected to existing emulator connection '${existing.name}' (${hostPort}).`,
          "Open Emulator UI"
        )
        .then((choice) => {
          if (choice === "Open Emulator UI") {
            this.openEmulatorUi(cfg);
          }
        });
      await vscode.commands.executeCommand("ketrik-firestore-studio.refreshExplorer");
      await this.refreshStatus();
      return existing;
    }

    const newConnection: FirestoreConnectionConfig = {
      id: `conn_emulator_${Date.now()}`,
      name: `Local Emulator (${cfg?.firestorePort || 8080})`,
      isEmulator: true,
      emulatorHost: hostPort,
      authEmulatorHost: authHostPort,
      projectId: projectId,
      databaseId: "(default)",
    };

    await connectionManager.addConnection(newConnection);
    vscode.window
      .showInformationMessage(
        `Local Firestore Emulator '${newConnection.name}' connected!`,
        "Open Emulator UI"
      )
      .then((choice) => {
        if (choice === "Open Emulator UI") {
          this.openEmulatorUi(cfg);
        }
      });

    await vscode.commands.executeCommand("ketrik-firestore-studio.refreshExplorer");
    await this.refreshStatus();
    return newConnection;
  }

  /**
   * Discover running emulators in workspace or probe default port and prompt user.
   */
  public async discoverAndConnect(promptIfNotFound = true): Promise<void> {
    const configs = await this.detectWorkspaceConfigs();
    if (configs.length === 0) {
      // Check default localhost:8080 anyway
      const isUp = await this.probePort("127.0.0.1", 8080);
      if (isUp) {
        await this.connectToEmulator();
        return;
      }
      if (promptIfNotFound) {
        const choice = await vscode.window.showInformationMessage(
          "No firebase.json found and port 8080 is not listening. Would you like to start the Firebase emulator?",
          "Start Emulator",
          "Cancel"
        );
        if (choice === "Start Emulator") {
          await this.startEmulator();
        }
      }
      return;
    }

    const target = configs[0];
    const isUp = await this.probePort(target.firestoreHost, target.firestorePort);
    if (isUp) {
      await this.connectToEmulator(target);
    } else {
      const choice = await vscode.window.showInformationMessage(
        `Firebase config detected (${target.projectId}), but emulator on ${target.firestoreHost}:${target.firestorePort} is not running.`,
        "Start Emulator",
        "Connect Anyway",
        "Cancel"
      );
      if (choice === "Start Emulator") {
        await this.startEmulator(undefined, target);
      } else if (choice === "Connect Anyway") {
        await this.connectToEmulator(target);
      }
    }
  }

  /**
   * Interactive QuickPick menu with status overview and emulator actions.
   */
  public async showStatusMenu(): Promise<void> {
    const config = await this.getPrimaryConfig();
    const isRunning = await this.isEmulatorRunning(config);
    const host = config?.firestoreHost || "127.0.0.1";
    const port = config?.firestorePort || 8080;
    const projectId = config?.projectId || "demo-project";
    const uiPort = config?.uiPort || 4000;

    const items: (vscode.QuickPickItem & { action: string })[] = [];

    if (isRunning) {
      items.push({
        label: `$(pass-filled) Emulator Online (${host}:${port})`,
        description: `Project: ${projectId}`,
        detail: "Firestore Emulator is actively listening",
        action: "none",
      });
      items.push({
        label: "$(plug) Connect in Firestore Studio",
        description: "Auto-provision connection in Explorer view",
        action: "connect",
      });
      items.push({
        label: `$(browser) Open Emulator Suite UI`,
        description: `http://localhost:${uiPort}`,
        action: "openUi",
      });
      items.push({
        label: "$(sync) Restart Emulator",
        description: "Stop and relaunch emulator terminal",
        action: "restart",
      });
      items.push({
        label: "$(stop) Stop Emulator",
        description: "Send stop signal to terminal",
        action: "stop",
      });
    } else {
      items.push({
        label: `$(circle-slash) Emulator Stopped`,
        description: config
          ? `Configured for ${host}:${port} (${projectId})`
          : "Port 8080 not listening",
        detail: "Select an option below to launch or connect",
        action: "none",
      });
      items.push({
        label: "$(play) Start Firebase Emulator Process",
        description: "Launch emulator in integrated VS Code terminal",
        action: "start",
      });
      items.push({
        label: "$(play-circle) Start Firestore & Auth Only",
        description: "firebase emulators:start --only firestore,auth",
        action: "start_minimal",
      });
      items.push({
        label: "$(plug) Connect Client Endpoint (Without Starting)",
        description: `Add or activate client connection to ${host}:${port}`,
        action: "connect",
      });
    }

    items.push({
      label: "$(search) Re-Scan Workspace Config",
      description: "Inspect firebase.json and .firebaserc",
      action: "rescan",
    });

    items.push({
      label: "$(gear) Configure Emulator Settings...",
      description: "Open Ketrik Firestore Studio settings",
      action: "settings",
    });

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: `Firebase Emulator (${isRunning ? "Online" : "Stopped"})`,
    });

    if (!selected || selected.action === "none") {
      return;
    }

    switch (selected.action) {
      case "connect":
        await this.connectToEmulator(config);
        break;
      case "start":
        await this.startEmulator(undefined, config);
        break;
      case "start_minimal":
        await this.startEmulator("firebase emulators:start --only firestore,auth", config);
        break;
      case "stop":
        await this.stopEmulator();
        break;
      case "restart":
        await this.restartEmulator();
        break;
      case "openUi":
        await this.openEmulatorUi(config);
        break;
      case "rescan":
        this.cachedConfigs = null;
        await this.refreshStatus();
        vscode.window.showInformationMessage("Workspace emulator configuration refreshed.");
        break;
      case "settings":
        vscode.commands.executeCommand(
          "workbench.action.openSettings",
          "ketrik-firestore-studio.emulator"
        );
        break;
    }
  }

  /**
   * Handler executed during startup to prompt or auto-connect when appropriate.
   */
  public async handleStartupDiscovery(context: vscode.ExtensionContext): Promise<void> {
    const vsConfig = vscode.workspace.getConfiguration("ketrik-firestore-studio");
    const autoDiscover = vsConfig.get<boolean>("autoDiscoverEmulators", true);
    if (!autoDiscover) {
      return;
    }

    const config = await this.getPrimaryConfig();
    if (!config) {
      return;
    }

    const isRunning = await this.isEmulatorRunning(config);
    if (isRunning) {
      const autoConnect = vsConfig.get<boolean>("emulatorAutoConnect", true);
      const existing = ConnectionManager.getInstance()
        .getConnections()
        .find(
          (c) =>
            c.isEmulator &&
            (c.emulatorHost === `${config.firestoreHost}:${config.firestorePort}` ||
              c.emulatorHost === `localhost:${config.firestorePort}`)
        );

      if (!existing && autoConnect) {
        await this.connectToEmulator(config);
      } else if (!existing) {
        const choice = await vscode.window.showInformationMessage(
          `Local Firebase Emulator detected running on ${config.firestoreHost}:${config.firestorePort} (${config.projectId}).`,
          "Connect Now",
          "Always Auto-Connect",
          "Dismiss"
        );
        if (choice === "Connect Now") {
          await this.connectToEmulator(config);
        } else if (choice === "Always Auto-Connect") {
          await vsConfig.update("emulatorAutoConnect", true, vscode.ConfigurationTarget.Global);
          await this.connectToEmulator(config);
        }
      }
    } else {
      const promptKey = `dismissed_emulator_prompt_${config.rootPath}`;
      const dismissed = context.globalState.get<boolean>(promptKey, false);
      const promptStart = vsConfig.get<boolean>("promptStartEmulator", true);

      if (promptStart && !dismissed) {
        const choice = await vscode.window.showInformationMessage(
          `Firebase configuration detected in workspace (${config.projectId}). Would you like to start the Local Emulator?`,
          "Start Emulator",
          "Don't Ask Again"
        );
        if (choice === "Start Emulator") {
          await this.startEmulator(undefined, config);
        } else if (choice === "Don't Ask Again") {
          await context.globalState.update(promptKey, true);
        }
      }
    }
  }

  public dispose(): void {
    if (this.fileWatcher) {
      this.fileWatcher.dispose();
    }
    if (this.statusBarItem) {
      this.statusBarItem.dispose();
    }
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }
}

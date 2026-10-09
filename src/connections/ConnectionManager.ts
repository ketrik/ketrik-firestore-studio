import { App, initializeApp, getApps, deleteApp, cert } from "firebase-admin/app";
import { Firestore, getFirestore } from "firebase-admin/firestore";
import * as vscode from "vscode";
import * as fs from "fs";

export interface FirestoreConnectionConfig {
  id: string;
  name: string;
  serviceAccountKeyPath?: string;
  projectId?: string;
  databaseId?: string;
  isEmulator?: boolean;
  emulatorHost?: string;
}

export class ConnectionManager implements vscode.Disposable {
  private static instance: ConnectionManager;
  private _onDidChangeConnections = new vscode.EventEmitter<void>();
  readonly onDidChangeConnections = this._onDidChangeConnections.event;

  private firestoreInstances = new Map<string, Firestore>();
  /** In-flight initialization promises – prevents duplicate initializeApp calls under concurrency. */
  private _initInFlight = new Map<string, Promise<Firestore>>();

  /**
   * Cache the connections array so we don't call getConfiguration()
   * on every getConnections() / getConnection() invocation.  Invalidated
   * whenever the VS Code configuration changes or saveConnections() is called.
   */
  private _cachedConnections: FirestoreConnectionConfig[] | null = null;
  private _configListener: vscode.Disposable;

  private constructor() {
    // Invalidate the connection cache whenever the user changes settings.
    this._configListener = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("ketrik-firestore-studio")) {
        this._cachedConnections = null;
      }
    });

    this.migrateLegacyConfigIfNeeded();
  }

  public static getInstance(): ConnectionManager {
    if (!ConnectionManager.instance) {
      ConnectionManager.instance = new ConnectionManager();
    }
    return ConnectionManager.instance;
  }

  /**
   * Terminate all active Firestore instances and Firebase apps cleanly.
   */
  public async dispose(): Promise<void> {
    this._configListener.dispose();
    this._onDidChangeConnections.dispose();
    this._cachedConnections = null;
    this._initInFlight.clear();

    const ids = Array.from(this.firestoreInstances.keys());
    for (const id of ids) {
      await this._cleanupInstance(id);
    }
    this.firestoreInstances.clear();
  }

  private async _cleanupInstance(id: string): Promise<void> {
    const firestore = this.firestoreInstances.get(id);
    if (firestore) {
      try {
        await firestore.terminate();
      } catch {}
      this.firestoreInstances.delete(id);
    }
    this._initInFlight.delete(id);

    const appName = `firestore-app-${id}`;
    const existingApp = getApps().find((app) => app?.name === appName);
    if (existingApp) {
      try {
        await deleteApp(existingApp);
      } catch {}
    }
  }

  private async migrateLegacyConfigIfNeeded(): Promise<void> {
    const config = vscode.workspace.getConfiguration("ketrik-firestore-studio");
    const connections = config.get<FirestoreConnectionConfig[]>("connections") || [];
    const legacyPath = config.get<string>("serviceAccountKeyPath");

    if (connections.length === 0 && legacyPath && legacyPath.trim() !== "") {
      const defaultConnection: FirestoreConnectionConfig = {
        id: "default",
        name: "Default Connection",
        serviceAccountKeyPath: legacyPath.trim(),
      };
      await config.update("connections", [defaultConnection], vscode.ConfigurationTarget.Global);
      this._cachedConnections = null;
      this._onDidChangeConnections.fire();
    }
  }

  public getConnections(): FirestoreConnectionConfig[] {
    if (this._cachedConnections !== null) {
      return this._cachedConnections;
    }
    const config = vscode.workspace.getConfiguration("ketrik-firestore-studio");
    this._cachedConnections = config.get<FirestoreConnectionConfig[]>("connections") || [];
    return this._cachedConnections;
  }

  public getConnection(id: string): FirestoreConnectionConfig | undefined {
    return this.getConnections().find((c) => c.id === id);
  }

  public async saveConnections(connections: FirestoreConnectionConfig[]): Promise<void> {
    const config = vscode.workspace.getConfiguration("ketrik-firestore-studio");
    await config.update("connections", connections, vscode.ConfigurationTarget.Global);

    // Clean up instances that are no longer in the connections list
    const currentIds = new Set(connections.map((c) => c.id));
    for (const id of Array.from(this.firestoreInstances.keys())) {
      if (!currentIds.has(id)) {
        await this._cleanupInstance(id);
      }
    }

    // Invalidate cached instances and connection list.
    this._cachedConnections = null;
    this._onDidChangeConnections.fire();
  }

  public async addConnection(conn: FirestoreConnectionConfig): Promise<void> {
    const connections = this.getConnections();
    // Check for duplicate ID
    if (connections.some((c) => c.id === conn.id)) {
      conn.id = `${conn.id}_${Date.now()}`;
    }
    connections.push(conn);
    await this.saveConnections(connections);
  }

  public async updateConnection(conn: FirestoreConnectionConfig): Promise<void> {
    const connections = this.getConnections();
    const index = connections.findIndex((c) => c.id === conn.id);
    if (index !== -1) {
      connections[index] = conn;
      await this._cleanupInstance(conn.id);
      await this.saveConnections(connections);
    }
  }

  public async deleteConnection(id: string): Promise<void> {
    const connections = this.getConnections().filter((c) => c.id !== id);
    await this._cleanupInstance(id);
    await this.saveConnections(connections);
  }

  public getFirestore(connectionId?: string): Promise<Firestore> {
    const connections = this.getConnections();
    if (connections.length === 0) {
      return Promise.reject(new Error("No Firestore connections configured. Please add a connection first."));
    }

    const conn = connectionId
      ? connections.find((c) => c.id === connectionId)
      : connections[0];

    if (!conn) {
      return Promise.reject(new Error(`Connection with ID '${connectionId}' not found.`));
    }

    // Fast path: already initialised.
    const cached = this.firestoreInstances.get(conn.id);
    if (cached) {
      return Promise.resolve(cached);
    }

    // Deduplicate concurrent initialisations for the same connection.
    const inFlight = this._initInFlight.get(conn.id);
    if (inFlight) {
      return inFlight;
    }

    const promise = this._initFirestore(conn).then((firestore) => {
      this.firestoreInstances.set(conn.id, firestore);
      this._initInFlight.delete(conn.id);
      return firestore;
    }).catch((err) => {
      // Allow retry on next call.
      this._initInFlight.delete(conn.id);
      throw err;
    });

    this._initInFlight.set(conn.id, promise);
    return promise;
  }

  /**
   * Create/get the Firestore instance for an app. Emulator connections are pointed at their host
   * through per-instance settings, so no process-wide environment variable is touched and
   * emulator and production connections can coexist.
   */
  private _openFirestore(app: App, conn: FirestoreConnectionConfig): Firestore {
    const databaseId = conn.databaseId && conn.databaseId !== "(default)" ? conn.databaseId : undefined;
    const firestore = databaseId ? getFirestore(app, databaseId) : getFirestore(app);

    if (conn.isEmulator) {
      try {
        firestore.settings({ host: conn.emulatorHost || "localhost:8080", ssl: false });
      } catch {
        // settings() may only be called once, before first use – an already configured
        // instance (e.g. after a hot-reload) is reused as is.
      }
    }

    return firestore;
  }

  private async _initFirestore(conn: FirestoreConnectionConfig): Promise<Firestore> {
    const appName = `firestore-app-${conn.id}`;
    // Guard against the app already existing (e.g. after a hot-reload).
    let app = getApps().find((a) => a?.name === appName);

    if (!app) {
      if (conn.isEmulator) {
        app = initializeApp(
          {
            projectId: conn.projectId || "demo-project",
          },
          appName
        );
      } else {
        if (!conn.serviceAccountKeyPath) {
          throw new Error(`Service account key path missing for connection '${conn.name}'.`);
        }
        if (!fs.existsSync(conn.serviceAccountKeyPath)) {
          throw new Error(`Service account key file not found: ${conn.serviceAccountKeyPath}`);
        }

        const serviceAccountContent = await fs.promises.readFile(conn.serviceAccountKeyPath, "utf8");
        const serviceAccount = JSON.parse(serviceAccountContent);

        app = initializeApp(
          {
            credential: cert(serviceAccount),
            projectId: conn.projectId || serviceAccount.project_id,
          },
          appName
        );
      }
    }

    return this._openFirestore(app, conn);
  }

  public async testConnection(conn: FirestoreConnectionConfig): Promise<{ success: boolean; message?: string }> {
    let testApp: App | undefined;
    try {
      const tempAppName = `test-conn-${Date.now()}`;

      if (conn.isEmulator) {
        testApp = initializeApp(
          {
            projectId: conn.projectId || "demo-project",
          },
          tempAppName
        );
      } else {
        if (!conn.serviceAccountKeyPath || !fs.existsSync(conn.serviceAccountKeyPath)) {
          return { success: false, message: `File does not exist: ${conn.serviceAccountKeyPath}` };
        }
        const serviceAccount = JSON.parse(
          await fs.promises.readFile(conn.serviceAccountKeyPath, "utf8")
        );
        testApp = initializeApp(
          {
            credential: cert(serviceAccount),
            projectId: conn.projectId || serviceAccount.project_id,
          },
          tempAppName
        );
      }

      const firestore = this._openFirestore(testApp, conn);
      await firestore.listCollections();
      return { success: true };
    } catch (err: any) {
      return { success: false, message: err.message };
    } finally {
      if (testApp) {
        try {
          await deleteApp(testApp);
        } catch {}
      }
    }
  }
}

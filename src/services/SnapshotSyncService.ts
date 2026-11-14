import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as crypto from "crypto";

export interface SnapshotBinding {
  filePath: string;
  connectionId: string;
  docPath: string;
  fieldPath?: string;
  lastSyncedAt?: number;
  lastSyncedHash?: string;
}

interface StoredSnapshotRegistry {
  version: number;
  snapshots: Record<string, Omit<SnapshotBinding, "filePath">>;
}

export class SnapshotSyncService {
  private static _instance: SnapshotSyncService;
  private _bindings: Map<string, SnapshotBinding> = new Map();
  private _statusBarItem: vscode.StatusBarItem;
  private _disposables: vscode.Disposable[] = [];
  private _gitignoreVerified = false;

  public static getInstance(): SnapshotSyncService {
    if (!SnapshotSyncService._instance) {
      SnapshotSyncService._instance = new SnapshotSyncService();
    }
    return SnapshotSyncService._instance;
  }

  private constructor() {
    this._statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this._statusBarItem.name = "Firestore Snapshot Sync";
    this.loadRegistry();

    // Auto-sync watcher: When a tracked snapshot file is saved, optionally auto-push to Firestore
    this._disposables.push(
      vscode.workspace.onDidSaveTextDocument(async (doc) => {
        if (doc.uri.scheme !== "file") return;
        const binding = this.getBinding(doc.uri);
        if (!binding) return;

        const config = vscode.workspace.getConfiguration("ketrik-firestore-studio");
        const autoSync = config.get<boolean>("autoSyncLocalSnapshots", true);
        if (autoSync) {
          const { ConnectionManager } = await import("../connections/ConnectionManager.js");
          const conn = ConnectionManager.getInstance().getConnection(binding.connectionId);
          if (conn?.readOnly) {
            vscode.window.showWarningMessage(
              `Auto-sync skipped: connection '${conn.name}' is in Read-Only mode.`
            );
            return;
          }
          await vscode.commands.executeCommand(
            "ketrik-firestore-studio.pushSnapshotToFirestore",
            doc.uri,
            true /* silent */
          );
        }
      })
    );
  }

  public static computeHash(content: string): string {
    return crypto.createHash("sha256").update(content, "utf8").digest("hex");
  }

  private normalizePath(p: string): string {
    const resolved = path.resolve(p);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  }

  private getRegistryPath(): string | undefined {
    const ws = vscode.workspace.workspaceFolders?.[0];
    if (!ws) {
      return undefined;
    }
    return path.join(ws.uri.fsPath, ".firestore", "snapshots.json");
  }

  /**
   * Generates a clean, deterministic, collision-free workspace file path for any document or field.
   * Format: <workspaceRoot>/.firestore/<connectionId>/<collectionPath>/<docId>/[<fieldPath>.json]
   */
  public getDeterministicSnapshotPath(
    connectionId: string,
    docPath: string,
    fieldPath?: string
  ): string {
    const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
    const safeConn = connectionId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const baseDir = path.resolve(wsRoot, ".firestore", safeConn);
    const sanitizeSegment = (s: string) => (s === "." || s === ".." ? "_" : s.replace(/[\\/:*?"<>|]/g, "_"));

    if (fieldPath) {
      const safeDocSegments = docPath.split("/").filter(Boolean).map(sanitizeSegment);
      const safeField = sanitizeSegment(fieldPath);
      const resolved = path.resolve(baseDir, ...safeDocSegments, `${safeField}.json`);
      if (!resolved.startsWith(baseDir + path.sep)) {
        throw new Error("Invalid snapshot path outside .firestore directory.");
      }
      return resolved;
    }

    const segments = docPath.split("/").filter(Boolean).map(sanitizeSegment);
    const docId = segments.pop() || "document";
    const resolved = path.resolve(baseDir, ...segments, `${docId}.json`);
    if (!resolved.startsWith(baseDir + path.sep)) {
      throw new Error("Invalid snapshot path outside .firestore directory.");
    }
    return resolved;
  }

  /**
   * Automatically creates or updates the workspace .firestore/ mirror for a virtual document or field.
   * Runs non-blockingly in the background so that AI agents always have a physical file ready.
   */
  public async mirrorVirtualDocument(
    connectionId: string,
    docPath: string,
    fieldPath: string | undefined,
    data: any
  ): Promise<string | undefined> {
    const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!wsRoot) return undefined;

    const config = vscode.workspace.getConfiguration("ketrik-firestore-studio");
    if (!config.get<boolean>("autoMirrorVirtualDocuments", false)) {
      return undefined;
    }

    try {
      const filePath = this.getDeterministicSnapshotPath(connectionId, docPath, fieldPath);
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const jsonText = JSON.stringify(data ?? {}, null, 2) + "\n";
      const newHash = SnapshotSyncService.computeHash(jsonText);
      const existing = this.getBinding(vscode.Uri.file(filePath));
      if (existing && existing.lastSyncedHash === newHash && fs.existsSync(filePath)) {
        return filePath;
      }

      fs.writeFileSync(filePath, jsonText, "utf8");
      this.ensureGitignored();

      await this.saveBinding({
        filePath,
        connectionId,
        docPath,
        fieldPath,
        lastSyncedAt: Date.now(),
        lastSyncedHash: newHash,
      });

      return filePath;
    } catch {
      return undefined;
    }
  }

  public loadRegistry(): void {
    this._bindings.clear();
    const registryPath = this.getRegistryPath();
    if (!registryPath || !fs.existsSync(registryPath)) {
      return;
    }

    try {
      const raw = fs.readFileSync(registryPath, "utf-8");
      const data: StoredSnapshotRegistry = JSON.parse(raw);
      if (data && typeof data.snapshots === "object") {
        const wsRoot = vscode.workspace.workspaceFolders![0].uri.fsPath;
        for (const [relPath, meta] of Object.entries(data.snapshots)) {
          const absPath = path.isAbsolute(relPath)
            ? relPath
            : path.join(wsRoot, relPath);
          const normalizedKey = this.normalizePath(absPath);
          this._bindings.set(normalizedKey, {
            filePath: absPath,
            connectionId: meta.connectionId,
            docPath: meta.docPath,
            fieldPath: (meta as any).fieldPath,
            lastSyncedAt: meta.lastSyncedAt,
            lastSyncedHash: meta.lastSyncedHash,
          });
        }
      }
    } catch {}
  }

  public async saveRegistry(): Promise<void> {
    const registryPath = this.getRegistryPath();
    if (!registryPath) {
      return;
    }

    try {
      const dir = path.dirname(registryPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      this.ensureGitignored();

      const wsRoot = vscode.workspace.workspaceFolders![0].uri.fsPath;
      const storedSnapshots: Record<string, Omit<SnapshotBinding, "filePath">> = {};

      for (const binding of this._bindings.values()) {
        const rel = path.relative(wsRoot, binding.filePath);
        storedSnapshots[rel] = {
          connectionId: binding.connectionId,
          docPath: binding.docPath,
          fieldPath: binding.fieldPath,
          lastSyncedAt: binding.lastSyncedAt,
          lastSyncedHash: binding.lastSyncedHash,
        };
      }

      const payload: StoredSnapshotRegistry = {
        version: 1,
        snapshots: storedSnapshots,
      };

      fs.writeFileSync(registryPath, JSON.stringify(payload, null, 2), "utf-8");
    } catch {}
  }

  public ensureGitignored(): void {
    if (this._gitignoreVerified) return;
    const ws = vscode.workspace.workspaceFolders?.[0];
    if (!ws) return;
    const gitignorePath = path.join(ws.uri.fsPath, ".gitignore");
    if (!fs.existsSync(gitignorePath)) return;

    try {
      const content = fs.readFileSync(gitignorePath, "utf-8");
      if (!content.includes(".firestore/")) {
        fs.appendFileSync(
          gitignorePath,
          "\n# Firestore Studio local metadata and snapshots\n.firestore/\n",
          "utf-8"
        );
      }
      this._gitignoreVerified = true;
    } catch {}
  }

  public getBinding(uriOrPath: vscode.Uri | string): SnapshotBinding | undefined {
    const fsPath = typeof uriOrPath === "string" ? uriOrPath : uriOrPath.fsPath;
    if (!fsPath) return undefined;
    return this._bindings.get(this.normalizePath(fsPath));
  }

  public async saveBinding(binding: SnapshotBinding): Promise<void> {
    const normalized = this.normalizePath(binding.filePath);
    this._bindings.set(normalized, { ...binding, filePath: path.resolve(binding.filePath) });
    await this.saveRegistry();
    this.updateContextForEditor(vscode.window.activeTextEditor);
  }

  public async removeBinding(uriOrPath: vscode.Uri | string): Promise<void> {
    const fsPath = typeof uriOrPath === "string" ? uriOrPath : uriOrPath.fsPath;
    if (!fsPath) return;
    const normalized = this.normalizePath(fsPath);
    this._bindings.delete(normalized);
    await this.saveRegistry();
    this.updateContextForEditor(vscode.window.activeTextEditor);
  }

  public async clearAllBindings(): Promise<void> {
    this._bindings.clear();
    const registryPath = this.getRegistryPath();
    if (registryPath && fs.existsSync(registryPath)) {
      try {
        fs.unlinkSync(registryPath);
      } catch {}
    }
    this.updateContextForEditor(vscode.window.activeTextEditor);
  }

  public listBindings(): SnapshotBinding[] {
    return Array.from(this._bindings.values());
  }

  public updateContextForEditor(editor?: vscode.TextEditor): void {
    if (!editor || !editor.document || editor.document.uri.scheme !== "file") {
      vscode.commands.executeCommand("setContext", "ketrik-firestore-studio.isSnapshotFile", false);
      this._statusBarItem.hide();
      return;
    }

    const binding = this.getBinding(editor.document.uri);
    if (binding) {
      vscode.commands.executeCommand("setContext", "ketrik-firestore-studio.isSnapshotFile", true);
      const label = binding.fieldPath
        ? `${binding.docPath}#${binding.fieldPath}`
        : binding.docPath;
      this._statusBarItem.text = `$(cloud-upload) Firestore Snapshot: [${binding.connectionId}] ${label}`;
      this._statusBarItem.tooltip = `Bound to Firestore: [${binding.connectionId}] ${label}\nClick for snapshot actions (Push, Pull, Compare Diff)`;
      this._statusBarItem.command = "ketrik-firestore-studio.snapshotActionsMenu";
      this._statusBarItem.show();
    } else {
      vscode.commands.executeCommand("setContext", "ketrik-firestore-studio.isSnapshotFile", false);
      this._statusBarItem.hide();
    }
  }

  public dispose(): void {
    this._statusBarItem.dispose();
    for (const d of this._disposables) {
      d.dispose();
    }
    this._disposables = [];
    this._bindings.clear();
  }
}

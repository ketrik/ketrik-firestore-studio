import { createHash } from "crypto";
import * as vscode from "vscode";
import { ConnectionManager } from "../connections/ConnectionManager";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface ParsedDocumentUri {
  connectionId: string;
  docPath: string;
  fieldPath?: string;
}

/**
 * Custom File System provider that allows interacting with Firestore documents and
 * their sub-fields/root-variables as virtual files in the editor, supporting multiple connections.
 */
export class DocumentFileSystemProvider implements vscode.FileSystemProvider, vscode.Disposable {
  private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();

  readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> =
    this._emitter.event;

  /** In-flight / short-lived document snapshot cache to deduplicate stat() followed immediately by readFile(). */
  private _snapshotCache = new Map<string, { snapshot: import("firebase-admin/firestore").DocumentSnapshot; timestamp: number }>();
  private _snapshotInFlight = new Map<string, Promise<import("firebase-admin/firestore").DocumentSnapshot>>();

  /** Version (update time + content hash) each open file was last loaded/saved with, for conflict detection. */
  private _baselines = new Map<string, { updateTime: string; hash: string }>();
  private static readonly MAX_BASELINES = 200;

  dispose(): void {
    this._emitter.dispose();
    this._snapshotCache.clear();
    this._snapshotInFlight.clear();
    this._baselines.clear();
  }

  private getCacheTTL(): number {
    const seconds = vscode.workspace
      .getConfiguration("ketrik-firestore-studio")
      .get<number>("cacheTTLSeconds", 30);
    return Math.max(0, seconds) * 1000;
  }

  private async getCachedSnapshot(
    connectionId: string,
    docPath: string
  ): Promise<import("firebase-admin/firestore").DocumentSnapshot> {
    const key = `${connectionId}:${docPath}`;
    const now = Date.now();
    const ttl = this.getCacheTTL();
    const cached = this._snapshotCache.get(key);
    if (cached && now - cached.timestamp < ttl) {
      return cached.snapshot;
    }

    const inFlight = this._snapshotInFlight.get(key);
    if (inFlight) {
      return inFlight;
    }

    const firestore = await ConnectionManager.getInstance().getFirestore(connectionId);
    const promise: Promise<import("firebase-admin/firestore").DocumentSnapshot> = firestore
      .doc(docPath)
      .get()
      .then((snapshot) => {
        // Only cache if this request has not been invalidated (e.g. by a write) meanwhile.
        if (this._snapshotInFlight.get(key) === promise) {
          this._snapshotInFlight.delete(key);
          const timestamp = Date.now();
          if (ttl > 0) {
            this._snapshotCache.set(key, { snapshot, timestamp });
            // Evict after TTL so the cache cannot grow unbounded.
            const timer = setTimeout(() => {
              if (this._snapshotCache.get(key)?.timestamp === timestamp) {
                this._snapshotCache.delete(key);
              }
            }, ttl);
            timer.unref?.();
          }
        }
        return snapshot;
      })
      .catch((err) => {
        if (this._snapshotInFlight.get(key) === promise) {
          this._snapshotInFlight.delete(key);
        }
        throw err;
      });

    this._snapshotInFlight.set(key, promise);
    return promise;
  }

  watch(_uri: vscode.Uri): vscode.Disposable {
    return new vscode.Disposable(() => {});
  }

  public parseUri(uri: vscode.Uri): ParsedDocumentUri {
    const connectionManager = ConnectionManager.getInstance();
    const connections = connectionManager.getConnections();

    let connectionId = uri.authority;
    let pathStr = uri.path.startsWith("/") ? uri.path.slice(1) : uri.path;

    // Strip trailing .json if present
    if (pathStr.endsWith(".json")) {
      pathStr = pathStr.slice(0, -5);
    }

    if (!connectionId) {
      // Check if first segment of path is connectionId
      const parts = pathStr.split("/");
      if (connections.some((c) => c.id === parts[0])) {
        connectionId = parts[0];
        pathStr = parts.slice(1).join("/");
      } else {
        connectionId = connections[0]?.id || "default";
      }
    }

    const segments = pathStr.split("/").filter(Boolean);
    // Firestore doc paths always have an even number of segments (coll/doc or coll/doc/subcoll/subdoc).
    // If the path has an odd number >= 3, the trailing segment is a targeted fieldPath!
    if (segments.length % 2 === 1 && segments.length >= 3) {
      const fieldPath = decodeURIComponent(segments.pop()!);
      const docPath = segments.join("/");
      return { connectionId, docPath, fieldPath };
    }

    return { connectionId, docPath: segments.join("/") };
  }

  private serializeDoc(data: any): Uint8Array {
    return encoder.encode(JSON.stringify(data ?? {}, null, 2));
  }

  /**
   * Return document (or field) metadata. Confirms whether the document/field exists.
   */
  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const { connectionId, docPath, fieldPath } = this.parseUri(uri);
    const doc = await this.getCachedSnapshot(connectionId, docPath);
    const now = Date.now();

    if (!doc.exists) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }

    if (fieldPath !== undefined) {
      const data = doc.data();
      if (!data || !(fieldPath in data)) {
        throw vscode.FileSystemError.FileNotFound(uri);
      }
    }

    return {
      type: vscode.FileType.File,
      ctime: doc.createTime ? doc.createTime.toMillis() : now,
      mtime: doc.updateTime ? doc.updateTime.toMillis() : now,
      size: 0,
    };
  }

  readDirectory(
    _uri: vscode.Uri
  ): [string, vscode.FileType][] | Thenable<[string, vscode.FileType][]> {
    throw new Error("Read Directory Method not implemented.");
  }

  createDirectory(_uri: vscode.Uri): void | Thenable<void> {
    throw new Error("Create Directory Method not implemented.");
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const { connectionId, docPath, fieldPath } = this.parseUri(uri);
    const doc = await this.getCachedSnapshot(connectionId, docPath);

    if (!doc.exists) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }

    const data = doc.data() ?? {};
    if (fieldPath !== undefined) {
      if (!(fieldPath in data)) {
        throw vscode.FileSystemError.FileNotFound(uri);
      }
      const bytes = this.serializeDoc(data[fieldPath]);
      this.rememberBaseline(uri, doc.updateTime, bytes);
      return bytes;
    }

    const bytes = this.serializeDoc(data);
    this.rememberBaseline(uri, doc.updateTime, bytes);
    return bytes;
  }

  /** Remember which version of a file the editor loaded, so saves can detect remote changes. */
  private rememberBaseline(
    uri: vscode.Uri,
    updateTime: import("firebase-admin/firestore").Timestamp | undefined,
    bytes: Uint8Array
  ): void {
    const key = uri.toString();
    this._baselines.delete(key); // re-insert to keep Map order = recency
    this._baselines.set(key, {
      updateTime: updateTime ? `${updateTime.seconds}.${updateTime.nanoseconds}` : "",
      hash: createHash("sha1").update(bytes).digest("hex"),
    });
    if (this._baselines.size > DocumentFileSystemProvider.MAX_BASELINES) {
      const oldest = this._baselines.keys().next().value;
      if (oldest !== undefined) {
        this._baselines.delete(oldest);
      }
    }
  }

  /**
   * Before saving, fetch a fresh copy (bypassing the cache) and compare it with the version the
   * editor loaded. If the document changed remotely meanwhile, ask before overwriting.
   */
  private async confirmNoRemoteChange(
    uri: vscode.Uri,
    firestore: import("firebase-admin/firestore").Firestore,
    docPath: string,
    fieldPath: string | undefined
  ): Promise<void> {
    const baseline = this._baselines.get(uri.toString());
    if (!baseline) {
      return;
    }

    const fresh = await firestore.doc(docPath).get();
    const freshTime = fresh.updateTime ? `${fresh.updateTime.seconds}.${fresh.updateTime.nanoseconds}` : "";
    if (fresh.exists && freshTime === baseline.updateTime) {
      return; // unchanged
    }

    if (fresh.exists && fieldPath !== undefined) {
      // Field-level edit: ignore changes to other fields.
      const data = fresh.data() ?? {};
      const freshHash =
        fieldPath in data
          ? createHash("sha1").update(this.serializeDoc(data[fieldPath])).digest("hex")
          : "";
      if (freshHash === baseline.hash) {
        return;
      }
    }

    const choice = await vscode.window.showWarningMessage(
      fresh.exists
        ? `"${docPath}" was modified in Firestore after you opened it. Overwrite the remote changes?`
        : `"${docPath}" no longer exists in Firestore. Save anyway?`,
      { modal: true },
      "Overwrite"
    );
    if (choice !== "Overwrite") {
      throw vscode.FileSystemError.Unavailable("Save cancelled: the document changed remotely.");
    }
  }

  async writeFile(
    uri: vscode.Uri,
    content: Uint8Array,
    _options: { readonly create: boolean; readonly overwrite: boolean }
  ): Promise<void> {
    const { connectionId, docPath, fieldPath } = this.parseUri(uri);
    const firestore = await ConnectionManager.getInstance().getFirestore(connectionId);

    // Invalidate cached snapshot on write
    this._snapshotCache.delete(`${connectionId}:${docPath}`);
    this._snapshotInFlight.delete(`${connectionId}:${docPath}`);

    let json: any;
    try {
      json = JSON.parse(decoder.decode(content));
    } catch (e: any) {
      throw new Error(`Could not parse JSON: ${e.message}`);
    }

    const checkChanges = vscode.workspace
      .getConfiguration("ketrik-firestore-studio")
      .get<boolean>("checkRemoteChangesOnSave", false);

    if (checkChanges) {
      await this.confirmNoRemoteChange(uri, firestore, docPath, fieldPath);
    }

    try {
      let writeTime: import("firebase-admin/firestore").Timestamp;
      if (fieldPath !== undefined) {
        // Atomic partial update: only update the targeted root field
        writeTime = (await firestore.doc(docPath).update({
          [fieldPath]: json,
        })).writeTime;
      } else {
        writeTime = (await firestore.doc(docPath).set(json)).writeTime;
      }
      // The saved version becomes the new baseline for the next save.
      this.rememberBaseline(uri, writeTime, this.serializeDoc(json));
      // Invalidate again after the write completes so no stale snapshot survives.
      this._snapshotCache.delete(`${connectionId}:${docPath}`);
      this._snapshotInFlight.delete(`${connectionId}:${docPath}`);
      this._emitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
    } catch (e: any) {
      throw new Error(`Could not write Firestore document: ${e.message}`);
    }
  }

  delete(
    _uri: vscode.Uri,
    _options: { readonly recursive: boolean }
  ): void | Thenable<void> {
    throw new Error("Delete Method not implemented.");
  }

  rename(
    _oldUri: vscode.Uri,
    _newUri: vscode.Uri,
    _options: { readonly overwrite: boolean }
  ): void | Thenable<void> {
    throw new Error("Rename Method not implemented.");
  }
}
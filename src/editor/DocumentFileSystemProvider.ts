import { createHash } from "crypto";
import * as vscode from "vscode";
import { FieldPath, Timestamp } from "firebase-admin/firestore";
import { isTimestampLike } from "../utils/timestampUtils";
import { ConnectionManager } from "../connections/ConnectionManager";
import { scheme } from "../constants";
import { RulesService } from "../rules/RulesService";
import { LocalJsonService } from "../services/LocalJsonService";
import { CostService } from "../cost/costService";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface ParsedDocumentUri {
  connectionId: string;
  docPath: string;
  fieldPath?: string;
  isRules?: boolean;
}

/**
 * Custom File System provider that allows interacting with Firestore documents and
 * their sub-fields/root-variables as virtual files in the editor, supporting multiple connections.
 */
export class DocumentFileSystemProvider implements vscode.FileSystemProvider, vscode.Disposable {
  private static instance: DocumentFileSystemProvider;
  private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();

  readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> =
    this._emitter.event;

  public static getInstance(): DocumentFileSystemProvider {
    if (!DocumentFileSystemProvider.instance) {
      DocumentFileSystemProvider.instance = new DocumentFileSystemProvider();
    }
    return DocumentFileSystemProvider.instance;
  }

  /** In-flight / short-lived document snapshot cache to deduplicate stat() followed immediately by readFile(). */
  private _snapshotCache = new Map<string, { snapshot: import("firebase-admin/firestore").DocumentSnapshot; timestamp: number }>();
  private _snapshotInFlight = new Map<string, Promise<import("firebase-admin/firestore").DocumentSnapshot>>();
  private static readonly MAX_SNAPSHOTS = 200;

  /** Version (update time + content hash) each open file was last loaded/saved with, for conflict detection. */
  private _baselines = new Map<string, { updateTime: string; hash: string }>();
  private static readonly MAX_BASELINES = 200;

  /**
   * Invalidate document snapshot cache and notify VS Code that the document file changed,
   * causing any open editor tabs to reload from Firestore.
   */
  public invalidateAndNotify(connectionId: string, docPath: string): void {
    this.invalidateAndNotifyMany([{ connectionId, docPath }]);
  }

  /**
   * Notify VS Code that a document was deleted, emitting a FileChangeType.Deleted event
   * and optionally closing any open tabs targeting this document.
   */
  public invalidateAndNotifyDocumentDeleted(connectionId: string, docPath: string): void {
    const key = `${connectionId}:${docPath}`;
    this._snapshotCache.delete(key);
    this._snapshotInFlight.delete(key);

    const docUri = vscode.Uri.from({
      scheme,
      authority: connectionId,
      path: `/${docPath}.json`,
    });
    this._emitter.fire([{ type: vscode.FileChangeType.Deleted, uri: docUri }]);
    this.closeTabsMatchingUri(docUri);
  }

  /**
   * Invalidate a document snapshot when a field is deleted, emit Deleted event
   * for the specific field's virtual file URI, close any open tabs for that field,
   * and emit Changed for the parent document JSON so full document tabs update immediately.
   */
  public invalidateAndNotifyFieldDeleted(connectionId: string, docPath: string, fieldNames: string | string[]): void {
    const key = `${connectionId}:${docPath}`;
    this._snapshotCache.delete(key);
    this._snapshotInFlight.delete(key);

    const names = Array.isArray(fieldNames) ? fieldNames : [fieldNames];
    const events: vscode.FileChangeEvent[] = [];

    // Notify that the parent document changed
    const parentDocUri = vscode.Uri.from({
      scheme,
      authority: connectionId,
      path: `/${docPath}.json`,
    });
    events.push({ type: vscode.FileChangeType.Changed, uri: parentDocUri });

    // Notify that each field virtual file was deleted and close its open tabs
    for (const name of names) {
      const fieldUri = vscode.Uri.from({
        scheme,
        authority: connectionId,
        path: `/${docPath}/${encodeURIComponent(name)}.json`,
      });
      events.push({ type: vscode.FileChangeType.Deleted, uri: fieldUri });
      this.closeTabsMatchingUri(fieldUri);
    }

    this._emitter.fire(events);
  }

  /**
   * Close any editor tabs matching a specific virtual URI.
   */
  private closeTabsMatchingUri(targetUri: vscode.Uri): void {
    try {
      const tabGroups = vscode.window.tabGroups;
      if (!tabGroups || !tabGroups.all) return;

      const tabsToClose: vscode.Tab[] = [];
      const targetStr = targetUri.toString();

      for (const group of tabGroups.all) {
        for (const tab of group.tabs) {
          if (tab.input instanceof vscode.TabInputText) {
            if (tab.input.uri.toString() === targetStr) {
              tabsToClose.push(tab);
            }
          }
        }
      }

      if (tabsToClose.length > 0) {
        tabGroups.close(tabsToClose).then(undefined, () => {});
      }
    } catch {}
  }

  /**
   * Invalidate multiple document snapshots in a single batch file change event,
   * preventing redundant event dispatching on batch updates or deletes.
   */
  public invalidateAndNotifyMany(entries: Array<{ connectionId: string; docPath: string }>): void {
    if (!entries.length) return;
    const events: vscode.FileChangeEvent[] = [];
    for (const { connectionId, docPath } of entries) {
      const key = `${connectionId}:${docPath}`;
      this._snapshotCache.delete(key);
      this._snapshotInFlight.delete(key);

      const docUri = vscode.Uri.from({
        scheme,
        authority: connectionId,
        path: `/${docPath}.json`,
      });
      events.push({ type: vscode.FileChangeType.Changed, uri: docUri });
    }
    this._emitter.fire(events);
  }

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
    CostService.getInstance().recordOperation(connectionId, "read", 1);
    const promise: Promise<import("firebase-admin/firestore").DocumentSnapshot> = firestore
      .doc(docPath)
      .get()
      .then((snapshot) => {
        // Only cache if this request has not been invalidated (e.g. by a write) meanwhile.
        if (this._snapshotInFlight.get(key) === promise) {
          this._snapshotInFlight.delete(key);
          const timestamp = Date.now();
          if (ttl > 0) {
            this._snapshotCache.delete(key);
            this._snapshotCache.set(key, { snapshot, timestamp });
            if (this._snapshotCache.size > DocumentFileSystemProvider.MAX_SNAPSHOTS) {
              const oldest = this._snapshotCache.keys().next().value;
              if (oldest !== undefined) {
                this._snapshotCache.delete(oldest);
              }
            }
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

    // Check if the URI targets virtual firestore.rules
    if (pathStr === "firestore.rules" || pathStr.endsWith("/firestore.rules")) {
      if (!connectionId) {
        const parts = pathStr.split("/");
        if (parts.length > 1 && connections.some((c) => c.id === parts[0])) {
          connectionId = parts[0];
        } else {
          connectionId = connections[0]?.id || "default";
        }
      }
      return { connectionId, docPath: "firestore.rules", isRules: true };
    }

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
    const parsed = this.parseUri(uri);
    const { connectionId, docPath, fieldPath, isRules } = parsed;
    const now = Date.now();

    if (isRules) {
      const content = RulesService.getInstance().getRulesContent(connectionId);
      return {
        type: vscode.FileType.File,
        ctime: now,
        mtime: now,
        size: encoder.encode(content).length,
      };
    }

    const conn = ConnectionManager.getInstance().getConnection(connectionId);
    if (conn?.isLocalJson) {
      const localDoc = LocalJsonService.getInstance().getDocument(conn, docPath);
      if (!localDoc) {
        throw vscode.FileSystemError.FileNotFound(uri);
      }
      if (fieldPath !== undefined && !(fieldPath in localDoc)) {
        throw vscode.FileSystemError.FileNotFound(uri);
      }
      return {
        type: vscode.FileType.File,
        ctime: now,
        mtime: now,
        size: 0,
      };
    }

    const doc = await this.getCachedSnapshot(connectionId, docPath);

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
    const parsed = this.parseUri(uri);
    const { connectionId, docPath, fieldPath, isRules } = parsed;

    if (isRules) {
      const text = RulesService.getInstance().getRulesContent(connectionId);
      return encoder.encode(text);
    }

    const conn = ConnectionManager.getInstance().getConnection(connectionId);
    if (conn?.isLocalJson) {
      const localDoc = LocalJsonService.getInstance().getDocument(conn, docPath);
      if (!localDoc) {
        throw vscode.FileSystemError.FileNotFound(uri);
      }
      const data = fieldPath !== undefined ? localDoc[fieldPath] : localDoc;
      if (fieldPath !== undefined && !(fieldPath in localDoc)) {
        throw vscode.FileSystemError.FileNotFound(uri);
      }
      const bytes = this.serializeDoc(data);
      this.rememberBaseline(uri, undefined, bytes);
      return bytes;
    }

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
    const parsed = this.parseUri(uri);
    const { connectionId, docPath, fieldPath, isRules } = parsed;

    if (isRules) {
      const text = decoder.decode(content);
      await RulesService.getInstance().saveRulesContent(connectionId, text);
      this._emitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
      return;
    }

    let json: any;
    try {
      json = JSON.parse(decoder.decode(content));
    } catch (e: any) {
      throw new Error(`Could not parse JSON: ${e.message}`);
    }

    const conn = ConnectionManager.getInstance().getConnection(connectionId);
    if (conn?.isLocalJson) {
      if (fieldPath !== undefined) {
        LocalJsonService.getInstance().updateField(conn, docPath, fieldPath, json);
      } else {
        LocalJsonService.getInstance().setDocument(conn, docPath, json);
      }
      this.rememberBaseline(uri, undefined, this.serializeDoc(json));
      this._emitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
      return;
    }

    const firestore = await ConnectionManager.getInstance().getFirestore(connectionId);

    // Invalidate cached snapshot on write
    this._snapshotCache.delete(`${connectionId}:${docPath}`);
    this._snapshotInFlight.delete(`${connectionId}:${docPath}`);

    // Convert any {_seconds, _nanoseconds} timestamp objects back to real Firestore Timestamps
    const reviveTimestamps = (val: any): any => {
      if (!val || typeof val !== "object") {
        return val;
      }
      if (val instanceof Timestamp) {
        return val;
      }
      if (isTimestampLike(val)) {
        return new Timestamp((val as any)._seconds, (val as any)._nanoseconds);
      }
      if (Array.isArray(val)) {
        return val.map(reviveTimestamps);
      }
      const res: Record<string, any> = {};
      for (const [k, v] of Object.entries(val)) {
        res[k] = reviveTimestamps(v);
      }
      return res;
    };

    json = reviveTimestamps(json);

    const checkChanges = vscode.workspace
      .getConfiguration("ketrik-firestore-studio")
      .get<boolean>("checkRemoteChangesOnSave", false);

    if (checkChanges) {
      await this.confirmNoRemoteChange(uri, firestore, docPath, fieldPath);
    }

    try {
      let writeTime: import("firebase-admin/firestore").Timestamp;
      if (fieldPath !== undefined) {
        // Atomic partial update: only update the targeted root field using FieldPath to handle dots safely
        writeTime = (await firestore.doc(docPath).update(new FieldPath(fieldPath), json)).writeTime;
      } else {
        writeTime = (await firestore.doc(docPath).set(json)).writeTime;
      }
      // The saved version becomes the new baseline for the next save.
      this.rememberBaseline(uri, writeTime, this.serializeDoc(json));
      CostService.getInstance().recordOperation(connectionId, "write", 1);
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
    throw vscode.FileSystemError.NoPermissions(
      "Deleting virtual Firestore document files directly via filesystem is not permitted. Use the explorer context menu."
    );
  }

  rename(
    _oldUri: vscode.Uri,
    _newUri: vscode.Uri,
    _options: { readonly overwrite: boolean }
  ): void | Thenable<void> {
    throw vscode.FileSystemError.NoPermissions(
      "Renaming virtual Firestore document files directly via filesystem is not permitted."
    );
  }
}
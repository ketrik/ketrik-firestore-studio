import { createHash } from "crypto";
import * as vscode from "vscode";
import { FieldPath } from "firebase-admin/firestore";
import { reviveTimestamps } from "../utils/timestampUtils";
import { ConnectionManager } from "../connections/ConnectionManager";
import { scheme } from "../constants";
import { RulesService } from "../rules/RulesService";
import { LocalJsonService } from "../services/LocalJsonService";
import { CostService } from "../cost/costService";
import { SnapshotSyncService } from "../services/SnapshotSyncService";

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
  private _snapshotTimers = new Map<string, NodeJS.Timeout>();
  private static readonly MAX_SNAPSHOTS = 200;

  /** Version (update time + content hash) each open file was last loaded/saved with, for conflict detection. */
  private _baselines = new Map<string, { updateTime: string; hash: string }>();
  private static readonly MAX_BASELINES = 200;

  private _evictSnapshot(key: string): void {
    this._snapshotCache.delete(key);
    this._snapshotInFlight.delete(key);
    const timer = this._snapshotTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this._snapshotTimers.delete(key);
    }
  }

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
    this._evictSnapshot(key);

    const docUri = vscode.Uri.from({
      scheme,
      authority: connectionId,
      path: `/${docPath}.json`,
    });
    this._emitter.fire([{ type: vscode.FileChangeType.Deleted, uri: docUri }]);
    this.closeTabsMatchingUri(docUri);
  }

  /**
   * Invalidate all document snapshot caches under a collection and close any open
   * editor tabs targeting documents in that collection.
   */
  public invalidateAndNotifyCollectionDeleted(connectionId: string, collPath: string): void {
    const prefix = `${connectionId}:${collPath}/`;
    const exact = `${connectionId}:${collPath}`;
    for (const key of Array.from(this._snapshotCache.keys())) {
      if (key.startsWith(prefix) || key === exact) {
        this._evictSnapshot(key);
      }
    }
    for (const key of Array.from(this._snapshotInFlight.keys())) {
      if (key.startsWith(prefix) || key === exact) {
        this._evictSnapshot(key);
      }
    }

    try {
      const tabGroups = vscode.window.tabGroups;
      if (!tabGroups || !tabGroups.all) return;

      const tabsToClose: vscode.Tab[] = [];
      const uriPrefix = `${scheme}://${connectionId}/${collPath}/`;
      const exactUri = `${scheme}://${connectionId}/${collPath}.json`;

      for (const group of tabGroups.all) {
        for (const tab of group.tabs) {
          if (tab.input instanceof vscode.TabInputText) {
            const tabUriStr = tab.input.uri.toString();
            if (tabUriStr.startsWith(uriPrefix) || tabUriStr === exactUri) {
              tabsToClose.push(tab);
            }
          }
        }
      }

      if (tabsToClose.length > 0) {
        tabGroups.close(tabsToClose).then(undefined, () => {});
      }
    } catch {}

    const collUri = vscode.Uri.from({
      scheme,
      authority: connectionId,
      path: `/${collPath}.json`,
    });
    this._emitter.fire([{ type: vscode.FileChangeType.Deleted, uri: collUri }]);
  }

  /**
   * Invalidate a document snapshot when a field is deleted, emit Deleted event
   * for the specific field's virtual file URI, close any open tabs for that field,
   * and emit Changed for the parent document JSON so full document tabs update immediately.
   */
  public invalidateAndNotifyFieldDeleted(connectionId: string, docPath: string, fieldNames: string | string[]): void {
    const key = `${connectionId}:${docPath}`;
    this._evictSnapshot(key);

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
      this._evictSnapshot(key);

      const docUri = vscode.Uri.from({
        scheme,
        authority: connectionId,
        path: `/${docPath}.json`,
      });
      events.push({ type: vscode.FileChangeType.Changed, uri: docUri });

      // Also notify any open field editor tabs under this document
      try {
        const tabGroups = vscode.window.tabGroups;
        if (tabGroups && tabGroups.all) {
          const prefix = `/${docPath}/`;
          for (const group of tabGroups.all) {
            for (const tab of group.tabs) {
              if (tab.input instanceof vscode.TabInputText) {
                const u = tab.input.uri;
                if (
                  u.scheme === scheme &&
                  u.authority === connectionId &&
                  u.path.startsWith(prefix) &&
                  u.path.endsWith(".json")
                ) {
                  events.push({ type: vscode.FileChangeType.Changed, uri: u });
                }
              }
            }
          }
        }
      } catch {}
    }
    this._emitter.fire(events);
  }

  dispose(): void {
    this._emitter.dispose();
    for (const timer of this._snapshotTimers.values()) {
      clearTimeout(timer);
    }
    this._snapshotTimers.clear();
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

  public async getCachedSnapshot(
    connectionId: string,
    docPath: string
  ): Promise<import("firebase-admin/firestore").DocumentSnapshot> {
    const key = `${connectionId}:${docPath}`;
    const now = Date.now();
    const ttl = this.getCacheTTL();
    const cached = this._snapshotCache.get(key);
    if (cached && now - cached.timestamp < ttl) {
      // Refresh recency for LRU
      this._snapshotCache.delete(key);
      this._snapshotCache.set(key, cached);
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
            const existingTimer = this._snapshotTimers.get(key);
            if (existingTimer) {
              clearTimeout(existingTimer);
              this._snapshotTimers.delete(key);
            }
            this._snapshotCache.delete(key);
            this._snapshotCache.set(key, { snapshot, timestamp });
            if (this._snapshotCache.size > DocumentFileSystemProvider.MAX_SNAPSHOTS) {
              const oldest = this._snapshotCache.keys().next().value;
              if (oldest !== undefined) {
                this._evictSnapshot(oldest);
              }
            }
            // Evict after TTL so the cache cannot grow unbounded.
            const timer = setTimeout(() => {
              this._snapshotTimers.delete(key);
              if (this._snapshotCache.get(key)?.timestamp === timestamp) {
                this._snapshotCache.delete(key);
              }
            }, ttl);
            timer.unref?.();
            this._snapshotTimers.set(key, timer);
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

    if (uri.fragment) {
      return { connectionId, docPath: segments.join("/"), fieldPath: decodeURIComponent(uri.fragment) };
    }

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
   * Helper to retrieve value at a dot-delimited field path from an object data hierarchy.
   */
  private getNestedFieldValue(data: any, fieldPath: string): { found: boolean; value: any } {
    if (!data || typeof data !== "object") {
      return { found: false, value: undefined };
    }
    if (fieldPath in data) {
      return { found: true, value: data[fieldPath] };
    }
    if (fieldPath.includes(".")) {
      const parts = fieldPath.split(".");
      let cur = data;
      for (const p of parts) {
        if (cur && typeof cur === "object" && p in cur) {
          cur = cur[p];
        } else {
          return { found: false, value: undefined };
        }
      }
      return { found: true, value: cur };
    }
    return { found: false, value: undefined };
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
        size: Buffer.byteLength(content, "utf8"),
      };
    }

    const conn = ConnectionManager.getInstance().getConnection(connectionId);
    if (conn?.isLocalJson) {
      const localDoc = LocalJsonService.getInstance().getDocument(conn, docPath);
      if (!localDoc) {
        throw vscode.FileSystemError.FileNotFound(uri);
      }
      if (fieldPath !== undefined && !this.getNestedFieldValue(localDoc, fieldPath).found) {
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
      if (fieldPath === undefined) {
        try {
          const firestore = await ConnectionManager.getInstance().getFirestore(connectionId);
          const subcollections = await firestore.doc(docPath).listCollections();
          if (subcollections.length > 0) {
            return {
              type: vscode.FileType.File,
              ctime: now,
              mtime: now,
              size: 2,
            };
          }
        } catch {}
      }
      throw vscode.FileSystemError.FileNotFound(uri);
    }

    if (fieldPath !== undefined) {
      const data = doc.data();
      if (!data || !this.getNestedFieldValue(data, fieldPath).found) {
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
      let data = localDoc;
      if (fieldPath !== undefined) {
        const nested = this.getNestedFieldValue(localDoc, fieldPath);
        if (!nested.found) {
          throw vscode.FileSystemError.FileNotFound(uri);
        }
        data = nested.value;
      }
      const bytes = this.serializeDoc(data);
      this.rememberBaseline(uri, undefined, bytes);
      void SnapshotSyncService.getInstance().mirrorVirtualDocument(connectionId, docPath, fieldPath, data);
      return bytes;
    }

    const doc = await this.getCachedSnapshot(connectionId, docPath);

    if (!doc.exists) {
      if (fieldPath === undefined) {
        try {
          const firestore = await ConnectionManager.getInstance().getFirestore(connectionId);
          const subcollections = await firestore.doc(docPath).listCollections();
          if (subcollections.length > 0) {
            const bytes = this.serializeDoc({});
            this.rememberBaseline(uri, undefined, bytes);
            void SnapshotSyncService.getInstance().mirrorVirtualDocument(connectionId, docPath, fieldPath, {});
            return bytes;
          }
        } catch {}
      }
      throw vscode.FileSystemError.FileNotFound(uri);
    }

    const data = doc.data() ?? {};
    if (fieldPath !== undefined) {
      const nested = this.getNestedFieldValue(data, fieldPath);
      if (!nested.found) {
        throw vscode.FileSystemError.FileNotFound(uri);
      }
      const bytes = this.serializeDoc(nested.value);
      this.rememberBaseline(uri, doc.updateTime, bytes);
      void SnapshotSyncService.getInstance().mirrorVirtualDocument(connectionId, docPath, fieldPath, nested.value);
      return bytes;
    }

    const bytes = this.serializeDoc(data);
    this.rememberBaseline(uri, doc.updateTime, bytes);
    void SnapshotSyncService.getInstance().mirrorVirtualDocument(connectionId, docPath, fieldPath, data);
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

    if (!baseline.updateTime && !fresh.exists) {
      return; // was missing when opened and still missing remotely; creating it is safe
    }

    if (fresh.exists && fieldPath !== undefined) {
      // Field-level edit: ignore changes to other fields.
      const data = fresh.data() ?? {};
      const nested = this.getNestedFieldValue(data, fieldPath);
      const freshHash = nested.found
        ? createHash("sha1").update(this.serializeDoc(nested.value)).digest("hex")
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
      void SnapshotSyncService.getInstance().mirrorVirtualDocument(connectionId, docPath, fieldPath, json);
      this._emitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
      return;
    }

    const firestore = await ConnectionManager.getInstance().getFirestore(connectionId);

    // Invalidate cached snapshot on write
    this._evictSnapshot(`${connectionId}:${docPath}`);

    // Convert any {_seconds, _nanoseconds} timestamp objects back to real Firestore Timestamps
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
        // Atomic partial update: only update the targeted field using FieldPath segments to handle nested paths safely
        const segments = fieldPath.includes(".") ? fieldPath.split(".") : [fieldPath];
        const hasNumericIndex = segments.some((s) => /^\d+$/.test(s));

        if (hasNumericIndex) {
          // Firestore does not natively support array-index updates in FieldPath (e.g. items.0).
          // Sending "items.0" to Firestore update() converts the parent array into a map { "0": ... },
          // wiping out array methods and data integrity.
          // We find the parent array, mutate the document in memory, and update the array field or doc.
          const docSnap = await firestore.doc(docPath).get();
          const docData = docSnap.exists ? docSnap.data() || {} : {};

          // Apply nested update to docData in-memory
          let target: any = docData;
          let arrayRootIndex = -1;
          for (let i = 0; i < segments.length - 1; i++) {
            const key = segments[i];
            const nextKey = segments[i + 1];
            if (Array.isArray(target) && arrayRootIndex === -1) {
              arrayRootIndex = i;
            }
            if (!target[key] || typeof target[key] !== "object") {
              target[key] = /^\d+$/.test(nextKey) ? [] : {};
            }
            target = target[key];
          }

          const lastKey = segments[segments.length - 1];
          if (Array.isArray(target) && /^\d+$/.test(lastKey)) {
            target[parseInt(lastKey, 10)] = json;
          } else {
            target[lastKey] = json;
          }

          // If the top segment before any array index can be isolated, update just that array field
          const firstNumericIdx = segments.findIndex((s) => /^\d+$/.test(s));
          if (firstNumericIdx > 0) {
            const arrayParentSegments = segments.slice(0, firstNumericIdx);
            let arrayVal: any = docData;
            for (const seg of arrayParentSegments) {
              arrayVal = arrayVal?.[seg];
            }
            writeTime = (
              await firestore.doc(docPath).update(new FieldPath(...arrayParentSegments), arrayVal)
            ).writeTime;
          } else {
            writeTime = (await firestore.doc(docPath).set(docData, { merge: true })).writeTime;
          }
        } else {
          writeTime = (await firestore.doc(docPath).update(new FieldPath(...segments), json)).writeTime;
        }
      } else {
        writeTime = (await firestore.doc(docPath).set(json)).writeTime;
      }
      // The saved version becomes the new baseline for the next save.
      this.rememberBaseline(uri, writeTime, this.serializeDoc(json));
      void SnapshotSyncService.getInstance().mirrorVirtualDocument(connectionId, docPath, fieldPath, json);
      CostService.getInstance().recordOperation(connectionId, "write", 1);
      // Invalidate again after the write completes so no stale snapshot survives.
      this._evictSnapshot(`${connectionId}:${docPath}`);
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
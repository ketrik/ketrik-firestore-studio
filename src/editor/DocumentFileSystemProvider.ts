import { createHash } from "crypto";
import * as fs from "fs";
import * as vscode from "vscode";
import { FieldPath } from "firebase-admin/firestore";
import { reviveTimestamps } from "../utils/timestampUtils";
import { ConnectionManager, FirestoreConnectionConfig } from "../connections/ConnectionManager";
import { scheme } from "../constants";
import { RulesService } from "../rules/RulesService";
import { LocalJsonService } from "../services/LocalJsonService";
import { CostService } from "../cost/costService";
import { SnapshotSyncService } from "../services/SnapshotSyncService";
import { PitrService } from "../pitr/PitrService";
import { DocumentClipboard } from "../services/DocumentClipboard";
import { DocumentCompareService } from "../services/DocumentCompareService";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

interface PersistedDocCacheEntry {
  data: any;
  ctime: number;
  mtime: number;
  savedAt: number;
}

export interface ParsedDocumentUri {
  connectionId: string;
  docPath: string;
  fieldPath?: string;
  isRules?: boolean;
  readTime?: Date;
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

  /** Persistent L2 cache so virtual tabs restored when VS Code reopens still resolve even if a connection or emulator is offline. */
  private _context: vscode.ExtensionContext | null = null;
  private _persistedCache = new Map<string, PersistedDocCacheEntry>();
  private _persistFlushTimer: NodeJS.Timeout | null = null;
  private static readonly PERSISTED_CACHE_KEY = "ketrik-firestore-studio.virtualDocCache.v1";
  private static readonly MAX_PERSISTED_DOCS = 60;
  private static readonly MAX_PERSISTED_DOC_BYTES = 256 * 1024;

  public setContext(context: vscode.ExtensionContext): void {
    this._context = context;
    try {
      const stored = context.globalState.get<Record<string, PersistedDocCacheEntry>>(
        DocumentFileSystemProvider.PERSISTED_CACHE_KEY
      );
      if (stored && typeof stored === "object") {
        for (const [k, v] of Object.entries(stored)) {
          if (v && typeof v === "object" && "data" in v) {
            this._persistedCache.set(k, v);
          }
        }
      }
    } catch { }
  }

  private _rememberPersistedDoc(
    connectionId: string,
    docPath: string,
    data: any,
    ctime?: number,
    mtime?: number
  ): void {
    try {
      const serialized = JSON.stringify(data ?? {});
      if (Buffer.byteLength(serialized, "utf8") > DocumentFileSystemProvider.MAX_PERSISTED_DOC_BYTES) {
        return;
      }
      const key = `${connectionId}:${docPath}`;
      const now = Date.now();
      const existing = this._persistedCache.get(key);
      this._persistedCache.delete(key);
      this._persistedCache.set(key, {
        data: JSON.parse(serialized),
        ctime: ctime ?? existing?.ctime ?? now,
        mtime: mtime ?? now,
        savedAt: now,
      });
      while (this._persistedCache.size > DocumentFileSystemProvider.MAX_PERSISTED_DOCS) {
        const oldest = this._persistedCache.keys().next().value;
        if (oldest === undefined) break;
        this._persistedCache.delete(oldest);
      }
      this._schedulePersistFlush();
    } catch { }
  }

  private _evictPersistedDoc(connectionId: string, docPath: string, includeDescendants = false): void {
    const exact = `${connectionId}:${docPath}`;
    const prefix = `${connectionId}:${docPath}/`;
    let changed = false;
    if (this._persistedCache.delete(exact)) {
      changed = true;
    }
    if (includeDescendants) {
      for (const k of Array.from(this._persistedCache.keys())) {
        if (k.startsWith(prefix)) {
          this._persistedCache.delete(k);
          changed = true;
        }
      }
    }
    if (changed) {
      this._schedulePersistFlush();
    }
  }

  private _schedulePersistFlush(): void {
    if (!this._context) return;
    if (this._persistFlushTimer) {
      clearTimeout(this._persistFlushTimer);
    }
    this._persistFlushTimer = setTimeout(() => {
      this._persistFlushTimer = null;
      if (!this._context) return;
      const obj: Record<string, PersistedDocCacheEntry> = {};
      for (const [k, v] of this._persistedCache.entries()) {
        obj[k] = v;
      }
      void this._context.globalState.update(DocumentFileSystemProvider.PERSISTED_CACHE_KEY, obj);
    }, 300);
    this._persistFlushTimer.unref?.();
  }

  /**
   * Look up a cached document or field payload from either the persistent L2 cache
   * or an existing `.firestore/<connectionId>/<docPath>` workspace mirror on disk.
   */
  private _getFallbackPayload(
    connectionId: string,
    docPath: string,
    fieldPath?: string
  ): { found: boolean; data: any; ctime: number; mtime: number } {
    const now = Date.now();
    // 1. Check workspace .firestore/ deterministic snapshot file first (if user or auto-mirror saved it)
    try {
      const mirrorPath = SnapshotSyncService.getInstance().getDeterministicSnapshotPath(
        connectionId,
        docPath,
        fieldPath
      );
      if (fs.existsSync(mirrorPath)) {
        const stat = fs.statSync(mirrorPath);
        const parsed = JSON.parse(fs.readFileSync(mirrorPath, "utf8"));
        return { found: true, data: parsed, ctime: stat.ctimeMs || now, mtime: stat.mtimeMs || now };
      }
      // If looking for a fieldPath and the parent document mirror exists on disk, extract the field from it
      if (fieldPath !== undefined) {
        const parentMirrorPath = SnapshotSyncService.getInstance().getDeterministicSnapshotPath(
          connectionId,
          docPath,
          undefined
        );
        if (fs.existsSync(parentMirrorPath)) {
          const stat = fs.statSync(parentMirrorPath);
          const parentData = JSON.parse(fs.readFileSync(parentMirrorPath, "utf8"));
          const nested = this.getNestedFieldValue(parentData, fieldPath);
          if (nested.found) {
            return { found: true, data: nested.value, ctime: stat.ctimeMs || now, mtime: stat.mtimeMs || now };
          }
        }
      }
    } catch { }

    // 2. Check L2 persisted extension globalState cache
    const persisted = this._persistedCache.get(`${connectionId}:${docPath}`);
    if (persisted) {
      if (fieldPath !== undefined) {
        const nested = this.getNestedFieldValue(persisted.data, fieldPath);
        if (nested.found) {
          return { found: true, data: nested.value, ctime: persisted.ctime, mtime: persisted.mtime };
        }
      } else {
        return { found: true, data: persisted.data, ctime: persisted.ctime, mtime: persisted.mtime };
      }
    }

    return { found: false, data: undefined, ctime: now, mtime: now };
  }

  /**
   * Resolve a connection by ID, or fall back when a restored tab references an older emulator/default connection ID.
   */
  private _resolveConnection(connectionId: string): FirestoreConnectionConfig | undefined {
    const connMgr = ConnectionManager.getInstance();
    const connections = connMgr.getConnections();
    const exact = connections.find((c) => c.id === connectionId);
    if (exact) {
      return exact;
    }
    if (connectionId.startsWith("conn_emulator_")) {
      const emulatorConn = connections.find((c) => c.isEmulator);
      if (emulatorConn) {
        return emulatorConn;
      }
    }
    if (connections.length === 1) {
      return connections[0];
    }
    return undefined;
  }

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

  private _clearStaleClipboardAndCompare(
    connectionId: string,
    targetPath: string,
    includeDescendants: boolean
  ): void {
    const matchesTarget = (p?: string) =>
      !!p && (p === targetPath || (includeDescendants && p.startsWith(targetPath + "/")));

    const copied = DocumentClipboard.getInstance().get();
    if (copied && copied.sourceConnectionId === connectionId && matchesTarget(copied.sourcePath)) {
      DocumentClipboard.getInstance().clear();
    }

    const compared = DocumentCompareService.getInstance().get();
    if (compared && compared.connectionId === connectionId && matchesTarget(compared.docPath)) {
      DocumentCompareService.getInstance().clear();
    }
  }

  /**
   * Notify VS Code that a document was deleted, emitting a FileChangeType.Deleted event
   * and closing any open document, field, or diff tabs targeting this document.
   */
  public invalidateAndNotifyDocumentDeleted(
    connectionId: string,
    docPath: string,
    recursive: boolean = false
  ): void {
    const key = `${connectionId}:${docPath}`;
    this._evictSnapshot(key);
    this._evictPersistedDoc(connectionId, docPath, recursive);
    if (recursive) {
      const subPrefix = `${connectionId}:${docPath}/`;
      for (const k of Array.from(this._snapshotCache.keys())) {
        if (k.startsWith(subPrefix)) {
          this._evictSnapshot(k);
        }
      }
      for (const k of Array.from(this._snapshotInFlight.keys())) {
        if (k.startsWith(subPrefix)) {
          this._evictSnapshot(k);
        }
      }
    }

    const matches = (uri: vscode.Uri): boolean => {
      const parsed = this.parseUri(uri);
      return (
        !parsed.isRules &&
        parsed.connectionId === connectionId &&
        (parsed.docPath === docPath || (recursive && parsed.docPath.startsWith(docPath + "/")))
      );
    };

    this._evictBaselinesMatching(matches);
    this._closeTabsMatching(matches);
    this._clearStaleClipboardAndCompare(connectionId, docPath, recursive);

    const docUri = vscode.Uri.from({
      scheme,
      authority: connectionId,
      path: `/${docPath}.json`,
    });
    this._emitter.fire([{ type: vscode.FileChangeType.Deleted, uri: docUri }]);
    void SnapshotSyncService.getInstance().unbindForDeletedTarget(connectionId, docPath, { recursive });
  }

  /**
   * Invalidate all document snapshot caches under a collection and close any open
   * editor or diff tabs targeting documents in that collection.
   */
  public invalidateAndNotifyCollectionDeleted(connectionId: string, collPath: string): void {
    this._evictPersistedDoc(connectionId, collPath, true);
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

    const matches = (uri: vscode.Uri): boolean => {
      const parsed = this.parseUri(uri);
      return (
        !parsed.isRules &&
        parsed.connectionId === connectionId &&
        (parsed.docPath === collPath || parsed.docPath.startsWith(collPath + "/"))
      );
    };

    this._evictBaselinesMatching(matches);
    this._closeTabsMatching(matches);
    this._clearStaleClipboardAndCompare(connectionId, collPath, true);

    const collUri = vscode.Uri.from({
      scheme,
      authority: connectionId,
      path: `/${collPath}.json`,
    });
    this._emitter.fire([{ type: vscode.FileChangeType.Deleted, uri: collUri }]);
    void SnapshotSyncService.getInstance().unbindForDeletedTarget(connectionId, collPath, {
      isCollection: true,
    });
  }

  /**
   * Invalidate a document snapshot when a field is deleted, emit Deleted event
   * for the specific field's virtual file URI, close any open tabs for that field (or its nested children),
   * and emit Changed for the parent document JSON so full document tabs update immediately.
   */
  public invalidateAndNotifyFieldDeleted(
    connectionId: string,
    docPath: string,
    fieldNames: string | string[]
  ): void {
    const key = `${connectionId}:${docPath}`;
    this._evictSnapshot(key);
    this._evictPersistedDoc(connectionId, docPath, false);

    const names = Array.isArray(fieldNames) ? fieldNames : [fieldNames];
    const events: vscode.FileChangeEvent[] = [];

    const matchesField = (uri: vscode.Uri): boolean => {
      const parsed = this.parseUri(uri);
      return (
        !parsed.isRules &&
        parsed.connectionId === connectionId &&
        parsed.docPath === docPath &&
        parsed.fieldPath !== undefined &&
        names.some((n) => parsed.fieldPath === n || parsed.fieldPath!.startsWith(n + "."))
      );
    };

    this._evictBaselinesMatching((uri) => {
      const parsed = this.parseUri(uri);
      return (
        !parsed.isRules &&
        parsed.connectionId === connectionId &&
        parsed.docPath === docPath &&
        (parsed.fieldPath === undefined ||
          names.some((n) => parsed.fieldPath === n || parsed.fieldPath!.startsWith(n + ".")))
      );
    });
    this._closeTabsMatching(matchesField);

    // Notify that the parent document changed
    const parentDocUri = vscode.Uri.from({
      scheme,
      authority: connectionId,
      path: `/${docPath}.json`,
    });
    events.push({ type: vscode.FileChangeType.Changed, uri: parentDocUri });

    // Notify that each field virtual file was deleted
    for (const name of names) {
      const fieldUri = vscode.Uri.from({
        scheme,
        authority: connectionId,
        path: `/${docPath}/${encodeURIComponent(name)}.json`,
      });
      events.push({ type: vscode.FileChangeType.Deleted, uri: fieldUri });
    }

    this._emitter.fire(events);
    void SnapshotSyncService.getInstance().unbindForDeletedTarget(connectionId, docPath, {
      fieldPaths: names,
    });
  }

  /**
   * Close any editor or diff tabs whose virtual URI matches the predicate.
   */
  private _closeTabsMatching(predicate: (uri: vscode.Uri) => boolean): void {
    try {
      const tabGroups = vscode.window.tabGroups;
      if (!tabGroups || !tabGroups.all) return;

      const tabsToClose: vscode.Tab[] = [];

      for (const group of tabGroups.all) {
        for (const tab of group.tabs) {
          if (tab.input instanceof vscode.TabInputText) {
            if (tab.input.uri.scheme === scheme && predicate(tab.input.uri)) {
              tabsToClose.push(tab);
            }
          } else if (tab.input instanceof vscode.TabInputTextDiff) {
            const origMatches =
              tab.input.original.scheme === scheme && predicate(tab.input.original);
            const modMatches =
              tab.input.modified.scheme === scheme && predicate(tab.input.modified);
            if (origMatches || modMatches) {
              tabsToClose.push(tab);
            }
          }
        }
      }

      if (tabsToClose.length > 0) {
        tabGroups.close(tabsToClose).then(undefined, () => { });
      }
    } catch { }
  }

  /**
   * Evict baseline version hashes for virtual URIs matching the predicate.
   */
  private _evictBaselinesMatching(predicate: (uri: vscode.Uri) => boolean): void {
    for (const key of Array.from(this._baselines.keys())) {
      try {
        const uri = vscode.Uri.parse(key);
        if (uri.scheme === scheme && predicate(uri)) {
          this._baselines.delete(key);
        }
      } catch { }
    }
  }

  /**
   * Invalidate multiple document snapshots in a single batch file change event,
   * preventing redundant event dispatching on batch updates or deletes.
   */
  public invalidateAndNotifyMany(entries: Array<{ connectionId: string; docPath: string }>): void {
    if (!entries.length) return;
    const events: vscode.FileChangeEvent[] = [];

    // Pre-collect open virtual field editor tabs once across all entries rather than re-scanning per-entry
    const openFieldUris: vscode.Uri[] = [];
    try {
      const tabGroups = vscode.window.tabGroups;
      if (tabGroups && tabGroups.all) {
        for (const group of tabGroups.all) {
          for (const tab of group.tabs) {
            if (tab.input instanceof vscode.TabInputText) {
              const u = tab.input.uri;
              if (u.scheme === scheme && u.path.endsWith(".json")) {
                openFieldUris.push(u);
              }
            }
          }
        }
      }
    } catch { }

    for (const { connectionId, docPath } of entries) {
      const key = `${connectionId}:${docPath}`;
      this._evictSnapshot(key);

      const docUri = vscode.Uri.from({
        scheme,
        authority: connectionId,
        path: `/${docPath}.json`,
      });
      events.push({ type: vscode.FileChangeType.Changed, uri: docUri });

      // Notify any open field editor tabs under this document
      if (openFieldUris.length > 0) {
        const prefix = `/${docPath}/`;
        for (let i = 0; i < openFieldUris.length; i++) {
          const u = openFieldUris[i];
          if (u.authority === connectionId && u.path.startsWith(prefix)) {
            events.push({ type: vscode.FileChangeType.Changed, uri: u });
          }
        }
      }
    }
    this._emitter.fire(events);
  }

  dispose(): void {
    this._emitter.dispose();
    if (this._persistFlushTimer) {
      clearTimeout(this._persistFlushTimer);
      this._persistFlushTimer = null;
    }
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
    return new vscode.Disposable(() => { });
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
      // Check if first segment of path is connectionId (or looks like a generated conn_ ID from a previous session)
      const parts = pathStr.split("/");
      if (
        connections.some((c) => c.id === parts[0]) ||
        parts[0]?.startsWith("conn_") ||
        parts[0] === "default"
      ) {
        connectionId = parts[0];
        pathStr = parts.slice(1).join("/");
      } else {
        connectionId = connections[0]?.id || "default";
      }
    }

    const resolvedConn = this._resolveConnection(connectionId);
    if (resolvedConn) {
      connectionId = resolvedConn.id;
    }

    let readTime: Date | undefined;
    if (uri.query) {
      try {
        const queryParams = new URLSearchParams(uri.query);
        const readTimeParam = queryParams.get("readTime");
        if (readTimeParam) {
          const parsedDate = new Date(readTimeParam);
          if (!isNaN(parsedDate.getTime())) {
            readTime = parsedDate;
          }
        }
      } catch { }
    }

    const segments = pathStr.split("/").filter(Boolean);

    if (uri.fragment) {
      return { connectionId, docPath: segments.join("/"), fieldPath: decodeURIComponent(uri.fragment), readTime };
    }

    // Firestore doc paths always have an even number of segments (coll/doc or coll/doc/subcoll/subdoc).
    // If the path has an odd number >= 3, the trailing segment is a targeted fieldPath!
    if (segments.length % 2 === 1 && segments.length >= 3) {
      const fieldPath = decodeURIComponent(segments.pop()!);
      const docPath = segments.join("/");
      return { connectionId, docPath, fieldPath, readTime };
    }

    return { connectionId, docPath: segments.join("/"), readTime };
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

    if (parsed.readTime) {
      const historical = await PitrService.getInstance().getDocumentAtTimestamp(connectionId, docPath, parsed.readTime);
      if (!historical || !historical.exists) {
        throw vscode.FileSystemError.FileNotFound(uri);
      }
      if (fieldPath !== undefined && !this.getNestedFieldValue(historical.data, fieldPath).found) {
        throw vscode.FileSystemError.FileNotFound(uri);
      }
      return {
        type: vscode.FileType.File,
        ctime: historical.createTime ? historical.createTime.getTime() : parsed.readTime.getTime(),
        mtime: historical.updateTime ? historical.updateTime.getTime() : parsed.readTime.getTime(),
        size: 0,
        permissions: vscode.FilePermission.Readonly,
      };
    }

    const conn = this._resolveConnection(connectionId);
    const effectiveConnectionId = conn?.id || connectionId;
    const isReadOnly = !!conn?.readOnly;

    if (conn?.isLocalJson) {
      const localDoc = LocalJsonService.getInstance().getDocument(conn, docPath);
      if (!localDoc) {
        const fallback = this._getFallbackPayload(effectiveConnectionId, docPath, fieldPath);
        if (fallback.found) {
          return {
            type: vscode.FileType.File,
            ctime: fallback.ctime,
            mtime: fallback.mtime,
            size: Buffer.byteLength(JSON.stringify(fallback.data ?? {}, null, 2), "utf8"),
            permissions: isReadOnly ? vscode.FilePermission.Readonly : undefined,
          };
        }
        throw vscode.FileSystemError.FileNotFound(uri);
      }
      if (fieldPath !== undefined && !this.getNestedFieldValue(localDoc, fieldPath).found) {
        throw vscode.FileSystemError.FileNotFound(uri);
      }
      this._rememberPersistedDoc(effectiveConnectionId, docPath, localDoc, now, now);
      return {
        type: vscode.FileType.File,
        ctime: now,
        mtime: now,
        size: 0,
        permissions: isReadOnly ? vscode.FilePermission.Readonly : undefined,
      };
    }

    let doc: import("firebase-admin/firestore").DocumentSnapshot;
    try {
      doc = await this.getCachedSnapshot(effectiveConnectionId, docPath);
    } catch (err) {
      const primaryFallback = this._getFallbackPayload(effectiveConnectionId, docPath, fieldPath);
      const fallback = primaryFallback.found
        ? primaryFallback
        : this._getFallbackPayload(connectionId, docPath, fieldPath);
      if (fallback.found) {
        return {
          type: vscode.FileType.File,
          ctime: fallback.ctime,
          mtime: fallback.mtime,
          size: Buffer.byteLength(JSON.stringify(fallback.data ?? {}, null, 2), "utf8"),
          permissions: isReadOnly ? vscode.FilePermission.Readonly : undefined,
        };
      }
      throw err;
    }

    if (!doc.exists) {
      if (fieldPath === undefined) {
        try {
          const firestore = await ConnectionManager.getInstance().getFirestore(effectiveConnectionId);
          const subcollections = await firestore.doc(docPath).listCollections();
          if (subcollections.length > 0) {
            return {
              type: vscode.FileType.File,
              ctime: now,
              mtime: now,
              size: 2,
              permissions: isReadOnly ? vscode.FilePermission.Readonly : undefined,
            };
          }
        } catch { }
      }
      // If connected to a freshly started empty emulator, fall back to persisted snapshot so restored tabs don't break
      if (conn?.isEmulator) {
        const primaryFallback = this._getFallbackPayload(effectiveConnectionId, docPath, fieldPath);
        const fallback = primaryFallback.found
          ? primaryFallback
          : this._getFallbackPayload(connectionId, docPath, fieldPath);
        if (fallback.found) {
          return {
            type: vscode.FileType.File,
            ctime: fallback.ctime,
            mtime: fallback.mtime,
            size: Buffer.byteLength(JSON.stringify(fallback.data ?? {}, null, 2), "utf8"),
            permissions: isReadOnly ? vscode.FilePermission.Readonly : undefined,
          };
        }
      }
      throw vscode.FileSystemError.FileNotFound(uri);
    }

    const fullData = doc.data();
    const ctime = doc.createTime ? doc.createTime.toMillis() : now;
    const mtime = doc.updateTime ? doc.updateTime.toMillis() : now;
    if (fullData) {
      this._rememberPersistedDoc(effectiveConnectionId, docPath, fullData, ctime, mtime);
      if (effectiveConnectionId !== connectionId) {
        this._rememberPersistedDoc(connectionId, docPath, fullData, ctime, mtime);
      }
    }

    if (fieldPath !== undefined) {
      if (!fullData || !this.getNestedFieldValue(fullData, fieldPath).found) {
        throw vscode.FileSystemError.FileNotFound(uri);
      }
    }

    return {
      type: vscode.FileType.File,
      ctime,
      mtime,
      size: 0,
      permissions: isReadOnly ? vscode.FilePermission.Readonly : undefined,
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

    if (parsed.readTime) {
      const historical = await PitrService.getInstance().getDocumentAtTimestamp(connectionId, docPath, parsed.readTime);
      if (!historical || !historical.exists) {
        throw vscode.FileSystemError.FileNotFound(uri);
      }
      let data = historical.data;
      if (fieldPath !== undefined) {
        const nested = this.getNestedFieldValue(data, fieldPath);
        if (!nested.found) {
          throw vscode.FileSystemError.FileNotFound(uri);
        }
        data = nested.value;
      }
      return this.serializeDoc(data);
    }

    const conn = this._resolveConnection(connectionId);
    const effectiveConnectionId = conn?.id || connectionId;
    if (conn?.isLocalJson) {
      const localDoc = LocalJsonService.getInstance().getDocument(conn, docPath);
      if (!localDoc) {
        const fallback = this._getFallbackPayload(effectiveConnectionId, docPath, fieldPath);
        if (fallback.found) {
          const bytes = this.serializeDoc(fallback.data);
          this.rememberBaseline(uri, undefined, bytes);
          return bytes;
        }
        throw vscode.FileSystemError.FileNotFound(uri);
      }
      this._rememberPersistedDoc(effectiveConnectionId, docPath, localDoc);
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
      void SnapshotSyncService.getInstance().mirrorVirtualDocument(effectiveConnectionId, docPath, fieldPath, data);
      return bytes;
    }

    let doc: import("firebase-admin/firestore").DocumentSnapshot;
    try {
      doc = await this.getCachedSnapshot(effectiveConnectionId, docPath);
    } catch (err) {
      const primaryFallback = this._getFallbackPayload(effectiveConnectionId, docPath, fieldPath);
      const fallback = primaryFallback.found
        ? primaryFallback
        : this._getFallbackPayload(connectionId, docPath, fieldPath);
      if (fallback.found) {
        const bytes = this.serializeDoc(fallback.data);
        this.rememberBaseline(uri, undefined, bytes);
        return bytes;
      }
      throw err;
    }

    if (!doc.exists) {
      if (fieldPath === undefined) {
        try {
          const firestore = await ConnectionManager.getInstance().getFirestore(effectiveConnectionId);
          const subcollections = await firestore.doc(docPath).listCollections();
          if (subcollections.length > 0) {
            const bytes = this.serializeDoc({});
            this.rememberBaseline(uri, undefined, bytes);
            void SnapshotSyncService.getInstance().mirrorVirtualDocument(effectiveConnectionId, docPath, fieldPath, {});
            return bytes;
          }
        } catch { }
      }
      if (conn?.isEmulator) {
        const primaryFallback = this._getFallbackPayload(effectiveConnectionId, docPath, fieldPath);
        const fallback = primaryFallback.found
          ? primaryFallback
          : this._getFallbackPayload(connectionId, docPath, fieldPath);
        if (fallback.found) {
          const bytes = this.serializeDoc(fallback.data);
          this.rememberBaseline(uri, undefined, bytes);
          return bytes;
        }
      }
      throw vscode.FileSystemError.FileNotFound(uri);
    }

    const data = doc.data() ?? {};
    const ctime = doc.createTime ? doc.createTime.toMillis() : undefined;
    const mtime = doc.updateTime ? doc.updateTime.toMillis() : undefined;
    this._rememberPersistedDoc(effectiveConnectionId, docPath, data, ctime, mtime);
    if (effectiveConnectionId !== connectionId) {
      this._rememberPersistedDoc(connectionId, docPath, data, ctime, mtime);
    }

    if (fieldPath !== undefined) {
      const nested = this.getNestedFieldValue(data, fieldPath);
      if (!nested.found) {
        throw vscode.FileSystemError.FileNotFound(uri);
      }
      const bytes = this.serializeDoc(nested.value);
      this.rememberBaseline(uri, doc.updateTime, bytes);
      void SnapshotSyncService.getInstance().mirrorVirtualDocument(effectiveConnectionId, docPath, fieldPath, nested.value);
      return bytes;
    }

    const bytes = this.serializeDoc(data);
    this.rememberBaseline(uri, doc.updateTime, bytes);
    void SnapshotSyncService.getInstance().mirrorVirtualDocument(effectiveConnectionId, docPath, fieldPath, data);
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
    const { connectionId, docPath, fieldPath, isRules, readTime } = parsed;

    if (readTime) {
      throw vscode.FileSystemError.NoPermissions(
        "Historical Point-in-Time Recovery snapshots are strictly read-only. Use 'Restore from History' to roll back live documents."
      );
    }

    const conn = this._resolveConnection(connectionId);
    const effectiveConnectionId = conn?.id || connectionId;
    if (conn?.readOnly) {
      throw vscode.FileSystemError.NoPermissions(
        `Connection '${conn.name}' is in Read-Only mode. Unlock it from the connection context menu to save changes.`
      );
    }

    if (isRules) {
      const text = decoder.decode(content);
      await RulesService.getInstance().saveRulesContent(effectiveConnectionId, text);
      this._emitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
      return;
    }

    let json: any;
    try {
      json = JSON.parse(decoder.decode(content));
    } catch (e: any) {
      throw vscode.FileSystemError.Unavailable(`Could not parse JSON: ${e.message}`);
    }

    if (conn?.isLocalJson) {
      if (fieldPath !== undefined) {
        LocalJsonService.getInstance().updateField(conn, docPath, fieldPath, json);
        const updatedDoc = LocalJsonService.getInstance().getDocument(conn, docPath);
        if (updatedDoc) {
          this._rememberPersistedDoc(effectiveConnectionId, docPath, updatedDoc);
        }
      } else {
        LocalJsonService.getInstance().setDocument(conn, docPath, json);
        this._rememberPersistedDoc(effectiveConnectionId, docPath, json);
      }
      this.rememberBaseline(uri, undefined, this.serializeDoc(json));
      void SnapshotSyncService.getInstance().mirrorVirtualDocument(effectiveConnectionId, docPath, fieldPath, json);
      this._emitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
      return;
    }

    const firestore = await ConnectionManager.getInstance().getFirestore(effectiveConnectionId);

    // Invalidate cached snapshot on write
    this._evictSnapshot(`${effectiveConnectionId}:${docPath}`);
    if (effectiveConnectionId !== connectionId) {
      this._evictSnapshot(`${connectionId}:${docPath}`);
    }

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
          try {
            writeTime = (await firestore.doc(docPath).update(new FieldPath(...segments), json)).writeTime;
          } catch (updateErr: any) {
            if ((updateErr.code === 5 || updateErr.code === "NOT_FOUND" || String(updateErr.message).includes("NOT_FOUND")) && segments.length === 1) {
              writeTime = (await firestore.doc(docPath).set({ [segments[0]]: json }, { merge: true })).writeTime;
            } else {
              throw updateErr;
            }
          }
        }
      } else {
        writeTime = (await firestore.doc(docPath).set(json)).writeTime;
      }
      // The saved version becomes the new baseline for the next save.
      const serializedBytes = this.serializeDoc(json);
      this.rememberBaseline(uri, writeTime, serializedBytes);
      if (fieldPath === undefined) {
        this._rememberPersistedDoc(effectiveConnectionId, docPath, JSON.parse(decoder.decode(serializedBytes)));
      } else {
        const existingPersisted = this._persistedCache.get(`${effectiveConnectionId}:${docPath}`);
        if (existingPersisted && existingPersisted.data && typeof existingPersisted.data === "object") {
          const clone = JSON.parse(JSON.stringify(existingPersisted.data));
          const segs = fieldPath.includes(".") ? fieldPath.split(".") : [fieldPath];
          let cur: any = clone;
          for (let i = 0; i < segs.length - 1; i++) {
            if (!cur[segs[i]] || typeof cur[segs[i]] !== "object") {
              cur[segs[i]] = {};
            }
            cur = cur[segs[i]];
          }
          cur[segs[segs.length - 1]] = JSON.parse(decoder.decode(serializedBytes));
          this._rememberPersistedDoc(effectiveConnectionId, docPath, clone);
        }
      }
      void SnapshotSyncService.getInstance().mirrorVirtualDocument(effectiveConnectionId, docPath, fieldPath, json);
      CostService.getInstance().recordOperation(effectiveConnectionId, "write", 1);
      // Invalidate again after the write completes so no stale snapshot survives.
      this._evictSnapshot(`${effectiveConnectionId}:${docPath}`);
      if (effectiveConnectionId !== connectionId) {
        this._evictSnapshot(`${connectionId}:${docPath}`);
      }
      this._emitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
    } catch (e: any) {
      if (e instanceof vscode.FileSystemError) {
        throw e;
      }
      throw vscode.FileSystemError.Unavailable(`Could not write Firestore document: ${e.message}`);
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
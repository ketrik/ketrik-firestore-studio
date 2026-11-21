import {
  CollectionReference,
  DocumentReference,
  FieldPath,
  OrderByDirection,
  QueryDocumentSnapshot,
} from "firebase-admin/firestore";
import * as vscode from "vscode";

import { ConnectionManager } from "../connections/ConnectionManager";
import { RulesService } from "../rules/RulesService";
import {
  AuthUserItem,
  AuthUsersBranchItem,
  CollectionItem,
  CompositeIndexItem,
  CompositeIndexesBranchItem,
  ConnectionTreeItem,
  CostQuotaBranchItem,
  DocumentFieldItem,
  DocumentItem,
  InfoMessageItem,
  Item,
  ShowMoreAuthUsersItem,
  ShowMoreItemsItem,
  StorageBucketsBranchItem,
  StorageBucketTreeItem,
  StorageFolderTreeItem,
  StorageFileTreeItem,
  SecretManagerBranchItem,
  SecretTreeItem,
  SecretVersionTreeItem,
} from "./items";
import { SecretManagerService } from "../secrets/SecretManagerService";
import { AuthService } from "../auth/AuthService";
import { IndexesService } from "../indexes/indexesService";
import { StorageService } from "../storage/storageService";
import { parseHostPort, probePort } from "../emulator/portUtils";
import { LocalJsonService } from "../services/LocalJsonService";
import { isTimestampLike, timestampToDate } from "../utils/timestampUtils";
import { CostService } from "../cost/costService";
import { matchesSearchTerm } from "../webview/common/tableUtils";

/** Maximum number of entries kept in the paging/orderBy state maps (LRU eviction). */
const MAX_MAP_SIZE = 200;
/** Maximum number of tree branch results cached in memory (LRU eviction). */
const MAX_TREE_CACHE_SIZE = 250;
/** Minimum duration the refresh progress/spinner remains visible so fast refreshes don't flicker or go unnoticed. */
const MIN_REFRESH_INDICATOR_MS = 500;

/**
 * Evict the oldest entry from a Map when it exceeds maxSize.
 * Maps preserve insertion order, so the first key is the oldest.
 */
function evictIfNeeded<K, V>(map: Map<K, V>, maxSize: number): void {
  if (map.size > maxSize) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) {
      map.delete(oldest);
    }
  }
}

/**
 * Provides the Firestore Studio Tree View data for multiple connections.
 */
export default class ExplorerDataProvider implements vscode.TreeDataProvider<Item>, vscode.Disposable {
  private _onDidChangeTreeData = new vscode.EventEmitter<Item | undefined>();
  private readonly _connectionManager = ConnectionManager.getInstance();

  private _paging = new Map<string, number>();
  private _authUsersPaging = new Map<string, { items: AuthUserItem[]; nextPageToken?: string }>();
  private _orderBy = new Map<string, { field: string | undefined; direction: "asc" | "desc" }>();
  private _collectionFilters = new Map<string, string>();
  private _collectionCounts = new Map<string, number>();
  private _connectionListener: vscode.Disposable;
  private _rulesListener: vscode.Disposable;
  private _configListener: vscode.Disposable;

  /** Canonical registry of live TreeItem instances currently tracked by VS Code's TreeView. */
  private _liveNodes = new Map<string, Item>();
  /** Timestamps of explicit direct node/parent refreshes to suppress duplicate 60ms FS-event invalidations. */
  private _recentDirectRefresh = new Map<string, number>();

  private _registerItems<T extends Item>(items: T[]): T[] {
    for (const it of items) {
      if (it.id) {
        this._liveNodes.set(it.id, it);
      }
    }
    if (this._liveNodes.size > 5000) {
      const oldest = this._liveNodes.keys().next().value;
      if (oldest !== undefined) {
        this._liveNodes.delete(oldest);
      }
    }
    return items;
  }

  public setCollectionCount(connectionId: string, collPath: string, count: number): void {
    const key = `${connectionId}:${collPath}`;
    this._collectionCounts.delete(key);
    this._collectionCounts.set(key, count);
    evictIfNeeded(this._collectionCounts, MAX_MAP_SIZE);
    const targetCol = this._updateCollectionInParentCache(connectionId, collPath);
    if (targetCol) {
      this._onDidChangeTreeData.fire(targetCol);
    }
  }

  public getCollectionCount(connectionId: string, collPath: string): number | undefined {
    return this._collectionCounts.get(`${connectionId}:${collPath}`);
  }

  private _updateCollectionInParentCache(connectionId: string, collPath: string): CollectionItem | undefined {
    const targetId = `col:${connectionId}:${collPath}`;
    const segs = collPath.split("/").filter(Boolean);
    const parentCacheKey =
      segs.length > 1
        ? `doc:${connectionId}:${segs.slice(0, -1).join("/")}`
        : `conn:${connectionId}`;

    const parentEntry = this._treeCache.get(parentCacheKey);
    const fromParent = parentEntry?.items.find(
      (it) => it instanceof CollectionItem && it.id === targetId
    ) as CollectionItem | undefined;
    const liveCol = (fromParent || this._liveNodes.get(targetId)) as CollectionItem | undefined;

    if (!liveCol) {
      if (parentEntry) {
        this._treeCache.delete(parentCacheKey);
      }
      return undefined;
    }

    const sortCfg = this._orderBy.get(`${connectionId}:${collPath}`);
    const filter = this.getCollectionFilter(connectionId, collPath);
    const docCount = this.getCollectionCount(connectionId, collPath);
    liveCol.updateMeta(
      {
        fieldName: sortCfg?.field ?? "id",
        direction: (sortCfg?.direction ?? "asc") as OrderByDirection,
      },
      filter,
      docCount
    );
    this._liveNodes.set(targetId, liveCol);
    return liveCol;
  }

  public setCollectionFilter(connectionId: string, collPath: string, filter: string): void {
    const key = `${connectionId}:${collPath}`;
    const trimmed = filter.trim();
    if (!trimmed) {
      this._collectionFilters.delete(key);
    } else {
      this._collectionFilters.delete(key);
      this._collectionFilters.set(key, trimmed);
      if (this._collectionFilters.size > 200) {
        const oldest = this._collectionFilters.keys().next().value;
        if (oldest !== undefined) {
          this._collectionFilters.delete(oldest);
        }
      }
    }
    this._deleteCachePrefix(`col:${connectionId}:${collPath}:`);
    const targetCol = this._updateCollectionInParentCache(connectionId, collPath);
    if (targetCol) {
      this._onDidChangeTreeData.fire(targetCol);
    }
  }

  public clearCollectionFilter(connectionId: string, collPath: string): void {
    const key = `${connectionId}:${collPath}`;
    this._collectionFilters.delete(key);
    this._deleteCachePrefix(`col:${connectionId}:${collPath}:`);
    const targetCol = this._updateCollectionInParentCache(connectionId, collPath);
    if (targetCol) {
      this._onDidChangeTreeData.fire(targetCol);
    }
  }

  public getCollectionFilter(connectionId: string, collPath: string): string | undefined {
    const key = `${connectionId}:${collPath}`;
    return this._collectionFilters.get(key);
  }

  /** Cache tree children (collections, docs, fields) to avoid re-requesting on repeated expand/collapse. */
  private _treeCache = new Map<string, { items: Item[]; timestamp: number }>();
  /** Short-lived hold cache so post-spinner UI redraws never trigger duplicate Firestore reads even when cacheTTLSeconds is 0. */
  private _shortHoldCache = new Map<string, { items: Item[]; expiresAt: number }>();
  private _debounceTimer: NodeJS.Timeout | undefined;
  private _pendingInvalidations = new Map<string, "changed" | "deleted">();

  private _treeView: vscode.TreeView<Item> | undefined;
  private _treeViewDisposables: vscode.Disposable[] = [];
  private _expandedNodeIds = new Set<string>();
  private _expandedDocIds = new Set<string>();
  private _expandedFieldIds = new Set<string>();
  private _refreshingNodeIds = new Set<string>();
  private _refreshGenerations = new Map<string, number>();
  private _refreshWaiters = new Map<string, Array<() => void>>();
  private _revealingDoc: { connectionId: string; docPath: string; docId: string } | null = null;
  private _revealDebounceTimer: NodeJS.Timeout | undefined;

  private _deleteCacheKey(key: string): void {
    this._treeCache.delete(key);
    this._shortHoldCache.delete(key);
  }

  private _deleteCachePrefix(prefix: string): void {
    for (const k of this._treeCache.keys()) {
      if (k.startsWith(prefix)) {
        this._treeCache.delete(k);
      }
    }
    for (const k of this._shortHoldCache.keys()) {
      if (k.startsWith(prefix)) {
        this._shortHoldCache.delete(k);
      }
    }
  }

  private _notifyRefreshWaiters(nodeId: string): void {
    const waiters = this._refreshWaiters.get(nodeId);
    if (!waiters || waiters.length === 0) {
      return;
    }
    this._refreshWaiters.delete(nodeId);
    for (const resolve of waiters) {
      resolve();
    }
  }

  private _waitForGetChildren(nodeId: string, timeoutMs = 15000): Promise<void> {
    return new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        const list = this._refreshWaiters.get(nodeId);
        if (list) {
          const idx = list.indexOf(done);
          if (idx !== -1) list.splice(idx, 1);
          if (list.length === 0) this._refreshWaiters.delete(nodeId);
        }
        done();
      }, timeoutMs);
      const list = this._refreshWaiters.get(nodeId) ?? [];
      list.push(done);
      this._refreshWaiters.set(nodeId, list);
    });
  }

  public setTreeView(treeView: vscode.TreeView<Item>): void {
    for (const d of this._treeViewDisposables) {
      d.dispose();
    }
    this._treeViewDisposables = [];
    this._treeView = treeView;

    this._treeViewDisposables.push(
      treeView.onDidExpandElement((e) => {
        if (e.element.id) {
          this._expandedNodeIds.add(e.element.id);
        }
        if (e.element instanceof DocumentItem) {
          const docKey = `doc:${e.element.connectionId}:${e.element.reference.path}`;
          this._expandedDocIds.add(docKey);
        } else if (e.element instanceof DocumentFieldItem && e.element.id) {
          this._expandedFieldIds.add(e.element.id);
        }
      }),
      treeView.onDidCollapseElement((e) => {
        if (e.element.id) {
          this._expandedNodeIds.delete(e.element.id);
        }
        if (e.element instanceof DocumentItem) {
          const docKey = `doc:${e.element.connectionId}:${e.element.reference.path}`;
          this._expandedDocIds.delete(docKey);
        } else if (e.element instanceof DocumentFieldItem && e.element.id) {
          this._expandedFieldIds.delete(e.element.id);
        }
      })
    );
  }

  readonly onDidChangeTreeData: vscode.Event<Item | undefined> =
    this._onDidChangeTreeData.event;

  constructor() {
    this._connectionListener = this._connectionManager.onDidChangeConnections(() => {
      this.refresh(true);
    });

    this._rulesListener = RulesService.getInstance().onDidChangeRules(() => {
      this.refresh(true);
    });

    this._configListener = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("ketrik-firestore-studio.authProfileCollection")) {
        this._authUsersPaging.clear();
        this._deleteCachePrefix("auth:");
        const branches = Array.from(this._liveNodes.values()).filter(
          (node): node is AuthUsersBranchItem => node instanceof AuthUsersBranchItem
        );
        if (branches.length > 0) {
          for (const branch of branches) {
            this._onDidChangeTreeData.fire(branch);
          }
        } else {
          this.refresh();
        }
      }
    });
  }

  private getCacheTTL(): number {
    const seconds = vscode.workspace
      .getConfiguration("ketrik-firestore-studio")
      .get<number>("cacheTTLSeconds", 30);
    return Math.max(0, seconds) * 1000;
  }

  dispose(): void {
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
    }
    if (this._revealDebounceTimer) {
      clearTimeout(this._revealDebounceTimer);
      this._revealDebounceTimer = undefined;
    }
    for (const d of this._treeViewDisposables) {
      d.dispose();
    }
    for (const nodeId of Array.from(this._refreshWaiters.keys())) {
      this._notifyRefreshWaiters(nodeId);
    }
    this._treeViewDisposables = [];
    this._expandedNodeIds.clear();
    this._expandedDocIds.clear();
    this._expandedFieldIds.clear();
    this._refreshingNodeIds.clear();
    this._refreshGenerations.clear();
    this._pendingInvalidations.clear();
    this._liveNodes.clear();
    this._recentDirectRefresh.clear();
    this._connectionListener.dispose();
    this._rulesListener.dispose();
    this._configListener.dispose();
    this._onDidChangeTreeData.dispose();
    this._paging.clear();
    this._authUsersPaging.clear();
    this._orderBy.clear();
    this._treeCache.clear();
    this._shortHoldCache.clear();
    this._collectionFilters.clear();
    this._collectionCounts.clear();
  }

  refresh(resetState = false): void {
    this._treeCache.clear();
    this._shortHoldCache.clear();
    this._pendingInvalidations.clear();
    if (resetState) {
      this._liveNodes.clear();
      this._recentDirectRefresh.clear();
      this._paging.clear();
      this._authUsersPaging.clear();
      this._orderBy.clear();
      this._collectionCounts.clear();
      this._expandedNodeIds.clear();
      this._expandedDocIds.clear();
      this._expandedFieldIds.clear();
    }
    this._onDidChangeTreeData.fire(undefined);
  }

  private _isRecentDirectRefresh(connectionId: string, docPath: string): boolean {
    const ts = this._recentDirectRefresh.get(`${connectionId}:${docPath}`);
    return ts !== undefined && Date.now() - ts < 250;
  }

  private _markRecentDirectRefresh(connectionId: string, docPath: string): void {
    const key = `${connectionId}:${docPath}`;
    this._recentDirectRefresh.set(key, Date.now());
    this._pendingInvalidations.delete(key);
    evictIfNeeded(this._recentDirectRefresh, MAX_MAP_SIZE);
  }

  private _findLiveDocument(connectionId: string, docPath: string): DocumentItem | undefined {
    const targetDocId = `doc:${connectionId}:${docPath}`;
    const fromRegistry = this._liveNodes.get(targetDocId);
    if (fromRegistry instanceof DocumentItem) {
      return fromRegistry;
    }
    for (const [k, v] of this._treeCache.entries()) {
      if (k.startsWith(`col:${connectionId}:`)) {
        const match = v.items.find(
          (it) => it instanceof DocumentItem && it.id === targetDocId
        ) as DocumentItem | undefined;
        if (match) {
          this._liveNodes.set(targetDocId, match);
          return match;
        }
      }
    }
    return undefined;
  }

  private _findLiveCollection(connectionId: string, collPath: string): CollectionItem | undefined {
    const targetColId = `col:${connectionId}:${collPath}`;
    const fromRegistry = this._liveNodes.get(targetColId);
    if (fromRegistry instanceof CollectionItem) {
      return fromRegistry;
    }
    return this._updateCollectionInParentCache(connectionId, collPath);
  }

  /**
   * Handle virtual file change events from DocumentFileSystemProvider with debouncing
   * and granular branch invalidation. Avoids full tree cache flushes on document saves.
   */
  public handleFileChanges(events: readonly vscode.FileChangeEvent[]): void {
    let added = false;
    for (const ev of events) {
      const uri = ev.uri;
      const connectionId = uri.authority;
      let pathStr = uri.path.startsWith("/") ? uri.path.slice(1) : uri.path;
      if (pathStr.endsWith(".json")) {
        pathStr = pathStr.slice(0, -5);
      }
      if (pathStr === "firestore.rules" || pathStr.endsWith("/firestore.rules")) {
        continue;
      }
      const segments = pathStr.split("/").filter(Boolean);
      // If odd segments >= 3, last segment was a fieldPath (field-level deletion only changes the parent doc)
      const isFieldUri = segments.length % 2 === 1 && segments.length >= 3;
      if (isFieldUri) {
        segments.pop();
      }
      const docPath = segments.join("/");
      if (!docPath || !connectionId) {
        continue;
      }
      if (this._isRecentDirectRefresh(connectionId, docPath)) {
        continue;
      }
      const key = `${connectionId}:${docPath}`;
      const kind: "changed" | "deleted" =
        !isFieldUri && ev.type === vscode.FileChangeType.Deleted ? "deleted" : "changed";
      const prev = this._pendingInvalidations.get(key);
      this._pendingInvalidations.set(key, prev === "deleted" || kind === "deleted" ? "deleted" : "changed");
      added = true;
    }

    if (!added) {
      return;
    }

    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
    }

    this._debounceTimer = setTimeout(() => {
      this._flushPendingInvalidations();
    }, 60);
  }

  private _flushPendingInvalidations(): void {
    if (this._pendingInvalidations.size === 0) return;

    const changedDocs: Array<{ connectionId: string; docPath: string }> = [];
    const deletedParents = new Map<string, { connectionId: string; collPath: string }>();

    for (const [key, kind] of this._pendingInvalidations.entries()) {
      const sep = key.indexOf(":");
      if (sep === -1) continue;
      const connectionId = key.substring(0, sep);
      const docPath = key.substring(sep + 1);

      if (this._isRecentDirectRefresh(connectionId, docPath)) {
        continue;
      }

      // Always invalidate the document node cache and subfield caches
      this._deleteCacheKey(`doc:${connectionId}:${docPath}`);
      this._deleteCachePrefix(`field:${connectionId}:${docPath}#`);

      if (kind === "deleted") {
        this._deleteCachePrefix(`col:${connectionId}:${docPath}/`);
        this._deleteCachePrefix(`doc:${connectionId}:${docPath}/`);
        const parentCollPath = docPath.includes("/") ? docPath.substring(0, docPath.lastIndexOf("/")) : "";
        if (parentCollPath) {
          this._collectionCounts.delete(`${connectionId}:${parentCollPath}`);
          this._deleteCachePrefix(`col:${connectionId}:${parentCollPath}:`);
          deletedParents.set(`${connectionId}:${parentCollPath}`, { connectionId, collPath: parentCollPath });
        }
      } else {
        changedDocs.push({ connectionId, docPath });
      }
    }

    this._pendingInvalidations.clear();

    // Refresh only deleted parent collections
    for (const { connectionId, collPath } of deletedParents.values()) {
      const parentCol = this._findLiveCollection(connectionId, collPath);
      if (parentCol) {
        this._onDidChangeTreeData.fire(parentCol);
      }
    }

    // Refresh only changed documents (or parent collection if the doc is newly created and not yet tracked)
    for (const { connectionId, docPath } of changedDocs) {
      const matchedDoc = this._findLiveDocument(connectionId, docPath);
      if (matchedDoc) {
        this._onDidChangeTreeData.fire(matchedDoc);
      } else {
        const parentCollPath = docPath.includes("/") ? docPath.substring(0, docPath.lastIndexOf("/")) : "";
        if (parentCollPath) {
          this._deleteCachePrefix(`col:${connectionId}:${parentCollPath}:`);
          const parentCol = this._findLiveCollection(connectionId, parentCollPath);
          if (parentCol) {
            this._onDidChangeTreeData.fire(parentCol);
          }
        }
      }
    }
  }

  private _resolveRefreshTarget(element: Item): Item | undefined {
    const live = (element.id ? this._liveNodes.get(element.id) : undefined) || element;
    if (element instanceof DocumentFieldItem) {
      const docPath = element.parentDocRef.path;
      const targetDoc = this._findLiveDocument(element.connectionId, docPath);
      if (targetDoc) {
        return targetDoc;
      }
      const parentCollPath = docPath.includes("/") ? docPath.substring(0, docPath.lastIndexOf("/")) : "";
      return parentCollPath ? this._findLiveCollection(element.connectionId, parentCollPath) : undefined;
    }
    if (element instanceof CollectionItem) {
      return this._findLiveCollection(element.connectionId, element.reference.path) || live;
    }
    if (element instanceof AuthUsersBranchItem || element instanceof AuthUserItem) {
      return this._liveNodes.get(`auth:${element.connectionId}`) || (element instanceof AuthUsersBranchItem ? live : undefined);
    }
    if (element instanceof CompositeIndexesBranchItem || element instanceof CompositeIndexItem) {
      return this._liveNodes.get(`indexes:${element.connectionId}`) || (element instanceof CompositeIndexesBranchItem ? live : undefined);
    }
    if (element instanceof StorageBucketsBranchItem) {
      return this._liveNodes.get(`storage:${element.connectionId}`) || live;
    }
    if (element instanceof StorageFileTreeItem) {
      const fileName = element.fileData.name;
      const folderPrefix = fileName.includes("/") ? fileName.substring(0, fileName.lastIndexOf("/") + 1) : "";
      return (
        (folderPrefix
          ? this._liveNodes.get(`storageFolder:${element.connectionId}:${element.bucketName}:${folderPrefix}`)
          : undefined) ||
        this._liveNodes.get(`storageBucket:${element.connectionId}:${element.bucketName}`)
      );
    }
    if (element instanceof SecretManagerBranchItem) {
      return this._liveNodes.get(`secrets:${element.connectionId}`) || live;
    }
    if (element instanceof SecretTreeItem) {
      return (
        this._liveNodes.get(`secrets:${element.connectionId}`) ||
        this._treeCache
          .get(`conn:${element.connectionId}`)
          ?.items.find((it) => it instanceof SecretManagerBranchItem && it.connectionId === element.connectionId)
      );
    }
    if (element instanceof SecretVersionTreeItem) {
      return (
        this._liveNodes.get(`secret:${element.connectionId}:${element.version.secretId}`) ||
        this._treeCache
          .get(`secrets:${element.connectionId}`)
          ?.items.find((it) => it instanceof SecretTreeItem && it.secret.id === element.version.secretId)
      );
    }
    if (
      element instanceof DocumentItem ||
      element instanceof ConnectionTreeItem ||
      element instanceof StorageBucketTreeItem ||
      element instanceof StorageFolderTreeItem
    ) {
      return live;
    }
    return undefined;
  }

  /**
   * Refresh the entire explorer with a view-level progress indicator held for at least MIN_REFRESH_INDICATOR_MS.
   */
  public async refreshWithFeedback(resetState = false): Promise<void> {
    await vscode.window.withProgress(
      { location: { viewId: "ketrik-firestore-studio-view" } },
      async () => {
        const waitRoot = this._waitForGetChildren("root", 5000);
        const minDelay = new Promise<void>((r) => setTimeout(r, MIN_REFRESH_INDICATOR_MS));
        this.refresh(resetState);
        await Promise.all([waitRoot, minDelay]);
      }
    );
  }

  /**
   * Refresh a specific node (or its parent document/branch) with both a view-level progress bar
   * and an in-row spinning icon held visible for at least MIN_REFRESH_INDICATOR_MS,
   * without triggering any extra Firestore reads when restoring the icon.
   */
  public async refreshNodeWithFeedback(element?: Item): Promise<void> {
    if (!element) {
      return this.refreshWithFeedback(false);
    }

    const resolved = this._resolveRefreshTarget(element);
    if (!resolved) {
      return this.refreshWithFeedback(false);
    }
    const target = resolved;

    const spinIds: string[] = [];
    if (target.id) {
      spinIds.push(target.id);
    }
    if (element instanceof DocumentFieldItem && element.id && !spinIds.includes(element.id)) {
      spinIds.push(element.id);
    }

    const startedGens = new Map<string, number>();
    for (const id of spinIds) {
      const nextGen = (this._refreshGenerations.get(id) ?? 0) + 1;
      this._refreshGenerations.set(id, nextGen);
      startedGens.set(id, nextGen);
      this._refreshingNodeIds.add(id);
    }

    const isExpanded = !!(
      target.id &&
      (this._expandedNodeIds.has(target.id) ||
        this._expandedDocIds.has(target.id) ||
        this._expandedFieldIds.has(target.id))
    );

    try {
      await vscode.window.withProgress(
        { location: { viewId: "ketrik-firestore-studio-view" } },
        async () => {
          const waitFetch = isExpanded && target.id ? this._waitForGetChildren(target.id) : Promise.resolve();
          const minDelay = new Promise<void>((r) => setTimeout(r, MIN_REFRESH_INDICATOR_MS));
          this.refreshNode(element);
          await Promise.all([waitFetch, minDelay]);
        }
      );
    } finally {
      for (const [id, gen] of startedGens.entries()) {
        if (this._refreshGenerations.get(id) === gen) {
          this._refreshingNodeIds.delete(id);
          this._refreshGenerations.delete(id);
        }
      }
      this._onDidChangeTreeData.fire(target);
    }
  }

  /**
   * Refresh a specific item (or parent document when invoked on a field)
   * while keeping all unrelated nodes and caches intact.
   */
  refreshNode(element?: Item): void {
    if (!element) {
      this.refresh();
      return;
    }

    const live = (element.id ? this._liveNodes.get(element.id) : undefined) || element;

    if (element instanceof DocumentItem) {
      const docPath = element.reference.path;
      this._markRecentDirectRefresh(element.connectionId, docPath);
      this._deleteCacheKey(`doc:${element.connectionId}:${docPath}`);
      this._deleteCachePrefix(`field:${element.connectionId}:${docPath}#`);
      this._deleteCachePrefix(`col:${element.connectionId}:${docPath}/`);
      this._onDidChangeTreeData.fire(live);
    } else if (element instanceof DocumentFieldItem) {
      const docPath = element.parentDocRef.path;
      this._markRecentDirectRefresh(element.connectionId, docPath);
      this._deleteCacheKey(`doc:${element.connectionId}:${docPath}`);
      if (element.id) {
        this._deleteCacheKey(element.id);
      }
      this._deleteCachePrefix(`field:${element.connectionId}:${docPath}#`);

      const targetDocItem = this._findLiveDocument(element.connectionId, docPath);
      if (targetDocItem) {
        this._onDidChangeTreeData.fire(targetDocItem);
      } else {
        const parentCollPath = docPath.includes("/") ? docPath.substring(0, docPath.lastIndexOf("/")) : "";
        if (parentCollPath) {
          this._deleteCachePrefix(`col:${element.connectionId}:${parentCollPath}:`);
          const parentCol = this._findLiveCollection(element.connectionId, parentCollPath);
          if (parentCol) {
            this._onDidChangeTreeData.fire(parentCol);
          }
        }
      }
    } else if (element instanceof CollectionItem) {
      const collPath = element.reference.path;
      this._collectionCounts.delete(`${element.connectionId}:${collPath}`);
      this._deleteCachePrefix(`col:${element.connectionId}:${collPath}:`);
      this._deleteCachePrefix(`col:${element.connectionId}:${collPath}/`);
      this._deleteCachePrefix(`doc:${element.connectionId}:${collPath}/`);
      this._deleteCachePrefix(`field:${element.connectionId}:${collPath}/`);
      const liveCol = this._updateCollectionInParentCache(element.connectionId, collPath) || (live as CollectionItem);
      this._onDidChangeTreeData.fire(liveCol);
    } else if (element instanceof AuthUsersBranchItem) {
      this._deleteCacheKey(`auth:${element.connectionId}`);
      this._authUsersPaging.delete(element.connectionId);
      const targetBranch = this._liveNodes.get(`auth:${element.connectionId}`) || live;
      this._onDidChangeTreeData.fire(targetBranch);
    } else if (element instanceof AuthUserItem) {
      this._deleteCacheKey(`auth:${element.connectionId}`);
      this._authUsersPaging.delete(element.connectionId);
      const targetBranch = this._liveNodes.get(`auth:${element.connectionId}`);
      if (targetBranch) {
        this._onDidChangeTreeData.fire(targetBranch);
      }
    } else if (element instanceof CompositeIndexesBranchItem) {
      this._deleteCacheKey(`indexes:${element.connectionId}`);
      const targetBranch = this._liveNodes.get(`indexes:${element.connectionId}`) || live;
      this._onDidChangeTreeData.fire(targetBranch);
    } else if (element instanceof CompositeIndexItem) {
      this._deleteCacheKey(`indexes:${element.connectionId}`);
      const targetBranch = this._liveNodes.get(`indexes:${element.connectionId}`);
      if (targetBranch) {
        this._onDidChangeTreeData.fire(targetBranch);
      }
    } else if (element instanceof StorageBucketsBranchItem) {
      this._deleteCacheKey(`storage:${element.connectionId}`);
      const targetBranch = this._liveNodes.get(`storage:${element.connectionId}`) || live;
      this._onDidChangeTreeData.fire(targetBranch);
    } else if (element instanceof StorageBucketTreeItem) {
      this._deleteCachePrefix(`storageFiles:${element.connectionId}:${element.bucketName}:`);
      this._onDidChangeTreeData.fire(live);
    } else if (element instanceof StorageFolderTreeItem) {
      const folderKey = `storageFiles:${element.connectionId}:${element.bucketName}:${element.prefix}`;
      this._deleteCacheKey(folderKey);
      this._deleteCachePrefix(folderKey.endsWith("/") ? folderKey : folderKey + "/");
      this._onDidChangeTreeData.fire(live);
    } else if (element instanceof StorageFileTreeItem) {
      this._deleteCachePrefix(`storageFiles:${element.connectionId}:${element.bucketName}:`);
      const fileName = element.fileData.name;
      const folderPrefix = fileName.includes("/")
        ? fileName.substring(0, fileName.lastIndexOf("/") + 1)
        : "";
      const targetParent =
        (folderPrefix
          ? this._liveNodes.get(`storageFolder:${element.connectionId}:${element.bucketName}:${folderPrefix}`)
          : undefined) ||
        this._liveNodes.get(`storageBucket:${element.connectionId}:${element.bucketName}`);
      if (targetParent) {
        this._onDidChangeTreeData.fire(targetParent);
      }
    } else if (element instanceof ConnectionTreeItem) {
      const connId = element.config.id;
      const prefixes = [
        `conn:${connId}`,
        `col:${connId}:`,
        `doc:${connId}:`,
        `field:${connId}:`,
        `auth:${connId}`,
        `indexes:${connId}`,
        `storage:${connId}`,
        `storageFiles:${connId}:`,
        `secrets:${connId}`,
        `secretVersions:${connId}:`,
      ];
      for (const p of prefixes) {
        this._deleteCacheKey(p);
        this._deleteCachePrefix(p);
      }
      this._onDidChangeTreeData.fire(live);
    } else if (element instanceof SecretManagerBranchItem) {
      this.refreshSecrets(element.connectionId, live as SecretManagerBranchItem);
    } else if (element instanceof SecretTreeItem) {
      this._deleteCacheKey(`secrets:${element.connectionId}`);
      this._deleteCacheKey(`secretVersions:${element.connectionId}:${element.secret.id}`);
      const branch =
        this._liveNodes.get(`secrets:${element.connectionId}`) ||
        this._treeCache
          .get(`conn:${element.connectionId}`)
          ?.items.find((it) => it instanceof SecretManagerBranchItem && it.connectionId === element.connectionId);
      if (branch) {
        this._onDidChangeTreeData.fire(branch);
      }
    } else if (element instanceof SecretVersionTreeItem) {
      this._deleteCacheKey(`secretVersions:${element.connectionId}:${element.version.secretId}`);
      const secretNode =
        this._liveNodes.get(`secret:${element.connectionId}:${element.version.secretId}`) ||
        this._treeCache
          .get(`secrets:${element.connectionId}`)
          ?.items.find((it) => it instanceof SecretTreeItem && it.secret.id === element.version.secretId);
      if (secretNode) {
        this._onDidChangeTreeData.fire(secretNode);
      }
    } else {
      this.refresh();
    }
  }

  /**
   * Remove cached counts, filters, sort order, and paging state for a deleted collection and its subcollections.
   */
  public clearCollectionMetadata(connectionId: string, collPath: string): void {
    const exact = `${connectionId}:${collPath}`;
    const prefix = `${exact}/`;
    for (const map of [
      this._collectionCounts,
      this._collectionFilters,
      this._orderBy,
      this._paging,
    ] as Array<Map<string, any>>) {
      map.delete(exact);
      for (const k of Array.from(map.keys())) {
        if (k.startsWith(prefix)) {
          map.delete(k);
        }
      }
    }
  }

  private _invalidateProfileCollectionBranch(
    connectionId: string,
    profileCollectionPath: string,
    docPaths: string[]
  ): void {
    this._collectionCounts.delete(`${connectionId}:${profileCollectionPath}`);
    this._deleteCachePrefix(`col:${connectionId}:${profileCollectionPath}:`);
    for (const docPath of docPaths) {
      this._markRecentDirectRefresh(connectionId, docPath);
      this._deleteCacheKey(`doc:${connectionId}:${docPath}`);
      this._deleteCachePrefix(`doc:${connectionId}:${docPath}/`);
      this._deleteCachePrefix(`field:${connectionId}:${docPath}#`);
      this._deleteCachePrefix(`col:${connectionId}:${docPath}/`);
    }

    const liveCol = this._findLiveCollection(connectionId, profileCollectionPath);
    if (liveCol) {
      this._onDidChangeTreeData.fire(liveCol);
    }
  }

  /**
   * Granularly update the Explorer tree after deleting an Auth user and optionally their Firestore profile.
   * Preserves Auth pagination state and updates both the Auth branch and the profile collection branch.
   */
  public refreshAfterAuthUserDeleted(
    connectionId: string,
    uid: string,
    profileCollectionPath?: string,
    deletedProfileDocPaths?: string[]
  ): void {
    const pagingState = this._authUsersPaging.get(connectionId);
    if (pagingState) {
      this._authUsersPaging.set(connectionId, {
        items: pagingState.items.filter((it) => it.user.uid !== uid),
        nextPageToken: pagingState.nextPageToken,
      });
    }
    this._liveNodes.delete(`authUser:${connectionId}:${uid}`);
    this._deleteCacheKey(`auth:${connectionId}`);
    const authBranch = this._liveNodes.get(`auth:${connectionId}`);
    if (authBranch) {
      this._onDidChangeTreeData.fire(authBranch);
    }

    if (profileCollectionPath) {
      const targetPaths =
        deletedProfileDocPaths && deletedProfileDocPaths.length > 0
          ? deletedProfileDocPaths
          : [`${profileCollectionPath}/${uid}`];
      this._invalidateProfileCollectionBranch(connectionId, profileCollectionPath, targetPaths);
    }
  }

  /**
   * Granularly update the Explorer tree after deleting ONLY a user's Firestore profile (keeping their Auth user).
   * Flips the matching AuthUserItem back to noProfile and refreshes the profile collection branch.
   */
  public refreshAfterAuthUserProfileDeleted(
    connectionId: string,
    uid: string,
    profileCollectionPath: string,
    deletedProfileDocPaths?: string[]
  ): void {
    const pagingState = this._authUsersPaging.get(connectionId);
    if (pagingState) {
      const updatedItems = pagingState.items.map((it) => {
        if (it.user.uid === uid) {
          const replacement = new AuthUserItem(it.user, connectionId, false, profileCollectionPath);
          if (replacement.id) {
            this._liveNodes.set(replacement.id, replacement);
          }
          return replacement;
        }
        return it;
      });
      this._authUsersPaging.set(connectionId, {
        items: updatedItems,
        nextPageToken: pagingState.nextPageToken,
      });
    }

    this._deleteCacheKey(`auth:${connectionId}`);
    const authBranch = this._liveNodes.get(`auth:${connectionId}`);
    if (authBranch) {
      this._onDidChangeTreeData.fire(authBranch);
    }

    const targetPaths =
      deletedProfileDocPaths && deletedProfileDocPaths.length > 0
        ? deletedProfileDocPaths
        : [`${profileCollectionPath}/${uid}`];
    this._invalidateProfileCollectionBranch(connectionId, profileCollectionPath, targetPaths);
  }

  /**
   * Granularly update the Explorer tree after bulk deleting multiple Firebase Auth users (and optionally profiles).
   */
  public refreshAfterAuthUsersBulkDeleted(
    connectionId: string,
    deletedUids: string[],
    profileCollectionPath?: string
  ): void {
    if (!deletedUids || deletedUids.length === 0) {
      return;
    }
    const uidSet = new Set(deletedUids);
    const pagingState = this._authUsersPaging.get(connectionId);
    if (pagingState) {
      this._authUsersPaging.set(connectionId, {
        items: pagingState.items.filter((it) => !uidSet.has(it.user.uid)),
        nextPageToken: pagingState.nextPageToken,
      });
    }
    for (const uid of deletedUids) {
      this._liveNodes.delete(`authUser:${connectionId}:${uid}`);
    }
    this._deleteCacheKey(`auth:${connectionId}`);
    const authBranch = this._liveNodes.get(`auth:${connectionId}`);
    if (authBranch) {
      this._onDidChangeTreeData.fire(authBranch);
    }

    if (profileCollectionPath) {
      const docPaths = deletedUids.map((uid) => `${profileCollectionPath}/${uid}`);
      this._invalidateProfileCollectionBranch(connectionId, profileCollectionPath, docPaths);
    }
  }

  /**
   * Granularly invalidate and refresh the Google Secret Manager branch (and its version caches)
   * for a specific connection without discarding unrelated tree caches or paging state.
   */
  public refreshSecrets(connectionId: string, branchElement?: SecretManagerBranchItem): void {
    this._deleteCacheKey(`secrets:${connectionId}`);
    this._deleteCachePrefix(`secretVersions:${connectionId}:`);
    const targetBranch =
      branchElement ??
      this._liveNodes.get(`secrets:${connectionId}`) ??
      this._treeCache.get(`conn:${connectionId}`)?.items.find(
        (it) => it instanceof SecretManagerBranchItem && it.connectionId === connectionId
      );
    if (targetBranch) {
      this._onDidChangeTreeData.fire(targetBranch);
    }
  }

  public isDocumentExpanded(connectionId: string, docPath: string): boolean {
    return this._expandedDocIds.has(`doc:${connectionId}:${docPath}`);
  }

  public isFieldExpanded(fieldId?: string): boolean {
    return !!(fieldId && this._expandedFieldIds.has(fieldId));
  }

  public async expandItem(item: Item): Promise<void> {
    if (this._treeView) {
      try {
        await this._treeView.reveal(item, { select: true, focus: false, expand: true });
      } catch {
        // Silently ignore if tree node cannot be revealed
      }
    }
  }

  getTreeItem(element: Item): vscode.TreeItem {
    if (element.id && this._refreshingNodeIds.has(element.id)) {
      const spinningItem = new vscode.TreeItem(element.label ?? "", element.collapsibleState);
      spinningItem.id = element.id;
      spinningItem.description = element.description;
      spinningItem.tooltip = element.tooltip;
      spinningItem.contextValue = element.contextValue;
      spinningItem.command = element.command;
      spinningItem.resourceUri = element.resourceUri;
      spinningItem.accessibilityInformation = element.accessibilityInformation;
      spinningItem.iconPath = new vscode.ThemeIcon("sync~spin", new vscode.ThemeColor("charts.blue"));
      return spinningItem;
    }
    return element;
  }

  async getParent(element: Item): Promise<Item | undefined> {
    if (element instanceof DocumentItem) {
      if (element.reference && element.reference.parent) {
        return new CollectionItem(
          element.reference.parent.id,
          element.reference.parent,
          element.connectionId
        );
      }
      const pathStr = element.reference?.path || "";
      const segments = pathStr.split("/").filter(Boolean);
      if (segments.length >= 2) {
        segments.pop(); // remove docId
        const collPath = segments.join("/");
        const collId = segments[segments.length - 1];
        const fakeCollRef = { id: collId, path: collPath } as any;
        return new CollectionItem(collId, fakeCollRef, element.connectionId);
      }
      return undefined;
    } else if (element instanceof CollectionItem) {
      if (element.reference && element.reference.parent) {
        return new DocumentItem(
          element.reference.parent.id,
          element.reference.parent,
          element.connectionId
        );
      }
      const pathStr = element.reference?.path || "";
      const segments = pathStr.split("/").filter(Boolean);
      if (segments.length > 1) {
        segments.pop(); // remove collId
        const docPath = segments.join("/");
        const docId = segments[segments.length - 1];
        const fakeDocRef = { id: docId, path: docPath } as any;
        return new DocumentItem(docId, fakeDocRef, element.connectionId);
      }
      const conn = this._connectionManager.getConnection(element.connectionId);
      return conn ? new ConnectionTreeItem(conn) : undefined;
    } else if (element instanceof DocumentFieldItem) {
      if (element.parentFieldItem) {
        return element.parentFieldItem;
      }
      return new DocumentItem(
        element.parentDocRef.id,
        element.parentDocRef,
        element.connectionId
      );
    } else if (element instanceof AuthUserItem || element instanceof ShowMoreAuthUsersItem) {
      return new AuthUsersBranchItem(element.connectionId);
    } else if (element instanceof ShowMoreItemsItem) {
      return new CollectionItem(
        element.reference.id,
        element.reference,
        element.connectionId
      );
    } else if (
      element instanceof AuthUsersBranchItem ||
      element instanceof CompositeIndexesBranchItem ||
      element instanceof CostQuotaBranchItem ||
      element instanceof StorageBucketsBranchItem ||
      element instanceof SecretManagerBranchItem
    ) {
      const conn = this._connectionManager.getConnection(element.connectionId);
      return conn ? new ConnectionTreeItem(conn) : undefined;
    } else if (element instanceof SecretTreeItem) {
      return new SecretManagerBranchItem(element.connectionId);
    } else if (element instanceof SecretVersionTreeItem) {
      const secretsCache = this._treeCache.get(`secrets:${element.connectionId}`);
      return secretsCache?.items.find(
        (it) => it instanceof SecretTreeItem && it.secret.id === element.version.secretId
      );
    } else if (element instanceof CompositeIndexItem) {
      return new CompositeIndexesBranchItem(element.connectionId);
    } else if (element instanceof StorageBucketTreeItem) {
      return new StorageBucketsBranchItem(element.connectionId);
    } else if (element instanceof StorageFolderTreeItem) {
      return new StorageBucketTreeItem(element.connectionId, element.bucketName);
    } else if (element instanceof StorageFileTreeItem) {
      return new StorageBucketTreeItem(element.connectionId, element.bucketName);
    }
    return undefined;
  }

  async getChildren(element?: Item): Promise<Item[] | undefined> {
    try {
      return await this._getChildrenInternal(element);
    } finally {
      this._notifyRefreshWaiters(element?.id ?? "root");
    }
  }

  private async _getChildrenInternal(element?: Item): Promise<Item[] | undefined> {
    const defaultLimit =
      (vscode.workspace
        .getConfiguration("ketrik-firestore-studio")
        .get<number>("pagingLimit")) ?? 10;

    if (!element) {
      const connections = this._connectionManager.getConnections();
      if (connections.length === 0) {
        return [];
      }
      return this._registerItems(connections.map((conn) => new ConnectionTreeItem(conn)));
    }

    const ttl = this.getCacheTTL();
    const cacheKey = element
      ? element instanceof ConnectionTreeItem
        ? `conn:${element.config.id}`
        : element instanceof DocumentItem
        ? `doc:${element.connectionId}:${element.reference.path}`
        : element instanceof CollectionItem
        ? `col:${element.connectionId}:${element.reference.path}:${this._paging.get(`${element.connectionId}:${element.reference.path}`) ?? defaultLimit}:${this._orderBy.get(`${element.connectionId}:${element.reference.path}`)?.field ?? "id"}:${this._orderBy.get(`${element.connectionId}:${element.reference.path}`)?.direction ?? "asc"}:${this.getCollectionFilter(element.connectionId, element.reference.path) ?? ""}`
        : element instanceof AuthUsersBranchItem
        ? `auth:${element.connectionId}`
        : element instanceof CompositeIndexesBranchItem
        ? `indexes:${element.connectionId}`
        : element instanceof StorageBucketsBranchItem
        ? `storage:${element.connectionId}`
        : element instanceof StorageBucketTreeItem
        ? `storageFiles:${element.connectionId}:${element.bucketName}:root`
        : element instanceof StorageFolderTreeItem
        ? `storageFiles:${element.connectionId}:${element.bucketName}:${element.prefix}`
        : element instanceof SecretManagerBranchItem
        ? `secrets:${element.connectionId}`
        : element instanceof SecretTreeItem
        ? `secretVersions:${element.connectionId}:${element.secret.id}`
        : element instanceof DocumentFieldItem
        ? (element.id || `field:${element.connectionId}:${element.parentDocRef.path}#${element.fullFieldPath}`)
        : undefined
      : "root";

    if (cacheKey) {
      let cached = ttl > 0 ? this._treeCache.get(cacheKey) : undefined;
      if (!cached) {
        const hold = this._shortHoldCache.get(cacheKey);
        if (hold && Date.now() < hold.expiresAt) {
          cached = { items: hold.items, timestamp: hold.expiresAt };
        } else if (hold) {
          this._shortHoldCache.delete(cacheKey);
        }
      }
      if (cached) {
        if (
          this._revealingDoc &&
          element instanceof CollectionItem &&
          this._revealingDoc.connectionId === element.connectionId &&
          (this._revealingDoc.docPath.startsWith(element.reference.path + "/") ||
            element.reference.path === this._revealingDoc.docPath.split("/").slice(0, -1).join("/")) &&
          !cached.items.some((it) => it.id === `doc:${element.connectionId}:${this._revealingDoc!.docPath}`)
        ) {
          try {
            const targetSnap = await element.reference.doc(this._revealingDoc.docId).get();
            const hasSubcollections = !targetSnap.exists
              ? (await targetSnap.ref.listCollections()).length > 0
              : false;
            if (targetSnap.exists || hasSubcollections) {
              const docKey = `doc:${element.connectionId}:${targetSnap.ref.path}`;
              const isExp = this._expandedDocIds.has(docKey);
              const revItem = new DocumentItem(
                targetSnap.id,
                targetSnap.ref,
                element.connectionId,
                targetSnap.exists ? targetSnap.data() : undefined,
                isExp,
                !targetSnap.exists
              );
              this._registerItems([revItem]);
              cached.items.unshift(revItem);
            }
          } catch {}
        }
        return cached.items;
      }
    }

    const storeAndReturn = (items: Item[]): Item[] => {
      this._registerItems(items);
      if (cacheKey) {
        this._shortHoldCache.delete(cacheKey);
        this._shortHoldCache.set(cacheKey, { items, expiresAt: Date.now() + 2000 });
        evictIfNeeded(this._shortHoldCache, MAX_TREE_CACHE_SIZE);
        if (ttl > 0) {
          this._treeCache.delete(cacheKey);
          this._treeCache.set(cacheKey, { items, timestamp: Date.now() });
          evictIfNeeded(this._treeCache, MAX_TREE_CACHE_SIZE);
        }
      }
      return items;
    };

    if (element instanceof ConnectionTreeItem) {
      if (element.config.isLocalJson) {
        try {
          const collections = LocalJsonService.getInstance().listCollections(element.config);
          const collItems = collections.map((collId) => {
            const fakeRef = {
              id: collId,
              path: collId,
            } as any;
            const sortKey = `${element.config.id}:${collId}`;
            const filter = this.getCollectionFilter(element.config.id, collId);
            const docCount = this.getCollectionCount(element.config.id, collId);
            return new CollectionItem(collId, fakeRef, element.config.id, {
              fieldName: this._orderBy.get(sortKey)?.field ?? "id",
              direction: (this._orderBy.get(sortKey)?.direction ?? "asc") as OrderByDirection,
            }, filter, docCount);
          });
          return storeAndReturn(collItems);
        } catch (err: any) {
          vscode.window.showErrorMessage(`Failed to load local JSON collections: ${err.message}`);
          return [];
        }
      }

      if (element.config.isEmulator) {
        const { host, port } = parseHostPort(element.config.emulatorHost);
        const isOnline = await probePort(host, port, 1000);
        if (!isOnline) {
          const choice = await vscode.window.showWarningMessage(
            `Cannot connect to '${element.config.name}': Firebase emulator on ${element.config.emulatorHost || `${host}:${port}`} is offline.`,
            "Start Emulator",
            "Edit Connection"
          );
          if (choice === "Start Emulator") {
            await vscode.commands.executeCommand("ketrik-firestore-studio.startEmulator");
          } else if (choice === "Edit Connection") {
            await vscode.commands.executeCommand("ketrik-firestore-studio.editConnection", element);
          }
          return [];
        }
      }

      try {
        const firestore = await this._connectionManager.getFirestore(element.config.id);
        const refs = (await firestore.listCollections()) as CollectionReference[];

        const collItems = refs.map((ref: CollectionReference) => {
          const sortKey = `${element.config.id}:${ref.path}`;
          const filter = this.getCollectionFilter(element.config.id, ref.path);
          const docCount = this.getCollectionCount(element.config.id, ref.path);
          return new CollectionItem(ref.id, ref, element.config.id, {
            fieldName: this._orderBy.get(sortKey)?.field ?? "id",
            direction: (this._orderBy.get(sortKey)?.direction ?? "asc") as OrderByDirection,
          }, filter, docCount);
        });

        // Add Authentication, Composite Indexes, Cloud Storage, Secret Manager, and Cost & Quotas nodes alongside Root Collections
        const authBranch = new AuthUsersBranchItem(element.config.id);
        const indexesBranch = new CompositeIndexesBranchItem(element.config.id);
        const storageBranch = new StorageBucketsBranchItem(element.config.id);
        const secretManagerBranch = new SecretManagerBranchItem(element.config.id);
        const costQuotaBranch = new CostQuotaBranchItem(element.config.id);
        const items: Item[] = [authBranch, indexesBranch, storageBranch, secretManagerBranch, costQuotaBranch, ...collItems];
        return storeAndReturn(items);
      } catch (err: any) {
        const isUnavailable =
          err?.code === 14 ||
          err?.message?.includes("ECONNREFUSED") ||
          err?.message?.includes("UNAVAILABLE") ||
          err?.message?.includes("exceeded");

        if (element.config.isEmulator && isUnavailable) {
          const choice = await vscode.window.showErrorMessage(
            `Emulator connection '${element.config.name}' (${element.config.emulatorHost || "localhost:8080"}) is unreachable. Make sure the emulator process is running.`,
            "Start Emulator",
            "Edit Connection"
          );
          if (choice === "Start Emulator") {
            await vscode.commands.executeCommand("ketrik-firestore-studio.startEmulator");
          } else if (choice === "Edit Connection") {
            await vscode.commands.executeCommand("ketrik-firestore-studio.editConnection", element);
          }
        } else {
          vscode.window.showErrorMessage(
            `Failed to load collections for connection '${element.config.name}': ${err.message}`
          );
        }
        return [];
      }
    } else if (element instanceof CompositeIndexesBranchItem) {
      try {
        const indexesService = IndexesService.getInstance();
        const indexes = await indexesService.listCompositeIndexes(element.connectionId);
        if (indexes.length === 0) {
          return storeAndReturn([]);
        }
        const indexItems = indexes.map((idx) => new CompositeIndexItem(element.connectionId, idx));
        return storeAndReturn(indexItems);
      } catch (err: any) {
        vscode.window.showErrorMessage(
          `Failed to load Firestore composite indexes: ${err.message}`
        );
        return [];
      }
    } else if (element instanceof StorageBucketsBranchItem) {
      try {
        const storageService = StorageService.getInstance();
        const buckets = await storageService.listBuckets(element.connectionId);
        if (buckets.length === 0) {
          return storeAndReturn([]);
        }
        const bucketItems = buckets.map((b) => new StorageBucketTreeItem(element.connectionId, b.name));
        return storeAndReturn(bucketItems);
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to load Cloud Storage buckets: ${err.message}`);
        return [];
      }
    } else if (element instanceof SecretManagerBranchItem) {
      try {
        const secretService = SecretManagerService.getInstance();
        const { secrets } = await secretService.listSecrets(element.connectionId);
        if (secrets.length === 0) {
          return storeAndReturn([
            new InfoMessageItem("No secrets found in this project", "info", "infoMessage", {
              command: "ketrik-firestore-studio.createSecret",
              title: "Create Secret",
              arguments: [element],
            }),
          ]);
        }
        const secretItems = secrets.map((sec) => new SecretTreeItem(element.connectionId, sec));
        return storeAndReturn(secretItems);
      } catch (err: any) {
        const errMsg = err?.message || String(err);
        vscode.window.showErrorMessage(`Failed to load Google Secret Manager secrets: ${errMsg}`);
        // Return an actionable error item in the tree so it immediately stops spinning and informs the user
        let actionItem: InfoMessageItem;
        if (errMsg.includes("PERMISSION_DENIED") || errMsg.includes("Permission")) {
          actionItem = new InfoMessageItem("Permission denied (Grant Secret Manager Secret Accessor / Viewer)", "lock", "secretError");
        } else if (errMsg.includes("Could not load the default credentials") || errMsg.includes("authentication required")) {
          actionItem = new InfoMessageItem("Authentication required (Run 'gcloud auth application-default login')", "key", "secretError");
        } else {
          actionItem = new InfoMessageItem(`Error: ${errMsg.slice(0, 80)}`, "warning", "secretError");
        }
        return storeAndReturn([actionItem]);
      }
    } else if (element instanceof SecretTreeItem) {
      try {
        const secretService = SecretManagerService.getInstance();
        const versions = await secretService.listSecretVersions(element.connectionId, element.secret.id);
        if (versions.length === 0) {
          return storeAndReturn([
            new InfoMessageItem("No versions available", "info", "infoMessage", {
              command: "ketrik-firestore-studio.addSecretVersion",
              title: "Add Version",
              arguments: [element],
            }),
          ]);
        }
        const versionItems = versions.map((v) => new SecretVersionTreeItem(element.connectionId, v));
        return storeAndReturn(versionItems);
      } catch (err: any) {
        const errMsg = err?.message || String(err);
        vscode.window.showErrorMessage(`Failed to load versions for secret '${element.secret.id}': ${errMsg}`);
        return storeAndReturn([
          new InfoMessageItem(`Error loading versions: ${errMsg.slice(0, 80)}`, "warning", "secretError"),
        ]);
      }
    } else if (element instanceof StorageBucketTreeItem) {
      try {
        const storageService = StorageService.getInstance();
        const { folders, files } = await storageService.listFilesAndFolders(element.connectionId, element.bucketName, "");
        const folderItems = folders.map((f) => new StorageFolderTreeItem(element.connectionId, element.bucketName, f));
        const fileItems = files.map((f) => new StorageFileTreeItem(element.connectionId, element.bucketName, f));
        return storeAndReturn([...folderItems, ...fileItems]);
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to load bucket contents: ${err.message}`);
        return [];
      }
    } else if (element instanceof StorageFolderTreeItem) {
      try {
        const storageService = StorageService.getInstance();
        const { folders, files } = await storageService.listFilesAndFolders(
          element.connectionId,
          element.bucketName,
          element.prefix
        );
        const folderItems = folders.map((f) => new StorageFolderTreeItem(element.connectionId, element.bucketName, f));
        const fileItems = files.map((f) => new StorageFileTreeItem(element.connectionId, element.bucketName, f));
        return storeAndReturn([...folderItems, ...fileItems]);
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to load folder contents: ${err.message}`);
        return [];
      }
    } else if (element instanceof AuthUsersBranchItem) {
      try {
        const authService = AuthService.getInstance();
        const pageSize = 25;
        const state = this._authUsersPaging.get(element.connectionId);

        if (!state) {
          // Initial batch fetch
          const profileCollection = authService.getProfileCollection(element.connectionId);
          const { users, pageToken } = await authService.listUsers(element.connectionId, pageSize);
          const uids = users.map((u) => u.uid);
          const existingProfiles = await authService.checkProfilesExist(
            element.connectionId,
            uids,
            profileCollection
          );
          const userItems = users.map(
            (u) => new AuthUserItem(u, element.connectionId, existingProfiles.has(u.uid), profileCollection)
          );

          this._authUsersPaging.set(element.connectionId, {
            items: userItems,
            nextPageToken: pageToken,
          });

          const result: Item[] = [...userItems];
          if (pageToken) {
            result.push(new ShowMoreAuthUsersItem(element.connectionId, pageToken, pageSize));
          }
          return storeAndReturn(result);
        } else {
          // Return accumulated items + show more if token exists
          const result: Item[] = [...state.items];
          if (state.nextPageToken) {
            result.push(new ShowMoreAuthUsersItem(element.connectionId, state.nextPageToken, pageSize));
          }
          return storeAndReturn(result);
        }
      } catch (err: any) {
        vscode.window.showErrorMessage(
          `Failed to load Firebase Auth users: ${err.message}`
        );
        return [];
      }
    } else if (element instanceof DocumentItem) {

      try {
        const conn = this._connectionManager.getConnection(element.connectionId);
        if (conn?.isLocalJson) {
          const rawDocData = LocalJsonService.getInstance().getDocument(conn, element.reference.path);
          const docData = rawDocData || {};
          element.updateDocMeta(docData, rawDocData === undefined);
          const fieldKeys = Object.keys(docData).sort((a, b) => a.localeCompare(b));
          const items: Item[] = fieldKeys.map((key) => {
            const fieldId = `field:${element.connectionId}:${element.reference.path}#${key}`;
            const isExpanded = this._expandedFieldIds.has(fieldId);
            return new DocumentFieldItem(
              key,
              docData[key],
              element.reference,
              element.connectionId,
              [key],
              undefined,
              isExpanded
            );
          });
          return storeAndReturn(items);
        }

        const items: Item[] = [];

        // 1. Fetch subcollections
        const refs = (await element.reference.listCollections()) as CollectionReference[];
        const subCollections = refs.map((ref: CollectionReference) => {
          const sortKey = `${element.connectionId}:${ref.path}`;
          const filter = this.getCollectionFilter(element.connectionId, ref.path);
          const docCount = this.getCollectionCount(element.connectionId, ref.path);
          return new CollectionItem(ref.id, ref, element.connectionId, {
            fieldName: this._orderBy.get(sortKey)?.field ?? "id",
            direction: (this._orderBy.get(sortKey)?.direction ?? "asc") as OrderByDirection,
          }, filter, docCount);
        });
        items.push(...subCollections);

        // 2. Fetch document snapshot and list root variables / fields
        const snapshot = await element.reference.get();
        if (snapshot.exists) {
          const data = snapshot.data() || {};
          element.updateDocMeta(data, false);
          const fieldKeys = Object.keys(data).sort((a, b) => {
            const isProtoA = a.startsWith("__");
            const isProtoB = b.startsWith("__");
            if (isProtoA && !isProtoB) return -1;
            if (!isProtoA && isProtoB) return 1;

            const isEnvA = a.startsWith("_");
            const isEnvB = b.startsWith("_");
            if (isEnvA && !isEnvB) return -1;
            if (!isEnvA && isEnvB) return 1;

            return a.localeCompare(b);
          });
          for (const key of fieldKeys) {
            const fieldId = `field:${element.connectionId}:${element.reference.path}#${key}`;
            const isExpanded = this._expandedFieldIds.has(fieldId);
            items.push(
              new DocumentFieldItem(
                key,
                data[key],
                element.reference,
                element.connectionId,
                [key],
                undefined,
                isExpanded
              )
            );
          }
        } else {
          element.updateDocMeta(undefined, true);
        }

        return storeAndReturn(items);
      } catch (err: any) {
        vscode.window.showErrorMessage(
          `Failed to load sub-items for document '${element.documentId}': ${err.message}`
        );
        return [];
      }
    } else if (element instanceof DocumentFieldItem) {
      if (Array.isArray(element.value)) {
        const arr = element.value;
        const currentSegments =
          element.pathSegments && element.pathSegments.length > 0
            ? element.pathSegments
            : [element.fieldName];
        const items: Item[] = arr.map((itemVal, idx) => {
          const childSegments = [...currentSegments, String(idx)];
          const childId = `field:${element.connectionId}:${element.parentDocRef.path}#${childSegments.join(".")}`;
          const isExpanded = this._expandedFieldIds.has(childId);
          return new DocumentFieldItem(
            `[${idx}]`,
            itemVal,
            element.parentDocRef,
            element.connectionId,
            childSegments,
            element,
            isExpanded,
            true,
            idx,
            element
          );
        });
        return storeAndReturn(items);
      } else if (
        element.value &&
        typeof element.value === "object" &&
        !isTimestampLike(element.value)
      ) {
        const isVector =
          element.value.constructor?.name === "VectorValue" ||
          (Array.isArray(element.value._values) && typeof element.value.isEqual === "function") ||
          (element.value.__type === "VectorValue" && Array.isArray(element.value.values));

        if (!isVector) {
          const data = element.value;
          const fieldKeys = Object.keys(data).sort((a, b) => {
            const isProtoA = a.startsWith("__");
            const isProtoB = b.startsWith("__");
            if (isProtoA && !isProtoB) return -1;
            if (!isProtoA && isProtoB) return 1;

            const isEnvA = a.startsWith("_");
            const isEnvB = b.startsWith("_");
            if (isEnvA && !isEnvB) return -1;
            if (!isEnvA && isEnvB) return 1;

            return a.localeCompare(b);
          });

          const currentSegments =
            element.pathSegments && element.pathSegments.length > 0
              ? element.pathSegments
              : [element.fieldName];
          const items: Item[] = fieldKeys.map((key) => {
            const childSegments = [...currentSegments, key];
            const childId = `field:${element.connectionId}:${element.parentDocRef.path}#${childSegments.join(".")}`;
            const isExpanded = this._expandedFieldIds.has(childId);
            return new DocumentFieldItem(
              key,
              data[key],
              element.parentDocRef,
              element.connectionId,
              childSegments,
              element,
              isExpanded
            );
          });
          return storeAndReturn(items);
        }
      }
      return [];
    } else if (element instanceof CollectionItem) {
      const activeFilter = this.getCollectionFilter(element.connectionId, element.reference.path);
      const activeFilterLower = activeFilter?.toLowerCase();
      try {
        const conn = this._connectionManager.getConnection(element.connectionId);
        if (conn?.isLocalJson) {
          const effectiveCollPath = element.reference?.path || element.collectionId;
          let docs = LocalJsonService.getInstance().listDocuments(conn, effectiveCollPath);
          if (activeFilter && activeFilterLower) {
            docs = docs.filter(
              (d) =>
                d.id.toLowerCase().includes(activeFilterLower) ||
                (d.data && matchesSearchTerm(d.data, activeFilterLower))
            );
          }
          const sortConfig = this._orderBy.get(`${element.connectionId}:${effectiveCollPath}`);
          if (sortConfig) {
            const field = sortConfig.field;
            const dir = sortConfig.direction === "desc" ? -1 : 1;
            const getNested = (obj: any, pathStr: string): any => {
              if (!obj || typeof obj !== "object") return undefined;
              if (pathStr in obj) return obj[pathStr];
              return pathStr
                .split(".")
                .reduce((acc, p) => (acc && typeof acc === "object" ? acc[p] : undefined), obj);
            };
            const toComparable = (v: any): number | string | null => {
              if (v === null || v === undefined) return null;
              if (typeof v === "number" || typeof v === "boolean") return Number(v);
              if (typeof v === "string") return v;
              if (typeof v === "object" && isTimestampLike(v)) {
                return timestampToDate(v)?.getTime() ?? 0;
              }
              return JSON.stringify(v);
            };
            docs = [...docs].sort((a, b) => {
              if (!field || field === "id") {
                return a.id.localeCompare(b.id) * dir;
              }
              const va = toComparable(getNested(a.data, field));
              const vb = toComparable(getNested(b.data, field));
              if (va === null && vb === null) return a.id.localeCompare(b.id) * dir;
              if (va === null) return 1;
              if (vb === null) return -1;
              if (typeof va === "number" && typeof vb === "number") {
                return (va - vb) * dir;
              }
              return String(va).localeCompare(String(vb)) * dir;
            });
          }
          if (docs.length === 0 && activeFilter) {
            const emptyItem = new InfoMessageItem(
              `No documents matching "${activeFilter}"`,
              "search-stop",
              "collectionEmptyFilter",
              {
                command: "ketrik-firestore-studio.clearCollectionFilter",
                title: "Clear Filter",
                arguments: [element],
              }
            );
            return storeAndReturn([emptyItem]);
          }
          const items: DocumentItem[] = docs.map((d) => {
            const fakeDocRef = {
              id: d.id,
              path: `${effectiveCollPath}/${d.id}`,
            } as any;
            const docKey = `doc:${element.connectionId}:${fakeDocRef.path}`;
            const isExp = this._expandedDocIds.has(docKey);
            return new DocumentItem(d.id, fakeDocRef, element.connectionId, d.data, isExp);
          });
          return storeAndReturn(items);
        }

        const key = `${element.connectionId}:${element.reference.path}`;
        const limit = this._paging.get(key) ?? defaultLimit;

        const sortConfig = this._orderBy.get(key);
        const isDefaultSort =
          !sortConfig ||
          sortConfig.field === "id" ||
          (sortConfig.field as any) === FieldPath.documentId();

        const items: DocumentItem[] = [];
        let hasMore = false;

        if (activeFilter && activeFilterLower) {
          let matchingRefs: DocumentReference[] = [];
          if (typeof element.reference.listDocuments === "function") {
            try {
              const docRefs = await element.reference.listDocuments();
              matchingRefs = docRefs.filter((r) => r.id.toLowerCase().includes(activeFilterLower));
            } catch {}
          }

          if (matchingRefs.length === 0 && !activeFilter.includes("/")) {
            try {
              const directDoc = await element.reference.doc(activeFilter).get();
              if (directDoc.exists) {
                matchingRefs = [directDoc.ref];
              }
            } catch {}
          }

          if (matchingRefs.length > 0) {
            const firestore = await this._connectionManager.getFirestore(element.connectionId);
            hasMore = matchingRefs.length > limit;
            const pageRefs = matchingRefs.slice(0, limit);
            const snapshots = await firestore.getAll(...pageRefs);
            CostService.getInstance().recordOperation(
              element.connectionId,
              "read",
              snapshots.filter((s) => s.exists).length
            );

            for (const snap of snapshots) {
              const docKey = `doc:${element.connectionId}:${snap.ref.path}`;
              const isExp = this._expandedDocIds.has(docKey);
              items.push(
                new DocumentItem(
                  snap.id,
                  snap.ref,
                  element.connectionId,
                  snap.exists ? snap.data() : undefined,
                  isExp,
                  !snap.exists
                )
              );
            }
          } else {
            // Query with text scan
            try {
              const snapshots = await element.reference.limit(limit * 2).get();
              CostService.getInstance().recordOperation(element.connectionId, "read", snapshots.size);
              for (const doc of snapshots.docs) {
                if (doc.id.toLowerCase().includes(activeFilterLower) || matchesSearchTerm(doc.data(), activeFilterLower)) {
                  const docKey = `doc:${element.connectionId}:${doc.ref.path}`;
                  const isExp = this._expandedDocIds.has(docKey);
                  items.push(new DocumentItem(doc.id, doc.ref, element.connectionId, doc.data(), isExp));
                }
              }
            } catch {}
          }

          if (items.length === 0) {
            const emptyItem = new InfoMessageItem(
              `No documents matching "${activeFilter}"`,
              "search-stop",
              "collectionEmptyFilter",
              {
                command: "ketrik-firestore-studio.clearCollectionFilter",
                title: "Clear Filter",
                arguments: [element],
              }
            );
            return storeAndReturn([emptyItem]);
          }

          if (hasMore) {
            const result = [
              ...items,
              new ShowMoreItemsItem(element.reference, limit, element.connectionId, defaultLimit),
            ];
            return storeAndReturn(result);
          }
          return storeAndReturn(items);
        }

        if (isDefaultSort && typeof element.reference.listDocuments === "function") {
          try {
            const docRefs = await element.reference.listDocuments();
            if (sortConfig?.direction === "desc") {
              docRefs.reverse();
            }

            hasMore = docRefs.length > limit;
            const pageRefs = docRefs.slice(0, limit);

            if (pageRefs.length > 0) {
              const firestore = await this._connectionManager.getFirestore(element.connectionId);
              const snapshots = await firestore.getAll(...pageRefs);
              CostService.getInstance().recordOperation(
                element.connectionId,
                "read",
                snapshots.filter((s) => s.exists).length
              );

              for (const snap of snapshots) {
                const docKey = `doc:${element.connectionId}:${snap.ref.path}`;
                const isExp = this._expandedDocIds.has(docKey);
                items.push(
                  new DocumentItem(
                    snap.id,
                    snap.ref,
                    element.connectionId,
                    snap.exists ? snap.data() : undefined,
                    isExp,
                    !snap.exists
                  )
                );
              }
            }
          } catch {
            // Fall back to standard query if listDocuments fails
          }
        }

        if (items.length === 0 && !hasMore) {
          const snapshots = await element.reference
            .limit(limit + 1)
            .orderBy(
              sortConfig?.field ?? FieldPath.documentId(),
              sortConfig?.direction ?? "asc"
            )
            .get();
          CostService.getInstance().recordOperation(element.connectionId, "read", snapshots.size);

          snapshots.forEach((snapshot: QueryDocumentSnapshot) => {
            const docKey = `doc:${element.connectionId}:${snapshot.ref.path}`;
            const isExp = this._expandedDocIds.has(docKey);
            items.push(
              new DocumentItem(snapshot.id, snapshot.ref, element.connectionId, snapshot.data(), isExp)
            );
          });

          // If the query returned 0 documents, check if there are missing documents that have subcollections
          if (items.length === 0 && typeof element.reference.listDocuments === "function") {
            try {
              const docRefs = await element.reference.listDocuments();
              hasMore = docRefs.length > limit;
              const pageRefs = docRefs.slice(0, limit);
              for (const ref of pageRefs) {
                const docKey = `doc:${element.connectionId}:${ref.path}`;
                const isExp = this._expandedDocIds.has(docKey);
                items.push(
                  new DocumentItem(ref.id, ref, element.connectionId, undefined, isExp, true)
                );
              }
            } catch {}
          } else if (items.length > limit) {
            items.pop();
            hasMore = true;
          }
        }

        // Ensure target revealing document is present in the children list even if beyond initial page limit
        if (
          this._revealingDoc &&
          this._revealingDoc.connectionId === element.connectionId &&
          (this._revealingDoc.docPath.startsWith(element.reference.path + "/") ||
            element.reference.path === this._revealingDoc.docPath.split("/").slice(0, -1).join("/")) &&
          !items.some((it) => it.id === `doc:${element.connectionId}:${this._revealingDoc!.docPath}`)
        ) {
          try {
            const targetSnap = await element.reference.doc(this._revealingDoc.docId).get();
            const hasSubcollections = !targetSnap.exists
              ? (await targetSnap.ref.listCollections()).length > 0
              : false;
            if (targetSnap.exists || hasSubcollections) {
              const docKey = `doc:${element.connectionId}:${targetSnap.ref.path}`;
              const isExp = this._expandedDocIds.has(docKey);
              items.unshift(
                new DocumentItem(
                  targetSnap.id,
                  targetSnap.ref,
                  element.connectionId,
                  targetSnap.exists ? targetSnap.data() : undefined,
                  isExp,
                  !targetSnap.exists
                )
              );
            }
          } catch {}
        }

        if (hasMore) {
          const result = [
            ...items,
            new ShowMoreItemsItem(element.reference, limit, element.connectionId, defaultLimit),
          ];
          return storeAndReturn(result);
        } else {
          return storeAndReturn(items);
        }
      } catch (err: any) {
        vscode.window.showErrorMessage(
          `Failed to load documents for collection '${element.collectionId}': ${err.message}`
        );
        return [];
      }
    }
    return [];
  }

  /**
   * Increase the paging limit for the given collection path and refresh the view.
   */
  async showMoreItems(path: string, connectionId?: string) {
    const connId =
      connectionId ||
      this._connectionManager.getConnections()[0]?.id ||
      "default";
    const key = `${connId}:${path}`;
    const defaultLimit =
      (vscode.workspace
        .getConfiguration("ketrik-firestore-studio")
        .get<number>("pagingLimit")) || 10;
    const newLimit = (this._paging.get(key) ?? defaultLimit) + defaultLimit;

    this._paging.set(key, newLimit);
    evictIfNeeded(this._paging, MAX_MAP_SIZE);

    // Evict previous cached collection items under the old limit
    this._deleteCachePrefix(`col:${connId}:${path}:`);

    const colNode = this._findLiveCollection(connId, path);
    if (colNode) {
      this._onDidChangeTreeData.fire(colNode);
    }
  }

  /**
   * Load the next page of Firebase Auth users for a connection.
   */
  async showMoreAuthUsers(connectionId?: string) {
    const connId =
      connectionId ||
      this._connectionManager.getConnections()[0]?.id ||
      "default";

    const state = this._authUsersPaging.get(connId);
    if (!state || !state.nextPageToken) {
      return;
    }

    try {
      const authService = AuthService.getInstance();
      const profileCollection = authService.getProfileCollection(connId);
      const pageSize = 25;
      const { users, pageToken } = await authService.listUsers(connId, pageSize, state.nextPageToken);
      const uids = users.map((u) => u.uid);
      const existingProfiles = await authService.checkProfilesExist(connId, uids, profileCollection);
      const newItems = users.map(
        (u) => new AuthUserItem(u, connId, existingProfiles.has(u.uid), profileCollection)
      );

      this._authUsersPaging.set(connId, {
        items: [...state.items, ...newItems],
        nextPageToken: pageToken,
      });

      // Invalidate tree cache for auth branch so getChildren returns updated accumulated items
      this._deleteCacheKey(`auth:${connId}`);
      const authBranch = this._liveNodes.get(`auth:${connId}`);
      if (authBranch) {
        this._onDidChangeTreeData.fire(authBranch);
      }
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to load more users: ${err.message}`);
    }
  }

  async orderBy(
    path: string,
    field: string | undefined,
    direction: OrderByDirection,
    connectionId?: string
  ) {
    const connId =
      connectionId ||
      this._connectionManager.getConnections()[0]?.id ||
      "default";
    const key = `${connId}:${path}`;

    this._orderBy.set(key, { field, direction });
    evictIfNeeded(this._orderBy, MAX_MAP_SIZE);

    this._deleteCachePrefix(`col:${connId}:${path}:`);
    const colNode = this._updateCollectionInParentCache(connId, path);
    if (colNode) {
      this._onDidChangeTreeData.fire(colNode);
    }
  }

  /**
   * Reveal, expand to, and highlight a Firestore document or document property/field in the Tree View.
   */
  public async revealDocument(
    docPath: string,
    connectionId: string,
    options: { select?: boolean; focus?: boolean; expand?: boolean | number } = { select: true, focus: false, expand: true },
    fieldName?: string
  ): Promise<void> {
    if (!this._treeView) {
      return;
    }

    if (this._revealDebounceTimer) {
      clearTimeout(this._revealDebounceTimer);
    }

    this._revealDebounceTimer = setTimeout(async () => {
      this._revealDebounceTimer = undefined;
      const cleanPath = docPath.replace(/^\//, "").replace(/\.json$/, "");
      const segments = cleanPath.split("/").filter(Boolean);

      let targetField = fieldName;
      // Must be a document path (even number of segments >= 2)
      if (segments.length % 2 !== 0) {
        if (segments.length > 2) {
          const popped = decodeURIComponent(segments.pop()!); // trailing segment is a field name
          if (!targetField) {
            targetField = popped;
          }
        } else {
          return;
        }
      }

      const fullDocPath = segments.join("/");
      const docId = segments[segments.length - 1];

      try {
        const conn = this._connectionManager.getConnection(connectionId);
        let docItem: DocumentItem;
        let docRef: any;

        if (conn?.isLocalJson) {
          const fakeDocRef = {
            id: docId,
            path: fullDocPath,
          } as any;
          const docData = LocalJsonService.getInstance().getDocument(conn, fullDocPath);
          const isExp = this._expandedDocIds.has(`doc:${connectionId}:${fullDocPath}`);
          docItem = new DocumentItem(docId, fakeDocRef, connectionId, docData, isExp);
          docRef = fakeDocRef;
        } else {
          const firestore = await this._connectionManager.getFirestore(connectionId);
          docRef = firestore.doc(fullDocPath);
          const isExp = this._expandedDocIds.has(`doc:${connectionId}:${fullDocPath}`);
          docItem = new DocumentItem(docId, docRef, connectionId, undefined, isExp);
        }

        // If a specific field/property is targeted, reveal the DocumentFieldItem
        if (targetField) {
          const docCacheKey = `doc:${connectionId}:${fullDocPath}`;
          let cachedChildren = this._treeCache.get(docCacheKey)?.items;
          if (!cachedChildren) {
            // Populate children so VS Code tree model has the field item loaded
            cachedChildren = (await this.getChildren(docItem)) || [];
          }

          const targetSegments = targetField.split(".");
          let currentChildren = cachedChildren;
          let currentFieldItem: DocumentFieldItem | undefined;

          for (let i = 0; i < targetSegments.length; i++) {
            const seg = targetSegments[i];
            const match = currentChildren.find(
              (it) => it instanceof DocumentFieldItem && it.fieldName === seg
            ) as DocumentFieldItem | undefined;

            if (!match) {
              currentFieldItem = undefined;
              break;
            }

            currentFieldItem = match;
            if (i < targetSegments.length - 1) {
              if (match.id) {
                this._expandedFieldIds.add(match.id);
              }
              currentChildren = (await this.getChildren(match)) || [];
            }
          }

          if (currentFieldItem) {
            await this._treeView?.reveal(currentFieldItem, options);
            return;
          }

          // If not in cache or children, construct DocumentFieldItem directly
          let fieldValue: any;
          if (conn?.isLocalJson) {
            const docData = LocalJsonService.getInstance().getDocument(conn, fullDocPath) || {};
            fieldValue = targetSegments.reduce(
              (acc, part) => (acc && typeof acc === "object" ? acc[part] : undefined),
              docData
            );
          } else {
            const snap = await docRef.get();
            const docData = snap.exists ? snap.data() || {} : {};
            fieldValue = targetSegments.reduce(
              (acc, part) => (acc && typeof acc === "object" ? acc[part] : undefined),
              docData
            );
          }

          const fallbackId = `field:${connectionId}:${docRef.path}#${targetSegments.join(".")}`;
          const isExpField = this._expandedFieldIds.has(fallbackId);
          const fallbackFieldItem = new DocumentFieldItem(
            targetSegments[targetSegments.length - 1],
            fieldValue,
            docRef,
            connectionId,
            targetSegments,
            undefined,
            isExpField
          );
          await this._treeView?.reveal(fallbackFieldItem, options);
          return;
        }

        this._revealingDoc = { connectionId, docPath: fullDocPath, docId };
        await this._treeView?.reveal(docItem, options);
      } catch {
        // Silently fail if node cannot be revealed
      } finally {
        this._revealingDoc = null;
      }
    }, 60);
  }
}
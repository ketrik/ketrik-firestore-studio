import {
  CollectionReference,
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
  Item,
  ShowMoreAuthUsersItem,
  ShowMoreItemsItem,
  StorageBucketsBranchItem,
  StorageBucketTreeItem,
  StorageFolderTreeItem,
  StorageFileTreeItem,
} from "./items";
import { AuthService } from "../auth/AuthService";
import { IndexesService } from "../indexes/indexesService";
import { StorageService } from "../storage/storageService";
import { parseHostPort, probePort } from "../emulator/portUtils";
import { LocalJsonService } from "../services/LocalJsonService";
import { isTimestampLike } from "../utils/timestampUtils";


/** Maximum number of entries kept in the paging/orderBy state maps (LRU eviction). */
const MAX_MAP_SIZE = 200;
/** Maximum number of tree branch results cached in memory (LRU eviction). */
const MAX_TREE_CACHE_SIZE = 250;

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
  private _connectionListener: vscode.Disposable;
  private _rulesListener: vscode.Disposable;

  /** Cache tree children (collections, docs, fields) to avoid re-requesting on repeated expand/collapse. */
  private _treeCache = new Map<string, { items: Item[]; timestamp: number }>();
  private _debounceTimer: NodeJS.Timeout | undefined;
  private _pendingInvalidations = new Set<string>();

  private _treeView: vscode.TreeView<Item> | undefined;
  private _treeViewDisposables: vscode.Disposable[] = [];
  private _expandedDocIds = new Set<string>();
  private _expandedFieldIds = new Set<string>();
  private _revealingDoc: { connectionId: string; docPath: string; docId: string } | null = null;
  private _revealDebounceTimer: NodeJS.Timeout | undefined;

  public setTreeView(treeView: vscode.TreeView<Item>): void {
    for (const d of this._treeViewDisposables) {
      d.dispose();
    }
    this._treeViewDisposables = [];
    this._treeView = treeView;

    this._treeViewDisposables.push(
      treeView.onDidExpandElement((e) => {
        if (e.element instanceof DocumentItem) {
          const docKey = `${e.element.connectionId}:${e.element.reference.path}`;
          this._expandedDocIds.add(docKey);
          // Refresh item so its click command becomes ketrik-firestore-studio.openPath
          this._onDidChangeTreeData.fire(e.element);
        } else if (e.element instanceof DocumentFieldItem && e.element.id) {
          this._expandedFieldIds.add(e.element.id);
          this._onDidChangeTreeData.fire(e.element);
        }
      }),
      treeView.onDidCollapseElement((e) => {
        if (e.element instanceof DocumentItem) {
          const docKey = `${e.element.connectionId}:${e.element.reference.path}`;
          this._expandedDocIds.delete(docKey);
          // Refresh item so single-click expands it instead of opening JSON
          this._onDidChangeTreeData.fire(e.element);
        } else if (e.element instanceof DocumentFieldItem && e.element.id) {
          this._expandedFieldIds.delete(e.element.id);
          this._onDidChangeTreeData.fire(e.element);
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
    this._treeViewDisposables = [];
    this._expandedDocIds.clear();
    this._expandedFieldIds.clear();
    this._pendingInvalidations.clear();
    this._connectionListener.dispose();
    this._rulesListener.dispose();
    this._onDidChangeTreeData.dispose();
    this._paging.clear();
    this._authUsersPaging.clear();
    this._orderBy.clear();
    this._treeCache.clear();
  }

  refresh(resetState = false): void {
    this._treeCache.clear();
    if (resetState) {
      this._paging.clear();
      this._authUsersPaging.clear();
      this._orderBy.clear();
      this._expandedDocIds.clear();
      this._expandedFieldIds.clear();
    }
    this._onDidChangeTreeData.fire(undefined);
  }

  /**
   * Handle virtual file change events from DocumentFileSystemProvider with debouncing
   * and granular branch invalidation. Avoids full tree cache flushes on document saves.
   */
  public handleFileChanges(events: readonly vscode.FileChangeEvent[]): void {
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
      // If odd segments >= 3, last segment was a fieldPath
      if (segments.length % 2 === 1 && segments.length >= 3) {
        segments.pop();
      }
      const docPath = segments.join("/");
      if (docPath && connectionId) {
        this._pendingInvalidations.add(`${connectionId}:${docPath}`);
      }
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

    const invalidatedDocs: Array<{ connectionId: string; docPath: string }> = [];

    for (const key of this._pendingInvalidations) {
      const sep = key.indexOf(":");
      if (sep === -1) continue;
      const connectionId = key.substring(0, sep);
      const docPath = key.substring(sep + 1);

      // Invalidate the document node cache
      this._treeCache.delete(`doc:${connectionId}:${docPath}`);

      invalidatedDocs.push({ connectionId, docPath });

      // Invalidate the parent collection node cache
      const parentCollPath = docPath.includes("/") ? docPath.substring(0, docPath.lastIndexOf("/")) : "";
      if (parentCollPath) {
        const prefix = `col:${connectionId}:${parentCollPath}:`;
        for (const k of this._treeCache.keys()) {
          if (k.startsWith(prefix)) {
            this._treeCache.delete(k);
          }
        }
      }
    }

    this._pendingInvalidations.clear();

    // Granular refresh: If only a few documents were invalidated, refresh just those doc nodes
    // using the exact cached DocumentItem instance, or fall back to tree refresh.
    if (invalidatedDocs.length > 0 && invalidatedDocs.length <= 5) {
      let anyDocRefreshed = false;
      for (const { connectionId, docPath } of invalidatedDocs) {
        const targetDocId = `${connectionId}:${docPath}`;
        let matchedDoc: DocumentItem | undefined;
        for (const [k, v] of this._treeCache.entries()) {
          if (k.startsWith(`col:${connectionId}:`)) {
            const match = v.items.find(
              (it) => it instanceof DocumentItem && it.id === targetDocId
            ) as DocumentItem | undefined;
            if (match) {
              matchedDoc = match;
              break;
            }
          }
        }

        if (matchedDoc) {
          this._onDidChangeTreeData.fire(matchedDoc);
          anyDocRefreshed = true;
        }
      }

      if (!anyDocRefreshed) {
        this._onDidChangeTreeData.fire(undefined);
      }
    } else {
      this._onDidChangeTreeData.fire(undefined);
    }
  }

  /**
   * Refresh a specific item (document, collection, connection, or field's parent)
   * while keeping the rest of the tree intact and snappy.
   */
  refreshNode(element?: Item): void {
    if (!element) {
      this.refresh();
      return;
    }

    if (element instanceof DocumentItem) {
      this._treeCache.delete(`doc:${element.connectionId}:${element.reference.path}`);
      this._onDidChangeTreeData.fire(element);
    } else if (element instanceof DocumentFieldItem) {
      this._treeCache.delete(`doc:${element.connectionId}:${element.parentDocRef.path}`);
      
      // Look up the existing DocumentItem instance in cached collection results
      let targetDocItem: DocumentItem | undefined;
      const targetDocId = `${element.connectionId}:${element.parentDocRef.path}`;
      for (const [k, v] of this._treeCache.entries()) {
        if (k.startsWith(`col:${element.connectionId}:`)) {
          const match = v.items.find(
            (it) => it instanceof DocumentItem && it.id === targetDocId
          ) as DocumentItem | undefined;
          if (match) {
            targetDocItem = match;
            break;
          }
        }
      }

      if (targetDocItem) {
        this._onDidChangeTreeData.fire(targetDocItem);
      } else {
        // Fallback: If document item instance isn't in cache, refresh parent collection or root
        const parentCollPath = element.parentDocRef.path.includes("/")
          ? element.parentDocRef.path.substring(0, element.parentDocRef.path.lastIndexOf("/"))
          : "";
        if (parentCollPath) {
          const prefix = `col:${element.connectionId}:${parentCollPath}:`;
          for (const k of this._treeCache.keys()) {
            if (k.startsWith(prefix)) {
              this._treeCache.delete(k);
            }
          }
        }
        this._onDidChangeTreeData.fire(undefined);
      }
    } else if (element instanceof CollectionItem) {
      const prefix = `col:${element.connectionId}:${element.reference.path}:`;
      for (const k of this._treeCache.keys()) {
        if (k.startsWith(prefix)) {
          this._treeCache.delete(k);
        }
      }
      this._onDidChangeTreeData.fire(element);
    } else if (element instanceof AuthUsersBranchItem) {
      this._treeCache.delete(`auth:${element.connectionId}`);
      this._authUsersPaging.delete(element.connectionId);
      this._onDidChangeTreeData.fire(element);
    } else if (element instanceof AuthUserItem) {
      this._treeCache.delete(`auth:${element.connectionId}`);
      this._authUsersPaging.delete(element.connectionId);
      this._onDidChangeTreeData.fire(undefined);
    } else if (element instanceof CompositeIndexesBranchItem) {
      this._treeCache.delete(`indexes:${element.connectionId}`);
      this._onDidChangeTreeData.fire(element);
    } else if (element instanceof CompositeIndexItem) {
      this._treeCache.delete(`indexes:${element.connectionId}`);
      this._onDidChangeTreeData.fire(undefined);
    } else if (element instanceof StorageBucketsBranchItem) {
      this._treeCache.delete(`storage:${element.connectionId}`);
      this._onDidChangeTreeData.fire(element);
    } else if (element instanceof StorageBucketTreeItem) {
      const prefix = `storageFiles:${element.connectionId}:${element.bucketName}:`;
      for (const k of this._treeCache.keys()) {
        if (k.startsWith(prefix)) {
          this._treeCache.delete(k);
        }
      }
      this._onDidChangeTreeData.fire(element);
    } else if (element instanceof StorageFolderTreeItem) {
      const folderKey = `storageFiles:${element.connectionId}:${element.bucketName}:${element.prefix}`;
      for (const k of this._treeCache.keys()) {
        if (k === folderKey || k.startsWith(folderKey.endsWith("/") ? folderKey : folderKey + "/")) {
          this._treeCache.delete(k);
        }
      }
      this._onDidChangeTreeData.fire(element);
    } else if (element instanceof StorageFileTreeItem) {
      const prefix = `storageFiles:${element.connectionId}:${element.bucketName}:`;
      for (const k of this._treeCache.keys()) {
        if (k.startsWith(prefix)) {
          this._treeCache.delete(k);
        }
      }
      this._onDidChangeTreeData.fire(undefined);
    } else if (element instanceof ConnectionTreeItem) {
      this._treeCache.delete(`conn:${element.config.id}`);
      this._onDidChangeTreeData.fire(element);
    } else {
      this.refresh();
    }
  }

  getTreeItem(element: Item): vscode.TreeItem {
    if (element instanceof DocumentItem) {
      const docKey = `${element.connectionId}:${element.reference.path}`;
      const isExpanded = this._expandedDocIds.has(docKey);
      if (isExpanded) {
        element.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
        element.command = {
          command: "ketrik-firestore-studio.openPath",
          title: "Open in Editor",
          arguments: [element.reference.path, element.connectionId],
        };
      } else {
        element.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
        element.command = undefined;
      }
    } else if (element instanceof DocumentFieldItem) {
      const isMap = element.contextValue === "documentFieldMap";
      const keyCount = isMap && element.value && typeof element.value === "object" ? Object.keys(element.value).length : 0;
      if (isMap && keyCount > 0) {
        const isExpanded = !!(element.id && this._expandedFieldIds.has(element.id));
        if (isExpanded) {
          element.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
          element.command = {
            command: "ketrik-firestore-studio.openFieldInEditor",
            title: "Open in Editor",
            arguments: [element],
          };
        } else {
          element.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
          element.command = undefined;
        }
      }
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
      element instanceof StorageBucketsBranchItem
    ) {
      const conn = this._connectionManager.getConnection(element.connectionId);
      return conn ? new ConnectionTreeItem(conn) : undefined;
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
    const defaultLimit =
      (vscode.workspace
        .getConfiguration("ketrik-firestore-studio")
        .get<number>("pagingLimit")) ?? 10;

    if (!element) {
      const connections = this._connectionManager.getConnections();
      if (connections.length === 0) {
        return [];
      }
      return connections.map((conn) => new ConnectionTreeItem(conn));
    }

    const ttl = this.getCacheTTL();
    const cacheKey = element
      ? element instanceof ConnectionTreeItem
        ? `conn:${element.config.id}`
        : element instanceof DocumentItem
        ? `doc:${element.connectionId}:${element.reference.path}`
        : element instanceof CollectionItem
        ? `col:${element.connectionId}:${element.reference.path}:${this._paging.get(`${element.connectionId}:${element.reference.path}`) ?? defaultLimit}:${this._orderBy.get(`${element.connectionId}:${element.reference.path}`)?.field ?? "id"}:${this._orderBy.get(`${element.connectionId}:${element.reference.path}`)?.direction ?? "asc"}`
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
        : undefined
      : "root";


    if (cacheKey && ttl > 0) {
      const cached = this._treeCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < ttl) {
        if (
          this._revealingDoc &&
          element instanceof CollectionItem &&
          this._revealingDoc.connectionId === element.connectionId &&
          (this._revealingDoc.docPath.startsWith(element.reference.path + "/") ||
            element.reference.path === this._revealingDoc.docPath.split("/").slice(0, -1).join("/")) &&
          !cached.items.some((it) => it.id === `${element.connectionId}:${this._revealingDoc!.docPath}`)
        ) {
          try {
            const targetSnap = await element.reference.doc(this._revealingDoc.docId).get();
            if (targetSnap.exists) {
              cached.items.unshift(
                new DocumentItem(targetSnap.id, targetSnap.ref, element.connectionId, targetSnap.data())
              );
            }
          } catch {}
        }
        return cached.items;
      }
    }

    const storeAndReturn = (items: Item[]): Item[] => {
      if (cacheKey && ttl > 0) {
        this._treeCache.delete(cacheKey);
        this._treeCache.set(cacheKey, { items, timestamp: Date.now() });
        evictIfNeeded(this._treeCache, MAX_TREE_CACHE_SIZE);
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
            return new CollectionItem(collId, fakeRef, element.config.id);
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
          return new CollectionItem(ref.id, ref, element.config.id, {
            fieldName: this._orderBy.get(sortKey)?.field ?? "id",
            direction: (this._orderBy.get(sortKey)?.direction ?? "asc") as OrderByDirection,
          });
        });

        // Add Authentication, Composite Indexes, Cloud Storage, and Cost & Quotas nodes alongside Root Collections
        const authBranch = new AuthUsersBranchItem(element.config.id);
        const indexesBranch = new CompositeIndexesBranchItem(element.config.id);
        const storageBranch = new StorageBucketsBranchItem(element.config.id);
        const costQuotaBranch = new CostQuotaBranchItem(element.config.id);
        const items: Item[] = [authBranch, indexesBranch, storageBranch, costQuotaBranch, ...collItems];
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
          const { users, pageToken } = await authService.listUsers(element.connectionId, pageSize);
          const uids = users.map((u) => u.uid);
          const existingProfiles = await authService.checkProfilesExist(element.connectionId, uids);
          const userItems = users.map(
            (u) => new AuthUserItem(u, element.connectionId, existingProfiles.has(u.uid))
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
          const docData = LocalJsonService.getInstance().getDocument(conn, element.reference.path) || {};
          const fieldKeys = Object.keys(docData).sort((a, b) => a.localeCompare(b));
          const items: Item[] = fieldKeys.map((key) => {
            const fieldId = `${element.connectionId}:${element.reference.path}#${key}`;
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
          return new CollectionItem(ref.id, ref, element.connectionId, {
            fieldName: this._orderBy.get(sortKey)?.field ?? "id",
            direction: (this._orderBy.get(sortKey)?.direction ?? "asc") as OrderByDirection,
          });
        });
        items.push(...subCollections);

        // 2. Fetch document snapshot and list root variables / fields
        const snapshot = await element.reference.get();
        if (snapshot.exists) {
          const data = snapshot.data() || {};
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
            const fieldId = `${element.connectionId}:${element.reference.path}#${key}`;
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
        }

        return storeAndReturn(items);
      } catch (err: any) {
        vscode.window.showErrorMessage(
          `Failed to load sub-items for document '${element.documentId}': ${err.message}`
        );
        return [];
      }
    } else if (element instanceof DocumentFieldItem) {
      if (
        element.value &&
        typeof element.value === "object" &&
        !Array.isArray(element.value) &&
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
            const childId = `${element.connectionId}:${element.parentDocRef.path}#${childSegments.join(".")}`;
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
          return items;
        }
      }
      return [];
    } else if (element instanceof CollectionItem) {
      try {
        const conn = this._connectionManager.getConnection(element.connectionId);
        if (conn?.isLocalJson) {
          const docs = LocalJsonService.getInstance().listDocuments(conn, element.collectionId);
          const items: DocumentItem[] = docs.map((d) => {
            const fakeDocRef = {
              id: d.id,
              path: `${element.collectionId}/${d.id}`,
            } as any;
            return new DocumentItem(d.id, fakeDocRef, element.connectionId, d.data);
          });
          return storeAndReturn(items);
        }

        const key = `${element.connectionId}:${element.reference.path}`;
        const limit = this._paging.get(key) ?? defaultLimit;

        const sortConfig = this._orderBy.get(key);
        const snapshots = await element.reference
          .limit(limit + 1)
          .orderBy(
            sortConfig?.field ?? FieldPath.documentId(),
            sortConfig?.direction ?? "asc"
          )
          .get();

        const items: DocumentItem[] = [];
        snapshots.forEach((snapshot: QueryDocumentSnapshot) => {
          items.push(
            new DocumentItem(snapshot.id, snapshot.ref, element.connectionId, snapshot.data())
          );
        });

        // Ensure target revealing document is present in the children list even if beyond initial page limit
        if (
          this._revealingDoc &&
          this._revealingDoc.connectionId === element.connectionId &&
          (this._revealingDoc.docPath.startsWith(element.reference.path + "/") ||
            element.reference.path === this._revealingDoc.docPath.split("/").slice(0, -1).join("/")) &&
          !items.some((it) => it.id === `${element.connectionId}:${this._revealingDoc!.docPath}`)
        ) {
          try {
            const targetSnap = await element.reference.doc(this._revealingDoc.docId).get();
            if (targetSnap.exists) {
              items.unshift(
                new DocumentItem(targetSnap.id, targetSnap.ref, element.connectionId, targetSnap.data())
              );
            }
          } catch {}
        }

        if (items.length > limit) {
          items.pop();
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
    const prefix = `col:${connId}:${path}:`;
    for (const k of this._treeCache.keys()) {
      if (k.startsWith(prefix)) {
        this._treeCache.delete(k);
      }
    }

    this._onDidChangeTreeData.fire(undefined);
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
      const pageSize = 25;
      const { users, pageToken } = await authService.listUsers(connId, pageSize, state.nextPageToken);
      const uids = users.map((u) => u.uid);
      const existingProfiles = await authService.checkProfilesExist(connId, uids);
      const newItems = users.map(
        (u) => new AuthUserItem(u, connId, existingProfiles.has(u.uid))
      );

      this._authUsersPaging.set(connId, {
        items: [...state.items, ...newItems],
        nextPageToken: pageToken,
      });

      // Invalidate tree cache for auth branch so getChildren returns updated accumulated items
      this._treeCache.delete(`auth:${connId}`);
      this._onDidChangeTreeData.fire(undefined);
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

    this._onDidChangeTreeData.fire(undefined);
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
          docItem = new DocumentItem(docId, fakeDocRef, connectionId, docData);
          docRef = fakeDocRef;
        } else {
          const firestore = await this._connectionManager.getFirestore(connectionId);
          docRef = firestore.doc(fullDocPath);
          docItem = new DocumentItem(docId, docRef, connectionId);
        }

        // If a specific field/property is targeted, reveal the DocumentFieldItem
        if (targetField) {
          const docCacheKey = `doc:${connectionId}:${fullDocPath}`;
          let cachedChildren = this._treeCache.get(docCacheKey)?.items;
          if (!cachedChildren) {
            // Populate children so VS Code tree model has the field item loaded
            cachedChildren = (await this.getChildren(docItem)) || [];
          }

          const fieldItem = cachedChildren.find(
            (it) => it instanceof DocumentFieldItem && it.fieldName === targetField
          );

          if (fieldItem) {
            await this._treeView?.reveal(fieldItem, options);
            return;
          }

          // If not in cache or children, construct DocumentFieldItem directly
          let fieldValue: any;
          if (conn?.isLocalJson) {
            const docData = LocalJsonService.getInstance().getDocument(conn, fullDocPath) || {};
            fieldValue = docData[targetField];
          } else {
            const snap = await docRef.get();
            fieldValue = snap.exists ? (snap.data() || {})[targetField] : undefined;
          }

          const fallbackFieldItem = new DocumentFieldItem(
            targetField,
            fieldValue,
            docRef,
            connectionId
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
import {
  CollectionReference,
  FieldPath,
  OrderByDirection,
  QueryDocumentSnapshot,
} from "firebase-admin/firestore";
import * as vscode from "vscode";

import { ConnectionManager } from "../connections/ConnectionManager";
import {
  CollectionItem,
  ConnectionTreeItem,
  DocumentFieldItem,
  DocumentItem,
  Item,
  ShowMoreItemsItem,
} from "./items";

/** Maximum number of entries kept in the paging/orderBy state maps (LRU eviction). */
const MAX_MAP_SIZE = 200;

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
  private _orderBy = new Map<string, { field: string | undefined; direction: "asc" | "desc" }>();
  private _connectionListener: vscode.Disposable;

  /** Cache tree children (collections, docs, fields) to avoid re-requesting on repeated expand/collapse. */
  private _treeCache = new Map<string, { items: Item[]; timestamp: number }>();

  readonly onDidChangeTreeData: vscode.Event<Item | undefined> =
    this._onDidChangeTreeData.event;

  constructor() {
    this._connectionListener = this._connectionManager.onDidChangeConnections(() => {
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
    this._connectionListener.dispose();
    this._onDidChangeTreeData.dispose();
    this._paging.clear();
    this._orderBy.clear();
    this._treeCache.clear();
  }

  refresh(resetState = false): void {
    this._treeCache.clear();
    if (resetState) {
      this._paging.clear();
      this._orderBy.clear();
    }
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: Item): vscode.TreeItem {
    return element;
  }

  async getParent(element: Item): Promise<Item | undefined> {
    if (element instanceof DocumentItem) {
      return new CollectionItem(
        element.reference.parent.id,
        element.reference.parent,
        element.connectionId
      );
    } else if (element instanceof CollectionItem) {
      if (element.reference.parent !== null) {
        return new DocumentItem(
          element.reference.parent.id,
          element.reference.parent,
          element.connectionId
        );
      }
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
        : undefined
      : "root";

    if (cacheKey && ttl > 0) {
      const cached = this._treeCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < ttl) {
        return cached.items;
      }
    }

    const storeAndReturn = (items: Item[]): Item[] => {
      if (cacheKey && ttl > 0) {
        this._treeCache.set(cacheKey, { items, timestamp: Date.now() });
      }
      return items;
    };

    if (element instanceof ConnectionTreeItem) {
      try {
        const firestore = await this._connectionManager.getFirestore(element.config.id);
        const refs = (await firestore.listCollections()) as CollectionReference[];

        const items = refs.map((ref: CollectionReference) => {
          const sortKey = `${element.config.id}:${ref.path}`;
          return new CollectionItem(ref.id, ref, element.config.id, {
            fieldName: this._orderBy.get(sortKey)?.field ?? "id",
            direction: (this._orderBy.get(sortKey)?.direction ?? "asc") as OrderByDirection,
          });
        });
        return storeAndReturn(items);
      } catch (err: any) {
        vscode.window.showErrorMessage(
          `Failed to load collections for connection '${element.config.name}': ${err.message}`
        );
        return [];
      }
    } else if (element instanceof DocumentItem) {
      try {
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
          const fieldKeys = Object.keys(data).sort();
          for (const key of fieldKeys) {
            items.push(
              new DocumentFieldItem(
                key,
                data[key],
                element.reference,
                element.connectionId
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
    } else if (element instanceof CollectionItem) {
      try {
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
            new DocumentItem(snapshot.id, snapshot.ref, element.connectionId)
          );
        });

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

    this._onDidChangeTreeData.fire(undefined);
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
}
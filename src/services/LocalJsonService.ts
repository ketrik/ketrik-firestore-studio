import * as fs from "fs";
import * as path from "path";
import { FirestoreConnectionConfig } from "../connections/ConnectionManager";

export interface LocalJsonDoc {
  id: string;
  data: Record<string, any>;
}

/**
 * Service to manage local JSON files or directories of JSON files as virtual Firestore databases.
 */
export class LocalJsonService {
  private static instance: LocalJsonService;
  private static readonly MAX_CACHE_SIZE = 50;

  /** In-memory cache for parsed JSON files to avoid synchronous disk I/O and JSON.parse on every lookup. */
  private _fileCache: Map<string, { mtimeMs: number; size: number; parsed: any }> = new Map();

  public static getInstance(): LocalJsonService {
    if (!LocalJsonService.instance) {
      LocalJsonService.instance = new LocalJsonService();
    }
    return LocalJsonService.instance;
  }

  /**
   * Clear the in-memory file cache.
   */
  public clearCache(): void {
    this._fileCache.clear();
  }

  /**
   * Safely read and parse a JSON file with mtime/size caching.
   */
  private _readJsonFile(filePath: string): any {
    if (!fs.existsSync(filePath)) {
      this._fileCache.delete(filePath);
      return undefined;
    }

    try {
      const stat = fs.statSync(filePath);
      const cached = this._fileCache.get(filePath);
      if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
        return cached.parsed;
      }

      const content = fs.readFileSync(filePath, "utf8");
      const parsed = JSON.parse(content);

      this._fileCache.delete(filePath);
      this._fileCache.set(filePath, {
        mtimeMs: stat.mtimeMs,
        size: stat.size,
        parsed,
      });

      if (this._fileCache.size > LocalJsonService.MAX_CACHE_SIZE) {
        const oldest = this._fileCache.keys().next().value;
        if (oldest !== undefined) {
          this._fileCache.delete(oldest);
        }
      }

      return parsed;
    } catch {
      return undefined;
    }
  }

  /**
   * Safely serialize and write a JSON file, updating the in-memory cache.
   */
  private _writeJsonFile(filePath: string, data: any): void {
    const jsonStr = JSON.stringify(data, null, 2);
    fs.writeFileSync(filePath, jsonStr, "utf8");

    try {
      const stat = fs.statSync(filePath);
      this._fileCache.delete(filePath);
      this._fileCache.set(filePath, {
        mtimeMs: stat.mtimeMs,
        size: stat.size,
        parsed: data,
      });

      if (this._fileCache.size > LocalJsonService.MAX_CACHE_SIZE) {
        const oldest = this._fileCache.keys().next().value;
        if (oldest !== undefined) {
          this._fileCache.delete(oldest);
        }
      }
    } catch {
      this._fileCache.delete(filePath);
    }
  }

  /**
   * Determine whether a connection path points to a single file or a directory.
   */
  public isDirectoryMode(config: FirestoreConnectionConfig): boolean {
    if (!config.localJsonPath || !fs.existsSync(config.localJsonPath)) {
      return false;
    }
    const stat = fs.statSync(config.localJsonPath);
    return stat.isDirectory();
  }

  /**
   * List collections in the local JSON database.
   */
  public listCollections(config: FirestoreConnectionConfig): string[] {
    if (!config.localJsonPath || !fs.existsSync(config.localJsonPath)) {
      return [];
    }

    if (this.isDirectoryMode(config)) {
      // Each .json file in the folder represents a collection
      const files = fs.readdirSync(config.localJsonPath);
      return files
        .filter((f) => f.endsWith(".json"))
        .map((f) => f.slice(0, -5))
        .sort();
    }

    // Single JSON file: Top-level keys represent collections
    const parsed = this._readJsonFile(config.localJsonPath);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.keys(parsed).sort();
    }

    return [];
  }

  /**
   * Load entire collection map: { [docId: string]: Record<string, any> }
   */
  public getCollectionData(config: FirestoreConnectionConfig, collectionId: string): Record<string, any> {
    if (!config.localJsonPath) {
      return {};
    }

    if (this.isDirectoryMode(config)) {
      const filePath = path.join(config.localJsonPath, `${collectionId}.json`);
      const parsed = this._readJsonFile(filePath);
      return this._normalizeToDocumentMap(parsed);
    }

    // Single JSON file
    const parsed = this._readJsonFile(config.localJsonPath);
    if (parsed && typeof parsed === "object" && parsed[collectionId]) {
      return this._normalizeToDocumentMap(parsed[collectionId]);
    }

    return {};
  }

  /**
   * Normalizes an array of objects `[{ id: "1", ... }, ...]` or a map `{ "1": { ... } }` into `{ [docId: string]: data }`.
   */
  private _normalizeToDocumentMap(val: any): Record<string, any> {
    if (!val || typeof val !== "object") {
      return {};
    }
    if (Array.isArray(val)) {
      const map: Record<string, any> = {};
      val.forEach((item, index) => {
        if (item && typeof item === "object") {
          const docId = String(item.id ?? item._id ?? `doc_${index + 1}`);
          const { id: _unusedId, _id: _unusedId2, ...data } = item;
          map[docId] = data;
        }
      });
      return map;
    }
    return val;
  }

  /**
   * List all documents in a collection.
   */
  public listDocuments(config: FirestoreConnectionConfig, collectionId: string): LocalJsonDoc[] {
    const map = this.getCollectionData(config, collectionId);
    return Object.keys(map)
      .sort()
      .map((docId) => ({
        id: docId,
        data: map[docId] || {},
      }));
  }

  /**
   * Get a single document by docPath: e.g. "users/user1"
   */
  public getDocument(config: FirestoreConnectionConfig, docPath: string): Record<string, any> | undefined {
    const segments = docPath.split("/").filter(Boolean);
    if (segments.length < 2) {
      return undefined;
    }
    const collectionId = segments[0];
    const docId = segments[1];
    const collMap = this.getCollectionData(config, collectionId);
    return collMap[docId];
  }

  /**
   * Save / set document data by docPath.
   */
  public setDocument(config: FirestoreConnectionConfig, docPath: string, data: Record<string, any>): void {
    const segments = docPath.split("/").filter(Boolean);
    if (segments.length < 2) {
      throw new Error(`Invalid document path: '${docPath}'`);
    }
    const collectionId = segments[0];
    const docId = segments[1];

    if (this.isDirectoryMode(config)) {
      const filePath = path.join(config.localJsonPath!, `${collectionId}.json`);
      const collMap = this.getCollectionData(config, collectionId);
      collMap[docId] = data;
      this._writeJsonFile(filePath, collMap);
      return;
    }

    // Single JSON file
    let parsed: any = this._readJsonFile(config.localJsonPath!) || {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      parsed = {};
    }
    if (!parsed[collectionId] || typeof parsed[collectionId] !== "object") {
      parsed[collectionId] = {};
    }
    parsed[collectionId][docId] = data;
    this._writeJsonFile(config.localJsonPath!, parsed);
  }

  /**
   * Atomically save / set multiple documents into a collection in a single disk write.
   */
  public setDocuments(
    config: FirestoreConnectionConfig,
    collectionId: string,
    docs: Array<{ id: string; data: Record<string, any> }>
  ): void {
    if (docs.length === 0) return;

    if (this.isDirectoryMode(config)) {
      const filePath = path.join(config.localJsonPath!, `${collectionId}.json`);
      const collMap = this.getCollectionData(config, collectionId);
      for (const d of docs) {
        collMap[d.id] = d.data;
      }
      this._writeJsonFile(filePath, collMap);
      return;
    }

    // Single JSON file
    let parsed: any = this._readJsonFile(config.localJsonPath!) || {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      parsed = {};
    }
    if (!parsed[collectionId] || typeof parsed[collectionId] !== "object") {
      parsed[collectionId] = {};
    }
    for (const d of docs) {
      parsed[collectionId][d.id] = d.data;
    }
    this._writeJsonFile(config.localJsonPath!, parsed);
  }

  /**
   * Delete a document by docPath.
   */
  public deleteDocument(config: FirestoreConnectionConfig, docPath: string): void {
    const segments = docPath.split("/").filter(Boolean);
    if (segments.length < 2) {
      return;
    }
    const collectionId = segments[0];
    const docId = segments[1];

    if (this.isDirectoryMode(config)) {
      const filePath = path.join(config.localJsonPath!, `${collectionId}.json`);
      const collMap = this.getCollectionData(config, collectionId);
      delete collMap[docId];
      this._writeJsonFile(filePath, collMap);
      return;
    }

    // Single JSON file
    if (!config.localJsonPath || !fs.existsSync(config.localJsonPath)) return;
    const parsed = this._readJsonFile(config.localJsonPath);
    if (parsed && parsed[collectionId]) {
      delete parsed[collectionId][docId];
      this._writeJsonFile(config.localJsonPath, parsed);
    }
  }

  /**
   * Atomically delete multiple documents from a collection in a single disk write.
   */
  public deleteDocuments(
    config: FirestoreConnectionConfig,
    collectionId: string,
    docIds: string[]
  ): void {
    if (docIds.length === 0) return;

    if (this.isDirectoryMode(config)) {
      const filePath = path.join(config.localJsonPath!, `${collectionId}.json`);
      const collMap = this.getCollectionData(config, collectionId);
      for (const id of docIds) {
        delete collMap[id];
      }
      this._writeJsonFile(filePath, collMap);
      return;
    }

    // Single JSON file
    if (!config.localJsonPath || !fs.existsSync(config.localJsonPath)) return;
    const parsed = this._readJsonFile(config.localJsonPath);
    if (parsed && parsed[collectionId]) {
      for (const id of docIds) {
        delete parsed[collectionId][id];
      }
      this._writeJsonFile(config.localJsonPath, parsed);
    }
  }

  /**
   * Update or delete a specific field in a document.
   */
  public updateField(
    config: FirestoreConnectionConfig,
    docPath: string,
    fieldPath: string,
    value: any,
    isDelete = false
  ): void {
    const current = this.getDocument(config, docPath) || {};
    if (fieldPath.includes(".")) {
      const parts = fieldPath.split(".");
      let target = current;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!target[parts[i]] || typeof target[parts[i]] !== "object") {
          target[parts[i]] = {};
        }
        target = target[parts[i]];
      }
      const lastKey = parts[parts.length - 1];
      if (isDelete) {
        delete target[lastKey];
      } else {
        target[lastKey] = value;
      }
    } else {
      if (isDelete) {
        delete current[fieldPath];
      } else {
        current[fieldPath] = value;
      }
    }
    this.setDocument(config, docPath, current);
  }
}

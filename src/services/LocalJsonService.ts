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
      // 1. Direct path check: e.g. <localJsonPath>/dashboard/broker/session.json or <localJsonPath>/dashboard.json
      const filePath = path.join(config.localJsonPath, `${collectionId}.json`);
      if (fs.existsSync(filePath)) {
        const parsed = this._readJsonFile(filePath);
        return this._normalizeToDocumentMap(parsed);
      }

      // 2. Directory check: e.g. <localJsonPath>/dashboard/broker/session/ containing individual .json documents
      const dirPath = path.join(config.localJsonPath, collectionId);
      if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
        try {
          const files = fs.readdirSync(dirPath);
          const map: Record<string, any> = {};
          for (const f of files) {
            if (f.endsWith(".json")) {
              const docId = f.slice(0, -5);
              const docContent = this._readJsonFile(path.join(dirPath, f));
              if (docContent !== undefined) {
                map[docId] = docContent;
              }
            }
          }
          if (Object.keys(map).length > 0) {
            return map;
          }
        } catch {}
      }

      // 3. Fallback: Check last segment: e.g. session.json if collectionId is "dashboard/broker/session"
      const segments = collectionId.split("/").filter(Boolean);
      if (segments.length > 1) {
        const lastSeg = segments[segments.length - 1];
        const lastFilePath = path.join(config.localJsonPath, `${lastSeg}.json`);
        if (fs.existsSync(lastFilePath)) {
          const parsed = this._readJsonFile(lastFilePath);
          return this._normalizeToDocumentMap(parsed);
        }

        // 4. Try root collection file and deep navigation: e.g. <localJsonPath>/dashboard.json
        const rootColl = segments[0];
        const rootFile = path.join(config.localJsonPath, `${rootColl}.json`);
        if (fs.existsSync(rootFile)) {
          let cur: any = this._readJsonFile(rootFile);
          for (let i = 1; i < segments.length; i++) {
            if (cur && typeof cur === "object" && segments[i] in cur) {
              cur = cur[segments[i]];
            } else {
              cur = undefined;
              break;
            }
          }
          if (cur) {
            return this._normalizeToDocumentMap(cur);
          }
        }
      }

      return {};
    }

    // Single JSON file
    const parsed = this._readJsonFile(config.localJsonPath);
    if (parsed && typeof parsed === "object") {
      // Direct collection path key
      if (parsed[collectionId]) {
        return this._normalizeToDocumentMap(parsed[collectionId]);
      }
      // Deep navigation by segments
      const segments = collectionId.split("/").filter(Boolean);
      let cur: any = parsed;
      for (const seg of segments) {
        if (cur && typeof cur === "object" && seg in cur) {
          cur = cur[seg];
        } else {
          cur = undefined;
          break;
        }
      }
      if (cur) {
        return this._normalizeToDocumentMap(cur);
      }
      // Last segment
      const lastSeg = segments[segments.length - 1];
      if (lastSeg && parsed[lastSeg]) {
        return this._normalizeToDocumentMap(parsed[lastSeg]);
      }
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
   * Get a single document by docPath: e.g. "users/user1" or "dashboard/broker/session/metadata"
   */
  public getDocument(config: FirestoreConnectionConfig, docPath: string): Record<string, any> | undefined {
    const segments = docPath.split("/").filter(Boolean);
    if (segments.length < 2) {
      return undefined;
    }

    const docId = segments[segments.length - 1];
    const collPath = segments.slice(0, -1).join("/");

    if (this.isDirectoryMode(config)) {
      // 1. Direct document file check: e.g. <localJsonPath>/dashboard/broker/session/metadata.json
      const exactDocFile = path.join(config.localJsonPath!, `${docPath}.json`);
      if (fs.existsSync(exactDocFile) && !fs.statSync(exactDocFile).isDirectory()) {
        const parsed = this._readJsonFile(exactDocFile);
        if (parsed !== undefined) return parsed;
      }

      // 2. Direct filename check: e.g. <localJsonPath>/metadata.json
      const standaloneDocFile = path.join(config.localJsonPath!, `${docId}.json`);
      if (fs.existsSync(standaloneDocFile) && !fs.statSync(standaloneDocFile).isDirectory()) {
        const parsed = this._readJsonFile(standaloneDocFile);
        if (parsed !== undefined && !Array.isArray(parsed)) {
          return parsed;
        }
      }

      // 3. Collection map check
      const collMap = this.getCollectionData(config, collPath);
      if (collMap && collMap[docId] !== undefined) {
        return collMap[docId];
      }

      // 4. If 2-segment fallback:
      if (segments.length === 2) {
        const rootMap = this.getCollectionData(config, segments[0]);
        return rootMap[docId];
      }

      return undefined;
    }

    // Single JSON file
    const parsed = this._readJsonFile(config.localJsonPath!);
    if (parsed && typeof parsed === "object") {
      // Direct doc path key: e.g. "dashboard/broker/session/metadata"
      if (parsed[docPath] !== undefined) {
        return parsed[docPath];
      }
      // Deep navigation
      let cur: any = parsed;
      for (const seg of segments) {
        if (cur && typeof cur === "object" && seg in cur) {
          cur = cur[seg];
        } else {
          cur = undefined;
          break;
        }
      }
      if (cur !== undefined) {
        return cur;
      }
      // Via collection map
      const collMap = this.getCollectionData(config, collPath);
      if (collMap && collMap[docId] !== undefined) {
        return collMap[docId];
      }
      // Direct docId key
      if (parsed[docId] !== undefined) {
        return parsed[docId];
      }
    }

    return undefined;
  }

  /**
   * Save / set document data by docPath.
   */
  public setDocument(config: FirestoreConnectionConfig, docPath: string, data: Record<string, any>): void {
    const segments = docPath.split("/").filter(Boolean);
    if (segments.length < 2) {
      throw new Error(`Invalid document path: '${docPath}'`);
    }

    const docId = segments[segments.length - 1];
    const collPath = segments.slice(0, -1).join("/");

    if (this.isDirectoryMode(config)) {
      // 1. If exact doc file exists, write to it
      const exactDocFile = path.join(config.localJsonPath!, `${docPath}.json`);
      if (fs.existsSync(exactDocFile)) {
        this._writeJsonFile(exactDocFile, data);
        return;
      }

      // 2. If standalone doc file exists, write to it
      const standaloneDocFile = path.join(config.localJsonPath!, `${docId}.json`);
      if (fs.existsSync(standaloneDocFile)) {
        this._writeJsonFile(standaloneDocFile, data);
        return;
      }

      // 3. Write into collection file
      const collFilePath = path.join(config.localJsonPath!, `${collPath}.json`);
      const collMap = this.getCollectionData(config, collPath);
      collMap[docId] = data;
      this._writeJsonFile(collFilePath, collMap);
      return;
    }

    // Single JSON file
    let parsed: any = this._readJsonFile(config.localJsonPath!) || {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      parsed = {};
    }

    if (parsed[docPath] !== undefined) {
      parsed[docPath] = data;
    } else {
      let cur = parsed;
      for (let i = 0; i < segments.length - 1; i++) {
        if (!cur[segments[i]] || typeof cur[segments[i]] !== "object") {
          cur[segments[i]] = {};
        }
        cur = cur[segments[i]];
      }
      cur[docId] = data;
    }

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
   * Delete an entire collection.
   */
  public deleteCollection(config: FirestoreConnectionConfig, collectionId: string): void {
    if (!config.localJsonPath || !fs.existsSync(config.localJsonPath)) {
      return;
    }

    if (this.isDirectoryMode(config)) {
      const filePath = path.join(config.localJsonPath, `${collectionId}.json`);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        this._fileCache.delete(filePath);
      }
      return;
    }

    // Single JSON file
    const parsed = this._readJsonFile(config.localJsonPath);
    if (parsed && typeof parsed === "object" && parsed[collectionId]) {
      delete parsed[collectionId];
      this._writeJsonFile(config.localJsonPath, parsed);
    }
  }

  /**
   * Delete a document by docPath.
   */
  public deleteDocument(config: FirestoreConnectionConfig, docPath: string): void {
    const segments = docPath.split("/").filter(Boolean);
    if (segments.length < 2) {
      return;
    }

    const docId = segments[segments.length - 1];
    const collPath = segments.slice(0, -1).join("/");

    if (this.isDirectoryMode(config)) {
      const exactDocFile = path.join(config.localJsonPath!, `${docPath}.json`);
      if (fs.existsSync(exactDocFile)) {
        fs.unlinkSync(exactDocFile);
        this._fileCache.delete(exactDocFile);
        return;
      }

      const standaloneDocFile = path.join(config.localJsonPath!, `${docId}.json`);
      if (fs.existsSync(standaloneDocFile)) {
        fs.unlinkSync(standaloneDocFile);
        this._fileCache.delete(standaloneDocFile);
        return;
      }

      const collFilePath = path.join(config.localJsonPath!, `${collPath}.json`);
      const collMap = this.getCollectionData(config, collPath);
      delete collMap[docId];
      this._writeJsonFile(collFilePath, collMap);
      return;
    }

    // Single JSON file
    if (!config.localJsonPath || !fs.existsSync(config.localJsonPath)) return;
    const parsed = this._readJsonFile(config.localJsonPath);
    if (parsed && typeof parsed === "object") {
      if (parsed[docPath]) {
        delete parsed[docPath];
      }
      let cur = parsed;
      for (let i = 0; i < segments.length - 1; i++) {
        if (cur && typeof cur === "object") {
          cur = cur[segments[i]];
        }
      }
      if (cur && typeof cur === "object") {
        delete cur[docId];
      }
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
   * Accurately distinguishes between Object maps and Arrays when handling nested dot paths (e.g. "tags.0" or "items.1.name").
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
        const key = parts[i];
        const nextKey = parts[i + 1];
        const nextIsNumeric = /^\d+$/.test(nextKey);

        if (!target[key] || typeof target[key] !== "object") {
          target[key] = nextIsNumeric ? [] : {};
        }
        target = target[key];
      }
      const lastKey = parts[parts.length - 1];
      if (Array.isArray(target) && /^\d+$/.test(lastKey)) {
        const idx = parseInt(lastKey, 10);
        if (isDelete) {
          target.splice(idx, 1);
        } else {
          target[idx] = value;
        }
      } else {
        const objTarget = target as Record<string, any>;
        if (isDelete) {
          delete objTarget[lastKey];
        } else {
          objTarget[lastKey] = value;
        }
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

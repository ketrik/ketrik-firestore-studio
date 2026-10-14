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

  public static getInstance(): LocalJsonService {
    if (!LocalJsonService.instance) {
      LocalJsonService.instance = new LocalJsonService();
    }
    return LocalJsonService.instance;
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
    try {
      const content = fs.readFileSync(config.localJsonPath, "utf8");
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return Object.keys(parsed).sort();
      }
    } catch {}

    return [];
  }

  /**
   * Load entire collection map: { [docId: string]: Record<string, any> }
   */
  public getCollectionData(config: FirestoreConnectionConfig, collectionId: string): Record<string, any> {
    if (!config.localJsonPath || !fs.existsSync(config.localJsonPath)) {
      return {};
    }

    if (this.isDirectoryMode(config)) {
      const filePath = path.join(config.localJsonPath, `${collectionId}.json`);
      if (!fs.existsSync(filePath)) {
        return {};
      }
      try {
        const raw = fs.readFileSync(filePath, "utf8");
        const parsed = JSON.parse(raw);
        return this._normalizeToDocumentMap(parsed);
      } catch {
        return {};
      }
    }

    // Single JSON file
    try {
      const content = fs.readFileSync(config.localJsonPath, "utf8");
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed === "object" && parsed[collectionId]) {
        return this._normalizeToDocumentMap(parsed[collectionId]);
      }
    } catch {}

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
      fs.writeFileSync(filePath, JSON.stringify(collMap, null, 2), "utf8");
      return;
    }

    // Single JSON file
    const content = fs.existsSync(config.localJsonPath!)
      ? fs.readFileSync(config.localJsonPath!, "utf8")
      : "{}";
    let parsed: any = {};
    try {
      parsed = JSON.parse(content);
    } catch {
      parsed = {};
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      parsed = {};
    }
    if (!parsed[collectionId] || typeof parsed[collectionId] !== "object") {
      parsed[collectionId] = {};
    }
    parsed[collectionId][docId] = data;
    fs.writeFileSync(config.localJsonPath!, JSON.stringify(parsed, null, 2), "utf8");
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
      fs.writeFileSync(filePath, JSON.stringify(collMap, null, 2), "utf8");
      return;
    }

    // Single JSON file
    if (!fs.existsSync(config.localJsonPath!)) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(config.localJsonPath!, "utf8"));
      if (parsed && parsed[collectionId]) {
        delete parsed[collectionId][docId];
        fs.writeFileSync(config.localJsonPath!, JSON.stringify(parsed, null, 2), "utf8");
      }
    } catch {}
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
    if (isDelete) {
      delete current[fieldPath];
    } else {
      current[fieldPath] = value;
    }
    this.setDocument(config, docPath, current);
  }
}

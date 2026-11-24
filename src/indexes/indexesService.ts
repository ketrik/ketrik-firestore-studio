import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { ConnectionManager } from "../connections/ConnectionManager";

export interface FirestoreVectorConfig {
  dimension: number;
  flat?: Record<string, never>;
}

export interface FirestoreIndexField {
  fieldPath: string;
  order?: "ASCENDING" | "DESCENDING";
  arrayConfig?: "CONTAINS";
  vectorConfig?: FirestoreVectorConfig;
}

export type FirestoreIndexState =
  | "STATE_UNSPECIFIED"
  | "CREATING"
  | "READY"
  | "NEEDS_REPAIR";

export type FirestoreIndexQueryScope =
  | "QUERY_SCOPE_UNSPECIFIED"
  | "COLLECTION"
  | "COLLECTION_GROUP"
  | "COLLECTION_RECURSIVE";

export interface FirestoreCompositeIndex {
  name: string; // e.g. "projects/{project}/databases/{database}/collectionGroups/{collection}/indexes/{indexId}"
  queryScope: FirestoreIndexQueryScope;
  fields: FirestoreIndexField[];
  state: FirestoreIndexState;
  collectionGroup: string;
  indexId: string;
  apiScope?: string;
}

export interface FirestoreIndexConfigEntry {
  collectionGroup: string;
  queryScope: FirestoreIndexQueryScope;
  fields: FirestoreIndexField[];
  apiScope?: string;
}

export interface FirestoreIndexesConfigFile {
  indexes?: FirestoreIndexConfigEntry[];
  fieldOverrides?: any[];
}

export interface DeployIndexesResult {
  created: number;
  skipped: number;
  failed: number;
  deleted: number;
  errors: Array<{ collectionGroup: string; error: string }>;
}

export type FirestoreTtlState =
  | "STATE_UNSPECIFIED"
  | "CREATING"
  | "ACTIVE"
  | "NEEDS_REPAIR";

export interface FirestoreFieldIndexOverride {
  name: string; // projects/{project}/databases/{db}/collectionGroups/{cg}/fields/{fieldPath}
  collectionGroup: string;
  fieldPath: string;
  usesAncestorConfig: boolean;
  indexes: Array<{
    queryScope: FirestoreIndexQueryScope;
    order?: "ASCENDING" | "DESCENDING";
    arrayConfig?: "CONTAINS";
  }>;
  ttlConfig?: {
    state: FirestoreTtlState;
  };
}

export class IndexesService {
  private static instance: IndexesService;
  private _fieldOverridesCache = new Map<
    string,
    { timestamp: number; byKey: Map<string, FirestoreFieldIndexOverride> }
  >();
  private _inFlightOverrides = new Map<string, Promise<FirestoreFieldIndexOverride[]>>();

  private constructor() {}

  public static getInstance(): IndexesService {
    if (!IndexesService.instance) {
      IndexesService.instance = new IndexesService();
    }
    return IndexesService.instance;
  }

  /**
   * Acquire a valid OAuth2 access token for the given connection.
   */
  public async getAccessToken(connectionId: string): Promise<string | null> {
    const connectionManager = ConnectionManager.getInstance();
    const conn = connectionManager.getConnection(connectionId);
    if (!conn) {
      return null;
    }

    try {
      const app = await connectionManager.getApp(connectionId);
      const credential = app.options.credential;
      if (!credential || typeof (credential as any).getAccessToken !== "function") {
        return null;
      }
      const tokenObj = await (credential as any).getAccessToken();
      return tokenObj?.access_token || null;
    } catch (err) {
      console.warn(`[IndexesService] Failed to acquire access token:`, err);
      return null;
    }
  }

  /**
   * Fetch all composite indexes for a given Firestore connection.
   */
  public async listCompositeIndexes(connectionId: string): Promise<FirestoreCompositeIndex[]> {
    const connectionManager = ConnectionManager.getInstance();
    const conn = connectionManager.getConnection(connectionId);
    if (!conn) {
      return [];
    }

    if (conn.isLocalJson) {
      return [];
    }

    const projectId = conn.projectId;
    if (!projectId) {
      return [];
    }
    const databaseId = conn.databaseId || "(default)";

    // Emulators: Emulator may not support the v1 indexes REST API
    let baseUrl: string;
    let headers: Record<string, string> = { Accept: "application/json" };

    if (conn.isEmulator) {
      const emulatorHost = conn.emulatorHost || "localhost:8080";
      baseUrl = `http://${emulatorHost}/v1/projects/${encodeURIComponent(projectId)}/databases/${encodeURIComponent(databaseId)}/collectionGroups/-/indexes`;
    } else {
      const accessToken = await this.getAccessToken(connectionId);
      if (!accessToken) {
        throw new Error(
          `Unable to retrieve Google OAuth2 access token for connection '${conn.name}'. Ensure a valid Service Account key is provided.`
        );
      }
      baseUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/${encodeURIComponent(databaseId)}/collectionGroups/-/indexes`;
      headers["Authorization"] = `Bearer ${accessToken}`;
    }

    const allIndexes: FirestoreCompositeIndex[] = [];
    let pageToken: string | undefined = undefined;

    do {
      const url = new URL(baseUrl);
      if (pageToken) {
        url.searchParams.set("pageToken", pageToken);
      }

      const res = await fetch(url.toString(), { headers });
      if (!res.ok) {
        if (conn.isEmulator && (res.status === 404 || res.status === 501)) {
          return [];
        }
        const errorText = await res.text();
        throw new Error(`Failed to list indexes (HTTP ${res.status}): ${errorText}`);
      }

      const data: any = await res.json();
      const rawIndexes: any[] = data.indexes || [];

      for (const idx of rawIndexes) {
        // Expected name pattern: projects/{project}/databases/{database}/collectionGroups/{collection}/indexes/{indexId}
        const name: string = idx.name || "";
        const parts = name.split("/");
        const collectionGroupIndex = parts.indexOf("collectionGroups");
        const collectionGroup =
          collectionGroupIndex !== -1 && parts[collectionGroupIndex + 1]
            ? parts[collectionGroupIndex + 1]
            : "unknown";
        const indexesIndex = parts.indexOf("indexes");
        const indexId =
          indexesIndex !== -1 && parts[indexesIndex + 1]
            ? parts[indexesIndex + 1]
            : name;

        allIndexes.push({
          name,
          queryScope: idx.queryScope || "COLLECTION",
          apiScope: idx.apiScope,
          fields: (idx.fields || []).map((f: any) => {
            const fieldOut: FirestoreIndexField = {
              fieldPath: f.fieldPath || "",
            };
            if (f.vectorConfig) {
              fieldOut.vectorConfig = f.vectorConfig;
            } else if (f.arrayConfig) {
              fieldOut.arrayConfig = f.arrayConfig;
            } else if (f.order) {
              fieldOut.order = f.order;
            }
            return fieldOut;
          }),
          state: idx.state || "STATE_UNSPECIFIED",
          collectionGroup,
          indexId,
        });
      }

      pageToken = data.nextPageToken;
    } while (pageToken);

    return allIndexes;
  }

  /**
   * Delete a composite index by its resource name.
   */
  public async deleteIndex(connectionId: string, indexName: string): Promise<void> {
    const connectionManager = ConnectionManager.getInstance();
    connectionManager.throwIfReadOnly(connectionId, "delete composite indexes");
    const conn = connectionManager.getConnection(connectionId);
    if (!conn) {
      throw new Error(`Connection '${connectionId}' not found.`);
    }

    let url: string;
    let headers: Record<string, string> = { Accept: "application/json" };

    if (conn.isEmulator) {
      const emulatorHost = conn.emulatorHost || "localhost:8080";
      url = `http://${emulatorHost}/v1/${indexName}`;
    } else {
      const accessToken = await this.getAccessToken(connectionId);
      if (!accessToken) {
        throw new Error("Unable to acquire OAuth2 access token to delete index.");
      }
      url = `https://firestore.googleapis.com/v1/${indexName}`;
      headers["Authorization"] = `Bearer ${accessToken}`;
    }

    const res = await fetch(url, {
      method: "DELETE",
      headers,
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Failed to delete index (HTTP ${res.status}): ${errorText}`);
    }
  }

  /**
   * Create a composite index in Firestore.
   */

  public async createCompositeIndex(
    connectionId: string,
    collectionGroup: string,
    queryScope: FirestoreIndexQueryScope,
    fields: FirestoreIndexField[],
    apiScope?: string
  ): Promise<any> {
    const connectionManager = ConnectionManager.getInstance();
    connectionManager.throwIfReadOnly(connectionId, "create composite indexes");
    const conn = connectionManager.getConnection(connectionId);
    if (!conn) {
      throw new Error(`Connection '${connectionId}' not found.`);
    }

    const projectId = conn.projectId;
    if (!projectId) {
      throw new Error(`Project ID not configured for connection '${conn.name}'.`);
    }
    const databaseId = conn.databaseId || "(default)";

    let url: string;
    let headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
    };

    const encodedCg = encodeURIComponent(collectionGroup.trim());
    const encodedDb = encodeURIComponent(databaseId);
    const encodedProj = encodeURIComponent(projectId);

    if (conn.isEmulator) {
      const emulatorHost = conn.emulatorHost || "localhost:8080";
      url = `http://${emulatorHost}/v1/projects/${encodedProj}/databases/${encodedDb}/collectionGroups/${encodedCg}/indexes`;
    } else {
      const accessToken = await this.getAccessToken(connectionId);
      if (!accessToken) {
        throw new Error("Unable to acquire OAuth2 access token to create index.");
      }
      url = `https://firestore.googleapis.com/v1/projects/${encodedProj}/databases/${encodedDb}/collectionGroups/${encodedCg}/indexes`;
      headers["Authorization"] = `Bearer ${accessToken}`;
    }

    // Prepare fields payload according to Google Cloud Firestore specification
    const payloadFields = fields.map((f) => {
      const fieldObj: any = { fieldPath: f.fieldPath };
      if (f.vectorConfig) {
        fieldObj.vectorConfig = {
          dimension: f.vectorConfig.dimension,
          ...(f.vectorConfig.flat ? { flat: f.vectorConfig.flat } : { flat: {} }),
        };
      } else if (f.arrayConfig === "CONTAINS") {
        fieldObj.arrayConfig = "CONTAINS";
      } else if (f.order) {
        fieldObj.order = f.order;
      } else {
        fieldObj.order = "ASCENDING";
      }
      return fieldObj;
    });

    const body: any = {
      queryScope,
      fields: payloadFields,
    };
    if (apiScope) {
      body.apiScope = apiScope;
    }

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Failed to create index (HTTP ${res.status}): ${errorText}`);
    }

    return await res.json();
  }

  /**
   * Strip Firestore's implicit `__name__` field when comparing or exporting composite/vector indexes.
   * Cloud Firestore automatically appends `__name__` to composite index definitions (or inserts it
   * immediately before a `vectorConfig` field), whereas `firestore.indexes.json` omits it.
   */
  public normalizeIndexFields(fields: FirestoreIndexField[]): FirestoreIndexField[] {
    let list = fields || [];
    if (list.length > 1) {
      const last = list[list.length - 1];
      if (last.fieldPath === "__name__" && !last.vectorConfig && !last.arrayConfig) {
        list = list.slice(0, -1);
      }
      if (list.length > 1 && list[list.length - 1].vectorConfig) {
        const prev = list[list.length - 2];
        if (prev.fieldPath === "__name__" && !prev.vectorConfig && !prev.arrayConfig) {
          list = [...list.slice(0, -2), list[list.length - 1]];
        }
      }
    }
    return list;
  }

  /**
   * Compute a canonical deterministic key for an index definition (preserving vectorConfig, arrayConfig, order).
   */
  public getIndexKey(idx: {
    collectionGroup: string;
    queryScope?: string;
    fields: FirestoreIndexField[];
    apiScope?: string;
  }): string {
    const scope = idx.queryScope || "COLLECTION";
    const apiPart = idx.apiScope && idx.apiScope !== "ANY_API" ? `:${idx.apiScope}` : "";
    const normalizedFields = this.normalizeIndexFields(idx.fields || []);
    const fieldsKey = normalizedFields
      .map((f) => {
        if (f.vectorConfig) {
          return `${f.fieldPath}-VECTOR:${f.vectorConfig.dimension}`;
        }
        if (f.arrayConfig === "CONTAINS") {
          return `${f.fieldPath}-CONTAINS`;
        }
        return `${f.fieldPath}-${f.order || "ASCENDING"}`;
      })
      .join(";");
    return `${idx.collectionGroup}:${scope}${apiPart}:${fieldsKey}`;
  }

  /**
   * Format an index into a clean firestore.indexes.json entry.
   */
  public formatIndexForConfig(idx: {
    collectionGroup: string;
    queryScope: FirestoreIndexQueryScope;
    fields: FirestoreIndexField[];
    apiScope?: string;
  }): FirestoreIndexConfigEntry {
    const normalizedFields = this.normalizeIndexFields(idx.fields || []);
    const out: FirestoreIndexConfigEntry = {
      collectionGroup: idx.collectionGroup,
      queryScope: idx.queryScope || "COLLECTION",
      fields: normalizedFields.map((f) => {
        const fieldOut: FirestoreIndexField = { fieldPath: f.fieldPath };
        if (f.vectorConfig) {
          fieldOut.vectorConfig = {
            dimension: f.vectorConfig.dimension,
            flat: f.vectorConfig.flat || {},
          };
        } else if (f.arrayConfig === "CONTAINS") {
          fieldOut.arrayConfig = "CONTAINS";
        } else if (f.order) {
          fieldOut.order = f.order;
        }
        return fieldOut;
      }),
    };
    if (idx.apiScope && idx.apiScope !== "ANY_API") {
      out.apiScope = idx.apiScope;
    }
    return out;
  }

  /**
   * Sort index entries canonically by collectionGroup, queryScope, and serialized fields.
   */
  public sortIndexesCanonically(indexes: FirestoreIndexConfigEntry[]): FirestoreIndexConfigEntry[] {
    return [...indexes].sort((a, b) => this.getIndexKey(a).localeCompare(this.getIndexKey(b)));
  }

  /**
   * Resolve a custom indexes file path from firebase.json if configured.
   */
  private resolveFromFirebaseJson(workspaceRoot: string, databaseId?: string): string | null {
    const fbJsonPath = path.join(workspaceRoot, "firebase.json");
    if (!fs.existsSync(fbJsonPath)) {
      return null;
    }
    try {
      const fbData = JSON.parse(fs.readFileSync(fbJsonPath, "utf8"));
      const firestoreCfg = fbData?.firestore;
      if (!firestoreCfg) {
        return null;
      }

      let relPath: string | undefined;
      if (Array.isArray(firestoreCfg)) {
        const targetDb = databaseId || "(default)";
        const matched =
          firestoreCfg.find((entry: any) => (entry?.database || "(default)") === targetDb) ||
          firestoreCfg.find((entry: any) => typeof entry?.indexes === "string");
        if (matched && typeof matched.indexes === "string" && matched.indexes.trim()) {
          relPath = matched.indexes.trim();
        }
      } else if (typeof firestoreCfg === "object" && typeof firestoreCfg.indexes === "string" && firestoreCfg.indexes.trim()) {
        relPath = firestoreCfg.indexes.trim();
      }

      if (relPath) {
        return path.resolve(workspaceRoot, relPath);
      }
    } catch {
      // Ignore malformed firebase.json and fall back to standard discovery
    }
    return null;
  }

  /**
   * Locate the workspace firestore.indexes.json file (checking firebase.json first).
   */
  public async getWorkspaceIndexesFilePath(connectionId?: string): Promise<string | null> {
    const wsFolders = vscode.workspace.workspaceFolders;
    if (!wsFolders || wsFolders.length === 0) {
      return null;
    }

    const databaseId = connectionId
      ? ConnectionManager.getInstance().getConnection(connectionId)?.databaseId || "(default)"
      : undefined;

    // 1. Check firebase.json configuration in workspace roots
    for (const folder of wsFolders) {
      const configuredPath = this.resolveFromFirebaseJson(folder.uri.fsPath, databaseId);
      if (configuredPath) {
        return configuredPath;
      }
    }

    // 2. Check root for firestore.indexes.json
    for (const folder of wsFolders) {
      const candidate = path.join(folder.uri.fsPath, "firestore.indexes.json");
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    // 3. Search via findFiles
    const uris = await vscode.workspace.findFiles("**/firestore.indexes.json", "**/node_modules/**", 1);
    if (uris.length > 0) {
      return uris[0].fsPath;
    }

    // 4. Default to workspace root
    return path.join(wsFolders[0].uri.fsPath, "firestore.indexes.json");
  }

  /**
   * Load and parse local firestore.indexes.json from the workspace.
   */
  public async loadLocalIndexesFile(
    connectionId?: string
  ): Promise<{ path: string; data: FirestoreIndexesConfigFile }> {
    const filePath = await this.getWorkspaceIndexesFilePath(connectionId);
    if (!filePath) {
      throw new Error("No active workspace folder found.");
    }

    if (!fs.existsSync(filePath)) {
      return {
        path: filePath,
        data: { indexes: [], fieldOverrides: [] },
      };
    }

    try {
      const content = fs.readFileSync(filePath, "utf8");
      const data = JSON.parse(content);
      return { path: filePath, data };
    } catch (err: any) {
      throw new Error(`Failed to parse ${path.basename(filePath)}: ${err.message}`);
    }
  }

  /**
   * Save live cloud indexes to workspace firestore.indexes.json (Merge or Replace).
   */
  public async snapshotToLocalIndexesFile(
    connectionId: string,
    mode: "merge" | "overwrite" = "merge"
  ): Promise<{ path: string; totalIndexes: number }> {
    const [liveIndexes, liveOverrides] = await Promise.all([
      this.listCompositeIndexes(connectionId),
      this.listFieldOverrides(connectionId).catch(() => []),
    ]);
    const { path: filePath, data: currentData } = await this.loadLocalIndexesFile(connectionId);

    const formattedLiveIndexes = liveIndexes.map((idx) => this.formatIndexForConfig(idx));
    let finalIndexes = formattedLiveIndexes;

    if (mode === "merge" && currentData.indexes) {
      const seen = new Set(formattedLiveIndexes.map((idx) => this.getIndexKey(idx)));
      finalIndexes = [...formattedLiveIndexes];

      for (const curr of currentData.indexes) {
        const key = this.getIndexKey(curr);
        if (!seen.has(key)) {
          finalIndexes.push(this.formatIndexForConfig(curr));
          seen.add(key);
        }
      }
    }

    const formattedLiveOverrides = liveOverrides.map((ov) =>
      this.formatFieldOverrideForConfig(ov)
    );
    let finalOverrides = formattedLiveOverrides;
    if (mode === "merge" && Array.isArray(currentData.fieldOverrides)) {
      const ovKey = (ov: any) => `${ov.collectionGroup}:${ov.fieldPath}`;
      const seenOv = new Set(formattedLiveOverrides.map(ovKey));
      finalOverrides = [...formattedLiveOverrides];
      for (const currOv of currentData.fieldOverrides) {
        const k = ovKey(currOv);
        if (!seenOv.has(k)) {
          finalOverrides.push(currOv);
          seenOv.add(k);
        }
      }
    }

    const sortedIndexes = this.sortIndexesCanonically(finalIndexes);
    const outputData: FirestoreIndexesConfigFile = {
      indexes: sortedIndexes,
      fieldOverrides: finalOverrides,
    };

    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(outputData, null, 2) + "\n", "utf8");
    return { path: filePath, totalIndexes: sortedIndexes.length };
  }

  /**
   * Append a single composite index to workspace firestore.indexes.json.
   */
  public async appendIndexToWorkspaceFile(
    collectionGroup: string,
    queryScope: FirestoreIndexQueryScope,
    fields: FirestoreIndexField[],
    connectionId?: string
  ): Promise<string> {
    const { path: filePath, data } = await this.loadLocalIndexesFile(connectionId);
    const indexes = (data.indexes || []).map((idx) => this.formatIndexForConfig(idx));

    const newIndex = this.formatIndexForConfig({
      collectionGroup,
      queryScope,
      fields,
    });

    const targetKey = this.getIndexKey(newIndex);
    if (!indexes.some((idx) => this.getIndexKey(idx) === targetKey)) {
      indexes.push(newIndex);
      data.indexes = this.sortIndexesCanonically(indexes);
      if (!data.fieldOverrides) {
        data.fieldOverrides = [];
      }
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
    }

    return filePath;
  }

  /**
   * Fetch all single-field index overrides and TTL policies for a given Firestore connection.
   */
  public async listFieldOverrides(connectionId: string): Promise<FirestoreFieldIndexOverride[]> {
    const connectionManager = ConnectionManager.getInstance();
    const conn = connectionManager.getConnection(connectionId);
    if (!conn || conn.isLocalJson) {
      return [];
    }

    const projectId = conn.projectId;
    if (!projectId) {
      return [];
    }
    const databaseId = conn.databaseId || "(default)";

    let baseUrl: string;
    const headers: Record<string, string> = { Accept: "application/json" };

    if (conn.isEmulator) {
      const emulatorHost = conn.emulatorHost || "localhost:8080";
      baseUrl = `http://${emulatorHost}/v1/projects/${encodeURIComponent(projectId)}/databases/${encodeURIComponent(databaseId)}/collectionGroups/-/fields`;
    } else {
      const accessToken = await this.getAccessToken(connectionId);
      if (!accessToken) {
        throw new Error(
          `Unable to retrieve Google OAuth2 access token for connection '${conn.name}'.`
        );
      }
      baseUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/${encodeURIComponent(databaseId)}/collectionGroups/-/fields`;
      headers["Authorization"] = `Bearer ${accessToken}`;
    }

    const allOverrides: FirestoreFieldIndexOverride[] = [];
    let pageToken: string | undefined;

    do {
      const url = new URL(baseUrl);
      if (pageToken) {
        url.searchParams.set("pageToken", pageToken);
      }

      const res = await fetch(url.toString(), { headers });
      if (!res.ok) {
        if (conn.isEmulator && (res.status === 404 || res.status === 501)) {
          return [];
        }
        const errorText = await res.text();
        throw new Error(`Failed to list field overrides (HTTP ${res.status}): ${errorText}`);
      }

      const data: any = await res.json();
      const rawFields: any[] = data.fields || [];

      for (const f of rawFields) {
        const name: string = f.name || "";
        const parts = name.split("/");
        const cgIdx = parts.indexOf("collectionGroups");
        const collectionGroup =
          cgIdx !== -1 && parts[cgIdx + 1] ? parts[cgIdx + 1] : "unknown";
        const fieldsIdx = parts.indexOf("fields");
        const rawFieldPath =
          fieldsIdx !== -1 && parts[fieldsIdx + 1]
            ? decodeURIComponent(parts.slice(fieldsIdx + 1).join("/"))
            : name;
        const fieldPath = rawFieldPath === "__default__" ? "*" : rawFieldPath;

        const indexConfig = f.indexConfig || {};
        const usesAncestorConfig = indexConfig.usesAncestorConfig !== false;
        const ttlConfig = f.ttlConfig
          ? { state: (f.ttlConfig.state || "STATE_UNSPECIFIED") as FirestoreTtlState }
          : undefined;

        // Only keep explicit overrides or active/configured TTL policies
        if (!usesAncestorConfig || ttlConfig) {
          const indexes = Array.isArray(indexConfig.indexes)
            ? indexConfig.indexes.map((idx: any) => {
                const entry: any = {
                  queryScope: idx.queryScope || "COLLECTION",
                };
                const fSpec = Array.isArray(idx.fields) ? idx.fields[0] : undefined;
                if (fSpec?.arrayConfig) {
                  entry.arrayConfig = fSpec.arrayConfig;
                } else if (fSpec?.order) {
                  entry.order = fSpec.order;
                }
                return entry;
              })
            : [];

          allOverrides.push({
            name,
            collectionGroup,
            fieldPath,
            usesAncestorConfig,
            indexes,
            ttlConfig,
          });
        }
      }

      pageToken = data.nextPageToken;
    } while (pageToken);

    const sorted = allOverrides.sort((a, b) =>
      `${a.collectionGroup}:${a.fieldPath}`.localeCompare(`${b.collectionGroup}:${b.fieldPath}`)
    );
    const byKey = new Map<string, FirestoreFieldIndexOverride>();
    for (const ov of sorted) {
      byKey.set(`${ov.collectionGroup}:${ov.fieldPath}`, ov);
    }
    this._fieldOverridesCache.set(connectionId, { timestamp: Date.now(), byKey });
    return sorted;
  }

  /**
   * Synchronous cache lookup for field override / TTL metadata (zero network calls).
   * Falls back to collection-wide wildcard (`*`) exemption if present.
   */
  public getCachedFieldMeta(
    connectionId: string,
    collectionGroup: string,
    fieldPath: string
  ): FirestoreFieldIndexOverride | undefined {
    const entry = this._fieldOverridesCache.get(connectionId);
    if (!entry) return undefined;
    if (Date.now() - entry.timestamp > 5 * 60 * 1000) {
      return undefined;
    }
    return (
      entry.byKey.get(`${collectionGroup}:${fieldPath}`) ||
      entry.byKey.get(`${collectionGroup}:*`)
    );
  }

  /**
   * Deduplicated background cache warmer for field overrides & TTL policies.
   */
  public async ensureFieldOverridesLoaded(connectionId: string): Promise<void> {
    const entry = this._fieldOverridesCache.get(connectionId);
    if (entry && Date.now() - entry.timestamp <= 5 * 60 * 1000) {
      return;
    }
    const existingPromise = this._inFlightOverrides.get(connectionId);
    if (existingPromise) {
      await existingPromise;
      return;
    }
    const p = this.listFieldOverrides(connectionId)
      .catch(() => [])
      .finally(() => {
        this._inFlightOverrides.delete(connectionId);
      });
    this._inFlightOverrides.set(connectionId, p);
    await p;
  }

  /**
   * Upsert or remove a field override / TTL entry inside workspace firestore.indexes.json.
   */
  public async upsertFieldOverrideInWorkspaceFile(
    connectionId: string,
    collectionGroup: string,
    fieldPath: string,
    indexes: Array<{
      queryScope: FirestoreIndexQueryScope;
      order?: "ASCENDING" | "DESCENDING";
      arrayConfig?: "CONTAINS";
    }> | null,
    ttl?: boolean
  ): Promise<string> {
    const { path: filePath, data } = await this.loadLocalIndexesFile(connectionId);
    const overrides = Array.isArray(data.fieldOverrides) ? [...data.fieldOverrides] : [];
    const cg = collectionGroup.trim();
    const fp = fieldPath.trim();
    const idx = overrides.findIndex(
      (ov: any) => ov?.collectionGroup === cg && ov?.fieldPath === fp
    );
    const existing = idx >= 0 ? overrides[idx] : undefined;

    if (indexes === null && !ttl && !(ttl === undefined && existing?.ttl)) {
      if (idx >= 0) {
        overrides.splice(idx, 1);
      }
    } else {
      const nextEntry: any = {
        collectionGroup: cg,
        fieldPath: fp,
        indexes: indexes !== null ? indexes : existing?.indexes || [],
      };
      const nextTtl = ttl !== undefined ? ttl : existing?.ttl;
      if (nextTtl) {
        nextEntry.ttl = true;
      }
      if (idx >= 0) {
        overrides[idx] = nextEntry;
      } else {
        overrides.push(nextEntry);
      }
    }

    overrides.sort((a: any, b: any) =>
      `${a.collectionGroup}:${a.fieldPath}`.localeCompare(`${b.collectionGroup}:${b.fieldPath}`)
    );
    data.fieldOverrides = overrides;
    if (!data.indexes) {
      data.indexes = [];
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
    return filePath;
  }

  /**
   * Enable or disable a Time-to-Live (TTL) policy on a collection group field.
   */
  public async setTtlPolicy(
    connectionId: string,
    collectionGroup: string,
    fieldPath: string,
    enable: boolean
  ): Promise<any> {
    const connectionManager = ConnectionManager.getInstance();
    connectionManager.throwIfReadOnly(connectionId, "update TTL policy");
    const conn = connectionManager.getConnection(connectionId);
    if (!conn) {
      throw new Error(`Connection '${connectionId}' not found.`);
    }
    if (conn.isLocalJson) {
      throw new Error("TTL policies are not supported on Local JSON databases.");
    }

    const projectId = conn.projectId;
    if (!projectId) {
      throw new Error(`Project ID not configured for connection '${conn.name}'.`);
    }
    const databaseId = conn.databaseId || "(default)";
    const encodedCg = encodeURIComponent(collectionGroup.trim());
    const apiFieldName = fieldPath.trim() === "*" ? "__default__" : fieldPath.trim();
    const encodedField = encodeURIComponent(apiFieldName);

    let url: string;
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
    };

    if (conn.isEmulator) {
      const emulatorHost = conn.emulatorHost || "localhost:8080";
      url = `http://${emulatorHost}/v1/projects/${encodeURIComponent(projectId)}/databases/${encodeURIComponent(databaseId)}/collectionGroups/${encodedCg}/fields/${encodedField}?updateMask=ttlConfig`;
    } else {
      const accessToken = await this.getAccessToken(connectionId);
      if (!accessToken) {
        throw new Error("Unable to acquire OAuth2 access token to update TTL policy.");
      }
      url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/${encodeURIComponent(databaseId)}/collectionGroups/${encodedCg}/fields/${encodedField}?updateMask=ttlConfig`;
      headers["Authorization"] = `Bearer ${accessToken}`;
    }

    const body = enable ? { ttlConfig: {} } : { ttlConfig: null };

    const res = await fetch(url, {
      method: "PATCH",
      headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Failed to ${enable ? "enable" : "disable"} TTL policy (HTTP ${res.status}): ${errorText}`);
    }

    this._fieldOverridesCache.delete(connectionId);
    return await res.json();
  }

  /**
   * Set or reset a single-field index override (e.g. exempt a field with `indexes: []` or restore ancestor config).
   */
  public async setFieldIndexOverride(
    connectionId: string,
    collectionGroup: string,
    fieldPath: string,
    indexes: Array<{
      queryScope: FirestoreIndexQueryScope;
      order?: "ASCENDING" | "DESCENDING";
      arrayConfig?: "CONTAINS";
    }> | null,
    ttl?: boolean
  ): Promise<any> {
    const connectionManager = ConnectionManager.getInstance();
    connectionManager.throwIfReadOnly(connectionId, "update field index override");
    const conn = connectionManager.getConnection(connectionId);
    if (!conn) {
      throw new Error(`Connection '${connectionId}' not found.`);
    }
    if (conn.isLocalJson) {
      throw new Error("Single-field index overrides are not supported on Local JSON databases.");
    }

    const projectId = conn.projectId;
    if (!projectId) {
      throw new Error(`Project ID not configured for connection '${conn.name}'.`);
    }
    const databaseId = conn.databaseId || "(default)";
    const encodedCg = encodeURIComponent(collectionGroup.trim());
    const normalizedField = fieldPath.trim();
    const apiFieldName = normalizedField === "*" ? "__default__" : normalizedField;
    const encodedField = encodeURIComponent(apiFieldName);

    const updateMasks = ["indexConfig"];
    const body: any = {};

    if (indexes === null) {
      body.indexConfig = { usesAncestorConfig: true };
    } else {
      body.indexConfig = {
        usesAncestorConfig: false,
        indexes: indexes.map((idx) => {
          const fieldSpec: any = { fieldPath: normalizedField };
          if (idx.arrayConfig === "CONTAINS") {
            fieldSpec.arrayConfig = "CONTAINS";
          } else if (idx.order) {
            fieldSpec.order = idx.order;
          }
          return {
            queryScope: idx.queryScope || "COLLECTION",
            fields: [fieldSpec],
          };
        }),
      };
    }

    if (ttl !== undefined) {
      updateMasks.push("ttlConfig");
      body.ttlConfig = ttl ? {} : null;
    }

    let url: string;
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
    };

    if (conn.isEmulator) {
      const emulatorHost = conn.emulatorHost || "localhost:8080";
      url = `http://${emulatorHost}/v1/projects/${encodeURIComponent(projectId)}/databases/${encodeURIComponent(databaseId)}/collectionGroups/${encodedCg}/fields/${encodedField}?updateMask=${updateMasks.join(",")}`;
    } else {
      const accessToken = await this.getAccessToken(connectionId);
      if (!accessToken) {
        throw new Error("Unable to acquire OAuth2 access token to update field override.");
      }
      url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/${encodeURIComponent(databaseId)}/collectionGroups/${encodedCg}/fields/${encodedField}?updateMask=${updateMasks.join(",")}`;
      headers["Authorization"] = `Bearer ${accessToken}`;
    }

    const res = await fetch(url, {
      method: "PATCH",
      headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Failed to update field override (HTTP ${res.status}): ${errorText}`);
    }

    this._fieldOverridesCache.delete(connectionId);
    return await res.json();
  }

  /**
   * Canonical key for comparing single-field overrides & TTL configurations.
   */
  public getFieldOverrideKey(ov: {
    collectionGroup: string;
    fieldPath: string;
    indexes?: Array<{ queryScope?: string; order?: string; arrayConfig?: string }>;
    ttl?: boolean;
    ttlConfig?: { state?: string };
  }): string {
    const idxPart = (ov.indexes || [])
      .map((i) => `${i.queryScope || "COLLECTION"}:${i.arrayConfig || i.order || ""}`)
      .sort()
      .join(",");
    const hasTtl = ov.ttl === true || Boolean(ov.ttlConfig);
    return `${ov.collectionGroup}:${ov.fieldPath}:[${idxPart}]:ttl=${hasTtl ? 1 : 0}`;
  }

  /**
   * Format a live field override / TTL policy into firestore.indexes.json fieldOverrides format.
   */
  public formatFieldOverrideForConfig(override: FirestoreFieldIndexOverride): any {
    const out: any = {
      collectionGroup: override.collectionGroup,
      fieldPath: override.fieldPath,
      indexes: override.indexes || [],
    };
    if (override.ttlConfig) {
      out.ttl = true;
    }
    return out;
  }

  /**
   * Deploy local firestore.indexes.json indexes to live Cloud Firestore.
   */
  public async deployLocalIndexes(
    connectionId: string,
    options?: { pruneOrphans?: boolean }
  ): Promise<DeployIndexesResult> {
    ConnectionManager.getInstance().throwIfReadOnly(connectionId, "deploy composite indexes");
    const { data } = await this.loadLocalIndexesFile(connectionId);
    const localIndexes = data.indexes || [];

    const liveIndexes = await this.listCompositeIndexes(connectionId);
    const liveKeySet = new Set(liveIndexes.map((idx) => this.getIndexKey(idx)));
    const localKeySet = new Set(localIndexes.map((idx) => this.getIndexKey(idx)));

    let created = 0;
    let skipped = 0;
    let failed = 0;
    let deleted = 0;
    const errors: Array<{ collectionGroup: string; error: string }> = [];

    for (const localIdx of localIndexes) {
      const key = this.getIndexKey(localIdx);
      if (liveKeySet.has(key)) {
        skipped++;
        continue;
      }

      try {
        await this.createCompositeIndex(
          connectionId,
          localIdx.collectionGroup,
          localIdx.queryScope,
          localIdx.fields,
          localIdx.apiScope
        );
        created++;
      } catch (err: any) {
        const msg = err?.message || String(err);
        console.warn(`[IndexesService] Failed to create index for ${localIdx.collectionGroup}:`, err);
        errors.push({ collectionGroup: localIdx.collectionGroup, error: msg });
        failed++;
      }
    }

    if (options?.pruneOrphans) {
      for (const liveIdx of liveIndexes) {
        const key = this.getIndexKey(liveIdx);
        if (!localKeySet.has(key)) {
          try {
            await this.deleteIndex(connectionId, liveIdx.name);
            deleted++;
          } catch (err: any) {
            const msg = err?.message || String(err);
            console.warn(`[IndexesService] Failed to prune orphan index ${liveIdx.name}:`, err);
            errors.push({ collectionGroup: liveIdx.collectionGroup, error: `Prune failed: ${msg}` });
            failed++;
          }
        }
      }
    }

    const localOverrides = Array.isArray(data.fieldOverrides) ? data.fieldOverrides : [];
    if (localOverrides.length > 0) {
      const liveOverrides = await this.listFieldOverrides(connectionId).catch(() => []);
      const liveOvKeys = new Set(liveOverrides.map((ov) => this.getFieldOverrideKey(ov)));

      for (const ov of localOverrides) {
        if (!ov?.collectionGroup || !ov?.fieldPath) {
          continue;
        }
        const localOvKey = this.getFieldOverrideKey(ov);
        if (liveOvKeys.has(localOvKey)) {
          skipped++;
          continue;
        }
        try {
          await this.setFieldIndexOverride(
            connectionId,
            ov.collectionGroup,
            ov.fieldPath,
            Array.isArray(ov.indexes) ? ov.indexes : [],
            typeof ov.ttl === "boolean" ? ov.ttl : undefined
          );
          created++;
        } catch (err: any) {
          const msg = err?.message || String(err);
          console.warn(`[IndexesService] Failed to deploy field override ${ov.collectionGroup}.${ov.fieldPath}:`, err);
          errors.push({
            collectionGroup: `${ov.collectionGroup}.${ov.fieldPath}`,
            error: `Field override failed: ${msg}`,
          });
          failed++;
        }
      }
    }

    return { created, skipped, failed, deleted, errors };
  }
}


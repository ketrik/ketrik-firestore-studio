import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { ConnectionManager } from "../connections/ConnectionManager";

export interface FirestoreIndexField {
  fieldPath: string;
  order?: "ASCENDING" | "DESCENDING";
  arrayConfig?: "CONTAINS";
}

export type FirestoreIndexState =
  | "STATE_UNSPECIFIED"
  | "CREATING"
  | "READY"
  | "NEEDS_REPAIR";

export type FirestoreIndexQueryScope =
  | "QUERY_SCOPE_UNSPECIFIED"
  | "COLLECTION"
  | "COLLECTION_GROUP";

export interface FirestoreCompositeIndex {
  name: string; // e.g. "projects/{project}/databases/{database}/collectionGroups/{collection}/indexes/{indexId}"
  queryScope: FirestoreIndexQueryScope;
  fields: FirestoreIndexField[];
  state: FirestoreIndexState;
  collectionGroup: string;
  indexId: string;
}

export interface FirestoreIndexesConfigFile {
  indexes?: Array<{
    collectionGroup: string;
    queryScope: FirestoreIndexQueryScope;
    fields: FirestoreIndexField[];
  }>;
  fieldOverrides?: any[];
}

export class IndexesService {
  private static instance: IndexesService;

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
      baseUrl = `http://${emulatorHost}/v1/projects/${projectId}/databases/${databaseId}/collectionGroups/-/indexes`;
    } else {
      const accessToken = await this.getAccessToken(connectionId);
      if (!accessToken) {
        throw new Error(
          `Unable to retrieve Google OAuth2 access token for connection '${conn.name}'. Ensure a valid Service Account key is provided.`
        );
      }
      baseUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/collectionGroups/-/indexes`;
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
          fields: (idx.fields || []).map((f: any) => ({
            fieldPath: f.fieldPath || "",
            order: f.order,
            arrayConfig: f.arrayConfig,
          })),
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
    fields: FirestoreIndexField[]
  ): Promise<any> {
    const connectionManager = ConnectionManager.getInstance();
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

    if (conn.isEmulator) {
      const emulatorHost = conn.emulatorHost || "localhost:8080";
      url = `http://${emulatorHost}/v1/projects/${projectId}/databases/${databaseId}/collectionGroups/${collectionGroup}/indexes`;
    } else {
      const accessToken = await this.getAccessToken(connectionId);
      if (!accessToken) {
        throw new Error("Unable to acquire OAuth2 access token to create index.");
      }
      url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/collectionGroups/${collectionGroup}/indexes`;
      headers["Authorization"] = `Bearer ${accessToken}`;
    }

    // Prepare fields payload according to Google Cloud Firestore specification
    const payloadFields = fields.map((f) => {
      const fieldObj: any = { fieldPath: f.fieldPath };
      if (f.arrayConfig === "CONTAINS") {
        fieldObj.arrayConfig = "CONTAINS";
      } else if (f.order) {
        fieldObj.order = f.order;
      } else {
        fieldObj.order = "ASCENDING";
      }
      return fieldObj;
    });

    const body = {
      queryScope,
      fields: payloadFields,
    };

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
   * Locate the workspace firestore.indexes.json file if one exists.
   */
  public async getWorkspaceIndexesFilePath(): Promise<string | null> {
    const wsFolders = vscode.workspace.workspaceFolders;
    if (!wsFolders || wsFolders.length === 0) {
      return null;
    }

    // Check root for firestore.indexes.json
    for (const folder of wsFolders) {
      const candidate = path.join(folder.uri.fsPath, "firestore.indexes.json");
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    // Search via findFiles
    const uris = await vscode.workspace.findFiles("**/firestore.indexes.json", "**/node_modules/**", 1);
    if (uris.length > 0) {
      return uris[0].fsPath;
    }

    // Default to workspace root
    return path.join(wsFolders[0].uri.fsPath, "firestore.indexes.json");
  }

  /**
   * Load and parse local firestore.indexes.json from the workspace.
   */
  public async loadLocalIndexesFile(): Promise<{ path: string; data: FirestoreIndexesConfigFile }> {
    const filePath = await this.getWorkspaceIndexesFilePath();
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
    const liveIndexes = await this.listCompositeIndexes(connectionId);
    const { path: filePath, data: currentData } = await this.loadLocalIndexesFile();

    const formattedLiveIndexes = liveIndexes.map((idx) => ({
      collectionGroup: idx.collectionGroup,
      queryScope: idx.queryScope,
      fields: idx.fields.map((f) => {
        const out: any = { fieldPath: f.fieldPath };
        if (f.arrayConfig === "CONTAINS") {
          out.arrayConfig = "CONTAINS";
        } else if (f.order) {
          out.order = f.order;
        }
        return out;
      }),
    }));

    let finalIndexes = formattedLiveIndexes;

    if (mode === "merge" && currentData.indexes) {
      const existingKey = (idx: any) =>
        `${idx.collectionGroup}:${idx.queryScope}:${idx.fields
          .map((f: any) => `${f.fieldPath}-${f.order || f.arrayConfig}`)
          .join(";")}`;

      const seen = new Set(formattedLiveIndexes.map(existingKey));
      finalIndexes = [...formattedLiveIndexes];

      for (const curr of currentData.indexes) {
        const key = existingKey(curr);
        if (!seen.has(key)) {
          finalIndexes.push(curr);
          seen.add(key);
        }
      }
    }

    const outputData: FirestoreIndexesConfigFile = {
      indexes: finalIndexes,
      fieldOverrides: currentData.fieldOverrides || [],
    };

    fs.writeFileSync(filePath, JSON.stringify(outputData, null, 2) + "\n", "utf8");
    return { path: filePath, totalIndexes: finalIndexes.length };
  }

  /**
   * Append a single composite index to workspace firestore.indexes.json.
   */
  public async appendIndexToWorkspaceFile(
    collectionGroup: string,
    queryScope: FirestoreIndexQueryScope,
    fields: FirestoreIndexField[]
  ): Promise<string> {
    const { path: filePath, data } = await this.loadLocalIndexesFile();
    const indexes = data.indexes || [];

    const existingKey = (idx: any) =>
      `${idx.collectionGroup}:${idx.queryScope}:${idx.fields
        .map((f: any) => `${f.fieldPath}-${f.order || f.arrayConfig}`)
        .join(";")}`;

    const newIndex = {
      collectionGroup,
      queryScope,
      fields: fields.map((f) => {
        const out: any = { fieldPath: f.fieldPath };
        if (f.arrayConfig === "CONTAINS") {
          out.arrayConfig = "CONTAINS";
        } else if (f.order) {
          out.order = f.order;
        }
        return out;
      }),
    };

    const targetKey = existingKey(newIndex);
    if (!indexes.some((idx) => existingKey(idx) === targetKey)) {
      indexes.push(newIndex);
      data.indexes = indexes;
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
    }

    return filePath;
  }

  /**
   * Deploy local firestore.indexes.json indexes to live Cloud Firestore.
   */
  public async deployLocalIndexes(connectionId: string): Promise<{ created: number; skipped: number; failed: number }> {
    const { data } = await this.loadLocalIndexesFile();
    const localIndexes = data.indexes || [];
    if (localIndexes.length === 0) {
      return { created: 0, skipped: 0, failed: 0 };
    }

    const liveIndexes = await this.listCompositeIndexes(connectionId);
    const existingKey = (cg: string, scope: string, fields: any[]) =>
      `${cg}:${scope}:${fields
        .map((f) => `${f.fieldPath}-${f.order || f.arrayConfig || "ASCENDING"}`)
        .join(";")}`;

    const liveKeySet = new Set(
      liveIndexes.map((idx) =>
        existingKey(
          idx.collectionGroup,
          idx.queryScope,
          idx.fields.map((f) => ({
            fieldPath: f.fieldPath,
            order: f.order,
            arrayConfig: f.arrayConfig,
          }))
        )
      )
    );

    let created = 0;
    let skipped = 0;
    let failed = 0;

    for (const localIdx of localIndexes) {
      const key = existingKey(localIdx.collectionGroup, localIdx.queryScope, localIdx.fields);
      if (liveKeySet.has(key)) {
        skipped++;
        continue;
      }

      try {
        await this.createCompositeIndex(
          connectionId,
          localIdx.collectionGroup,
          localIdx.queryScope,
          localIdx.fields
        );
        created++;
      } catch (err) {
        console.warn(`[IndexesService] Failed to create index for ${localIdx.collectionGroup}:`, err);
        failed++;
      }
    }

    return { created, skipped, failed };
  }
}


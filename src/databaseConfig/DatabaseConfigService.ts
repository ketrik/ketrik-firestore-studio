import * as fs from "fs";
import { ConnectionManager, FirestoreConnectionConfig } from "../connections/ConnectionManager";
import { DatabaseMetadata, UpdateDatabaseConfigPayload } from "./types";
import { LocalJsonService } from "../services/LocalJsonService";

/**
 * Service for fetching and managing Google Cloud Firestore database configuration,
 * including Point-in-Time Recovery (PITR), Delete Protection, Concurrency Modes, and metadata.
 */
export class DatabaseConfigService {
  private static instance: DatabaseConfigService;
  private _cachedConfig = new Map<string, { timestamp: number; data: DatabaseMetadata }>();
  private static readonly CACHE_TTL_MS = 15000; // 15 seconds cache

  private constructor() {}

  public static getInstance(): DatabaseConfigService {
    if (!DatabaseConfigService.instance) {
      DatabaseConfigService.instance = new DatabaseConfigService();
    }
    return DatabaseConfigService.instance;
  }

  /**
   * Clear in-memory cached database configurations.
   */
  public clearCache(connectionId?: string): void {
    if (connectionId) {
      this._cachedConfig.delete(connectionId);
    } else {
      this._cachedConfig.clear();
    }
  }

  /**
   * Helper to retrieve Google Cloud OAuth2 access token for a given connection.
   */
  private async getAccessToken(conn: FirestoreConnectionConfig): Promise<string> {
    const connectionManager = ConnectionManager.getInstance();
    const app = await connectionManager.getApp(conn.id);
    const credential = app.options.credential;

    if (!credential || typeof (credential as any).getAccessToken !== "function") {
      throw new Error(`Connection '${conn.name}' does not have valid Google Cloud credentials to fetch access tokens.`);
    }

    const tokenObj = await (credential as any).getAccessToken();
    const accessToken = tokenObj?.access_token;
    if (!accessToken) {
      throw new Error(`Failed to retrieve Google Cloud OAuth2 access token for connection '${conn.name}'.`);
    }

    return accessToken;
  }

  /**
   * Retrieve live database configuration and metadata.
   */
  public async getDatabaseConfig(connectionId: string, bypassCache = false): Promise<DatabaseMetadata> {
    const connectionManager = ConnectionManager.getInstance();
    const conn = connectionManager.getConnection(connectionId);
    if (!conn) {
      throw new Error(`Connection with ID '${connectionId}' not found.`);
    }

    const cached = this._cachedConfig.get(connectionId);
    if (!bypassCache && cached && Date.now() - cached.timestamp < DatabaseConfigService.CACHE_TTL_MS) {
      return cached.data;
    }

    const databaseId = conn.databaseId || "(default)";
    const projectId = conn.projectId || "demo-project";

    // 1. Handle Local JSON Database
    if (conn.isLocalJson) {
      let docCount = 0;
      let sizeBytes = 0;
      if (conn.localJsonPath && fs.existsSync(conn.localJsonPath)) {
        try {
          const stat = fs.statSync(conn.localJsonPath);
          sizeBytes = stat.size;
          const collections = await LocalJsonService.getInstance().listCollections(conn);
          for (const col of collections) {
            const colData = LocalJsonService.getInstance().getCollectionData(conn, col);
            docCount += Object.keys(colData).length;
          }
        } catch {}
      }

      const meta: DatabaseMetadata = {
        name: `local-json/${conn.id}`,
        databaseId: databaseId,
        projectId: projectId,
        isLocalJson: true,
        localJsonPath: conn.localJsonPath,
        localJsonDocCount: docCount,
        localJsonSizeBytes: sizeBytes,
        type: "LOCAL_JSON",
        concurrencyMode: "OPTIMISTIC",
        pointInTimeRecoveryEnablement: "POINT_IN_TIME_RECOVERY_DISABLED",
        deleteProtectionState: "DELETE_PROTECTION_DISABLED",
      };
      this._cachedConfig.set(connectionId, { timestamp: Date.now(), data: meta });
      return meta;
    }

    // 2. Handle Local Emulator
    if (conn.isEmulator) {
      const meta: DatabaseMetadata = {
        name: `emulator/${conn.id}`,
        databaseId: databaseId,
        projectId: projectId,
        isEmulator: true,
        emulatorHost: conn.emulatorHost || "localhost:8080",
        type: "FIRESTORE_EMULATOR",
        concurrencyMode: "OPTIMISTIC",
        pointInTimeRecoveryEnablement: "POINT_IN_TIME_RECOVERY_DISABLED",
        deleteProtectionState: "DELETE_PROTECTION_DISABLED",
      };
      this._cachedConfig.set(connectionId, { timestamp: Date.now(), data: meta });
      return meta;
    }

    // 3. Handle Live Google Cloud Firestore via REST API
    const accessToken = await this.getAccessToken(conn);
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}`;

    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      const errorText = await res.text();
      let parsedError: any;
      try {
        parsedError = JSON.parse(errorText);
      } catch {}
      const msg = parsedError?.error?.message || errorText || res.statusText;
      throw new Error(`Failed to fetch database configuration from Google Cloud: ${msg} (HTTP ${res.status})`);
    }

    const data: any = await res.json();

    const meta: DatabaseMetadata = {
      name: data.name || `projects/${projectId}/databases/${databaseId}`,
      databaseId: databaseId,
      projectId: projectId,
      uid: data.uid,
      createTime: data.createTime,
      updateTime: data.updateTime,
      locationId: data.locationId,
      type: data.type || "FIRESTORE_NATIVE",
      concurrencyMode: data.concurrencyMode || "OPTIMISTIC",
      appEngineIntegrationMode: data.appEngineIntegrationMode || "DISABLED",
      pointInTimeRecoveryEnablement: data.pointInTimeRecoveryEnablement || "POINT_IN_TIME_RECOVERY_DISABLED",
      earliestVersionTime: data.earliestVersionTime,
      versionRetentionPeriod: data.versionRetentionPeriod || "604800s",
      deleteProtectionState: data.deleteProtectionState || "DELETE_PROTECTION_DISABLED",
      cmekConfig: data.cmekConfig,
      etag: data.etag,
      isLocalJson: false,
      isEmulator: false,
    };

    this._cachedConfig.set(connectionId, { timestamp: Date.now(), data: meta });
    return meta;
  }

  /**
   * Update mutable database configuration settings in Google Cloud.
   */
  public async updateDatabaseConfig(
    connectionId: string,
    updates: UpdateDatabaseConfigPayload
  ): Promise<DatabaseMetadata> {
    const connectionManager = ConnectionManager.getInstance();
    connectionManager.throwIfReadOnly(connectionId, "update database configuration");
    const conn = connectionManager.getConnection(connectionId);
    if (!conn) {
      throw new Error(`Connection with ID '${connectionId}' not found.`);
    }

    if (conn.isLocalJson || conn.isEmulator) {
      throw new Error("Database configuration cannot be modified on Local JSON or Local Emulator instances.");
    }

    const databaseId = conn.databaseId || "(default)";
    const projectId = conn.projectId;
    if (!projectId) {
      throw new Error("No GCP project ID configured for this connection.");
    }

    const updateMaskFields: string[] = [];
    const requestBody: any = {};

    if (updates.pointInTimeRecoveryEnablement !== undefined) {
      updateMaskFields.push("pointInTimeRecoveryEnablement");
      requestBody.pointInTimeRecoveryEnablement = updates.pointInTimeRecoveryEnablement;
    }
    if (updates.deleteProtectionState !== undefined) {
      updateMaskFields.push("deleteProtectionState");
      requestBody.deleteProtectionState = updates.deleteProtectionState;
    }
    if (updates.concurrencyMode !== undefined) {
      updateMaskFields.push("concurrencyMode");
      requestBody.concurrencyMode = updates.concurrencyMode;
    }
    if (updates.appEngineIntegrationMode !== undefined) {
      updateMaskFields.push("appEngineIntegrationMode");
      requestBody.appEngineIntegrationMode = updates.appEngineIntegrationMode;
    }

    if (updateMaskFields.length === 0) {
      return this.getDatabaseConfig(connectionId);
    }

    const accessToken = await this.getAccessToken(conn);
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}?updateMask=${updateMaskFields.join(",")}`;

    const res = await fetch(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!res.ok) {
      const errorText = await res.text();
      let parsedError: any;
      try {
        parsedError = JSON.parse(errorText);
      } catch {}
      const msg = parsedError?.error?.message || errorText || res.statusText;
      const gcloudCmd = this.getGcloudCommand(conn, updates);
      throw new Error(
        `Failed to update database configuration (${res.status}): ${msg}\n\n` +
        `If your service account lacks 'datastore.databases.update' permission, run this gcloud command:\n${gcloudCmd}`
      );
    }

    // Invalidate local cache and return fresh config
    this._cachedConfig.delete(connectionId);
    return this.getDatabaseConfig(connectionId, true);
  }

  /**
   * Helper to enable Point-in-Time Recovery.
   */
  public async enablePitr(connectionId: string): Promise<DatabaseMetadata> {
    return this.updateDatabaseConfig(connectionId, {
      pointInTimeRecoveryEnablement: "POINT_IN_TIME_RECOVERY_ENABLED",
    });
  }

  /**
   * Helper to disable Point-in-Time Recovery.
   */
  public async disablePitr(connectionId: string): Promise<DatabaseMetadata> {
    return this.updateDatabaseConfig(connectionId, {
      pointInTimeRecoveryEnablement: "POINT_IN_TIME_RECOVERY_DISABLED",
    });
  }

  /**
   * Helper to toggle delete protection state.
   */
  public async toggleDeleteProtection(connectionId: string, enable: boolean): Promise<DatabaseMetadata> {
    return this.updateDatabaseConfig(connectionId, {
      deleteProtectionState: enable ? "DELETE_PROTECTION_ENABLED" : "DELETE_PROTECTION_DISABLED",
    });
  }

  /**
   * Generates equivalent gcloud command for terminal execution.
   */
  public getGcloudCommand(conn: FirestoreConnectionConfig, updates: UpdateDatabaseConfigPayload): string {
    const databaseId = conn.databaseId || "(default)";
    const projectId = conn.projectId ? ` --project=${conn.projectId}` : "";
    const flags: string[] = [];

    if (updates.pointInTimeRecoveryEnablement === "POINT_IN_TIME_RECOVERY_ENABLED") {
      flags.push("--enable-pitr");
    } else if (updates.pointInTimeRecoveryEnablement === "POINT_IN_TIME_RECOVERY_DISABLED") {
      flags.push("--no-enable-pitr");
    }

    if (updates.deleteProtectionState === "DELETE_PROTECTION_ENABLED") {
      flags.push("--enable-delete-protection");
    } else if (updates.deleteProtectionState === "DELETE_PROTECTION_DISABLED") {
      flags.push("--no-enable-delete-protection");
    }

    if (updates.concurrencyMode) {
      flags.push(`--concurrency-mode=${updates.concurrencyMode.toLowerCase().replace(/_/g, "-")}`);
    }

    return `gcloud firestore databases update --database='${databaseId}'${flags.length > 0 ? " " + flags.join(" ") : ""}${projectId}`;
  }
}

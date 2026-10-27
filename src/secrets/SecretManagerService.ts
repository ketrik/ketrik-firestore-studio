import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { GoogleAuth } from "google-auth-library";
import * as vscode from "vscode";
import * as fs from "fs";
import { ConnectionManager } from "../connections/ConnectionManager";
import { SecretStorageService } from "./SecretStorageService";

export interface SecretMetadata {
  name: string; // Full resource name e.g. "projects/123/secrets/my-secret"
  id: string; // Short ID e.g. "my-secret"
  projectId: string;
  createTime?: string;
  labels?: Record<string, string>;
  replicationType?: string;
  locations?: string[];
}

export interface SecretVersionMetadata {
  name: string; // Full resource name e.g. "projects/123/secrets/my-secret/versions/1"
  versionId: string; // e.g. "1"
  secretId: string;
  projectId: string;
  state: "ENABLED" | "DISABLED" | "DESTROYED" | "STATE_UNSPECIFIED";
  createTime?: string;
  destroyTime?: string;
}

/**
 * SecretManagerService coordinates Google Cloud Secret Manager API operations
 * for connections configured in Ketrik Firestore Studio.
 */
export class SecretManagerService {
  private static instance: SecretManagerService;
  private clientMap = new Map<string, SecretManagerServiceClient>();

  private constructor() {}

  public static getInstance(): SecretManagerService {
    if (!SecretManagerService.instance) {
      SecretManagerService.instance = new SecretManagerService();
    }
    return SecretManagerService.instance;
  }

  /**
   * Reset client cache for a connection (e.g. after editing credentials)
   */
  public resetClient(connectionId: string): void {
    this.clientMap.delete(connectionId);
  }

  /**
   * Clear all cached client instances
   */
  public clearAll(): void {
    this.clientMap.clear();
  }

  /**
   * Obtain or initialize a SecretManagerServiceClient for the target connection.
   *
   * Authentication Strategy:
   * 1. If conn.useSecretStorage or conn.serviceAccountKeyPath is explicitly provided AND has Secret Manager access,
   *    credentials are used.
   * 2. Otherwise (or when fetching service account bootstrap credentials from Secret Manager), it falls back
   *    directly to the user's active Google Cloud / ADC connection session without requiring local SA keys.
   */
  public async getClient(connectionId: string, forceGcpUserAuth: boolean = false): Promise<SecretManagerServiceClient> {
    const cacheKey = forceGcpUserAuth ? `${connectionId}_gcpUser` : connectionId;
    const existing = this.clientMap.get(cacheKey);
    if (existing) {
      return existing;
    }

    const connMgr = ConnectionManager.getInstance();
    const conn = connMgr.getConnection(connectionId);
    if (!conn) {
      throw new Error(`Connection '${connectionId}' not found.`);
    }

    const options: any = { autoPaginate: false };
    const projectId = await this.ensureProjectId(connectionId);
    if (projectId) {
      options.projectId = projectId;
    }

    let hasExplicitCredentials = false;

    // 1. Try explicit service account credentials from connection config if available and not forced to GCP user auth
    if (!forceGcpUserAuth) {
      if (conn.useSecretStorage) {
        const saJson = await SecretStorageService.getInstance().getServiceAccount(conn.id);
        if (saJson) {
          try {
            options.credentials = JSON.parse(saJson);
            hasExplicitCredentials = true;
          } catch {}
        }
      } else if (conn.serviceAccountKeyPath && fs.existsSync(conn.serviceAccountKeyPath)) {
        try {
          const raw = await fs.promises.readFile(conn.serviceAccountKeyPath, "utf8");
          options.credentials = JSON.parse(raw);
          hasExplicitCredentials = true;
        } catch {}
      }
    }

    // 2. If no explicit service account is available (or forceGcpUserAuth is true), verify ADC / user credentials
    if (!hasExplicitCredentials) {
      const auth = new GoogleAuth({
        scopes: ["https://www.googleapis.com/auth/cloud-platform"],
        projectId: options.projectId,
      });

      try {
        const authClient = await auth.getClient();
        options.authClient = authClient;
      } catch (authErr: any) {
        // If user auth verification failed but connection has an SA key, fall back to SA key
        if (forceGcpUserAuth && (conn.useSecretStorage || conn.serviceAccountKeyPath)) {
          return this.getClient(connectionId, false);
        }
        throw new Error(
          `Google Cloud authentication required for Secret Manager: ${authErr.message || "No credentials found"}. ` +
          `Please run 'gcloud auth application-default login' in your terminal or configure a Service Account key.`
        );
      }
    }

    const client = new SecretManagerServiceClient(options);
    this.clientMap.set(cacheKey, client);
    return client;
  }

  /**
   * Resolves the effective Google Cloud Project ID for Secret Manager operations,
   * interactively prompting the user if not configured in the connection, workspace, or environment.
   */
  public async ensureProjectId(connectionId: string, promptIfMissing: boolean = false): Promise<string> {
    const connMgr = ConnectionManager.getInstance();
    const conn = connMgr.getConnection(connectionId);
    let projectId = connMgr.getEffectiveProjectId(conn);

    if (!projectId && promptIfMissing) {
      const entered = await vscode.window.showInputBox({
        title: "Google Secret Manager: Project ID Required",
        prompt: "Enter the Google Cloud Project ID for Secret Manager",
        placeHolder: "e.g. my-gcp-project",
        ignoreFocusOut: true,
      });

      if (entered && entered.trim()) {
        projectId = entered.trim();
        if (conn) {
          conn.projectId = projectId;
          await connMgr.updateConnection(conn);
        }
      }
    }

    if (!projectId) {
      throw new Error(
        `Google Cloud Project ID is not configured for connection '${conn?.name || connectionId}'. Please configure 'projectId' or select a Google Cloud project.`
      );
    }

    return projectId;
  }

  /**
   * Parse a Google Secret Manager canonical path or shorthand into its components.
   * Format: "projects/{project}/secrets/{secret}/versions/{version}" or "projects/{project}/secrets/{secret}"
   */
  public parseSecretResource(pathOrUri: string): { projectId?: string; secretId: string; versionId?: string } | null {
    if (!pathOrUri || typeof pathOrUri !== "string") {
      return null;
    }
    const trimmed = pathOrUri.trim();

    // Canonical pattern: projects/<p>/secrets/<s>[/versions/<v>]
    const canonicalMatch = trimmed.match(/^projects\/([^\/]+)\/secrets\/([^\/]+)(?:\/versions\/([^\/]+))?$/);
    if (canonicalMatch) {
      return {
        projectId: canonicalMatch[1],
        secretId: canonicalMatch[2],
        versionId: canonicalMatch[3],
      };
    }

    // URI format: gcp-secret://[<project>/]<s>[#<v>]
    const uriMatch = trimmed.match(/^gcp-secret:\/\/(?:([^\/]+)\/)?([^\/#]+)(?:#([^\/]+))?$/);
    if (uriMatch) {
      return {
        projectId: uriMatch[1],
        secretId: uriMatch[2],
        versionId: uriMatch[3],
      };
    }

    return null;
  }

  /**
   * Determine whether a field value looks like a Google Secret reference.
   */
  public isSecretReference(value: unknown): boolean {
    if (typeof value !== "string") {
      return false;
    }
    const trimmed = value.trim();
    return trimmed.startsWith("projects/") && trimmed.includes("/secrets/") || trimmed.startsWith("gcp-secret://");
  }

  /**
   * List all secrets within the project belonging to the connection.
   */
  public async listSecrets(
    connectionId: string,
    pageSize: number = 100,
    pageToken?: string
  ): Promise<{ secrets: SecretMetadata[]; nextPageToken?: string }> {
    const projectId = await this.ensureProjectId(connectionId, true);
    // Secret Manager listing defaults to the GCP user session / ADC first to avoid SA permission restrictions
    let client: SecretManagerServiceClient;
    try {
      client = await this.getClient(connectionId, true);
    } catch {
      client = await this.getClient(connectionId, false);
    }
    const parent = `projects/${projectId}`;

    const [secrets, , response] = await client.listSecrets(
      {
        parent,
        pageSize,
        pageToken,
      },
      { autoPaginate: false }
    );

    const parsedSecrets: SecretMetadata[] = (secrets || []).map((sec) => {
      const fullName = sec.name || "";
      const parsed = this.parseSecretResource(fullName);
      const secretId = parsed?.secretId || fullName.split("/").pop() || "";
      let replicationType = "automatic";
      let locations: string[] = [];

      if (sec.replication?.userManaged?.replicas) {
        replicationType = "user-managed";
        locations = sec.replication.userManaged.replicas.map((r) => r.location || "").filter(Boolean);
      }

      return {
        name: fullName,
        id: secretId,
        projectId,
        createTime: sec.createTime?.seconds ? new Date(Number(sec.createTime.seconds) * 1000).toISOString() : undefined,
        labels: (sec.labels as Record<string, string>) || {},
        replicationType,
        locations,
      };
    });

    return {
      secrets: parsedSecrets,
      nextPageToken: response?.nextPageToken || undefined,
    };
  }

  /**
   * List versions of a given secret.
   */
  public async listSecretVersions(connectionId: string, secretId: string): Promise<SecretVersionMetadata[]> {
    const projectId = await this.ensureProjectId(connectionId, true);
    let client: SecretManagerServiceClient;
    try {
      client = await this.getClient(connectionId, true);
    } catch {
      client = await this.getClient(connectionId, false);
    }
    const parent = `projects/${projectId}/secrets/${secretId}`;

    const [versions] = await client.listSecretVersions({ parent });

    return (versions || []).map((v) => {
      const fullName = v.name || "";
      const versionId = fullName.split("/").pop() || "";
      return {
        name: fullName,
        versionId,
        secretId,
        projectId,
        state: (v.state as any) || "STATE_UNSPECIFIED",
        createTime: v.createTime?.seconds ? new Date(Number(v.createTime.seconds) * 1000).toISOString() : undefined,
        destroyTime: v.destroyTime?.seconds ? new Date(Number(v.destroyTime.seconds) * 1000).toISOString() : undefined,
      };
    });
  }

  /**
   * Fetch and decrypt the secret version payload.
   */
  public async accessSecretPayload(
    connectionId: string,
    secretIdOrPath: string,
    version: string = "latest"
  ): Promise<string> {
    const connMgr = ConnectionManager.getInstance();
    const conn = connMgr.getConnection(connectionId);
    const defaultProjectId = connMgr.getEffectiveProjectId(conn);

    const parsed = this.parseSecretResource(secretIdOrPath);
    const projectId = parsed?.projectId || defaultProjectId || (await this.ensureProjectId(connectionId, true));
    const secretId = parsed?.secretId || secretIdOrPath;
    const effectiveVersion = parsed?.versionId || version || "latest";

    // Attempt accessing secret version: first via GCP user session / ADC, fallback to SA
    let client: SecretManagerServiceClient;
    try {
      client = await this.getClient(connectionId, true);
    } catch {
      client = await this.getClient(connectionId, false);
    }
    const name = `projects/${projectId}/secrets/${secretId}/versions/${effectiveVersion}`;

    let versionData;
    try {
      [versionData] = await client.accessSecretVersion({ name });
    } catch (err: any) {
      // If user auth threw permission error and connection has SA credentials, try with SA credentials
      if (client !== (await this.getClient(connectionId, false))) {
        const saClient = await this.getClient(connectionId, false);
        [versionData] = await saClient.accessSecretVersion({ name });
      } else {
        throw err;
      }
    }
    const payload = versionData?.payload?.data;
    if (!payload) {
      return "";
    }

    if (typeof payload === "string") {
      return payload;
    }
    return Buffer.from(payload).toString("utf8");
  }

  /**
   * Create a new secret in Secret Manager, optionally with an initial payload version.
   */
  public async createSecret(
    connectionId: string,
    secretId: string,
    initialPayload?: string,
    labels?: Record<string, string>
  ): Promise<SecretMetadata> {
    const projectId = await this.ensureProjectId(connectionId, true);

    let client: SecretManagerServiceClient;
    try {
      client = await this.getClient(connectionId, true);
    } catch {
      client = await this.getClient(connectionId, false);
    }
    const parent = `projects/${projectId}`;

    const [createdSecret] = await client.createSecret({
      parent,
      secretId,
      secret: {
        labels: labels || {},
        replication: {
          automatic: {},
        },
      },
    });

    if (initialPayload !== undefined && initialPayload !== null) {
      await this.addSecretVersion(connectionId, secretId, initialPayload);
    }

    return {
      name: createdSecret.name || `projects/${projectId}/secrets/${secretId}`,
      id: secretId,
      projectId,
      createTime: new Date().toISOString(),
      labels: labels || {},
      replicationType: "automatic",
    };
  }

  /**
   * Add a new version with payload to an existing secret.
   */
  public async addSecretVersion(
    connectionId: string,
    secretId: string,
    payloadText: string
  ): Promise<SecretVersionMetadata> {
    const defaultProjectId = await this.ensureProjectId(connectionId, true);

    const parsed = this.parseSecretResource(secretId);
    const projectId = parsed?.projectId || defaultProjectId;
    const targetSecretId = parsed?.secretId || secretId;

    let client: SecretManagerServiceClient;
    try {
      client = await this.getClient(connectionId, true);
    } catch {
      client = await this.getClient(connectionId, false);
    }
    const parent = `projects/${projectId}/secrets/${targetSecretId}`;

    const [version] = await client.addSecretVersion({
      parent,
      payload: {
        data: Buffer.from(payloadText, "utf8"),
      },
    });

    const fullName = version.name || "";
    const versionId = fullName.split("/").pop() || "";

    return {
      name: fullName,
      versionId,
      secretId: targetSecretId,
      projectId,
      state: (version.state as any) || "ENABLED",
      createTime: new Date().toISOString(),
    };
  }

  /**
   * Disable a specific secret version.
   */
  public async disableSecretVersion(
    connectionId: string,
    secretIdOrPath: string,
    versionId?: string
  ): Promise<void> {
    const fullName = this._resolveVersionFullName(connectionId, secretIdOrPath, versionId);
    const client = await this.getClient(connectionId);
    await client.disableSecretVersion({ name: fullName });
  }

  /**
   * Enable a disabled secret version.
   */
  public async enableSecretVersion(
    connectionId: string,
    secretIdOrPath: string,
    versionId?: string
  ): Promise<void> {
    const fullName = this._resolveVersionFullName(connectionId, secretIdOrPath, versionId);
    const client = await this.getClient(connectionId);
    await client.enableSecretVersion({ name: fullName });
  }

  /**
   * Destroy a secret version payload permanently.
   */
  public async destroySecretVersion(
    connectionId: string,
    secretIdOrPath: string,
    versionId?: string
  ): Promise<void> {
    const fullName = this._resolveVersionFullName(connectionId, secretIdOrPath, versionId);
    const client = await this.getClient(connectionId);
    await client.destroySecretVersion({ name: fullName });
  }

  private _resolveVersionFullName(
    connectionId: string,
    secretIdOrPath: string,
    versionId?: string
  ): string {
    const parsed = this.parseSecretResource(secretIdOrPath);
    const connMgr = ConnectionManager.getInstance();
    const conn = connMgr.getConnection(connectionId);
    const projectId = parsed?.projectId || connMgr.getEffectiveProjectId(conn);
    const secretId = parsed?.secretId || secretIdOrPath;
    const version = parsed?.versionId || versionId;

    if (!projectId || !secretId || !version) {
      throw new Error(`Incomplete secret version resource specifier: ${secretIdOrPath} (version: ${versionId})`);
    }

    return `projects/${projectId}/secrets/${secretId}/versions/${version}`;
  }
}

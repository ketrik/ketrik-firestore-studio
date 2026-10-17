import { ConnectionManager } from "../connections/ConnectionManager";

export interface StorageBucketItemData {
  name: string;
}

export interface StorageFileItemData {
  bucketName: string;
  name: string; // Full path inside bucket, e.g. "avatars/user1.png"
  size?: number;
  contentType?: string;
  updated?: string;
  isPrefix?: boolean; // True if it's a virtual directory/folder
}

export class StorageService {
  private static instance: StorageService;

  private constructor() {}

  public static getInstance(): StorageService {
    if (!StorageService.instance) {
      StorageService.instance = new StorageService();
    }
    return StorageService.instance;
  }

  /**
   * Acquire a valid OAuth2 access token for the given connection.
   */
  public async getAccessToken(connectionId: string): Promise<string | null> {
    const conn = ConnectionManager.getInstance().getConnection(connectionId);
    if (!conn) return null;

    try {
      const app = await ConnectionManager.getInstance().getApp(connectionId);
      const credential = app.options.credential;
      if (!credential || typeof (credential as any).getAccessToken !== "function") {
        return null;
      }
      const tokenObj = await (credential as any).getAccessToken();
      return tokenObj?.access_token || null;
    } catch {
      return null;
    }
  }

  /**
   * List all Cloud Storage buckets for the connection.
   */
  public async listBuckets(connectionId: string): Promise<StorageBucketItemData[]> {
    const conn = ConnectionManager.getInstance().getConnection(connectionId);
    if (!conn || conn.isLocalJson) {
      return [];
    }

    // If local emulator, check if storage bucket is configured or default
    if (conn.isEmulator) {
      const defaultBucket = conn.storageBucket || `${conn.projectId || "demo-project"}.appspot.com`;
      return [{ name: defaultBucket }];
    }

    const projectId = conn.projectId;
    if (!projectId) return [];

    try {
      const storage = await ConnectionManager.getInstance().getStorage(connectionId);
      // Attempt using storageClient.getBuckets()
      const [buckets] = await (storage as any).storageClient.getBuckets();
      if (Array.isArray(buckets) && buckets.length > 0) {
        return buckets.map((b: any) => ({ name: b.name }));
      }
    } catch (err) {
      // Fallback: Use Google Cloud Storage JSON API via OAuth2
      const accessToken = await this.getAccessToken(connectionId);
      if (accessToken) {
        const url = `https://storage.googleapis.com/storage/v1/b?project=${projectId}`;
        const res = await fetch(url, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
          },
        });
        if (res.ok) {
          const data: any = await res.json();
          if (Array.isArray(data.items)) {
            return data.items.map((b: any) => ({ name: b.name }));
          }
        }
      }
    }

    // Default fallback to configured bucket or standard Firebase naming pattern
    const fallbackName = conn.storageBucket || `${projectId}.appspot.com`;
    return [{ name: fallbackName }];
  }

  /**
   * List files and folders in a bucket, optionally under a prefix.
   */
  public async listFilesAndFolders(
    connectionId: string,
    bucketName: string,
    prefix = ""
  ): Promise<{ folders: string[]; files: StorageFileItemData[] }> {
    const conn = ConnectionManager.getInstance().getConnection(connectionId);
    if (!conn || conn.isLocalJson) {
      return { folders: [], files: [] };
    }

    const storage = await ConnectionManager.getInstance().getStorage(connectionId);
    const bucket = storage.bucket(bucketName);

    const query: any = {
      autoPaginate: false,
      delimiter: "/",
      maxResults: 100,
    };
    if (prefix) {
      query.prefix = prefix.endsWith("/") ? prefix : `${prefix}/`;
    }

    return new Promise((resolve, reject) => {
      (bucket.getFiles as any)(query, (err: any, files: any, _nextQuery: any, apiResponse: any) => {
        if (err) {
          return reject(err);
        }

        const folders: string[] = [];
        if (apiResponse && Array.isArray(apiResponse.prefixes)) {
          for (const p of apiResponse.prefixes) {
            folders.push(p);
          }
        }

        const fileItems: StorageFileItemData[] = (files || [])
          .filter((f: any) => f.name !== query.prefix) // Filter out folder placeholder objects
          .map((f: any) => ({
            bucketName,
            name: f.name,
            size: Number(f.metadata?.size || 0),
            contentType: f.metadata?.contentType,
            updated: f.metadata?.updated,
            isPrefix: false,
          }));

        resolve({ folders, files: fileItems });
      });
    });
  }

  /**
   * Generate a secure signed URL for temporary file access.
   */
  public async generateSignedUrl(
    connectionId: string,
    bucketName: string,
    filePath: string,
    expiresInMinutes = 60
  ): Promise<string> {
    const conn = ConnectionManager.getInstance().getConnection(connectionId);
    if (!conn) throw new Error("Connection not found");

    if (conn.isEmulator) {
      const host = conn.emulatorStorageHost || "localhost:9199";
      return `http://${host}/v0/b/${bucketName}/o/${encodeURIComponent(filePath)}?alt=media`;
    }

    const storage = await ConnectionManager.getInstance().getStorage(connectionId);
    const bucket = storage.bucket(bucketName);
    const file = bucket.file(filePath);

    const [signedUrl] = await file.getSignedUrl({
      action: "read",
      expires: Date.now() + expiresInMinutes * 60 * 1000,
    });

    return signedUrl;
  }

  /**
   * Get public or gs:// URL for a file.
   */
  public getFileUrls(bucketName: string, filePath: string): { gsUrl: string; httpUrl: string } {
    const gsUrl = `gs://${bucketName}/${filePath}`;
    const httpUrl = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(
      filePath
    )}?alt=media`;
    return { gsUrl, httpUrl };
  }

  /**
   * Upload a local file into a Cloud Storage bucket.
   */
  public async uploadFile(
    connectionId: string,
    bucketName: string,
    destinationPath: string,
    localFilePath: string,
    contentType?: string
  ): Promise<{ gsUrl: string; httpUrl: string }> {
    const storage = await ConnectionManager.getInstance().getStorage(connectionId);
    const bucket = storage.bucket(bucketName);

    await bucket.upload(localFilePath, {
      destination: destinationPath,
      contentType,
      metadata: {
        cacheControl: "public, max-age=31536000",
      },
    });

    return this.getFileUrls(bucketName, destinationPath);
  }

  /**
   * Delete a file from Cloud Storage.
   */
  public async deleteFile(connectionId: string, bucketName: string, filePath: string): Promise<void> {
    const storage = await ConnectionManager.getInstance().getStorage(connectionId);
    const bucket = storage.bucket(bucketName);
    const file = bucket.file(filePath);
    await file.delete();
  }

  /**
   * Scan a document's values recursively for gs:// or firebasestorage URLs.
   */
  public extractStorageUrlsFromObject(obj: any): Array<{ bucketName?: string; filePath?: string; rawUrl: string }> {
    const found: Array<{ bucketName?: string; filePath?: string; rawUrl: string }> = [];

    const recurse = (val: any) => {
      if (typeof val === "string") {
        if (val.startsWith("gs://")) {
          // gs://bucketName/path/to/file
          const withoutPrefix = val.slice(5);
          const firstSlash = withoutPrefix.indexOf("/");
          if (firstSlash !== -1) {
            const bucketName = withoutPrefix.substring(0, firstSlash);
            const filePath = withoutPrefix.substring(firstSlash + 1);
            found.push({ bucketName, filePath, rawUrl: val });
          } else {
            found.push({ bucketName: withoutPrefix, rawUrl: val });
          }
        } else if (
          val.startsWith("https://firebasestorage.googleapis.com/v0/b/") ||
          val.startsWith("https://storage.googleapis.com/")
        ) {
          // Parse bucket and object
          try {
            if (val.includes("/b/")) {
              const parts = val.split("/b/")[1]?.split("/o/");
              if (parts && parts.length === 2) {
                const bucketName = parts[0];
                const filePath = decodeURIComponent(parts[1].split("?")[0]);
                found.push({ bucketName, filePath, rawUrl: val });
              }
            } else if (val.startsWith("https://storage.googleapis.com/")) {
              const withoutDomain = val.replace("https://storage.googleapis.com/", "");
              const slashIdx = withoutDomain.indexOf("/");
              if (slashIdx !== -1) {
                const bucketName = withoutDomain.substring(0, slashIdx);
                const filePath = decodeURIComponent(withoutDomain.substring(slashIdx + 1).split("?")[0]);
                found.push({ bucketName, filePath, rawUrl: val });
              }
            }
          } catch {
            // Skip invalid URLs
          }
        }
      } else if (Array.isArray(val)) {
        val.forEach(recurse);
      } else if (val !== null && typeof val === "object") {
        Object.values(val).forEach(recurse);
      }
    };

    recurse(obj);
    return found;
  }
}

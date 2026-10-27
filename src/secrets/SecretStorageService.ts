import * as vscode from "vscode";

/**
 * SecretStorageService manages encrypted local credentials stored inside VS Code's
 * SecretStorage (macOS Keychain, Windows Credential Manager, Linux libsecret).
 * This eliminates the need to store plaintext Service Account JSON strings
 * in settings.json or workspace files.
 */
export class SecretStorageService {
  private static instance: SecretStorageService;
  private secretStorage: vscode.SecretStorage | null = null;

  private constructor() {}

  public static getInstance(): SecretStorageService {
    if (!SecretStorageService.instance) {
      SecretStorageService.instance = new SecretStorageService();
    }
    return SecretStorageService.instance;
  }

  public init(context: vscode.ExtensionContext): void {
    this.secretStorage = context.secrets;
  }

  private ensureInitialized(): vscode.SecretStorage {
    if (!this.secretStorage) {
      throw new Error("SecretStorageService is not initialized. ExtensionContext missing.");
    }
    return this.secretStorage;
  }

  /**
   * Store Service Account JSON for a specific connection in OS Keychain.
   */
  public async storeServiceAccount(connectionId: string, serviceAccountJson: string): Promise<void> {
    const storage = this.ensureInitialized();
    await storage.store(`ketrik_sa_${connectionId}`, serviceAccountJson.trim());
  }

  /**
   * Retrieve Service Account JSON for a connection from OS Keychain.
   */
  public async getServiceAccount(connectionId: string): Promise<string | undefined> {
    const storage = this.ensureInitialized();
    return await storage.get(`ketrik_sa_${connectionId}`);
  }

  /**
   * Check whether a Service Account JSON exists in OS Keychain for a connection.
   */
  public async hasServiceAccount(connectionId: string): Promise<boolean> {
    const content = await this.getServiceAccount(connectionId);
    return !!content && content.trim().length > 0;
  }

  /**
   * Delete Service Account JSON for a connection from OS Keychain.
   */
  public async deleteServiceAccount(connectionId: string): Promise<void> {
    const storage = this.ensureInitialized();
    await storage.delete(`ketrik_sa_${connectionId}`);
  }

  /**
   * Store an arbitrary named secret in SecretStorage.
   */
  public async storeSecret(key: string, value: string): Promise<void> {
    const storage = this.ensureInitialized();
    await storage.store(`ketrik_sec_${key}`, value);
  }

  /**
   * Retrieve an arbitrary named secret from SecretStorage.
   */
  public async getSecret(key: string): Promise<string | undefined> {
    const storage = this.ensureInitialized();
    return await storage.get(`ketrik_sec_${key}`);
  }

  /**
   * Delete an arbitrary named secret from SecretStorage.
   */
  public async deleteSecret(key: string): Promise<void> {
    const storage = this.ensureInitialized();
    await storage.delete(`ketrik_sec_${key}`);
  }
}

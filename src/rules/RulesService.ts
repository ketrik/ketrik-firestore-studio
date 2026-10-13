import * as vscode from "vscode";
import * as fs from "fs";
import { RulesParser, CollectionSecurityAccess } from "./RulesParser";
import { ConnectionManager } from "../connections/ConnectionManager";

/**
 * Service to manage local workspace firestore.rules and compute collection access levels.
 */
export class RulesService implements vscode.Disposable {
  private static instance: RulesService;
  private parsers = new Map<string, RulesParser>();
  private workspaceParser: RulesParser | null = null;
  private rulesWatcher: vscode.FileSystemWatcher | null = null;
  private currentRulesPath: string | null = null;
  private _onDidChangeRules = new vscode.EventEmitter<void>();
  readonly onDidChangeRules = this._onDidChangeRules.event;

  private context: vscode.ExtensionContext | null = null;
  private virtualRules = new Map<string, string>();

  private static readonly DEFAULT_RULES = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Default: lock down all documents
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
`;

  private constructor() {
    this.findAndLoadWorkspaceRules();
    this.setupWatcher();
  }

  public static getInstance(): RulesService {
    if (!RulesService.instance) {
      RulesService.instance = new RulesService();
    }
    return RulesService.instance;
  }

  public setContext(context: vscode.ExtensionContext): void {
    this.context = context;
  }

  /**
   * Fetch active Firestore Security Rules from Firebase for a connection using the Firebase Rules API.
   */
  public async fetchLiveRules(connectionId: string): Promise<string | null> {
    const connectionManager = ConnectionManager.getInstance();
    const conn = connectionManager.getConnection(connectionId);
    if (!conn) {
      return null;
    }

    try {
      const app = await connectionManager.getApp(connectionId);
      const projectId = conn.projectId || app.options.projectId;
      if (!projectId) {
        return null;
      }

      // 1. Obtain Google OAuth2 access token from Firebase App credentials
      const credential = app.options.credential;
      if (!credential || typeof (credential as any).getAccessToken !== "function") {
        return null;
      }

      const tokenObj = await (credential as any).getAccessToken();
      const accessToken = tokenObj?.access_token;
      if (!accessToken) {
        return null;
      }

      // 2. Fetch the active release for cloud.firestore
      const releaseRes = await fetch(
        `https://firebaserules.googleapis.com/v1/projects/${projectId}/releases/cloud.firestore`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
          },
        }
      );

      if (!releaseRes.ok) {
        console.warn(`[RulesService] Could not fetch release for ${projectId}: ${releaseRes.statusText}`);
        return null;
      }

      const releaseData: any = await releaseRes.json();
      const rulesetName = releaseData.rulesetName; // e.g. "projects/{id}/rulesets/{ruleset_id}"
      if (!rulesetName) {
        return null;
      }

      // 3. Fetch the ruleset content
      const rulesetRes = await fetch(
        `https://firebaserules.googleapis.com/v1/${rulesetName}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
          },
        }
      );

      if (!rulesetRes.ok) {
        console.warn(`[RulesService] Could not fetch ruleset ${rulesetName}: ${rulesetRes.statusText}`);
        return null;
      }

      const rulesetData: any = await rulesetRes.json();
      const file = rulesetData.source?.files?.find((f: any) => f.name === "firestore.rules" || f.name.endsWith(".rules"))
        || rulesetData.source?.files?.[0];

      if (file?.content) {
        await this.saveRulesContent(connectionId, file.content);
        return file.content;
      }
    } catch (err) {
      console.warn(`[RulesService] Failed to download live rules from Firebase:`, err);
    }

    return null;
  }

  /**
   * Deploy local firestore.rules to the active Firebase project via Firebase Rules API.
   */
  public async deployRules(connectionId: string, rulesContent: string): Promise<{ success: boolean; message?: string }> {
    const connectionManager = ConnectionManager.getInstance();
    const conn = connectionManager.getConnection(connectionId);
    if (!conn) {
      return { success: false, message: `Connection '${connectionId}' not found.` };
    }

    try {
      const app = await connectionManager.getApp(connectionId);
      const projectId = conn.projectId || app.options.projectId;
      if (!projectId) {
        return { success: false, message: "Project ID not configured for this connection." };
      }

      const credential = app.options.credential;
      if (!credential || typeof (credential as any).getAccessToken !== "function") {
        return { success: false, message: "Service account credential does not support getting an OAuth access token." };
      }

      const tokenObj = await (credential as any).getAccessToken();
      const accessToken = tokenObj?.access_token;
      if (!accessToken) {
        return { success: false, message: "Failed to acquire Google OAuth access token." };
      }

      // 1. Create a new ruleset with the rules source code
      const createRulesetRes = await fetch(
        `https://firebaserules.googleapis.com/v1/projects/${projectId}/rulesets`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            source: {
              files: [
                {
                  name: "firestore.rules",
                  content: rulesContent,
                },
              ],
            },
          }),
        }
      );

      if (!createRulesetRes.ok) {
        const errorText = await createRulesetRes.text();
        return { success: false, message: `Failed to create ruleset: ${errorText}` };
      }

      const rulesetData: any = await createRulesetRes.json();
      const newRulesetName = rulesetData.name; // e.g. "projects/{projectId}/rulesets/{rulesetId}"
      if (!newRulesetName) {
        return { success: false, message: "No ruleset name returned from Firebase Rules API." };
      }

      // 2. Release the ruleset to cloud.firestore
      const releaseName = `projects/${projectId}/releases/cloud.firestore`;
      const patchReleaseRes = await fetch(
        `https://firebaserules.googleapis.com/v1/${releaseName}?updateMask=rulesetName`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            release: {
              name: releaseName,
              rulesetName: newRulesetName,
            },
            updateMask: "rulesetName",
          }),
        }
      );

      if (!patchReleaseRes.ok) {
        // If release didn't exist yet, try creating it
        const createReleaseRes = await fetch(
          `https://firebaserules.googleapis.com/v1/projects/${projectId}/releases`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({
              name: releaseName,
              rulesetName: newRulesetName,
            }),
          }
        );

        if (!createReleaseRes.ok) {
          const errText = await createReleaseRes.text();
          return { success: false, message: `Failed to release ruleset: ${errText}` };
        }
      }

      // Update local cache and AST
      await this.saveRulesContent(connectionId, rulesContent);
      return { success: true };
    } catch (err: any) {
      return { success: false, message: err.message || String(err) };
    }
  }

  /**
   * Get virtual or physical rules content for a connection.
   */
  public getRulesContent(connectionId: string): string {
    // 1. Check in-memory virtual cache for this connection
    if (this.virtualRules.has(connectionId)) {
      return this.virtualRules.get(connectionId)!;
    }

    // 2. Check workspace globalState for this connection
    if (this.context) {
      const saved = this.context.globalState.get<string>(`virtual_rules:${connectionId}`);
      if (saved) {
        this.virtualRules.set(connectionId, saved);
        this.parsers.set(connectionId, new RulesParser(saved));
        return saved;
      }
    }

    // 3. If local physical workspace file exists, fall back to it
    if (this.currentRulesPath && fs.existsSync(this.currentRulesPath)) {
      try {
        const fileContent = fs.readFileSync(this.currentRulesPath, "utf8");
        return fileContent;
      } catch (e) {
        console.error("Failed to read workspace firestore.rules:", e);
      }
    }

    // 4. Default starter template
    return RulesService.DEFAULT_RULES;
  }

  /**
   * Save virtual rules content for a connection and update the AST parser.
   */
  public async saveRulesContent(connectionId: string, content: string): Promise<void> {
    this.virtualRules.set(connectionId, content);
    if (this.context) {
      await this.context.globalState.update(`virtual_rules:${connectionId}`, content);
    }
    this.parsers.set(connectionId, new RulesParser(content));
    this._onDidChangeRules.fire();
  }

  /**
   * Find firestore.rules file in the open workspace folders.
   */
  public async findAndLoadWorkspaceRules(): Promise<string | null> {
    const files = await vscode.workspace.findFiles("**/firestore.rules", "**/node_modules/**", 1);
    if (files.length > 0) {
      this.currentRulesPath = files[0].fsPath;
      try {
        const content = fs.readFileSync(this.currentRulesPath, "utf8");
        this.workspaceParser = new RulesParser(content);
        return this.currentRulesPath;
      } catch (e) {
        console.error("Failed to read firestore.rules:", e);
      }
    }
    return null;
  }

  private setupWatcher(): void {
    this.rulesWatcher = vscode.workspace.createFileSystemWatcher("**/firestore.rules");
    this.rulesWatcher.onDidChange(async (uri) => {
      this.currentRulesPath = uri.fsPath;
      try {
        const content = fs.readFileSync(uri.fsPath, "utf8");
        this.workspaceParser = new RulesParser(content);
        this._onDidChangeRules.fire();
      } catch (e) {
        console.error("Failed to reload firestore.rules:", e);
      }
    });

    this.rulesWatcher.onDidCreate(async (uri) => {
      this.currentRulesPath = uri.fsPath;
      try {
        const content = fs.readFileSync(uri.fsPath, "utf8");
        this.workspaceParser = new RulesParser(content);
        this._onDidChangeRules.fire();
      } catch (e) {}
    });

    this.rulesWatcher.onDidDelete(() => {
      this.workspaceParser = null;
      this.currentRulesPath = null;
      this._onDidChangeRules.fire();
    });
  }

  /**
   * Get the security access classification for a collection path.
   */
  public getAccessForCollection(collPath: string, connectionId?: string): CollectionSecurityAccess | null {
    // 1. Prefer the parser corresponding to this connection's rules
    if (connectionId) {
      let parser = this.parsers.get(connectionId);
      if (!parser) {
        const rules = this.getRulesContent(connectionId);
        parser = new RulesParser(rules);
        this.parsers.set(connectionId, parser);
      }
      return parser.getAccessForCollection(collPath);
    }

    // 2. Fallback to workspace parser if available
    if (this.workspaceParser) {
      return this.workspaceParser.getAccessForCollection(collPath);
    }

    return null;
  }

  /**
   * Get the current firestore.rules path if found.
   */
  public getRulesPath(): string | null {
    return this.currentRulesPath;
  }

  public dispose(): void {
    if (this.rulesWatcher) {
      this.rulesWatcher.dispose();
    }
    this._onDidChangeRules.dispose();
  }
}

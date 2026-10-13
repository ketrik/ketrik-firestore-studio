import * as vscode from "vscode";
import * as fs from "fs";
import { RulesService } from "./RulesService";
import { scheme } from "../constants";
import { ConnectionManager } from "../connections/ConnectionManager";
import { ConnectionTreeItem } from "../explorer/items";

function resolveConnectionId(item?: ConnectionTreeItem | { id: string } | string): string {
  const connectionManager = ConnectionManager.getInstance();
  if (typeof item === "string") {
    return item;
  } else if (item && "config" in item) {
    return item.config.id;
  } else if (item && "id" in item) {
    return item.id;
  }
  const connections = connectionManager.getConnections();
  return connections[0]?.id || "default";
}

/**
 * Open live deployed firestore.rules file from Firebase in the editor as a virtual file.
 */
export async function openRulesCommand(item?: ConnectionTreeItem | { id: string } | string) {
  const rulesService = RulesService.getInstance();
  const connectionId = resolveConnectionId(item);

  // 1. Fetch live rules directly from Firebase API
  let liveFetched = false;
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Loading Firestore Security Rules from Firebase...",
      cancellable: false,
    },
    async () => {
      const content = await rulesService.fetchLiveRules(connectionId);
      liveFetched = !!content;
    }
  );

  if (!liveFetched && !rulesService.hasRules(connectionId)) {
    vscode.window.showInformationMessage(
      "No live rules downloaded from Firebase. Opening starter rules template."
    );
  }

  // 2. Open virtual firestore.rules for this connection
  const virtualRulesUri = vscode.Uri.from({
    scheme,
    authority: connectionId,
    path: "/firestore.rules",
  });

  try {
    const doc = await vscode.workspace.openTextDocument(virtualRulesUri);
    await vscode.window.showTextDocument(doc);
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to open live firestore.rules: ${err.message}`);
  }
}

/**
 * Compare live deployed rules against the workspace's local firestore.rules file.
 */
export async function diffRulesCommand(item?: ConnectionTreeItem | { id: string } | string) {
  const rulesService = RulesService.getInstance();
  const connectionId = resolveConnectionId(item);

  // Check if a local firestore.rules file exists in the workspace
  let localRulesPath = rulesService.getRulesPath();
  if (!localRulesPath) {
    localRulesPath = await rulesService.findAndLoadWorkspaceRules();
  }

  if (!localRulesPath || !fs.existsSync(localRulesPath)) {
    vscode.window.showWarningMessage(
      "No local firestore.rules file found in your workspace to compare against."
    );
    return;
  }

  // Fetch latest live rules from Firebase
  let liveFetched = false;
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Fetching live deployed rules for diff...",
      cancellable: false,
    },
    async () => {
      const content = await rulesService.fetchLiveRules(connectionId);
      liveFetched = !!content;
    }
  );

  if (!liveFetched && !rulesService.hasRules(connectionId)) {
    vscode.window.showErrorMessage(
      "Could not download live rules from Firebase to compare."
    );
    return;
  }

  const liveUri = vscode.Uri.from({
    scheme,
    authority: connectionId,
    path: "/firestore.rules",
  });
  const localUri = vscode.Uri.file(localRulesPath);

  const title = `firestore.rules (Live vs Local Workspace)`;
  await vscode.commands.executeCommand("vscode.diff", liveUri, localUri, title);
}

/**
 * Deploy local (or currently active) firestore.rules to Firebase with confirmation.
 */
export async function deployRulesCommand(item?: ConnectionTreeItem | { id: string } | string) {
  const rulesService = RulesService.getInstance();
  const connectionManager = ConnectionManager.getInstance();
  const connectionId = resolveConnectionId(item);
  const conn = connectionManager.getConnection(connectionId);
  const targetName = conn ? `${conn.name} (${conn.projectId || "Project"})` : connectionId;

  // 1. Determine rules content to deploy (prefer open active document if it's firestore.rules, or local workspace file)
  let rulesToDeploy: string | null = null;
  const activeEditor = vscode.window.activeTextEditor;
  if (
    activeEditor &&
    (activeEditor.document.uri.path.endsWith("/firestore.rules") ||
      activeEditor.document.uri.path.endsWith("firestore.rules"))
  ) {
    rulesToDeploy = activeEditor.document.getText();
  } else {
    let localPath = rulesService.getRulesPath();
    if (!localPath) {
      localPath = await rulesService.findAndLoadWorkspaceRules();
    }
    if (localPath && fs.existsSync(localPath)) {
      rulesToDeploy = fs.readFileSync(localPath, "utf8");
    }
  }

  if (!rulesToDeploy) {
    vscode.window.showErrorMessage(
      "No firestore.rules found to deploy. Open a rules file or have one in your workspace."
    );
    return;
  }

  // 2. Confirmation modal
  const confirm = await vscode.window.showWarningMessage(
    `Are you sure you want to deploy these security rules to ${targetName}? This will immediately affect production database security.`,
    { modal: true },
    "Deploy Now"
  );

  if (confirm !== "Deploy Now") {
    return;
  }

  // 3. Deploy via Firebase Rules API
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Deploying Firestore Security Rules to ${targetName}...`,
      cancellable: false,
    },
    async () => {
      const result = await rulesService.deployRules(connectionId, rulesToDeploy!);
      if (result.success) {
        vscode.window.showInformationMessage(`Successfully deployed Firestore Security Rules to ${targetName}!`);
      } else {
        vscode.window.showErrorMessage(`Failed to deploy Firestore Security Rules: ${result.message}`);
      }
    }
  );
}

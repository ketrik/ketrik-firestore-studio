import * as vscode from "vscode";
import { SecretManagerService, SecretMetadata } from "./SecretManagerService";
import {
  SecretManagerBranchItem,
  SecretTreeItem,
  SecretVersionTreeItem,
  DocumentFieldItem,
  ConnectionTreeItem,
} from "../explorer/items";
import ExplorerDataProvider from "../explorer/ExplorerDataProvider";
import { DocumentFileSystemProvider } from "../editor/DocumentFileSystemProvider";
import { ConnectionManager } from "../connections/ConnectionManager";

let autoWipeTimer: NodeJS.Timeout | undefined;

/**
 * Copy text to clipboard with optional automated wipe for security.
 */
export async function copyWithSecurityWipe(text: string, label: string = "Secret payload", wipeSeconds: number = 20): Promise<void> {
  await vscode.env.clipboard.writeText(text);

  if (autoWipeTimer) {
    clearTimeout(autoWipeTimer);
    autoWipeTimer = undefined;
  }

  vscode.window.showInformationMessage(
    `$(check) ${label} copied to clipboard! (Clipboard will auto-clear in ${wipeSeconds}s for security)`
  );

  autoWipeTimer = setTimeout(async () => {
    try {
      const current = await vscode.env.clipboard.readText();
      if (current === text) {
        await vscode.env.clipboard.writeText("");
        vscode.window.setStatusBarMessage(`$(shield) Clipboard auto-cleared (${label})`, 4000);
      }
    } catch {}
  }, wipeSeconds * 1000);
}

/**
 * Command: Create a new secret in Google Secret Manager
 */
export function createSecretCommand(explorerDataProvider?: ExplorerDataProvider) {
  return async (target?: SecretManagerBranchItem | ConnectionTreeItem) => {
    let connectionId: string | undefined;

    if (target instanceof SecretManagerBranchItem) {
      connectionId = target.connectionId;
    } else if (target instanceof ConnectionTreeItem) {
      connectionId = target.config.id;
    } else {
      const connections = ConnectionManager.getInstance().getConnections();
      if (connections.length === 0) {
        vscode.window.showErrorMessage("No connections configured.");
        return;
      }
      if (connections.length === 1) {
        connectionId = connections[0].id;
      } else {
        const pick = await vscode.window.showQuickPick(
          connections.map((c) => ({
            label: c.name,
            description: c.projectId || c.id,
            connectionId: c.id,
          })),
          { placeHolder: "Select connection to create Google Secret in" }
        );
        if (!pick) {
          return;
        }
        connectionId = pick.connectionId;
      }
    }

    const secretId = await vscode.window.showInputBox({
      title: "Create Secret in Google Secret Manager",
      prompt: "Enter Secret ID (lowercase alphanumeric and hyphens, e.g. stripe-webhook-secret)",
      placeHolder: "my-secret-key",
      validateInput: (val) => {
        if (!val || !val.trim()) {
          return "Secret ID is required.";
        }
        if (!/^[a-zA-Z0-9_-]{1,255}$/.test(val.trim())) {
          return "Secret ID may only contain letters, numbers, underscores, and hyphens (up to 255 chars).";
        }
        return null;
      },
    });

    if (!secretId || !secretId.trim()) {
      return;
    }

    const initialPayload = await vscode.window.showInputBox({
      title: `Secret Value for '${secretId.trim()}'`,
      prompt: "Enter initial secret value / payload (optional, press Enter to skip)",
      password: true,
      placeHolder: "••••••••••••",
    });

    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Creating secret '${secretId.trim()}' in Google Secret Manager...`,
        },
        async () => {
          await SecretManagerService.getInstance().createSecret(
            connectionId!,
            secretId.trim(),
            initialPayload && initialPayload.length > 0 ? initialPayload : undefined
          );
        }
      );

      vscode.window.showInformationMessage(`Secret '${secretId.trim()}' created successfully in Google Secret Manager.`);
      explorerDataProvider?.refresh(true);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to create secret: ${err.message}`);
    }
  };
}

/**
 * Command: Add a new version payload to an existing secret
 */
export function addSecretVersionCommand(explorerDataProvider?: ExplorerDataProvider) {
  return async (target?: SecretTreeItem) => {
    if (!target || !(target instanceof SecretTreeItem)) {
      vscode.window.showErrorMessage("Please select a secret from the Google Secret Manager tree.");
      return;
    }

    const modePick = await vscode.window.showQuickPick(
      [
        { label: "$(edit) Enter text payload directly", mode: "text" },
        { label: "$(file) Load payload from local file", mode: "file" },
      ],
      { placeHolder: `Add new version to '${target.secret.id}'` }
    );

    if (!modePick) {
      return;
    }

    let payload = "";

    if (modePick.mode === "text") {
      const text = await vscode.window.showInputBox({
        title: `Add Secret Version — ${target.secret.id}`,
        prompt: "Enter secret value for new version",
        password: true,
        placeHolder: "••••••••••••",
      });
      if (text === undefined) {
        return;
      }
      payload = text;
    } else {
      const files = await vscode.window.showOpenDialog({
        title: `Select file payload for '${target.secret.id}'`,
        canSelectMany: false,
        openLabel: "Upload Payload",
      });
      if (!files || files.length === 0) {
        return;
      }
      const raw = await vscode.workspace.fs.readFile(files[0]);
      payload = Buffer.from(raw).toString("utf8");
    }

    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Adding new version to secret '${target.secret.id}'...`,
        },
        async () => {
          await SecretManagerService.getInstance().addSecretVersion(
            target.connectionId,
            target.secret.id,
            payload
          );
        }
      );

      vscode.window.showInformationMessage(`New version added successfully to '${target.secret.id}'.`);
      explorerDataProvider?.refresh(true);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to add secret version: ${err.message}`);
    }
  };
}

/**
 * Command: Inspect or safely reveal secret payload
 */
export function inspectSecretPayloadCommand() {
  return async (target?: SecretVersionTreeItem | SecretTreeItem) => {
    if (!target) {
      return;
    }

    let connectionId = target.connectionId;
    let secretId = "";
    let versionId = "latest";

    if (target instanceof SecretVersionTreeItem) {
      secretId = target.version.secretId;
      versionId = target.version.versionId;
    } else if (target instanceof SecretTreeItem) {
      secretId = target.secret.id;
      versionId = "latest";
    }

    try {
      let payload = "";
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Fetching secret payload for '${secretId}' (version ${versionId})...`,
        },
        async () => {
          payload = await SecretManagerService.getInstance().accessSecretPayload(
            connectionId,
            secretId,
            versionId
          );
        }
      );

      const action = await vscode.window.showQuickPick(
        [
          {
            label: "$(copy) Copy Payload to Clipboard",
            description: "Copies value with 20s security auto-wipe timer",
            action: "copy",
          },
          {
            label: "$(eye) Reveal in Ephemeral Masked Preview",
            description: "Shows secret payload in temporary message modal",
            action: "reveal",
          },
          {
            label: "$(file-code) Open in Virtual Scratchpad",
            description: "Opens payload in read-only editor buffer",
            action: "open",
          },
        ],
        { placeHolder: `Secret Payload fetched for '${secretId} (${versionId})'` }
      );

      if (!action) {
        return;
      }

      if (action.action === "copy") {
        await copyWithSecurityWipe(payload, `Secret '${secretId}'`);
      } else if (action.action === "reveal") {
        await vscode.window.showInformationMessage(
          `Secret: ${secretId} (v${versionId})\n\nValue:\n${payload}`,
          { modal: true }
        );
      } else if (action.action === "open") {
        const doc = await vscode.workspace.openTextDocument({
          content: payload,
          language: payload.trim().startsWith("{") || payload.trim().startsWith("[") ? "json" : "text",
        });
        await vscode.window.showTextDocument(doc, { preview: true });
      }
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to fetch secret payload: ${err.message}`);
    }
  };
}

/**
 * Command: Copy secret payload directly to clipboard with security auto-wipe
 */
export function copySecretPayloadCommand() {
  return async (target?: SecretVersionTreeItem | SecretTreeItem) => {
    if (!target) {
      return;
    }

    let connectionId = target.connectionId;
    let secretId = "";
    let versionId = "latest";

    if (target instanceof SecretVersionTreeItem) {
      secretId = target.version.secretId;
      versionId = target.version.versionId;
    } else if (target instanceof SecretTreeItem) {
      secretId = target.secret.id;
      versionId = "latest";
    }

    try {
      const payload = await SecretManagerService.getInstance().accessSecretPayload(
        connectionId,
        secretId,
        versionId
      );
      await copyWithSecurityWipe(payload, `Secret '${secretId}'`);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to copy secret payload: ${err.message}`);
    }
  };
}

/**
 * Command: Copy full canonical resource name (e.g. projects/.../secrets/...) to clipboard
 */
export function copySecretResourceNameCommand() {
  return async (target?: SecretTreeItem | SecretVersionTreeItem) => {
    if (!target) {
      return;
    }
    const name = target instanceof SecretTreeItem ? target.secret.name : target.version.name;
    await vscode.env.clipboard.writeText(name);
    vscode.window.showInformationMessage(`Copied resource name to clipboard: ${name}`);
  };
}

/**
 * Command: Disable a secret version
 */
export function disableSecretVersionCommand(explorerDataProvider?: ExplorerDataProvider) {
  return async (target?: SecretVersionTreeItem) => {
    if (!target || !(target instanceof SecretVersionTreeItem)) {
      return;
    }

    try {
      await SecretManagerService.getInstance().disableSecretVersion(
        target.connectionId,
        target.version.secretId,
        target.version.versionId
      );
      vscode.window.showInformationMessage(
        `Version ${target.version.versionId} of secret '${target.version.secretId}' disabled.`
      );
      explorerDataProvider?.refresh(true);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to disable secret version: ${err.message}`);
    }
  };
}

/**
 * Command: Enable a disabled secret version
 */
export function enableSecretVersionCommand(explorerDataProvider?: ExplorerDataProvider) {
  return async (target?: SecretVersionTreeItem) => {
    if (!target || !(target instanceof SecretVersionTreeItem)) {
      return;
    }

    try {
      await SecretManagerService.getInstance().enableSecretVersion(
        target.connectionId,
        target.version.secretId,
        target.version.versionId
      );
      vscode.window.showInformationMessage(
        `Version ${target.version.versionId} of secret '${target.version.secretId}' enabled.`
      );
      explorerDataProvider?.refresh(true);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to enable secret version: ${err.message}`);
    }
  };
}

/**
 * Command: Destroy a secret version payload permanently
 */
export function destroySecretVersionCommand(explorerDataProvider?: ExplorerDataProvider) {
  return async (target?: SecretVersionTreeItem) => {
    if (!target || !(target instanceof SecretVersionTreeItem)) {
      return;
    }

    const confirm = await vscode.window.showWarningMessage(
      `Are you sure you want to DESTROY version ${target.version.versionId} of secret '${target.version.secretId}'? The payload will be permanently wiped and cannot be recovered.`,
      { modal: true },
      "Destroy Version"
    );

    if (confirm !== "Destroy Version") {
      return;
    }

    try {
      await SecretManagerService.getInstance().destroySecretVersion(
        target.connectionId,
        target.version.secretId,
        target.version.versionId
      );
      vscode.window.showInformationMessage(
        `Version ${target.version.versionId} of secret '${target.version.secretId}' destroyed.`
      );
      explorerDataProvider?.refresh(true);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to destroy secret version: ${err.message}`);
    }
  };
}

/**
 * Command: Link Document Field to a Google Secret
 */
export function linkFieldToSecretCommand(explorerDataProvider?: ExplorerDataProvider) {
  return async (fieldItem?: DocumentFieldItem) => {
    if (!fieldItem || !(fieldItem instanceof DocumentFieldItem)) {
      vscode.window.showErrorMessage("Please right-click a document field.");
      return;
    }

    try {
      const { secrets } = await SecretManagerService.getInstance().listSecrets(fieldItem.connectionId);
      if (secrets.length === 0) {
        const createChoice = await vscode.window.showWarningMessage(
          "No secrets found in this Google Cloud project. Would you like to create one?",
          "Create Secret"
        );
        if (createChoice === "Create Secret") {
          await vscode.commands.executeCommand("ketrik-firestore-studio.createSecret");
        }
        return;
      }

      const picks = secrets.map((s) => ({
        label: `$(key) ${s.id}`,
        description: s.name,
        detail: `Replication: ${s.replicationType} • Created: ${s.createTime || "unknown"}`,
        secret: s,
      }));

      const selected = await vscode.window.showQuickPick(picks, {
        placeHolder: `Select Google Secret to link to field '${fieldItem.fullFieldPath}'`,
      });

      if (!selected) {
        return;
      }

      // Format canonical secret URI
      const secretResource = selected.secret.name;

      // Update the document field atomically in Firestore
      await fieldItem.parentDocRef.update({
        [fieldItem.fullFieldPath]: secretResource,
      });

      // Invalidate file system provider so open editor tabs live-reload
      DocumentFileSystemProvider.getInstance().invalidateAndNotify(
        fieldItem.connectionId,
        fieldItem.parentDocRef.path
      );

      vscode.window.showInformationMessage(
        `Field '${fieldItem.fullFieldPath}' linked to Google Secret: ${selected.secret.id}`
      );
      explorerDataProvider?.refresh(true);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to link field to secret: ${err.message}`);
    }
  };
}

/**
 * Command: Migrate sensitive plaintext field to Google Secret Manager (Extract & Mask)
 */
export function migrateFieldToSecretCommand(explorerDataProvider?: ExplorerDataProvider) {
  return async (fieldItem?: DocumentFieldItem) => {
    if (!fieldItem || !(fieldItem instanceof DocumentFieldItem)) {
      vscode.window.showErrorMessage("Please right-click a document field.");
      return;
    }

    const rawValue = fieldItem.value;
    if (typeof rawValue !== "string" || !rawValue.trim()) {
      vscode.window.showWarningMessage(
        `Field '${fieldItem.fullFieldPath}' must be a non-empty string to migrate to Secret Manager.`
      );
      return;
    }

    const defaultSecretId = `${fieldItem.parentDocRef.id}_${fieldItem.fieldName}`
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "_");

    const secretId = await vscode.window.showInputBox({
      title: "Migrate Field to Google Secret Manager",
      prompt: `Enter Secret ID for secret holding '${fieldItem.fullFieldPath}' value`,
      value: defaultSecretId,
      validateInput: (val) => {
        if (!val || !val.trim()) {
          return "Secret ID is required.";
        }
        if (!/^[a-zA-Z0-9_-]{1,255}$/.test(val.trim())) {
          return "Secret ID may only contain letters, numbers, underscores, and hyphens.";
        }
        return null;
      },
    });

    if (!secretId || !secretId.trim()) {
      return;
    }

    try {
      let createdSecret: SecretMetadata | undefined;
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Migrating field '${fieldItem.fullFieldPath}' to Secret Manager...`,
        },
        async () => {
          createdSecret = await SecretManagerService.getInstance().createSecret(
            fieldItem.connectionId,
            secretId.trim(),
            rawValue
          );

          // Replace plaintext field with canonical secret resource link in Firestore
          await fieldItem.parentDocRef.update({
            [fieldItem.fullFieldPath]: createdSecret.name,
          });
        }
      );

      DocumentFileSystemProvider.getInstance().invalidateAndNotify(
        fieldItem.connectionId,
        fieldItem.parentDocRef.path
      );

      vscode.window.showInformationMessage(
        `Field '${fieldItem.fullFieldPath}' successfully migrated to secret '${secretId.trim()}'. Plaintext replaced with secret link.`
      );
      explorerDataProvider?.refresh(true);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to migrate field to secret: ${err.message}`);
    }
  };
}

/**
 * Command: Reveal the secret payload of a field containing a secret link
 */
export function revealFieldSecretPayloadCommand() {
  return async (fieldItem?: DocumentFieldItem) => {
    if (!fieldItem || !(fieldItem instanceof DocumentFieldItem)) {
      return;
    }

    const secretResource = String(fieldItem.value || "");
    try {
      const payload = await SecretManagerService.getInstance().accessSecretPayload(
        fieldItem.connectionId,
        secretResource
      );

      const action = await vscode.window.showQuickPick(
        [
          { label: "$(copy) Copy Secret Payload to Clipboard (Auto-Wipe in 20s)", action: "copy" },
          { label: "$(eye) Reveal in Ephemeral Modal", action: "reveal" },
        ],
        { placeHolder: `Secret Payload for field '${fieldItem.fullFieldPath}'` }
      );

      if (action?.action === "copy") {
        await copyWithSecurityWipe(payload, `Field '${fieldItem.fullFieldPath}' secret`);
      } else if (action?.action === "reveal") {
        await vscode.window.showInformationMessage(
          `Field: ${fieldItem.fullFieldPath}\nSecret: ${secretResource}\n\nPayload:\n${payload}`,
          { modal: true }
        );
      }
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to fetch secret payload: ${err.message}`);
    }
  };
}

/**
 * Register all Google Secret Manager commands with VS Code extension context.
 */
export function registerSecretCommands(
  context: vscode.ExtensionContext,
  explorerDataProvider: ExplorerDataProvider
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.createSecret",
      createSecretCommand(explorerDataProvider)
    ),
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.addSecretVersion",
      addSecretVersionCommand(explorerDataProvider)
    ),
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.inspectSecretPayload",
      inspectSecretPayloadCommand()
    ),
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.copySecretPayload",
      copySecretPayloadCommand()
    ),
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.copySecretResourceName",
      copySecretResourceNameCommand()
    ),
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.disableSecretVersion",
      disableSecretVersionCommand(explorerDataProvider)
    ),
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.enableSecretVersion",
      enableSecretVersionCommand(explorerDataProvider)
    ),
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.destroySecretVersion",
      destroySecretVersionCommand(explorerDataProvider)
    ),
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.linkFieldToSecret",
      linkFieldToSecretCommand(explorerDataProvider)
    ),
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.migrateFieldToSecret",
      migrateFieldToSecretCommand(explorerDataProvider)
    ),
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.revealFieldSecretPayload",
      revealFieldSecretPayloadCommand()
    ),
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.refreshSecrets",
      (item?: any) => {
        if (item) {
          explorerDataProvider.refreshNode(item);
        } else {
          explorerDataProvider.refresh();
        }
      }
    )
  );
}

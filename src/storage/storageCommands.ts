import * as vscode from "vscode";
import {
  StorageBucketsBranchItem,
  StorageBucketTreeItem,
  StorageFolderTreeItem,
  StorageFileTreeItem,
  DocumentItem,
} from "../explorer/items";
import { StorageService } from "../storage/storageService";
import { ConnectionManager } from "../connections/ConnectionManager";
import ExplorerDataProvider from "../explorer/ExplorerDataProvider";
import * as path from "path";

/**
 * Register all Cloud Storage commands.
 */
export function registerStorageCommands(
  context: vscode.ExtensionContext,
  explorerDataProvider: ExplorerDataProvider
): void {
  const storageService = StorageService.getInstance();

  // 1. Refresh Storage Branch / Bucket / Folder
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.refreshStorage",
      async (item?: StorageBucketsBranchItem | StorageBucketTreeItem | StorageFolderTreeItem) => {
        if (item) {
          explorerDataProvider.refreshNode(item);
        } else {
          explorerDataProvider.refresh();
        }
      }
    )
  );

  // 2. Upload file to Bucket or Folder
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.uploadStorageFile",
      async (target?: StorageBucketTreeItem | StorageFolderTreeItem | DocumentItem) => {
        let connectionId: string | undefined;
        let bucketName: string | undefined;
        let prefix = "";

        if (target instanceof StorageBucketTreeItem) {
          connectionId = target.connectionId;
          bucketName = target.bucketName;
        } else if (target instanceof StorageFolderTreeItem) {
          connectionId = target.connectionId;
          bucketName = target.bucketName;
          prefix = target.prefix;
        } else if (target instanceof DocumentItem) {
          connectionId = target.connectionId;
        }

        const connMgr = ConnectionManager.getInstance();
        if (!connectionId) {
          const connections = connMgr.getConnections().filter((c) => !c.isLocalJson);
          if (connections.length === 0) {
            vscode.window.showErrorMessage("No cloud Firestore connections available for Storage upload.");
            return;
          }
          const picks = connections.map((c) => ({ label: c.name, description: c.projectId, id: c.id }));
          const picked = await vscode.window.showQuickPick(picks, { placeHolder: "Select connection for upload" });
          if (!picked) return;
          connectionId = picked.id;
        }

        if (!bucketName) {
          try {
            const buckets = await storageService.listBuckets(connectionId);
            if (buckets.length === 0) {
              vscode.window.showErrorMessage("No Cloud Storage buckets found.");
              return;
            }
            if (buckets.length === 1) {
              bucketName = buckets[0].name;
            } else {
              const pickedBucket = await vscode.window.showQuickPick(
                buckets.map((b) => ({ label: b.name })),
                { placeHolder: "Select destination Storage bucket" }
              );
              if (!pickedBucket) return;
              bucketName = pickedBucket.label;
            }
          } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to list buckets: ${err.message}`);
            return;
          }
        }

        // Pick local file(s) to upload
        const fileUris = await vscode.window.showOpenDialog({
          canSelectMany: true,
          openLabel: "Upload to Cloud Storage",
          title: `Upload to bucket '${bucketName}'`,
        });

        if (!fileUris || fileUris.length === 0) {
          return;
        }

        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Uploading ${fileUris.length} file(s) to ${bucketName}...`,
            cancellable: false,
          },
          async (progress) => {
            const uploadedUrls: string[] = [];

            for (let i = 0; i < fileUris.length; i++) {
              const localUri = fileUris[i];
              const fileName = path.basename(localUri.fsPath);
              const destinationPath = prefix ? `${prefix.replace(/\/$/, "")}/${fileName}` : fileName;

              progress.report({
                message: `[${i + 1}/${fileUris.length}] ${fileName}`,
                increment: 100 / fileUris.length,
              });

              try {
                const urls = await storageService.uploadFile(
                  connectionId!,
                  bucketName!,
                  destinationPath,
                  localUri.fsPath
                );
                uploadedUrls.push(urls.httpUrl);
              } catch (err: any) {
                vscode.window.showErrorMessage(`Failed to upload '${fileName}': ${err.message}`);
              }
            }

            if (uploadedUrls.length > 0) {
              // Copy first URL to clipboard and show options
              await vscode.env.clipboard.writeText(uploadedUrls[0]);
              vscode.window.showInformationMessage(
                `Successfully uploaded ${uploadedUrls.length} file(s). Primary URL copied to clipboard!`
              );
            }

            // Refresh tree node if applicable
            if (target instanceof StorageBucketTreeItem || target instanceof StorageFolderTreeItem) {
              explorerDataProvider.refreshNode(target);
            } else {
              explorerDataProvider.refresh();
            }
          }
        );
      }
    )
  );

  // 3. Inspect Storage File (details & actions)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.inspectStorageFile",
      async (item?: StorageFileTreeItem) => {
        if (!item || !item.fileData) return;

        const { gsUrl, httpUrl } = storageService.getFileUrls(item.bucketName, item.fileData.name);
        const fileName = item.fileData.name.split("/").pop() || item.fileData.name;

        const actions = [
          { label: "📋 Copy Download URL", action: "copyHttp", detail: httpUrl },
          { label: "📋 Copy gs:// Path", action: "copyGs", detail: gsUrl },
          { label: "🔑 Generate Signed URL (Custom Expiry)...", action: "signedUrl" },
          { label: "🌐 Open in External Browser", action: "openBrowser" },
          { label: "🗑️ Delete File", action: "delete" },
        ];

        const choice = await vscode.window.showQuickPick(actions, {
          title: `Cloud Storage File: ${fileName}`,
          placeHolder: `Size: ${item.description || "N/A"} • Bucket: ${item.bucketName}`,
        });

        if (!choice) return;

        if (choice.action === "copyHttp") {
          await vscode.env.clipboard.writeText(httpUrl);
          vscode.window.showInformationMessage(`Copied Download URL to clipboard.`);
        } else if (choice.action === "copyGs") {
          await vscode.env.clipboard.writeText(gsUrl);
          vscode.window.showInformationMessage(`Copied gs:// URI to clipboard.`);
        } else if (choice.action === "signedUrl") {
          await vscode.commands.executeCommand("ketrik-firestore-studio.mintSignedUrl", item);
        } else if (choice.action === "openBrowser") {
          await vscode.env.openExternal(vscode.Uri.parse(httpUrl));
        } else if (choice.action === "delete") {
          await vscode.commands.executeCommand("ketrik-firestore-studio.deleteStorageFile", item);
        }
      }
    )
  );

  // 4. Mint Signed URL with customizable expiry
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.mintSignedUrl",
      async (item?: StorageFileTreeItem) => {
        if (!item || !item.fileData) return;

        const durations = [
          { label: "15 Minutes", minutes: 15 },
          { label: "1 Hour", minutes: 60 },
          { label: "24 Hours (1 Day)", minutes: 1440 },
          { label: "7 Days", minutes: 10080 },
        ];

        const pick = await vscode.window.showQuickPick(durations, {
          placeHolder: "Select Signed URL expiration duration",
        });
        if (!pick) return;

        try {
          const signedUrl = await storageService.generateSignedUrl(
            item.connectionId,
            item.bucketName,
            item.fileData.name,
            pick.minutes
          );

          await vscode.env.clipboard.writeText(signedUrl);
          const openAction = await vscode.window.showInformationMessage(
            `Signed URL generated (expires in ${pick.label}). Copied to clipboard!`,
            "Open in Browser"
          );
          if (openAction === "Open in Browser") {
            await vscode.env.openExternal(vscode.Uri.parse(signedUrl));
          }
        } catch (err: any) {
          vscode.window.showErrorMessage(`Failed to mint Signed URL: ${err.message}`);
        }
      }
    )
  );

  // 5. Delete File from Cloud Storage
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.deleteStorageFile",
      async (item?: StorageFileTreeItem) => {
        if (!item || !item.fileData) return;

        const fileName = item.fileData.name.split("/").pop() || item.fileData.name;
        const confirm = await vscode.window.showWarningMessage(
          `Are you sure you want to permanently delete '${fileName}' from bucket '${item.bucketName}'?`,
          { modal: true },
          "Delete File",
          "Cancel"
        );

        if (confirm !== "Delete File") return;

        try {
          await storageService.deleteFile(item.connectionId, item.bucketName, item.fileData.name);
          vscode.window.showInformationMessage(`Deleted file '${fileName}'.`);
          explorerDataProvider.refresh();
        } catch (err: any) {
          vscode.window.showErrorMessage(`Failed to delete file: ${err.message}`);
        }
      }
    )
  );

  // 6. Copy gs:// and HTTP URLs directly from context menu
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.copyStorageGsUrl",
      async (item?: StorageFileTreeItem) => {
        if (!item || !item.fileData) return;
        const { gsUrl } = storageService.getFileUrls(item.bucketName, item.fileData.name);
        await vscode.env.clipboard.writeText(gsUrl);
        vscode.window.showInformationMessage(`Copied '${gsUrl}' to clipboard.`);
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.copyStorageHttpUrl",
      async (item?: StorageFileTreeItem) => {
        if (!item || !item.fileData) return;
        const { httpUrl } = storageService.getFileUrls(item.bucketName, item.fileData.name);
        await vscode.env.clipboard.writeText(httpUrl);
        vscode.window.showInformationMessage(`Copied Download URL to clipboard.`);
      }
    )
  );
}

/**
 * Cascade orphan storage files prompt when deleting a document or user.
 * Returns true if deletion should proceed.
 */
export async function promptAndCleanupOrphanStorageFiles(
  connectionId: string,
  docData: any,
  itemLabel: string
): Promise<void> {
  const storageService = StorageService.getInstance();
  const urls = storageService.extractStorageUrlsFromObject(docData);

  if (urls.length === 0) {
    return;
  }

  const validFiles = urls.filter((u) => u.bucketName && u.filePath);
  if (validFiles.length === 0) return;

  const choice = await vscode.window.showWarningMessage(
    `Document / User '${itemLabel}' references ${validFiles.length} Cloud Storage file(s). Would you like to also delete the referenced Storage files?`,
    "Delete Referenced Files",
    "Keep Files"
  );

  if (choice === "Delete Referenced Files") {
    let deletedCount = 0;
    for (const f of validFiles) {
      try {
        await storageService.deleteFile(connectionId, f.bucketName!, f.filePath!);
        deletedCount++;
      } catch (err) {
        // Silently continue or warn
      }
    }
    if (deletedCount > 0) {
      vscode.window.showInformationMessage(`Cleaned up ${deletedCount} referenced Cloud Storage file(s).`);
    }
  }
}

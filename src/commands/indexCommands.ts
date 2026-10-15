import * as vscode from "vscode";
import { CompositeIndexItem, CompositeIndexesBranchItem } from "../explorer/items";
import { IndexesService } from "../indexes/indexesService";
import { ConnectionManager } from "../connections/ConnectionManager";
import ExplorerDataProvider from "../explorer/ExplorerDataProvider";


/**
 * Register all composite index commands.
 */
export function registerIndexCommands(
  context: vscode.ExtensionContext,
  explorerDataProvider: ExplorerDataProvider
): void {
  // 1. Refresh Composite Indexes Branch
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.refreshIndexes",
      async (item?: CompositeIndexesBranchItem) => {
        if (item) {
          explorerDataProvider.refreshNode(item);
        } else {
          explorerDataProvider.refresh();
        }
      }
    )
  );

  // 2. Inspect Composite Index Definition (opens read-only JSON document)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.inspectIndexDefinition",
      async (item?: CompositeIndexItem) => {
        if (!item || !item.index) {
          return;
        }

        const jsonContent = JSON.stringify(item.index, null, 2);
        const doc = await vscode.workspace.openTextDocument({
          language: "json",
          content: jsonContent,
        });
        await vscode.window.showTextDocument(doc, { preview: true });
      }
    )
  );

  // 3. Delete Composite Index
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.deleteIndex",
      async (item?: CompositeIndexItem) => {
        if (!item || !item.index) {
          return;
        }

        const fieldsSummary = item.index.fields
          .map((f) => `${f.fieldPath} (${f.arrayConfig || f.order || "ASC"})`)
          .join(", ");

        const confirm = await vscode.window.showWarningMessage(
          `Are you sure you want to delete composite index for '${item.index.collectionGroup}' [${fieldsSummary}]? This action cannot be undone.`,
          { modal: true },
          "Delete Index"
        );

        if (confirm !== "Delete Index") {
          return;
        }

        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Deleting composite index for '${item.index.collectionGroup}'...`,
            cancellable: false,
          },
          async () => {
            try {
              const indexesService = IndexesService.getInstance();
              await indexesService.deleteIndex(item.connectionId, item.index.name);
              vscode.window.showInformationMessage(
                `Composite index for '${item.index.collectionGroup}' successfully deleted.`
              );
              explorerDataProvider.refreshNode(item);
            } catch (err: any) {
              vscode.window.showErrorMessage(
                `Failed to delete index: ${err.message}`
              );
            }
          }
        );
      }
    )
  );

  // 4. Pull / Snapshot Live Indexes into workspace firestore.indexes.json
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.snapshotLiveIndexes",
      async (item?: CompositeIndexesBranchItem) => {
        const indexesService = IndexesService.getInstance();
        const connectionId =
          item?.connectionId ||
          ConnectionManager.getInstance().getConnections()[0]?.id ||
          "default";


        const choice = await vscode.window.showQuickPick(
          [
            {
              label: "$(git-merge) Merge with existing workspace file",
              description: "Preserves local overrides & indexes, appends new live cloud indexes",
              mode: "merge" as const,
            },
            {
              label: "$(repo-sync) Overwrite workspace firestore.indexes.json",
              description: "Replaces local indexes with the exact deployed cloud index snapshot",
              mode: "overwrite" as const,
            },
          ],
          { placeHolder: "Select index snapshot import strategy" }
        );

        if (!choice) return;

        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "Snapshotting Cloud Firestore indexes...",
            cancellable: false,
          },
          async () => {
            try {
              const res = await indexesService.snapshotToLocalIndexesFile(connectionId, choice.mode);
              const action = await vscode.window.showInformationMessage(
                `Saved ${res.totalIndexes} composite indexes to ${vscode.workspace.asRelativePath(res.path)}`,
                "Open File"
              );
              if (action === "Open File") {
                const doc = await vscode.workspace.openTextDocument(res.path);
                await vscode.window.showTextDocument(doc);
              }
            } catch (err: any) {
              vscode.window.showErrorMessage(`Failed to snapshot indexes: ${err.message}`);
            }
          }
        );
      }
    )
  );

  // 5. Diff Live vs Local firestore.indexes.json
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.diffIndexes",
      async (item?: CompositeIndexesBranchItem) => {
        const indexesService = IndexesService.getInstance();
        const connectionId = item?.connectionId || "default";

        try {
          const liveIndexes = await indexesService.listCompositeIndexes(connectionId);
          const liveConfig = {
            indexes: liveIndexes.map((idx) => ({
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
            })),
          };

          const localFilePath = await indexesService.getWorkspaceIndexesFilePath();
          if (!localFilePath) {
            vscode.window.showWarningMessage("No workspace folder found to compare indexes.");
            return;
          }

          // Create virtual live doc
          const liveDoc = await vscode.workspace.openTextDocument({
            language: "json",
            content: JSON.stringify(liveConfig, null, 2),
          });

          let localUri: vscode.Uri;
          if (require("fs").existsSync(localFilePath)) {
            localUri = vscode.Uri.file(localFilePath);
          } else {
            // Open scratch if not exists
            const emptyDoc = await vscode.workspace.openTextDocument({
              language: "json",
              content: JSON.stringify({ indexes: [] }, null, 2),
            });
            localUri = emptyDoc.uri;
          }

          await vscode.commands.executeCommand(
            "vscode.diff",
            liveDoc.uri,
            localUri,
            `firestore.indexes.json (Live Cloud ⇄ Local Workspace)`
          );
        } catch (err: any) {
          vscode.window.showErrorMessage(`Failed to diff indexes: ${err.message}`);
        }
      }
    )
  );

  // 6. Deploy Local firestore.indexes.json to Cloud Firestore
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.deployIndexes",
      async (item?: CompositeIndexesBranchItem) => {
        const indexesService = IndexesService.getInstance();
        const connectionId = item?.connectionId || "default";

        const { path: localPath, data } = await indexesService.loadLocalIndexesFile();
        const count = data.indexes?.length || 0;
        if (count === 0) {
          vscode.window.showInformationMessage(
            `No composite indexes found in ${vscode.workspace.asRelativePath(localPath)} to deploy.`
          );
          return;
        }

        const confirm = await vscode.window.showWarningMessage(
          `Deploy ${count} composite index definition(s) from ${vscode.workspace.asRelativePath(localPath)} to Firestore? Indexes will build asynchronously in the cloud.`,
          { modal: true },
          "Deploy Indexes"
        );

        if (confirm !== "Deploy Indexes") return;

        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Deploying composite indexes from ${vscode.workspace.asRelativePath(localPath)}...`,
            cancellable: false,
          },
          async () => {
            try {
              const res = await indexesService.deployLocalIndexes(connectionId);
              vscode.window.showInformationMessage(
                `Index deployment complete: ${res.created} created, ${res.skipped} already active, ${res.failed} failed.`
              );
              if (item) {
                explorerDataProvider.refreshNode(item);
              } else {
                explorerDataProvider.refresh();
              }
            } catch (err: any) {
              vscode.window.showErrorMessage(`Index deployment failed: ${err.message}`);
            }
          }
        );
      }
    )
  );

  // 7. Interactive Visual Composite Index Builder
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.buildCompositeIndex",
      async (item?: any) => {
        const indexesService = IndexesService.getInstance();
        const connectionId = item?.connectionId || "default";
        const defaultCollection = item?.collectionId || item?.collectionGroup || "";

        // Step 1: Collection Group / Collection ID
        const collectionGroup = await vscode.window.showInputBox({
          title: "Create Composite Index (1/4): Collection Group",
          prompt: "Enter the collection or collection group name",
          value: defaultCollection,
          placeHolder: "e.g. orders, users, posts",
          validateInput: (v) => (!v.trim() ? "Collection group cannot be empty" : null),
        });
        if (!collectionGroup) return;

        // Step 2: Query Scope
        const scopeChoice = await vscode.window.showQuickPick(
          [
            {
              label: "$(folder) COLLECTION",
              description: "Applies to collections with this ID directly (most common)",
              value: "COLLECTION" as const,
            },
            {
              label: "$(layers) COLLECTION_GROUP",
              description: "Applies across all subcollections sharing this name database-wide",
              value: "COLLECTION_GROUP" as const,
            },
          ],
          { title: "Create Composite Index (2/4): Query Scope" }
        );
        if (!scopeChoice) return;

        // Step 3: Fields definition loop
        const fields: import("../indexes/indexesService").FirestoreIndexField[] = [];
        let addingFields = true;

        while (addingFields) {
          const fieldIndex = fields.length + 1;
          const fieldPath = await vscode.window.showInputBox({
            title: `Create Composite Index (3/4): Field #${fieldIndex}`,
            prompt: `Enter field path for index field #${fieldIndex} (or leave blank to finish)`,
            placeHolder: fields.length === 0 ? "e.g. status, createdAt, user.email" : "Leave blank if finished",
          });

          if (!fieldPath || !fieldPath.trim()) {
            if (fields.length < 2) {
              vscode.window.showWarningMessage("A composite index requires at least 2 fields.");
              continue;
            }
            break;
          }

          const modeChoice = await vscode.window.showQuickPick(
            [
              { label: "$(arrow-up) ASCENDING", value: "ASCENDING" as const },
              { label: "$(arrow-down) DESCENDING", value: "DESCENDING" as const },
              { label: "$(list-unordered) ARRAY_CONTAINS", value: "CONTAINS" as const },
            ],
            { title: `Indexing Mode for field '${fieldPath.trim()}'` }
          );

          if (!modeChoice) return;

          if (modeChoice.value === "CONTAINS") {
            fields.push({
              fieldPath: fieldPath.trim(),
              arrayConfig: "CONTAINS",
            });
          } else {
            fields.push({
              fieldPath: fieldPath.trim(),
              order: modeChoice.value,
            });
          }

          if (fields.length >= 2) {
            const nextAction = await vscode.window.showQuickPick(
              [
                { label: "$(plus) Add another field", value: "add" },
                { label: "$(check) Done - Finish and save index", value: "done" },
              ],
              { title: `Current fields: ${fields.map((f) => f.fieldPath).join(", ")}` }
            );
            if (nextAction?.value === "done") {
              break;
            }
          }
        }

        // Step 4: Destination choice (Deploy directly via API, append to file, or both)
        const destChoice = await vscode.window.showQuickPick(
          [
            {
              label: "$(cloud-upload) Deploy to Cloud & Save to firestore.indexes.json",
              value: "both",
              description: "Triggers asynchronous build on Firestore and updates workspace file",
            },
            {
              label: "$(cloud) Deploy directly to Cloud Firestore API",
              value: "cloud",
              description: "Triggers build immediately via Google Cloud REST API",
            },
            {
              label: "$(file-code) Append to workspace firestore.indexes.json only",
              value: "file",
              description: "Safely stages the index in your repository for Git versioning",
            },
          ],
          { title: "Create Composite Index (4/4): Save Destination" }
        );

        if (!destChoice) return;

        if (destChoice.value === "file" || destChoice.value === "both") {
          try {
            const filePath = await indexesService.appendIndexToWorkspaceFile(
              collectionGroup.trim(),
              scopeChoice.value,
              fields
            );
            vscode.window.showInformationMessage(
              `Index appended to ${vscode.workspace.asRelativePath(filePath)}`
            );
          } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to write to indexes file: ${err.message}`);
          }
        }

        if (destChoice.value === "cloud" || destChoice.value === "both") {
          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: `Creating composite index for '${collectionGroup}' in Firestore...`,
              cancellable: false,
            },
            async () => {
              try {
                await indexesService.createCompositeIndex(
                  connectionId,
                  collectionGroup.trim(),
                  scopeChoice.value,
                  fields
                );
                vscode.window.showInformationMessage(
                  `Composite index build requested for '${collectionGroup}'. State: BUILDING.`
                );
                if (item) {
                  explorerDataProvider.refreshNode(item);
                } else {
                  explorerDataProvider.refresh();
                }
              } catch (err: any) {
                vscode.window.showErrorMessage(`Failed to create index via API: ${err.message}`);
              }
            }
          );
        }
      }
    )
  );
}


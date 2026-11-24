import * as vscode from "vscode";
import * as fs from "fs";
import {
  CollectionItem,
  CompositeIndexItem,
  CompositeIndexesBranchItem,
  DocumentFieldItem,
} from "../explorer/items";
import {
  FirestoreIndexField,
  FirestoreIndexQueryScope,
  IndexesService,
} from "../indexes/indexesService";
import { ConnectionManager } from "../connections/ConnectionManager";
import ExplorerDataProvider from "../explorer/ExplorerDataProvider";
import { confirmProductionAction, getEnvironmentWarningPrefix } from "../utils/deleteUtils";
import { openIndexesAsTable } from "../webview/openIndexesAsTable";

export interface MissingIndexContext {
  connectionId: string;
  collectionGroup: string;
  isGroup?: boolean;
  queryClauses?: Array<{ field: string; op: string }>;
  vectorField?: string;
  vectorDimension?: number;
}

/**
 * Resolve a connection ID from a tree item/context, or prompt the user when multiple connections exist.
 */
async function resolveIndexConnectionId(item?: any, actionLabel = "index operation"): Promise<string | undefined> {
  if (item && typeof item === "object" && "connectionId" in item && item.connectionId) {
    return item.connectionId;
  }
  const connections = ConnectionManager.getInstance().getConnections();
  if (connections.length === 0) {
    vscode.window.showWarningMessage("No Firestore connections configured.");
    return undefined;
  }
  if (connections.length === 1) {
    return connections[0].id;
  }
  const picked = await vscode.window.showQuickPick(
    connections.map((c) => ({
      label: c.name,
      description: c.projectId || (c.isEmulator ? c.emulatorHost : c.localJsonPath) || c.id,
      connectionId: c.id,
    })),
    { title: `Select Firestore Connection (${actionLabel})`, placeHolder: "Choose target connection" }
  );
  return picked?.connectionId;
}

/**
 * Decode Firestore's `create_composite=<base64>` protobuf URL parameter into exact index fields & scope.
 */
function decodeCreateCompositeUrl(
  indexUrl: string
): { queryScope?: FirestoreIndexQueryScope; fields: FirestoreIndexField[] } | null {
  try {
    const parsed = new URL(indexUrl);
    const token = parsed.searchParams.get("create_composite");
    if (!token) return null;

    const b64 = token.replace(/-/g, "+").replace(/_/g, "/");
    const buf = Buffer.from(b64, "base64");

    const readVarint = (b: Buffer, offset: number): { val: number; next: number } => {
      let val = 0;
      let shift = 0;
      let pos = offset;
      while (pos < b.length) {
        const byte = b[pos++];
        val |= (byte & 0x7f) << shift;
        if ((byte & 0x80) === 0) break;
        shift += 7;
      }
      return { val, next: pos };
    };

    const parseFieldMsg = (b: Buffer): FirestoreIndexField | null => {
      let pos = 0;
      const field: FirestoreIndexField = { fieldPath: "" };
      while (pos < b.length) {
        const tagRes = readVarint(b, pos);
        pos = tagRes.next;
        const fieldNum = tagRes.val >>> 3;
        const wireType = tagRes.val & 0x7;

        if (wireType === 2) {
          const lenRes = readVarint(b, pos);
          pos = lenRes.next;
          const slice = b.subarray(pos, pos + lenRes.val);
          pos += lenRes.val;
          if (fieldNum === 1) {
            field.fieldPath = slice.toString("utf8");
          } else if (fieldNum === 4) {
            // vectorConfig submessage: field 1 = dimension (varint)
            let vPos = 0;
            while (vPos < slice.length) {
              const vt = readVarint(slice, vPos);
              vPos = vt.next;
              if ((vt.val >>> 3) === 1 && (vt.val & 0x7) === 0) {
                const dimRes = readVarint(slice, vPos);
                vPos = dimRes.next;
                field.vectorConfig = { dimension: dimRes.val, flat: {} };
              } else if ((vt.val & 0x7) === 2) {
                const vl = readVarint(slice, vPos);
                vPos = vl.next + vl.val;
              } else {
                break;
              }
            }
          }
        } else if (wireType === 0) {
          const valRes = readVarint(b, pos);
          pos = valRes.next;
          if (fieldNum === 2) {
            field.order = valRes.val === 2 ? "DESCENDING" : "ASCENDING";
          } else if (fieldNum === 3 && valRes.val === 1) {
            field.arrayConfig = "CONTAINS";
          }
        } else {
          break;
        }
      }
      return field.fieldPath ? field : null;
    };

    let pos = 0;
    let queryScope: FirestoreIndexQueryScope | undefined;
    const fields: FirestoreIndexField[] = [];

    while (pos < buf.length) {
      const tagRes = readVarint(buf, pos);
      pos = tagRes.next;
      const fieldNum = tagRes.val >>> 3;
      const wireType = tagRes.val & 0x7;

      if (wireType === 2) {
        const lenRes = readVarint(buf, pos);
        pos = lenRes.next;
        const slice = buf.subarray(pos, pos + lenRes.val);
        pos += lenRes.val;
        if (fieldNum === 3) {
          const parsedField = parseFieldMsg(slice);
          if (parsedField) fields.push(parsedField);
        }
      } else if (wireType === 0) {
        const valRes = readVarint(buf, pos);
        pos = valRes.next;
        if (fieldNum === 2) {
          queryScope =
            valRes.val === 2
              ? "COLLECTION_GROUP"
              : valRes.val === 3
                ? "COLLECTION_RECURSIVE"
                : "COLLECTION";
        }
      } else {
        break;
      }
    }

    return fields.length > 0 ? { queryScope, fields } : null;
  } catch {
    return null;
  }
}

/**
 * Sample collection names from the live Firestore connection for QuickPick autocomplete.
 */
async function pickCollectionGroup(
  connectionId: string,
  title: string,
  defaultVal = ""
): Promise<string | undefined> {
  if (defaultVal.trim()) {
    return defaultVal.trim();
  }
  try {
    const conn = ConnectionManager.getInstance().getConnection(connectionId);
    if (conn && !conn.isLocalJson) {
      const fsClient = await ConnectionManager.getInstance().getFirestore(connectionId);
      const cols = await fsClient.listCollections();
      if (cols.length > 0) {
        const items: Array<vscode.QuickPickItem & { value?: string }> = cols.map((c) => ({
          label: `$(folder) ${c.id}`,
          description: "Root collection",
          value: c.id,
        }));
        items.push({
          label: "$(edit) Custom collection group...",
          description: "Type a subcollection or custom collection group ID",
          value: "__custom__",
        });
        const picked = await vscode.window.showQuickPick(items, {
          title,
          placeHolder: "Select a collection or enter a custom collection group name",
        });
        if (!picked) return undefined;
        if (picked.value !== "__custom__") return picked.value;
      }
    }
  } catch {
    // Fall back to InputBox
  }

  const entered = await vscode.window.showInputBox({
    title,
    prompt: "Enter the collection or collection group name",
    value: defaultVal,
    placeHolder: "e.g. orders, users, posts",
    validateInput: (v) => (!v.trim() ? "Collection group cannot be empty" : null),
  });
  return entered?.trim();
}

/**
 * Sample up to 5 documents from a collection to suggest field paths via QuickPick.
 */
async function pickFieldPath(
  connectionId: string,
  collectionGroup: string,
  title: string,
  allowBlankToFinish = false,
  placeholder = "e.g. status, createdAt, embedding"
): Promise<string | undefined> {
  try {
    const conn = ConnectionManager.getInstance().getConnection(connectionId);
    if (conn && !conn.isLocalJson) {
      const fsClient = await ConnectionManager.getInstance().getFirestore(connectionId);
      let snap = await fsClient.collection(collectionGroup).limit(5).get();
      if (snap.empty) {
        snap = await fsClient.collectionGroup(collectionGroup).limit(5).get();
      }
      const fieldSet = new Set<string>();
      const collectKeys = (obj: any, prefix: string, depth: number) => {
        if (!obj || typeof obj !== "object" || depth > 2) return;
        for (const k of Object.keys(obj)) {
          const full = prefix ? `${prefix}.${k}` : k;
          fieldSet.add(full);
          const v = obj[k];
          if (
            v &&
            typeof v === "object" &&
            !Array.isArray(v) &&
            !(v instanceof Date) &&
            typeof v.toMillis !== "function" &&
            typeof v.latitude !== "number" &&
            !Array.isArray(v._values) &&
            typeof v.path !== "string"
          ) {
            collectKeys(v, full, depth + 1);
          }
        }
      };
      for (const doc of snap.docs) {
        collectKeys(doc.data() || {}, "", 0);
      }
      if (fieldSet.size > 0) {
        const items: Array<vscode.QuickPickItem & { value: string }> = [];
        if (allowBlankToFinish) {
          items.push({
            label: "$(check) Done adding fields",
            description: "Finish field selection",
            value: "__done__",
          });
        }
        items.push({
          label: "$(edit) Custom field path...",
          description: "Enter a nested dot-notation field path (e.g. user.email)",
          value: "__custom__",
        });
        for (const f of Array.from(fieldSet).sort()) {
          items.push({
            label: `$(symbol-field) ${f}`,
            description: "Sampled field",
            value: f,
          });
        }
        const picked = await vscode.window.showQuickPick(items, {
          title,
          placeHolder: "Select a sampled field or enter a custom field path",
        });
        if (!picked) return allowBlankToFinish ? "" : undefined;
        if (picked.value === "__done__") return "";
        if (picked.value !== "__custom__") return picked.value;
      }
    }
  } catch {
    // Fall back to InputBox
  }

  const entered = await vscode.window.showInputBox({
    title,
    prompt: allowBlankToFinish
      ? "Enter field path (or leave blank to finish)"
      : "Enter field path (dot notation supported)",
    placeHolder: placeholder,
  });
  return entered === undefined ? (allowBlankToFinish ? "" : undefined) : entered.trim();
}

/**
 * Derive suggested Firestore index fields from query clauses or vector search parameters.
 */
function buildSuggestedIndexFields(context: MissingIndexContext): FirestoreIndexField[] {
  const fields: FirestoreIndexField[] = [];
  const seen = new Set<string>();

  if (Array.isArray(context.queryClauses)) {
    for (const clause of context.queryClauses) {
      const fieldPath = (clause.field || "").trim();
      if (!fieldPath || seen.has(fieldPath)) {
        continue;
      }
      seen.add(fieldPath);
      if (clause.op === "array-contains" || clause.op === "array-contains-any") {
        fields.push({ fieldPath, arrayConfig: "CONTAINS" });
      } else {
        fields.push({ fieldPath, order: "ASCENDING" });
      }
    }
  }

  if (context.vectorField && context.vectorDimension && context.vectorDimension > 0) {
    const vecField = context.vectorField.trim();
    if (vecField && !seen.has(vecField)) {
      fields.push({
        fieldPath: vecField,
        vectorConfig: { dimension: context.vectorDimension, flat: {} },
      });
    }
  }

  return fields;
}

/**
 * Detect Firestore missing-index errors (FAILED_PRECONDITION / index URL / vector index missing)
 * and present actionable 1-click index creation options to the user.
 * Returns true if the error was handled as a missing-index error.
 */
export function handleMissingIndexError(err: any, context: MissingIndexContext): boolean {
  const msg = err?.message || String(err || "");
  const urlMatch = msg.match(/https:\/\/console\.firebase\.google\.com\S+/);
  const lowerMsg = msg.toLowerCase();
  const isMissingIndex =
    Boolean(urlMatch) ||
    err?.code === 9 ||
    msg.includes("FAILED_PRECONDITION") ||
    lowerMsg.includes("requires an index") ||
    lowerMsg.includes("missing vector index") ||
    (lowerMsg.includes("vector") && lowerMsg.includes("index"));

  if (!isMissingIndex) {
    return false;
  }

  const indexUrl = urlMatch ? urlMatch[0] : undefined;
  const decodedFromUrl = indexUrl ? decodeCreateCompositeUrl(indexUrl) : null;
  const suggestedFields =
    decodedFromUrl && decodedFromUrl.fields.length > 0
      ? decodedFromUrl.fields
      : buildSuggestedIndexFields(context);
  const suggestedScope: FirestoreIndexQueryScope =
    decodedFromUrl?.queryScope || (context.isGroup ? "COLLECTION_GROUP" : "COLLECTION");
  const hasVectorField = suggestedFields.some((f) => Boolean(f.vectorConfig));
  const isSingleFieldGroupMissing =
    suggestedScope === "COLLECTION_GROUP" &&
    !hasVectorField &&
    suggestedFields.length === 1 &&
    (lowerMsg.includes("collection_group") || (indexUrl?.includes("single-field") ?? false));
  const hasPreseededIndex = hasVectorField
    ? suggestedFields.length >= 1
    : suggestedFields.length >= 2;

  const actions: string[] = [];
  if (isSingleFieldGroupMissing) {
    actions.push("Enable Collection Group Index");
  } else {
    actions.push(hasPreseededIndex ? "Create Index Now" : "Build / Add to firestore.indexes.json");
  }
  if (indexUrl) {
    actions.push("Create Index in Firebase Console", "Copy Index URL");
  }

  const promptMsg = context.vectorField
    ? `Vector search on '${context.collectionGroup}.${context.vectorField}' requires a vector index.`
    : isSingleFieldGroupMissing
      ? `Collection Group query on '${context.collectionGroup}.${suggestedFields[0].fieldPath}' requires a single-field COLLECTION_GROUP index override.`
      : `Query on '${context.collectionGroup}' requires a composite index.`;

  void vscode.window.showErrorMessage(promptMsg, ...actions).then(async (action) => {
    if (action === "Enable Collection Group Index") {
      await vscode.commands.executeCommand("ketrik-firestore-studio.manageFieldOverride", {
        connectionId: context.connectionId,
        collectionGroup: context.collectionGroup,
        fieldPath: suggestedFields[0]?.fieldPath,
        mode: "collectionGroup",
      });
    } else if (action === "Create Index Now" || action === "Build / Add to firestore.indexes.json") {
      await vscode.commands.executeCommand("ketrik-firestore-studio.buildCompositeIndex", {
        connectionId: context.connectionId,
        collectionGroup: context.collectionGroup,
        collectionId: context.collectionGroup,
        queryScope: suggestedScope,
        fields: hasPreseededIndex ? suggestedFields : undefined,
      });
    } else if (action === "Create Index in Firebase Console" && indexUrl) {
      await vscode.env.openExternal(vscode.Uri.parse(indexUrl));
    } else if (action === "Copy Index URL" && indexUrl) {
      await vscode.env.clipboard.writeText(indexUrl);
      vscode.window.showInformationMessage("Index URL copied to clipboard!");
    }
  });

  return true;
}

function formatFieldsSummary(fields: FirestoreIndexField[]): string {
  return fields
    .map((f) => {
      if (f.vectorConfig) {
        return `${f.fieldPath} (VECTOR:${f.vectorConfig.dimension})`;
      }
      if (f.arrayConfig === "CONTAINS") {
        return `${f.fieldPath} (CONTAINS)`;
      }
      return `${f.fieldPath} (${f.order || "ASCENDING"})`;
    })
    .join(", ");
}


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
          await explorerDataProvider.refreshNodeWithFeedback(item);
        } else {
          await explorerDataProvider.refreshWithFeedback();
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

  // 3. Delete Composite Index (single or multi-select)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.deleteIndex",
      async (item?: CompositeIndexItem, selectedItems?: unknown[]) => {
        const targets: CompositeIndexItem[] =
          Array.isArray(selectedItems) && selectedItems.length > 0
            ? selectedItems.filter(
                (s): s is CompositeIndexItem => s instanceof CompositeIndexItem && Boolean(s.index)
              )
            : item && item.index
              ? [item]
              : [];

        if (targets.length === 0) {
          return;
        }

        const connectionId = targets[0].connectionId;
        if (!ConnectionManager.getInstance().ensureWritable(connectionId, "delete composite index")) {
          return;
        }

        const envPrefix = getEnvironmentWarningPrefix(connectionId);
        const promptMessage =
          targets.length === 1
            ? `${envPrefix}Are you sure you want to delete composite index for '${targets[0].index.collectionGroup}' [${formatFieldsSummary(targets[0].index.fields)}]? This action cannot be undone.`
            : `${envPrefix}Are you sure you want to permanently delete ${targets.length} selected composite indexes? This action cannot be undone.`;

        const confirmLabel = targets.length === 1 ? "Delete Index" : `Delete ${targets.length} Indexes`;
        const confirm = await vscode.window.showWarningMessage(
          promptMessage,
          { modal: true },
          confirmLabel
        );

        if (confirm !== confirmLabel) {
          return;
        }

        const confirmedProd = await confirmProductionAction({
          connectionId,
          actionLabel: targets.length === 1 ? "Delete Composite Index" : "Bulk Delete Composite Indexes",
          targetSummary:
            targets.length === 1
              ? `composite index on '${targets[0].index.collectionGroup}'`
              : `${targets.length} composite indexes`,
          expectedInput:
            targets.length === 1 ? targets[0].index.collectionGroup : `DELETE ${targets.length}`,
        });
        if (!confirmedProd) {
          return;
        }

        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title:
              targets.length === 1
                ? `Deleting composite index for '${targets[0].index.collectionGroup}'...`
                : `Deleting ${targets.length} composite indexes...`,
            cancellable: false,
          },
          async () => {
            const indexesService = IndexesService.getInstance();
            let deleted = 0;
            const errors: string[] = [];

            for (const target of targets) {
              try {
                await indexesService.deleteIndex(target.connectionId, target.index.name);
                deleted++;
              } catch (err: any) {
                errors.push(`${target.index.collectionGroup}: ${err?.message || err}`);
              }
            }

            if (errors.length > 0) {
              vscode.window.showWarningMessage(
                `Deleted ${deleted} index(es); ${errors.length} failed (first: ${errors[0]}).`
              );
            } else if (targets.length === 1) {
              vscode.window.showInformationMessage(
                `Composite index for '${targets[0].index.collectionGroup}' successfully deleted.`
              );
            } else {
              vscode.window.showInformationMessage(
                `Successfully deleted ${deleted} composite indexes.`
              );
            }
            explorerDataProvider.refreshNode(targets[0]);
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
        const connectionId = await resolveIndexConnectionId(item, "Snapshot Live Indexes");
        if (!connectionId) return;


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
      async (item?: CompositeIndexesBranchItem | vscode.Uri) => {
        const indexesService = IndexesService.getInstance();
        const connectionId = await resolveIndexConnectionId(item, "Diff Indexes");
        if (!connectionId) return;

        try {
          const [liveIndexes, liveOverrides] = await Promise.all([
            indexesService.listCompositeIndexes(connectionId),
            indexesService.listFieldOverrides(connectionId).catch(() => null),
          ]);
          const { path: localFilePath, data: localData } =
            await indexesService.loadLocalIndexesFile(connectionId).catch(async () => {
              const fallbackPath = await indexesService.getWorkspaceIndexesFilePath(connectionId);
              return { path: fallbackPath || "", data: { indexes: [], fieldOverrides: [] } };
            });

          if (!localFilePath) {
            vscode.window.showWarningMessage("No workspace folder found to compare indexes.");
            return;
          }

          const liveConfig = {
            indexes: indexesService.sortIndexesCanonically(
              liveIndexes.map((idx) => indexesService.formatIndexForConfig(idx))
            ),
            fieldOverrides:
              liveOverrides !== null
                ? liveOverrides.map((ov) => indexesService.formatFieldOverrideForConfig(ov))
                : localData.fieldOverrides || [],
          };

          // Create virtual live doc
          const liveDoc = await vscode.workspace.openTextDocument({
            language: "json",
            content: JSON.stringify(liveConfig, null, 2) + "\n",
          });

          let localUri: vscode.Uri;
          if (fs.existsSync(localFilePath)) {
            localUri = vscode.Uri.file(localFilePath);
          } else {
            // Open scratch if not exists
            const emptyDoc = await vscode.workspace.openTextDocument({
              language: "json",
              content: JSON.stringify({ indexes: [], fieldOverrides: [] }, null, 2) + "\n",
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
      async (item?: CompositeIndexesBranchItem | vscode.Uri) => {
        const indexesService = IndexesService.getInstance();
        const connectionId = await resolveIndexConnectionId(item, "Deploy Indexes");
        if (!connectionId) return;
        if (!ConnectionManager.getInstance().ensureWritable(connectionId, "deploy composite indexes")) {
          return;
        }

        const { path: localPath, data } = await indexesService.loadLocalIndexesFile(connectionId);
        const localIndexes = data.indexes || [];
        const localOverrides = Array.isArray(data.fieldOverrides) ? data.fieldOverrides : [];
        const liveIndexes = await indexesService.listCompositeIndexes(connectionId);
        const localKeySet = new Set(localIndexes.map((idx) => indexesService.getIndexKey(idx)));
        const liveKeySet = new Set(liveIndexes.map((idx) => indexesService.getIndexKey(idx)));

        const toCreateCount = localIndexes.filter(
          (idx) => !liveKeySet.has(indexesService.getIndexKey(idx))
        ).length;
        const orphanCount = liveIndexes.filter(
          (idx) => !localKeySet.has(indexesService.getIndexKey(idx))
        ).length;

        if (localIndexes.length === 0 && orphanCount === 0 && localOverrides.length === 0) {
          vscode.window.showInformationMessage(
            `No composite indexes or field overrides found in ${vscode.workspace.asRelativePath(localPath)} to deploy.`
          );
          return;
        }

        const envPrefix = getEnvironmentWarningPrefix(connectionId);
        const relPath = vscode.workspace.asRelativePath(localPath);
        const overridePart = localOverrides.length > 0 ? `, ${localOverrides.length} field override(s)` : "";
        let pruneOrphans = false;

        if (orphanCount > 0) {
          const pruneLabel = `Deploy & Prune ${orphanCount} Orphan(s)`;
          const deployOnlyLabel = "Deploy Only";
          const confirm = await vscode.window.showWarningMessage(
            `${envPrefix}${relPath}: ${toCreateCount} index(es) to create, ${localIndexes.length - toCreateCount} already active${overridePart}, and ${orphanCount} cloud index(es) not in local file.`,
            { modal: true },
            ...(toCreateCount > 0 || localOverrides.length > 0 ? [deployOnlyLabel, pruneLabel] : [pruneLabel])
          );
          if (!confirm) return;
          pruneOrphans = confirm === pruneLabel;
        } else {
          const confirm = await vscode.window.showWarningMessage(
            `${envPrefix}Deploy ${localIndexes.length} composite index definition(s)${overridePart} from ${relPath} to Firestore (${toCreateCount} new index(es))? Indexes will build asynchronously in the cloud.`,
            { modal: true },
            "Deploy Indexes"
          );
          if (confirm !== "Deploy Indexes") return;
        }

        const confirmedProd = await confirmProductionAction({
          connectionId,
          actionLabel: pruneOrphans ? "Deploy & Prune Composite Indexes" : "Deploy Composite Indexes",
          targetSummary: `${toCreateCount} new index(es)${pruneOrphans ? `, prune ${orphanCount} orphan(s)` : ""} from ${relPath}`,
          expectedInput: pruneOrphans ? `PRUNE ${orphanCount}` : "DEPLOY",
        });
        if (!confirmedProd) return;

        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Deploying composite indexes from ${relPath}...`,
            cancellable: false,
          },
          async () => {
            try {
              const res = await indexesService.deployLocalIndexes(connectionId, { pruneOrphans });
              const prunePart = pruneOrphans ? `, ${res.deleted} pruned` : "";
              if (res.failed > 0) {
                const firstErr = res.errors[0];
                const detailMsg = firstErr ? ` First error (${firstErr.collectionGroup}): ${firstErr.error}` : "";
                vscode.window.showWarningMessage(
                  `Index deployment finished with errors: ${res.created} created, ${res.skipped} already active${prunePart}, ${res.failed} failed.${detailMsg}`
                );
              } else {
                vscode.window.showInformationMessage(
                  `Index deployment complete: ${res.created} created, ${res.skipped} already active${prunePart}.`
                );
              }
              if (item && !(item instanceof vscode.Uri)) {
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
        const connectionId = await resolveIndexConnectionId(item, "Create Composite Index");
        if (!connectionId) return;
        if (!ConnectionManager.getInstance().ensureWritable(connectionId, "create composite index")) {
          return;
        }

        let preseededFields: FirestoreIndexField[] | undefined =
          Array.isArray(item?.fields) && item.fields.length > 0 ? item.fields : undefined;
        const preseededScope: FirestoreIndexQueryScope | undefined = item?.queryScope;

        let collectionGroup = (item?.collectionId || item?.collectionGroup || "").trim();
        if (item instanceof DocumentFieldItem) {
          collectionGroup = item.parentDocRef?.parent?.id || collectionGroup;
          const vecDims =
            item.value?.values?.length ||
            item.value?._values?.length ||
            (typeof item.value?.toArray === "function" ? item.value.toArray().length : 0);
          if (vecDims > 0) {
            preseededFields = [
              {
                fieldPath: item.fullFieldPath,
                vectorConfig: { dimension: vecDims, flat: {} },
              },
            ];
          }
        }

        let queryScope: FirestoreIndexQueryScope = preseededScope || "COLLECTION";
        let fields: FirestoreIndexField[] = preseededFields ? [...preseededFields] : [];

        if (!preseededFields) {
          // Step 1: Collection Group / Collection ID (with autocomplete if not invoked from IndexCollectionGroupItem)
          if (!collectionGroup) {
            const pickedGroup = await pickCollectionGroup(
              connectionId,
              "Create Composite Index (1/4): Collection Group",
              collectionGroup
            );
            if (!pickedGroup) return;
            collectionGroup = pickedGroup;
          }

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
              {
                label: "$(list-tree) COLLECTION_RECURSIVE",
                description: "Applies recursively across a collection and its subcollections",
                value: "COLLECTION_RECURSIVE" as const,
              },
            ],
            { title: "Create Composite Index (2/4): Query Scope" }
          );
          if (!scopeChoice) return;
          queryScope = scopeChoice.value;

          // Step 3: Fields definition loop (with sampled field QuickPick)
          while (true) {
            const fieldIndex = fields.length + 1;
            const hasVector = fields.some((f) => Boolean(f.vectorConfig));
            const minFields = hasVector ? 1 : 2;

            const fieldPath = await pickFieldPath(
              connectionId,
              collectionGroup,
              `Create Composite Index (3/4): Field #${fieldIndex}`,
              fields.length >= minFields,
              fields.length === 0 ? "e.g. status, createdAt, embedding" : "Leave blank if finished"
            );

            if (fieldPath === undefined) return;
            if (!fieldPath) {
              if (fields.length < minFields) {
                vscode.window.showWarningMessage(
                  hasVector
                    ? "A vector index requires at least 1 field."
                    : "A composite index requires at least 2 fields (or 1 vector field)."
                );
                continue;
              }
              break;
            }

            const modeChoice = await vscode.window.showQuickPick(
              [
                { label: "$(arrow-up) ASCENDING", value: "ASCENDING" as const },
                { label: "$(arrow-down) DESCENDING", value: "DESCENDING" as const },
                { label: "$(list-unordered) ARRAY_CONTAINS", value: "CONTAINS" as const },
                { label: "$(zap) VECTOR (kNN Similarity)", value: "VECTOR" as const },
              ],
              { title: `Indexing Mode for field '${fieldPath.trim()}'` }
            );

            if (!modeChoice) return;

            if (modeChoice.value === "VECTOR") {
              const dimInput = await vscode.window.showInputBox({
                title: `Vector Dimension for '${fieldPath.trim()}'`,
                prompt: "Enter embedding vector dimension (e.g. 768, 1536, max 2048)",
                value: "768",
                validateInput: (v) => {
                  const n = Number(v);
                  if (!Number.isInteger(n) || n < 1 || n > 2048) {
                    return "Dimension must be an integer between 1 and 2048";
                  }
                  return null;
                },
              });
              if (!dimInput) return;
              fields.push({
                fieldPath: fieldPath.trim(),
                vectorConfig: {
                  dimension: Number(dimInput),
                  flat: {},
                },
              });
            } else if (modeChoice.value === "CONTAINS") {
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

            const updatedHasVector = fields.some((f) => Boolean(f.vectorConfig));
            const updatedMinFields = updatedHasVector ? 1 : 2;
            if (fields.length >= updatedMinFields) {
              const nextAction = await vscode.window.showQuickPick(
                [
                  { label: "$(plus) Add another field", value: "add" },
                  { label: "$(check) Done - Finish and save index", value: "done" },
                ],
                { title: `Current fields: ${formatFieldsSummary(fields)}` }
              );
              if (nextAction?.value === "done") {
                break;
              }
            }
          }
        }

        const stepTitlePrefix = preseededFields
          ? `Create Index: ${collectionGroup} [${formatFieldsSummary(fields)}]`
          : "Create Composite Index (4/4): Save Destination";

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
          { title: stepTitlePrefix }
        );

        if (!destChoice) return;

        if (destChoice.value === "file" || destChoice.value === "both") {
          try {
            const filePath = await indexesService.appendIndexToWorkspaceFile(
              collectionGroup,
              queryScope,
              fields,
              connectionId
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
              title: `Creating index for '${collectionGroup}' in Firestore...`,
              cancellable: false,
            },
            async () => {
              try {
                await indexesService.createCompositeIndex(
                  connectionId,
                  collectionGroup,
                  queryScope,
                  fields
                );
                vscode.window.showInformationMessage(
                  `Index build requested for '${collectionGroup}'. State: CREATING.`
                );
                if (item instanceof CompositeIndexesBranchItem || item instanceof CompositeIndexItem) {
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

  // 8. Open Composite Indexes & TTL Policies as Table
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.openIndexesAsTable",
      async (item?: CompositeIndexesBranchItem | CollectionItem | { connectionId?: string; collectionId?: string; collectionGroup?: string }) => {
        const connectionId = await resolveIndexConnectionId(item, "Open Indexes & TTL Table");
        if (!connectionId) return;
        const initialCollectionGroup =
          item instanceof CollectionItem
            ? item.collectionId
            : (item as any)?.collectionGroup || (item as any)?.collectionId;
        await openIndexesAsTable(connectionId, explorerDataProvider, initialCollectionGroup);
      }
    )
  );

  // 9. Enable or Disable Time-to-Live (TTL) Policy on a Field
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.manageTtlPolicy",
      async (item?: DocumentFieldItem | {
        connectionId?: string;
        collectionGroup?: string;
        fieldPath?: string;
        enable?: boolean;
      }) => {
        const connectionId = await resolveIndexConnectionId(item, "Configure TTL Policy");
        if (!connectionId) return;
        if (!ConnectionManager.getInstance().ensureWritable(connectionId, "manage TTL policy")) {
          return;
        }

        const isFieldItem = item instanceof DocumentFieldItem;
        let collectionGroup = isFieldItem
          ? (item.parentDocRef?.parent?.id || "")
          : (item?.collectionGroup?.trim() || "");
        if (!collectionGroup) {
          const picked = await pickCollectionGroup(
            connectionId,
            "Configure Firestore TTL Policy (1/3): Collection Group"
          );
          if (!picked) return;
          collectionGroup = picked;
        }

        let fieldPath = isFieldItem
          ? item.fullFieldPath
          : (item?.fieldPath?.trim() || "");
        if (!fieldPath) {
          const pickedField = await pickFieldPath(
            connectionId,
            collectionGroup,
            "Configure Firestore TTL Policy (2/3): Timestamp Field Path",
            false,
            "e.g. expireAt, ttl, meta.expiresAt"
          );
          if (!pickedField) return;
          fieldPath = pickedField;
        }

        let enable = isFieldItem ? undefined : item?.enable;
        if (enable === undefined) {
          const actionPick = await vscode.window.showQuickPick(
            [
              {
                label: "$(clock) Enable TTL Policy",
                description: "Firestore will automatically delete documents after this timestamp passes",
                value: true,
              },
              {
                label: "$(circle-slash) Disable TTL Policy",
                description: "Stop automatic TTL expiration for this field",
                value: false,
              },
            ],
            { title: `Configure TTL Policy (3/3): ${collectionGroup}.${fieldPath}` }
          );
          if (!actionPick) return;
          enable = actionPick.value;
        }

        const hasWorkspace = Boolean(vscode.workspace.workspaceFolders?.length);
        let destValue: "both" | "cloud" | "file" = "cloud";
        if (hasWorkspace) {
          const destChoice = await vscode.window.showQuickPick(
            [
              {
                label: "$(cloud-upload) Update Cloud & Save to firestore.indexes.json",
                value: "both" as const,
                description: "Applies TTL policy on Firestore and updates workspace file",
              },
              {
                label: "$(cloud) Update Cloud Firestore Only",
                value: "cloud" as const,
                description: "Applies TTL policy via REST API without modifying workspace file",
              },
              {
                label: "$(file-code) Save to firestore.indexes.json Only",
                value: "file" as const,
                description: "Stages TTL setting in workspace file for Git/CI deployment",
              },
            ],
            { title: `TTL Policy Destination: ${collectionGroup}.${fieldPath}` }
          );
          if (!destChoice) return;
          destValue = destChoice.value;
        }

        if (destValue === "cloud" || destValue === "both") {
          const envPrefix = getEnvironmentWarningPrefix(connectionId);
          const verb = enable ? "Enable" : "Disable";
          const warnText = enable
            ? `${envPrefix}Enable TTL auto-deletion on '${collectionGroup}.${fieldPath}'? Documents with a past Timestamp in '${fieldPath}' will be permanently deleted by Firestore.`
            : `${envPrefix}Disable TTL auto-deletion on '${collectionGroup}.${fieldPath}'?`;

          const confirm = await vscode.window.showWarningMessage(
            warnText,
            { modal: true },
            `${verb} TTL`
          );
          if (confirm !== `${verb} TTL`) return;

          const confirmedProd = await confirmProductionAction({
            connectionId,
            actionLabel: `${verb} TTL Policy`,
            targetSummary: `TTL on '${collectionGroup}.${fieldPath}'`,
            expectedInput: fieldPath,
          });
          if (!confirmedProd) return;
        }

        if (destValue === "file" || destValue === "both") {
          try {
            const filePath = await IndexesService.getInstance().upsertFieldOverrideInWorkspaceFile(
              connectionId,
              collectionGroup,
              fieldPath,
              null,
              enable
            );
            vscode.window.showInformationMessage(
              `TTL override saved to ${vscode.workspace.asRelativePath(filePath)}`
            );
          } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to update workspace file: ${err?.message || err}`);
          }
        }

        if (destValue === "cloud" || destValue === "both") {
          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: `${enable ? "Enabling" : "Disabling"} TTL policy for '${collectionGroup}.${fieldPath}'...`,
              cancellable: false,
            },
            async () => {
              try {
                const svc = IndexesService.getInstance();
                await svc.setTtlPolicy(connectionId, collectionGroup, fieldPath, enable!);
                await svc.listFieldOverrides(connectionId).catch(() => []);
                if (isFieldItem) {
                  explorerDataProvider.refreshNode(item);
                }
                vscode.window.showInformationMessage(
                  `TTL policy ${enable ? "enabled" : "disabled"} for '${collectionGroup}.${fieldPath}'.`
                );
              } catch (err: any) {
                vscode.window.showErrorMessage(`Failed to update TTL policy: ${err?.message || err}`);
              }
            }
          );
        }
      }
    )
  );

  // 10. Exempt, Enable Collection Group, or Restore Single-Field Index Override
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.manageFieldOverride",
      async (item?: DocumentFieldItem | {
        connectionId?: string;
        collectionGroup?: string;
        fieldPath?: string;
        mode?: "exempt" | "collectionGroup" | "restore";
      }) => {
        const connectionId = await resolveIndexConnectionId(item, "Manage Single-Field Index Override");
        if (!connectionId) return;
        if (!ConnectionManager.getInstance().ensureWritable(connectionId, "update field index override")) {
          return;
        }

        const isFieldItem = item instanceof DocumentFieldItem;
        let collectionGroup = isFieldItem
          ? (item.parentDocRef?.parent?.id || "")
          : (item?.collectionGroup?.trim() || "");
        if (!collectionGroup) {
          const picked = await pickCollectionGroup(
            connectionId,
            "Single-Field Index Override (1/3): Collection Group"
          );
          if (!picked) return;
          collectionGroup = picked;
        }

        let fieldPath = isFieldItem
          ? item.fullFieldPath
          : (item?.fieldPath?.trim() || "");
        if (!fieldPath) {
          const pickedField = await pickFieldPath(
            connectionId,
            collectionGroup,
            "Single-Field Index Override (2/3): Field Path",
            false,
            "e.g. bodyText, userId, metadata"
          );
          if (!pickedField) return;
          fieldPath = pickedField;
        }

        let mode: "exempt" | "collectionGroup" | "restore" | "custom" | undefined = isFieldItem
          ? undefined
          : item?.mode;
        if (!mode) {
          const pick = await vscode.window.showQuickPick(
            [
              {
                label: "$(layers) Enable Collection Group Indexing (ASC, DESC, CONTAINS)",
                description: "Required for 1-field collectionGroup() queries on this field",
                value: "collectionGroup" as const,
              },
              {
                label: "$(checklist) Custom Scope Matrix...",
                description: "Pick exact scopes (COLLECTION / COLLECTION_GROUP + ASC / DESC / CONTAINS)",
                value: "custom" as const,
              },
              {
                label: "$(circle-slash) Exempt Field (Disable Single-Field Indexing)",
                description: "Saves index storage & avoids the 40,000 index entries/doc limit",
                value: "exempt" as const,
              },
              {
                label: "$(history) Restore Default (Inherit Ancestor Config)",
                description: "Re-enables default automatic single-field indexing",
                value: "restore" as const,
              },
            ],
            { title: `Single-Field Index Override (3/3): ${collectionGroup}.${fieldPath}` }
          );
          if (!pick) return;
          mode = pick.value;
        }

        let overrideIndexes: Array<{
          queryScope: FirestoreIndexQueryScope;
          order?: "ASCENDING" | "DESCENDING";
          arrayConfig?: "CONTAINS";
        }> | null = null;

        if (mode === "custom") {
          const scopeChoices = await vscode.window.showQuickPick(
            [
              { label: "COLLECTION • ASCENDING", picked: true, spec: { queryScope: "COLLECTION" as const, order: "ASCENDING" as const } },
              { label: "COLLECTION • DESCENDING", picked: true, spec: { queryScope: "COLLECTION" as const, order: "DESCENDING" as const } },
              { label: "COLLECTION • ARRAY_CONTAINS", picked: false, spec: { queryScope: "COLLECTION" as const, arrayConfig: "CONTAINS" as const } },
              { label: "COLLECTION_GROUP • ASCENDING", picked: true, spec: { queryScope: "COLLECTION_GROUP" as const, order: "ASCENDING" as const } },
              { label: "COLLECTION_GROUP • DESCENDING", picked: false, spec: { queryScope: "COLLECTION_GROUP" as const, order: "DESCENDING" as const } },
              { label: "COLLECTION_GROUP • ARRAY_CONTAINS", picked: false, spec: { queryScope: "COLLECTION_GROUP" as const, arrayConfig: "CONTAINS" as const } },
            ],
            {
              canPickMany: true,
              title: `Select Single-Field Index Scopes for '${collectionGroup}.${fieldPath}'`,
              placeHolder: "Select scopes (leave all unchecked to exempt completely)",
            }
          );
          if (!scopeChoices) return;
          overrideIndexes = scopeChoices.map((c) => c.spec);
        } else if (mode === "restore") {
          overrideIndexes = null;
        } else if (mode === "exempt") {
          overrideIndexes = [];
        } else {
          overrideIndexes = [
            { queryScope: "COLLECTION", order: "ASCENDING" },
            { queryScope: "COLLECTION", order: "DESCENDING" },
            { queryScope: "COLLECTION", arrayConfig: "CONTAINS" },
            { queryScope: "COLLECTION_GROUP", order: "ASCENDING" },
            { queryScope: "COLLECTION_GROUP", order: "DESCENDING" },
            { queryScope: "COLLECTION_GROUP", arrayConfig: "CONTAINS" },
          ];
        }

        const hasWorkspace = Boolean(vscode.workspace.workspaceFolders?.length);
        let destValue: "both" | "cloud" | "file" = "cloud";
        if (hasWorkspace) {
          const destChoice = await vscode.window.showQuickPick(
            [
              {
                label: "$(cloud-upload) Update Cloud & Save to firestore.indexes.json",
                value: "both" as const,
              },
              {
                label: "$(cloud) Update Cloud Firestore Only",
                value: "cloud" as const,
              },
              {
                label: "$(file-code) Save to firestore.indexes.json Only",
                value: "file" as const,
              },
            ],
            { title: `Field Override Destination: ${collectionGroup}.${fieldPath}` }
          );
          if (!destChoice) return;
          destValue = destChoice.value;
        }

        const actionLabel =
          mode === "collectionGroup"
            ? "Enable Collection Group Indexing"
            : mode === "custom"
              ? "Set Custom Single-Field Scopes"
              : mode === "exempt"
                ? "Exempt Field from Indexing"
                : "Restore Default Indexing";

        if (destValue === "cloud" || destValue === "both") {
          const envPrefix = getEnvironmentWarningPrefix(connectionId);
          const confirm = await vscode.window.showWarningMessage(
            `${envPrefix}${actionLabel} for '${collectionGroup}.${fieldPath}'?`,
            { modal: true },
            actionLabel
          );
          if (confirm !== actionLabel) return;

          const confirmedProd = await confirmProductionAction({
            connectionId,
            actionLabel,
            targetSummary: `field override on '${collectionGroup}.${fieldPath}'`,
            expectedInput: fieldPath,
          });
          if (!confirmedProd) return;
        }

        if (destValue === "file" || destValue === "both") {
          try {
            const filePath = await IndexesService.getInstance().upsertFieldOverrideInWorkspaceFile(
              connectionId,
              collectionGroup,
              fieldPath,
              overrideIndexes
            );
            vscode.window.showInformationMessage(
              `Field override saved to ${vscode.workspace.asRelativePath(filePath)}`
            );
          } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to update workspace file: ${err?.message || err}`);
          }
        }

        if (destValue === "cloud" || destValue === "both") {
          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: `Updating single-field index override for '${collectionGroup}.${fieldPath}'...`,
              cancellable: false,
            },
            async () => {
              try {
                const svc = IndexesService.getInstance();
                await svc.setFieldIndexOverride(
                  connectionId,
                  collectionGroup,
                  fieldPath,
                  overrideIndexes
                );
                await svc.listFieldOverrides(connectionId).catch(() => []);
                if (isFieldItem) {
                  explorerDataProvider.refreshNode(item);
                }
                vscode.window.showInformationMessage(
                  mode === "collectionGroup"
                    ? `Enabled COLLECTION_GROUP single-field indexing for '${collectionGroup}.${fieldPath}'.`
                    : mode === "custom"
                      ? `Updated ${overrideIndexes?.length ?? 0} custom index scope(s) for '${collectionGroup}.${fieldPath}'.`
                      : mode === "exempt"
                        ? `Field '${collectionGroup}.${fieldPath}' exempted from single-field indexing.`
                        : `Restored default single-field indexing for '${collectionGroup}.${fieldPath}'.`
                );
              } catch (err: any) {
                vscode.window.showErrorMessage(`Failed to update field override: ${err?.message || err}`);
              }
            }
          );
        }
      }
    )
  );

  // 11. Rebuild a NEEDS_REPAIR Composite Index (Delete + Recreate)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "ketrik-firestore-studio.rebuildIndex",
      async (item?: CompositeIndexItem | { connectionId: string; index: any }) => {
        const index = item?.index;
        if (!item || !index || !index.name) return;
        const connectionId = item.connectionId;
        if (!ConnectionManager.getInstance().ensureWritable(connectionId, "rebuild composite index")) {
          return;
        }

        const envPrefix = getEnvironmentWarningPrefix(connectionId);
        const confirm = await vscode.window.showWarningMessage(
          `${envPrefix}Rebuild composite index on '${index.collectionGroup}' [${formatFieldsSummary(index.fields)}]? This will delete and recreate the index.`,
          { modal: true },
          "Rebuild Index"
        );
        if (confirm !== "Rebuild Index") return;

        const confirmedProd = await confirmProductionAction({
          connectionId,
          actionLabel: "Rebuild Composite Index",
          targetSummary: `composite index on '${index.collectionGroup}'`,
          expectedInput: index.collectionGroup,
        });
        if (!confirmedProd) return;

        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Rebuilding index on '${index.collectionGroup}'...`,
            cancellable: false,
          },
          async () => {
            try {
              const svc = IndexesService.getInstance();
              await svc.deleteIndex(connectionId, index.name);
              await svc.createCompositeIndex(
                connectionId,
                index.collectionGroup,
                index.queryScope,
                svc.normalizeIndexFields(index.fields),
                index.apiScope
              );
              vscode.window.showInformationMessage(
                `Index rebuild initiated for '${index.collectionGroup}'. State: CREATING.`
              );
              if (item instanceof CompositeIndexItem) {
                explorerDataProvider.refreshNode(item);
              } else {
                explorerDataProvider.refresh();
              }
            } catch (err: any) {
              vscode.window.showErrorMessage(`Failed to rebuild index: ${err?.message || err}`);
            }
          }
        );
      }
    )
  );
}


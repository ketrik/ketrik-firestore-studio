import * as vscode from "vscode";
import { ConnectionTreeItem, CollectionItem } from "../explorer/items";
import { ConnectionManager } from "../connections/ConnectionManager";
import { DocumentFileSystemProvider } from "../editor/DocumentFileSystemProvider";
import ExplorerDataProvider from "../explorer/ExplorerDataProvider";
import { LocalJsonService } from "../services/LocalJsonService";
import { QueryDocumentSnapshot, Timestamp } from "firebase-admin/firestore";
import { isTimestampLike } from "../utils/timestampUtils";

/**
 * Helper to revive Firestore Timestamp objects from raw serialized JSON or Firestore maps.
 */
function reviveTimestamps(val: any): any {
  if (!val || typeof val !== "object") return val;
  if (val instanceof Timestamp) return val;
  if (isTimestampLike(val)) {
    return new Timestamp((val as any)._seconds, (val as any)._nanoseconds);
  }
  if (Array.isArray(val)) return val.map(reviveTimestamps);
  const res: Record<string, any> = {};
  for (const [k, v] of Object.entries(val)) {
    res[k] = reviveTimestamps(v);
  }
  return res;
}

/**
 * Safe chunked WriteBatch manager to stay well below the 500-operation Firestore limit.
 */
class BatchWriter {
  private _batch: FirebaseFirestore.WriteBatch;
  private _opCount = 0;
  private readonly _limit = 400;

  constructor(private _firestore: FirebaseFirestore.Firestore) {
    this._batch = this._firestore.batch();
  }

  public async set(
    ref: FirebaseFirestore.DocumentReference,
    data: any,
    options: { merge?: boolean }
  ): Promise<void> {
    this._batch.set(ref, data, options);
    this._opCount++;
    if (this._opCount >= this._limit) {
      await this.flush();
    }
  }

  public async flush(): Promise<void> {
    if (this._opCount > 0) {
      await this._batch.commit();
      this._opCount = 0;
      this._batch = this._firestore.batch();
    }
  }
}

/**
 * Recursively copies a document and optionally all its nested subcollections.
 */
async function copyDocRecursive(
  sourceDocRef: FirebaseFirestore.DocumentReference,
  targetDocRef: FirebaseFirestore.DocumentReference,
  data: any,
  deep: boolean,
  batchWriter: BatchWriter,
  merge: boolean,
  token: vscode.CancellationToken,
  onDocCopied: () => void
): Promise<void> {
  if (token.isCancellationRequested) return;

  await batchWriter.set(targetDocRef, reviveTimestamps(data), { merge });
  onDocCopied();

  if (!deep) return;

  try {
    const subcollections = await sourceDocRef.listCollections();
    for (const subColl of subcollections) {
      if (token.isCancellationRequested) break;
      const targetSubColl = targetDocRef.collection(subColl.id);

      const pageSize = 300;
      let lastDoc: QueryDocumentSnapshot | null = null;
      let hasMore = true;

      while (hasMore && !token.isCancellationRequested) {
        let q = subColl.limit(pageSize);
        if (lastDoc) {
          q = q.startAfter(lastDoc);
        }
        const snap = await q.get();
        if (snap.empty) break;

        for (const childDoc of snap.docs) {
          if (token.isCancellationRequested) break;
          await copyDocRecursive(
            childDoc.ref,
            targetSubColl.doc(childDoc.id),
            childDoc.data(),
            deep,
            batchWriter,
            merge,
            token,
            onDocCopied
          );
        }

        lastDoc = snap.docs[snap.docs.length - 1];
        if (snap.docs.length < pageSize) hasMore = false;
      }
    }
  } catch {
    // Graceful fallback if subcollection listing lacks permissions
  }
}

/**
 * Command: Batch copy multiple collections to another instance or within the same instance.
 * Supports checkbox multi-selection, naming transformations, deep subcollection hierarchy copying,
 * and seamless cross-substrate replication across Cloud Firestore, Local Emulators, and Local JSON.
 */
export async function copyMultipleCollectionsCommand(
  item?: ConnectionTreeItem | CollectionItem,
  explorerDataProvider?: ExplorerDataProvider
): Promise<void> {
  const connectionManager = ConnectionManager.getInstance();
  const connections = connectionManager.getConnections();

  if (connections.length === 0) {
    vscode.window.showWarningMessage("No Firestore connections configured.");
    return;
  }

  // 1. Resolve source connection
  let sourceConnId: string | undefined;
  let preSelectedColl: string | undefined;

  if (item instanceof ConnectionTreeItem) {
    sourceConnId = item.config.id;
  } else if (item instanceof CollectionItem) {
    sourceConnId = item.connectionId;
    preSelectedColl = item.collectionId;
  } else {
    // Invoked from Command Palette: prompt for source connection
    const sourcePick = await vscode.window.showQuickPick(
      connections.map((c) => ({
        label: `$(database) ${c.name}`,
        description: c.isLocalJson
          ? `Local JSON (${c.localJsonPath})`
          : c.isEmulator
          ? `Emulator (${c.emulatorHost})`
          : c.projectId || "Cloud",
        config: c,
      })),
      {
        title: "Select Source Connection to Copy Collections From",
        placeHolder: "Choose source database",
      }
    );
    if (!sourcePick) return;
    sourceConnId = sourcePick.config.id;
  }

  const sourceConn = connectionManager.getConnection(sourceConnId);
  if (!sourceConn) {
    vscode.window.showErrorMessage("Source connection not found.");
    return;
  }

  // 2. Discover available root collections
  let collectionIds: string[] = [];

  if (sourceConn.isLocalJson) {
    collectionIds = LocalJsonService.getInstance().listCollections(sourceConn);
  } else {
    try {
      const firestore = await connectionManager.getFirestore(sourceConn.id);
      const refs = await firestore.listCollections();
      collectionIds = refs.map((r) => r.id);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to list collections in '${sourceConn.name}': ${err.message}`);
      return;
    }
  }

  if (collectionIds.length === 0) {
    vscode.window.showInformationMessage(`No collections found in '${sourceConn.name}'.`);
    return;
  }

  // 3. Multi-Select Collections via Checkboxes
  const collectionPicks = await vscode.window.showQuickPick(
    collectionIds.map((id) => ({
      label: `$(folder) ${id}`,
      description: "Collection",
      collectionId: id,
      picked: preSelectedColl ? id === preSelectedColl : true,
    })),
    {
      title: `Select Collections to Replicate from '${sourceConn.name}'`,
      placeHolder: "Select one or more collections (Space to toggle checkboxes)",
      canPickMany: true,
    }
  );

  if (!collectionPicks || collectionPicks.length === 0) {
    return;
  }

  const selectedColls = collectionPicks.map((p) => p.collectionId);

  // 4. Select Destination Connection
  const targetPick = await vscode.window.showQuickPick(
    connections.map((c) => ({
      label: c.id === sourceConnId ? `$(database) ${c.name} (Same Instance)` : `$(database) ${c.name}`,
      description: c.isLocalJson
        ? `Local JSON (${c.localJsonPath})`
        : c.isEmulator
        ? `Emulator (${c.emulatorHost})`
        : c.projectId || "Cloud",
      config: c,
    })),
    {
      title: `Copy ${selectedColls.length} Collection(s) to Destination Database`,
      placeHolder: "Select destination Firebase / Firestore / Emulator database",
    }
  );

  if (!targetPick) {
    return;
  }

  const targetConn = targetPick.config;
  const isSameConnection = targetConn.id === sourceConnId;

  // 5. Naming Transformation Strategy
  let targetMapping: Array<{ source: string; target: string }> = [];

  if (isSameConnection) {
    // Same instance: enforce prefix or suffix to avoid self-overwrite
    const sameInstanceNaming = await vscode.window.showQuickPick(
      [
        {
          label: "$(tag) Append Suffix (e.g. users -> users_copy)",
          description: "Append a custom suffix to all collection names",
          mode: "suffix",
        },
        {
          label: "$(tag) Prepend Prefix (e.g. users -> copy_users)",
          description: "Prepend a custom prefix to all collection names",
          mode: "prefix",
        },
      ],
      {
        title: "Naming Strategy (Required for Same Instance)",
        placeHolder: "Choose how to rename collections to prevent overwriting originals",
      }
    );

    if (!sameInstanceNaming) return;

    const defaultVal = sameInstanceNaming.mode === "suffix" ? "_copy" : "copy_";
    const affixInput = await vscode.window.showInputBox({
      prompt: `Enter ${sameInstanceNaming.mode} for duplicated collections`,
      value: defaultVal,
      validateInput: (v) => {
        if (!v || !v.trim()) return "Affix cannot be empty when copying within the same instance";
        return null;
      },
    });

    if (!affixInput) return;
    const affix = affixInput.trim();

    targetMapping = selectedColls.map((src) => ({
      source: src,
      target: sameInstanceNaming.mode === "suffix" ? `${src}${affix}` : `${affix}${src}`,
    }));
  } else {
    // Cross-instance: offer keep identical, prefix, or suffix
    const namingChoice = await vscode.window.showQuickPick(
      [
        {
          label: "$(check) Keep Original Names (Default)",
          description: "Replicate with exact collection names (e.g. users -> users)",
          mode: "keep",
        },
        {
          label: "$(tag) Prepend Prefix",
          description: "Prepend a custom prefix (e.g. staging_users)",
          mode: "prefix",
        },
        {
          label: "$(tag) Append Suffix",
          description: "Append a custom suffix (e.g. users_backup)",
          mode: "suffix",
        },
      ],
      {
        title: "Target Collection Naming Strategy",
        placeHolder: "Select naming rule for copied collections",
      }
    );

    if (!namingChoice) return;

    if (namingChoice.mode === "keep") {
      targetMapping = selectedColls.map((src) => ({ source: src, target: src }));
    } else {
      const affixInput = await vscode.window.showInputBox({
        prompt: `Enter ${namingChoice.mode} for target collections`,
        value: namingChoice.mode === "prefix" ? "staging_" : "_backup",
        validateInput: (v) => (!v || !v.trim() ? "Affix cannot be empty" : null),
      });

      if (!affixInput) return;
      const affix = affixInput.trim();

      targetMapping = selectedColls.map((src) => ({
        source: src,
        target: namingChoice.mode === "prefix" ? `${affix}${src}` : `${src}${affix}`,
      }));
    }
  }

  // 6. Subcollection Depth Selection
  const depthPick = await vscode.window.showQuickPick(
    [
      {
        label: "$(files) Root Documents Only",
        description: "Replicate direct collection documents only (fast, lower quota usage)",
        deep: false,
      },
      {
        label: "$(repo-forked) Deep Recursive Copy (Include Subcollections)",
        description: "Recursively copy all nested subcollections under each document",
        deep: true,
      },
    ],
    {
      title: "Subcollection Depth Strategy",
      placeHolder: "Choose whether to include nested subcollections",
    }
  );

  if (!depthPick) return;

  // 7. Write Strategy Selection
  const strategyPick = await vscode.window.showQuickPick(
    [
      {
        label: "$(git-merge) Merge / Patch",
        description: "Preserve other fields on existing target documents",
        merge: true,
      },
      {
        label: "$(replace) Overwrite (Set)",
        description: "Replace target document contents completely",
        merge: false,
      },
    ],
    {
      title: "Write Strategy for Target Documents",
      placeHolder: "Select write strategy for existing documents in target collections",
    }
  );

  if (!strategyPick) return;

  // 8. Pre-Flight Safety Confirmation
  const mappingPreview = targetMapping
    .slice(0, 4)
    .map((m) => `${m.source} -> ${m.target}`)
    .join(", ");
  const moreCount = targetMapping.length - 4;
  const previewSuffix = moreCount > 0 ? ` (+${moreCount} more)` : "";

  const confirm = await vscode.window.showWarningMessage(
    `Replicate ${targetMapping.length} collection(s) from '${sourceConn.name}' to '${targetConn.name}'?\n\nMapping: ${mappingPreview}${previewSuffix}\nDepth: ${
      depthPick.deep ? "Deep Recursive" : "Root Documents Only"
    }\nStrategy: ${strategyPick.merge ? "Merge / Patch" : "Overwrite"}`,
    { modal: true },
    "Proceed with Batch Copy"
  );

  if (confirm !== "Proceed with Batch Copy") return;

  // 9. Execution Engine with Live Progress
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Replicating collections to '${targetConn.name}'...`,
      cancellable: true,
    },
    async (progress, token) => {
      let totalDocsCopied = 0;
      let completedCollections = 0;

      try {
        const totalColls = targetMapping.length;

        // Substrate handling
        if (sourceConn.isLocalJson) {
          // Source: Local JSON
          if (targetConn.isLocalJson) {
            // Local JSON -> Local JSON
            for (let i = 0; i < totalColls; i++) {
              if (token.isCancellationRequested) break;
              const { source, target } = targetMapping[i];
              progress.report({
                message: `[${i + 1}/${totalColls}] Copying '${source}' -> '${target}'...`,
                increment: (1 / totalColls) * 100,
              });

              const localDocs = LocalJsonService.getInstance().listDocuments(sourceConn, source);
              if (localDocs.length > 0) {
                LocalJsonService.getInstance().setDocuments(targetConn, target, localDocs);
                totalDocsCopied += localDocs.length;
              }
              completedCollections++;
            }
          } else {
            // Local JSON -> Firestore / Emulator
            const targetFirestore = await connectionManager.getFirestore(targetConn.id);
            const batchWriter = new BatchWriter(targetFirestore);

            for (let i = 0; i < totalColls; i++) {
              if (token.isCancellationRequested) break;
              const { source, target } = targetMapping[i];
              progress.report({
                message: `[${i + 1}/${totalColls}] Copying '${source}' -> '${target}'...`,
              });

              const localDocs = LocalJsonService.getInstance().listDocuments(sourceConn, source);
              const targetCollRef = targetFirestore.collection(target);

              for (const doc of localDocs) {
                if (token.isCancellationRequested) break;
                await batchWriter.set(targetCollRef.doc(doc.id), reviveTimestamps(doc.data), {
                  merge: strategyPick.merge,
                });
                totalDocsCopied++;
              }
              await batchWriter.flush();
              completedCollections++;
              progress.report({ increment: (1 / totalColls) * 100 });
            }
          }
        } else {
          // Source: Firestore / Emulator
          const sourceFirestore = await connectionManager.getFirestore(sourceConn.id);

          if (targetConn.isLocalJson) {
            // Firestore -> Local JSON
            const batchSize = 250;

            for (let i = 0; i < totalColls; i++) {
              if (token.isCancellationRequested) break;
              const { source, target } = targetMapping[i];
              const sourceCollRef = sourceFirestore.collection(source);

              let lastDoc: QueryDocumentSnapshot | null = null;
              let hasMore = true;
              let collDocsCopied = 0;

              while (hasMore && !token.isCancellationRequested) {
                let query = sourceCollRef.limit(batchSize);
                if (lastDoc) {
                  query = query.startAfter(lastDoc);
                }
                const snap = await query.get();
                if (snap.empty) break;

                const batchDocs = snap.docs.map((doc) => ({
                  id: doc.id,
                  data: doc.data(),
                }));
                LocalJsonService.getInstance().setDocuments(targetConn, target, batchDocs);
                collDocsCopied += batchDocs.length;
                totalDocsCopied += batchDocs.length;

                lastDoc = snap.docs[snap.docs.length - 1];
                progress.report({
                  message: `[${i + 1}/${totalColls}] '${source}' (${collDocsCopied} docs)...`,
                });
                if (snap.docs.length < batchSize) hasMore = false;
              }
              completedCollections++;
              progress.report({ increment: (1 / totalColls) * 100 });
            }
          } else {
            // Firestore -> Firestore / Emulator
            const targetFirestore = await connectionManager.getFirestore(targetConn.id);
            const batchWriter = new BatchWriter(targetFirestore);

            for (let i = 0; i < totalColls; i++) {
              if (token.isCancellationRequested) break;
              const { source, target } = targetMapping[i];
              const sourceCollRef = sourceFirestore.collection(source);
              const targetCollRef = targetFirestore.collection(target);

              const batchSize = 350;
              let lastDoc: QueryDocumentSnapshot | null = null;
              let hasMore = true;
              let collDocsCopied = 0;

              while (hasMore && !token.isCancellationRequested) {
                let query = sourceCollRef.limit(batchSize);
                if (lastDoc) {
                  query = query.startAfter(lastDoc);
                }
                const snap = await query.get();
                if (snap.empty) break;

                for (const doc of snap.docs) {
                  if (token.isCancellationRequested) break;
                  await copyDocRecursive(
                    doc.ref,
                    targetCollRef.doc(doc.id),
                    doc.data(),
                    depthPick.deep,
                    batchWriter,
                    strategyPick.merge,
                    token,
                    () => {
                      collDocsCopied++;
                      totalDocsCopied++;
                    }
                  );
                }

                lastDoc = snap.docs[snap.docs.length - 1];
                progress.report({
                  message: `[${i + 1}/${totalColls}] '${source}' (${collDocsCopied} docs)...`,
                });
                if (snap.docs.length < batchSize) hasMore = false;
              }

              await batchWriter.flush();
              completedCollections++;
              progress.report({ increment: (1 / totalColls) * 100 });
            }
          }
        }

        // Cache Invalidation for target collections
        for (const m of targetMapping) {
          DocumentFileSystemProvider.getInstance().invalidateAndNotify(targetConn.id, m.target);
        }

        if (token.isCancellationRequested) {
          vscode.window.showWarningMessage(
            `Batch replication cancelled. Copied ${totalDocsCopied} document(s) across ${completedCollections} collection(s).`
          );
        } else {
          vscode.window.showInformationMessage(
            `Successfully replicated ${completedCollections} collection(s) (${totalDocsCopied} document(s) total) from '${sourceConn.name}' to '${targetConn.name}'!`
          );
        }

        if (explorerDataProvider) {
          explorerDataProvider.refresh();
        }
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to replicate collections: ${err.message}`);
      }
    }
  );
}

import * as vscode from "vscode";
import { CollectionItem } from "../explorer/items";
import { ConnectionManager } from "../connections/ConnectionManager";
import { DocumentFileSystemProvider } from "../editor/DocumentFileSystemProvider";
import ExplorerDataProvider from "../explorer/ExplorerDataProvider";
import { LocalJsonService } from "../services/LocalJsonService";
import { QueryDocumentSnapshot, Timestamp } from "firebase-admin/firestore";
import { isTimestampLike } from "../utils/timestampUtils";

/**
 * Command: Directly copy/clone an entire collection from one Firestore instance to another.
 * Works seamlessly across Cloud Firestore, Local Emulators, and Local JSON stores!
 */
export async function copyCollectionToInstanceCommand(
  item: CollectionItem,
  explorerDataProvider: ExplorerDataProvider
): Promise<void> {
  const sourceConnId = item.connectionId;
  const sourceCollName = item.collectionId;
  const sourceCollPath = item.reference.path;
  const connectionManager = ConnectionManager.getInstance();
  const sourceConn = connectionManager.getConnection(sourceConnId);

  if (!sourceConn) {
    vscode.window.showErrorMessage("Source connection not found.");
    return;
  }

  // 1. Pick destination connection (any other connection, or even the same connection with a different collection name)
  const connections = connectionManager.getConnections();
  if (connections.length === 0) {
    vscode.window.showWarningMessage("No connections available.");
    return;
  }

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
      title: `Copy Collection '${sourceCollName}' to Another Instance`,
      placeHolder: "Select destination Firebase / Firestore / Emulator database",
    }
  );

  if (!targetPick) {
    return;
  }

  const targetConn = targetPick.config;

  // 2. Target collection name
  const isSameConnection = targetConn.id === sourceConnId;
  const defaultTargetName = isSameConnection ? `${sourceCollName}_copy` : sourceCollName;

  const targetCollInput = await vscode.window.showInputBox({
    prompt: `Destination collection name in '${targetConn.name}'`,
    value: defaultTargetName,
    validateInput: (v) => {
      if (!v || !v.trim()) return "Collection name cannot be empty";
      if (isSameConnection && v.trim() === sourceCollName) {
        return "Target collection must have a different name when copying within the same instance";
      }
      return null;
    },
  });

  if (!targetCollInput) {
    return;
  }

  const targetCollName = targetCollInput.trim();

  // 3. Select write strategy: Merge / Patch vs Overwrite
  const strategyPick = await vscode.window.showQuickPick(
    [
      { label: "$(git-merge) Merge / Patch", description: "Preserve other fields on existing target documents", merge: true },
      { label: "$(replace) Overwrite (Set)", description: "Replace target document contents completely", merge: false },
    ],
    { placeHolder: "Select write strategy for existing documents" }
  );

  if (!strategyPick) {
    return;
  }

  // 4. Confirmation dialog
  const confirm = await vscode.window.showWarningMessage(
    `Copy collection '${sourceCollName}' from '${sourceConn.name}' to '${targetConn.name}' -> collection '${targetCollName}'?`,
    { modal: true },
    "Proceed with Copy"
  );

  if (confirm !== "Proceed with Copy") {
    return;
  }

  const reviveTimestamps = (val: any): any => {
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
  };

  // 5. Execute copy with progress indicator
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Copying '${sourceCollName}' to '${targetConn.name}/${targetCollName}'...`,
      cancellable: true,
    },
    async (progress, token) => {
      try {
        let copiedCount = 0;

        // Source Docs Loading
        if (sourceConn.isLocalJson) {
          // Case A: Source is Local JSON
          const localDocs = LocalJsonService.getInstance().listDocuments(sourceConn, sourceCollName);
          if (localDocs.length === 0) {
            vscode.window.showInformationMessage(`Source collection '${sourceCollName}' has no documents.`);
            return;
          }

          if (targetConn.isLocalJson) {
            // Local JSON -> Local JSON
            for (const doc of localDocs) {
              if (token.isCancellationRequested) break;
              LocalJsonService.getInstance().setDocument(targetConn, `${targetCollName}/${doc.id}`, doc.data);
              copiedCount++;
            }
          } else {
            // Local JSON -> Firestore / Emulator
            const firestore = await connectionManager.getFirestore(targetConn.id);
            const collRef = firestore.collection(targetCollName);
            const chunkSize = 400;

            for (let i = 0; i < localDocs.length; i += chunkSize) {
              if (token.isCancellationRequested) break;
              const chunk = localDocs.slice(i, i + chunkSize);
              const batch = firestore.batch();
              for (const doc of chunk) {
                const docRef = collRef.doc(doc.id);
                batch.set(docRef, reviveTimestamps(doc.data), { merge: strategyPick.merge });
              }
              await batch.commit();
              copiedCount += chunk.length;
              progress.report({
                message: `${copiedCount} / ${localDocs.length} copied...`,
                increment: (chunk.length / localDocs.length) * 100,
              });
            }
          }
        } else {
          // Case B: Source is Firestore / Emulator
          const sourceFirestore = await connectionManager.getFirestore(sourceConn.id);
          const sourceCollRef = sourceFirestore.collection(sourceCollPath);

          if (targetConn.isLocalJson) {
            // Firestore -> Local JSON
            const batchSize = 250;
            let lastDoc: QueryDocumentSnapshot | null = null;
            let hasMore = true;

            while (hasMore && !token.isCancellationRequested) {
              let query = sourceCollRef.limit(batchSize);
              if (lastDoc) {
                query = query.startAfter(lastDoc);
              }
              const snapshot = await query.get();
              if (snapshot.empty) break;

              for (const doc of snapshot.docs) {
                LocalJsonService.getInstance().setDocument(targetConn, `${targetCollName}/${doc.id}`, doc.data());
                copiedCount++;
              }

              lastDoc = snapshot.docs[snapshot.docs.length - 1];
              progress.report({ message: `${copiedCount} documents copied...` });
              if (snapshot.docs.length < batchSize) hasMore = false;
            }
          } else {
            // Firestore -> Firestore (Live instance to Live instance)
            const targetFirestore = await connectionManager.getFirestore(targetConn.id);
            const targetCollRef = targetFirestore.collection(targetCollName);

            const batchSize = 400;
            let lastDoc: QueryDocumentSnapshot | null = null;
            let hasMore = true;

            while (hasMore && !token.isCancellationRequested) {
              let query = sourceCollRef.limit(batchSize);
              if (lastDoc) {
                query = query.startAfter(lastDoc);
              }
              const snapshot = await query.get();
              if (snapshot.empty) break;

              const batch = targetFirestore.batch();
              for (const doc of snapshot.docs) {
                const targetRef = targetCollRef.doc(doc.id);
                batch.set(targetRef, doc.data(), { merge: strategyPick.merge });
              }

              await batch.commit();
              copiedCount += snapshot.docs.length;
              lastDoc = snapshot.docs[snapshot.docs.length - 1];

              progress.report({ message: `${copiedCount} documents copied...` });
              if (snapshot.docs.length < batchSize) hasMore = false;
            }
          }
        }

        if (token.isCancellationRequested) {
          vscode.window.showWarningMessage(`Collection copy stopped. ${copiedCount} documents copied.`);
          return;
        }

        DocumentFileSystemProvider.getInstance().invalidateAndNotify(targetConn.id, targetCollName);
        vscode.window.showInformationMessage(
          `Successfully copied ${copiedCount} document(s) from '${sourceConn.name}/${sourceCollName}' to '${targetConn.name}/${targetCollName}'!`
        );
        explorerDataProvider.refresh();
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to copy collection: ${err.message}`);
      }
    }
  );
}

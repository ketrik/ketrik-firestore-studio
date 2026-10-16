import * as vscode from "vscode";
import { CollectionItem, DocumentItem } from "../explorer/items";
import { ConnectionManager, FirestoreConnectionConfig } from "../connections/ConnectionManager";
import { LocalJsonService } from "../services/LocalJsonService";
import { DocumentFileSystemProvider } from "../editor/DocumentFileSystemProvider";
import ExplorerDataProvider from "../explorer/ExplorerDataProvider";
import { Timestamp } from "firebase-admin/firestore";
import { isTimestampLike } from "../utils/timestampUtils";

/**
 * Command: Push / Seed a local JSON collection into a Firestore database (Cloud or Emulator).
 */
export async function pushLocalCollectionToFirestoreCommand(
  item: CollectionItem,
  explorerDataProvider: ExplorerDataProvider
): Promise<void> {
  const sourceConnId = item.connectionId;
  const sourceCollName = item.collectionId;
  const connectionManager = ConnectionManager.getInstance();
  const sourceConn = connectionManager.getConnection(sourceConnId);

  if (!sourceConn || !sourceConn.isLocalJson) {
    vscode.window.showErrorMessage("This action is only available for Local JSON Database collections.");
    return;
  }

  // 1. Load source local documents
  const localDocs = LocalJsonService.getInstance().listDocuments(sourceConn, sourceCollName);
  if (localDocs.length === 0) {
    vscode.window.showInformationMessage(`Collection '${sourceCollName}' has no documents to push.`);
    return;
  }

  // 2. Select target Firestore connection
  const targetConnections = connectionManager.getConnections().filter((c) => !c.isLocalJson);
  if (targetConnections.length === 0) {
    vscode.window.showWarningMessage(
      "No Firestore or Emulator connections found to push data to. Please add one first."
    );
    return;
  }

  const targetPick = await vscode.window.showQuickPick(
    targetConnections.map((c) => ({
      label: `$(database) ${c.name}`,
      description: c.isEmulator ? `Emulator (${c.emulatorHost})` : c.projectId || "Cloud",
      config: c,
    })),
    {
      title: `Push '${sourceCollName}' (${localDocs.length} docs) to Firestore`,
      placeHolder: "Select destination Firestore or Emulator database",
    }
  );

  if (!targetPick) {
    return;
  }

  const targetConn = targetPick.config;

  // 3. Confirm target collection name (default same name)
  const targetCollInput = await vscode.window.showInputBox({
    prompt: "Destination collection name",
    value: sourceCollName,
    validateInput: (v) => (v && v.trim().length > 0 ? null : "Collection name cannot be empty"),
  });

  if (!targetCollInput) {
    return;
  }

  const targetCollName = targetCollInput.trim();

  // 4. Select write strategy: Merge/Patch vs Overwrite
  const strategyPick = await vscode.window.showQuickPick(
    [
      { label: "$(git-merge) Merge / Patch", description: "Preserve other fields on existing documents", merge: true },
      { label: "$(replace) Overwrite (Set)", description: "Replace target document contents completely", merge: false },
    ],
    { placeHolder: "Select write strategy for existing documents" }
  );

  if (!strategyPick) {
    return;
  }

  // 5. Confirmation dialog
  const confirm = await vscode.window.showWarningMessage(
    `Push ${localDocs.length} document(s) from local '${sourceCollName}' into '${targetConn.name}' -> collection '${targetCollName}'?`,
    { modal: true },
    "Proceed with Push"
  );

  if (confirm !== "Proceed with Push") {
    return;
  }

  // Revive {_seconds, _nanoseconds} maps into Timestamp objects
  const reviveTimestamps = (val: any): any => {
    if (!val || typeof val !== "object") {
      return val;
    }
    if (val instanceof Timestamp) {
      return val;
    }
    if (isTimestampLike(val)) {
      return new Timestamp((val as any)._seconds, (val as any)._nanoseconds);
    }
    if (Array.isArray(val)) {
      return val.map(reviveTimestamps);
    }
    const res: Record<string, any> = {};
    for (const [k, v] of Object.entries(val)) {
      res[k] = reviveTimestamps(v);
    }
    return res;
  };

  // 6. Execute chunked batch write (400 per batch)
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Pushing to '${targetConn.name}/${targetCollName}'...`,
      cancellable: true,
    },
    async (progress, token) => {
      try {
        const firestore = await connectionManager.getFirestore(targetConn.id);
        const collRef = firestore.collection(targetCollName);

        const chunkSize = 400;
        let writtenCount = 0;

        for (let i = 0; i < localDocs.length; i += chunkSize) {
          if (token.isCancellationRequested) {
            vscode.window.showWarningMessage(`Push stopped. ${writtenCount} documents written.`);
            return;
          }

          const chunk = localDocs.slice(i, i + chunkSize);
          const batch = firestore.batch();

          for (const doc of chunk) {
            const docRef = collRef.doc(doc.id);
            const sanitized = reviveTimestamps(doc.data);
            batch.set(docRef, sanitized, { merge: strategyPick.merge });
          }

          await batch.commit();
          writtenCount += chunk.length;
          progress.report({
            message: `${writtenCount} / ${localDocs.length} written...`,
            increment: (chunk.length / localDocs.length) * 100,
          });
        }

        DocumentFileSystemProvider.getInstance().invalidateAndNotify(targetConn.id, targetCollName);
        vscode.window.showInformationMessage(
          `Successfully pushed ${writtenCount} document(s) from local store to '${targetConn.name}/${targetCollName}'!`
        );
        explorerDataProvider.refresh();
      } catch (err: any) {
        vscode.window.showErrorMessage(`Push to Firestore failed: ${err.message}`);
      }
    }
  );
}

/**
 * Command: Pull / Snapshot an entire Firestore collection into a Local JSON Database or file.
 */
export async function snapshotFirestoreToLocalJsonCommand(
  item: CollectionItem,
  explorerDataProvider: ExplorerDataProvider
): Promise<void> {
  const sourceConnId = item.connectionId;
  const sourceCollName = item.collectionId;
  const sourceCollPath = item.reference.path;
  const connectionManager = ConnectionManager.getInstance();

  // 1. Pick destination: Existing Local JSON Connection or New File
  const localConnections = connectionManager.getConnections().filter((c) => c.isLocalJson);
  const destinationOptions = [
    ...localConnections.map((c) => ({
      label: `$(file-code) ${c.name}`,
      description: c.localJsonPath || "",
      isNew: false,
      conn: c,
    })),
    {
      label: "$(add) New Local JSON File / Database...",
      description: "Pick or create a new JSON file to store this snapshot",
      isNew: true,
      conn: null,
    },
  ];

  const pick = await vscode.window.showQuickPick(destinationOptions, {
    title: `Snapshot Firestore Collection: '${sourceCollName}'`,
    placeHolder: "Select Local JSON destination database or file",
  });

  if (!pick) {
    return;
  }

  let targetConfig: FirestoreConnectionConfig;

  if (pick.isNew) {
    const saveUri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(`${sourceCollName}_snapshot.json`),
      filters: { "JSON Files": ["json"] },
      title: "Save Snapshot as Local JSON Database",
    });
    if (!saveUri) return;

    const baseName = sourceCollName;
    targetConfig = {
      id: `conn_${Date.now()}`,
      name: `Local (${baseName})`,
      isLocalJson: true,
      localJsonPath: saveUri.fsPath,
    };
    await connectionManager.addConnection(targetConfig);
  } else {
    targetConfig = pick.conn!;
  }

  // 2. Stream all documents from Firestore and write into Local JSON store
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Snapshotting '${sourceCollName}' to local store...`,
      cancellable: true,
    },
    async (progress, token) => {
      try {
        const firestore = await connectionManager.getFirestore(sourceConnId);
        const collRef = firestore.collection(sourceCollPath);

        let lastDoc: any = null;
        let hasMore = true;
        const batchSize = 250;
        let fetchedCount = 0;

        while (hasMore && !token.isCancellationRequested) {
          let query = collRef.limit(batchSize);
          if (lastDoc) {
            query = query.startAfter(lastDoc);
          }
          const snapshot = await query.get();
          if (snapshot.empty) {
            hasMore = false;
            break;
          }

          const batchDocs = snapshot.docs.map((doc) => ({
            id: doc.id,
            data: doc.data(),
          }));
          LocalJsonService.getInstance().setDocuments(targetConfig, sourceCollName, batchDocs);
          fetchedCount += batchDocs.length;

          lastDoc = snapshot.docs[snapshot.docs.length - 1];
          progress.report({ message: `Captured ${fetchedCount} documents...` });
          if (snapshot.docs.length < batchSize) {
            hasMore = false;
          }
        }

        if (token.isCancellationRequested) {
          vscode.window.showWarningMessage("Snapshot cancelled.");
          return;
        }

        vscode.window.showInformationMessage(
          `Successfully saved snapshot of ${fetchedCount} document(s) into Local JSON Database '${targetConfig.name}'!`
        );
        explorerDataProvider.refresh();
      } catch (err: any) {
        vscode.window.showErrorMessage(`Snapshot failed: ${err.message}`);
      }
    }
  );
}

/**
 * Command: Push / Seed a single local document into a Firestore database.
 */
export async function pushLocalDocumentToFirestoreCommand(
  item: DocumentItem,
  explorerDataProvider: ExplorerDataProvider
): Promise<void> {
  const sourceConnId = item.connectionId;
  const connectionManager = ConnectionManager.getInstance();
  const sourceConn = connectionManager.getConnection(sourceConnId);

  if (!sourceConn || !sourceConn.isLocalJson) {
    vscode.window.showErrorMessage("This action is only available for Local JSON Database documents.");
    return;
  }

  const docPath = item.reference.path;
  const segments = docPath.split("/").filter(Boolean);
  if (segments.length < 2) {
    return;
  }
  const docId = segments[1];

  const docData = LocalJsonService.getInstance().getDocument(sourceConn, docPath);
  if (!docData) {
    vscode.window.showErrorMessage(`Local document '${docId}' not found.`);
    return;
  }

  const targetConnections = connectionManager.getConnections().filter((c) => !c.isLocalJson);
  if (targetConnections.length === 0) {
    vscode.window.showWarningMessage("No Firestore or Emulator connections found to push data to.");
    return;
  }

  const targetPick = await vscode.window.showQuickPick(
    targetConnections.map((c) => ({
      label: `$(database) ${c.name}`,
      description: c.isEmulator ? `Emulator (${c.emulatorHost})` : c.projectId || "Cloud",
      config: c,
    })),
    {
      title: `Push Document '${docId}' to Firestore`,
      placeHolder: "Select destination Firestore or Emulator database",
    }
  );

  if (!targetPick) return;
  const targetConn = targetPick.config;

  const targetPathInput = await vscode.window.showInputBox({
    prompt: "Destination document path in target database",
    value: docPath,
    validateInput: (v) => (v && v.trim().length > 0 ? null : "Document path cannot be empty"),
  });

  if (!targetPathInput) return;
  const targetPath = targetPathInput.trim();

  const strategyPick = await vscode.window.showQuickPick(
    [
      { label: "$(git-merge) Merge / Patch", description: "Preserve other fields on existing target document", merge: true },
      { label: "$(replace) Overwrite (Set)", description: "Replace target document contents completely", merge: false },
    ],
    { placeHolder: "Select write strategy" }
  );

  if (!strategyPick) return;

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

  try {
    const firestore = await connectionManager.getFirestore(targetConn.id);
    const targetRef = firestore.doc(targetPath);
    const sanitized = reviveTimestamps(docData);
    await targetRef.set(sanitized, { merge: strategyPick.merge });

    DocumentFileSystemProvider.getInstance().invalidateAndNotify(targetConn.id, targetPath);
    vscode.window.showInformationMessage(
      `Successfully pushed local document '${docId}' to '${targetConn.name}/${targetPath}'!`
    );
    explorerDataProvider.refresh();
  } catch (err: any) {
    vscode.window.showErrorMessage(`Push failed: ${err.message}`);
  }
}

/**
 * Command: Pull / Snapshot an individual Firestore document into a Local JSON Database or file.
 */
export async function snapshotDocumentToLocalJsonCommand(
  item: DocumentItem,
  explorerDataProvider: ExplorerDataProvider
): Promise<void> {
  const sourceConnId = item.connectionId;
  const sourceDocPath = item.reference.path;
  const connectionManager = ConnectionManager.getInstance();

  const localConnections = connectionManager.getConnections().filter((c) => c.isLocalJson);
  const destinationOptions = [
    ...localConnections.map((c) => ({
      label: `$(file-code) ${c.name}`,
      description: c.localJsonPath || "",
      isNew: false,
      conn: c,
    })),
    {
      label: "$(add) New Local JSON File / Database...",
      description: "Pick or create a new JSON file to store this snapshot",
      isNew: true,
      conn: null,
    },
  ];

  const pick = await vscode.window.showQuickPick(destinationOptions, {
    title: `Snapshot Firestore Document: '${sourceDocPath}'`,
    placeHolder: "Select Local JSON destination database or file",
  });

  if (!pick) return;

  let targetConfig: FirestoreConnectionConfig;

  if (pick.isNew) {
    const saveUri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(`${item.documentId}_snapshot.json`),
      filters: { "JSON Files": ["json"] },
      title: "Save Snapshot as Local JSON Database",
    });
    if (!saveUri) return;

    targetConfig = {
      id: `conn_${Date.now()}`,
      name: `Local (${item.documentId})`,
      isLocalJson: true,
      localJsonPath: saveUri.fsPath,
    };
    await connectionManager.addConnection(targetConfig);
  } else {
    targetConfig = pick.conn!;
  }

  try {
    const firestore = await connectionManager.getFirestore(sourceConnId);
    const docRef = firestore.doc(sourceDocPath);
    const snap = await docRef.get();
    if (!snap.exists) {
      vscode.window.showErrorMessage(`Document '${sourceDocPath}' does not exist in Firestore.`);
      return;
    }

    LocalJsonService.getInstance().setDocument(targetConfig, sourceDocPath, snap.data() || {});
    vscode.window.showInformationMessage(
      `Successfully saved snapshot of document '${item.documentId}' into Local JSON Database '${targetConfig.name}'!`
    );
    explorerDataProvider.refresh();
  } catch (err: any) {
    vscode.window.showErrorMessage(`Snapshot failed: ${err.message}`);
  }
}

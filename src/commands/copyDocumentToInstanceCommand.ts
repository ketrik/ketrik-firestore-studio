import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { DocumentItem, DocumentFieldItem } from "../explorer/items";
import { ConnectionManager, FirestoreConnectionConfig } from "../connections/ConnectionManager";
import { DocumentFileSystemProvider } from "../editor/DocumentFileSystemProvider";
import ExplorerDataProvider from "../explorer/ExplorerDataProvider";
import { LocalJsonService } from "../services/LocalJsonService";
import { QueryDocumentSnapshot } from "firebase-admin/firestore";
import { reviveTimestamps } from "../utils/timestampUtils";
import { SnapshotSyncService } from "../services/SnapshotSyncService";
import { scheme } from "../constants";
import openPath from "./openPath";

/**
 * Execute an asynchronous Firestore operation with automatic retry on transient gRPC errors.
 * Handles DEADLINE_EXCEEDED (code 4), UNAVAILABLE (code 14), and RESOURCE_EXHAUSTED (code 8).
 */
async function executeWithRetry<T>(
  operation: () => Promise<T>,
  maxRetries = 3,
  baseDelayMs = 1500
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await operation();
    } catch (err: any) {
      attempt++;
      const msg = err?.message || String(err);
      const isTransient =
        err?.code === 4 || // DEADLINE_EXCEEDED
        err?.code === 14 || // UNAVAILABLE
        err?.code === 8 || // RESOURCE_EXHAUSTED
        /DEADLINE_EXCEEDED/i.test(msg) ||
        /UNAVAILABLE/i.test(msg) ||
        /RESOURCE_EXHAUSTED/i.test(msg) ||
        /ETIMEDOUT/i.test(msg) ||
        /ECONNRESET/i.test(msg);

      if (!isTransient || attempt >= maxRetries) {
        throw err;
      }

      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * attempt));
    }
  }
}

/**
 * Safe adaptive chunked WriteBatch manager.
 * Limits both the number of operations (e.g. 10 - 50) and the total JSON payload byte size
 * to stay safely within Firestore's 10MB write limit and prevent 60-second gRPC DEADLINE_EXCEEDED.
 */
class BatchWriter {
  private _batch: FirebaseFirestore.WriteBatch;
  private _opCount = 0;
  private _approxBytes = 0;
  private readonly _limit: number;
  private readonly _byteLimit = 2 * 1024 * 1024; // 2MB safe chunk limit

  constructor(
    private _firestore: FirebaseFirestore.Firestore,
    batchSize = 25
  ) {
    this._limit = Math.max(1, Math.min(batchSize, 400));
    this._batch = this._firestore.batch();
  }

  private _estimateBytes(data: any): number {
    try {
      if (typeof data === "string") return data.length;
      return JSON.stringify(data).length;
    } catch {
      return 1024;
    }
  }

  public async set(
    ref: FirebaseFirestore.DocumentReference,
    data: any,
    options: { merge?: boolean }
  ): Promise<void> {
    const docBytes = this._estimateBytes(data);

    // If adding this document would exceed 2MB or count limit, flush existing operations first
    if (this._opCount > 0 && (this._opCount >= this._limit || this._approxBytes + docBytes > this._byteLimit)) {
      await this.flush();
    }

    this._batch.set(ref, data, options);
    this._opCount++;
    this._approxBytes += docBytes;

    // If batch reached count limit or payload limit, flush immediately
    if (this._opCount >= this._limit || this._approxBytes >= this._byteLimit) {
      await this.flush();
    }
  }

  public async flush(): Promise<void> {
    if (this._opCount > 0) {
      const batchToCommit = this._batch;
      // Reset immediately before await to prevent double commits
      this._opCount = 0;
      this._approxBytes = 0;
      this._batch = this._firestore.batch();

      await executeWithRetry(async () => {
        await batchToCommit.commit();
      });
    }
  }
}

/**
 * Recursively copies all subcollections and their documents from sourceDoc to targetDoc in Firestore.
 * Uses small query pages (e.g. 25 docs) to avoid gRPC read timeouts on large documents.
 * If allowedSubcollections is provided, only those top-level subcollections will be traversed.
 */
async function copyFirestoreDocHierarchy(
  sourceDocRef: FirebaseFirestore.DocumentReference,
  targetDocRef: FirebaseFirestore.DocumentReference,
  batchWriter: BatchWriter,
  merge: boolean,
  pageSize: number,
  token: vscode.CancellationToken,
  onDocCopied: (path: string) => void,
  onSubCollFound: (id: string) => void,
  allowedSubcollections?: string[]
): Promise<void> {
  if (token.isCancellationRequested) return;

  try {
    const subcollections = await executeWithRetry(async () => {
      return await sourceDocRef.listCollections();
    });

    for (const subColl of subcollections) {
      if (token.isCancellationRequested) break;
      if (allowedSubcollections && !allowedSubcollections.includes(subColl.id)) {
        continue;
      }
      onSubCollFound(subColl.id);
      const targetSubColl = targetDocRef.collection(subColl.id);

      let lastDoc: QueryDocumentSnapshot | null = null;
      let hasMore = true;

      while (hasMore && !token.isCancellationRequested) {
        let q = subColl.limit(pageSize);
        if (lastDoc) {
          q = q.startAfter(lastDoc);
        }

        const snap = await executeWithRetry(async () => {
          return await q.get();
        });

        if (snap.empty) break;

        for (const childDoc of snap.docs) {
          if (token.isCancellationRequested) break;
          const targetChildDoc = targetSubColl.doc(childDoc.id);
          await batchWriter.set(targetChildDoc, reviveTimestamps(childDoc.data()), { merge });
          onDocCopied(targetChildDoc.path);

          // Deep recursion: copy nested subcollections if childDoc has any (unfiltered for child docs)
          await copyFirestoreDocHierarchy(
            childDoc.ref,
            targetChildDoc,
            batchWriter,
            merge,
            pageSize,
            token,
            onDocCopied,
            onSubCollFound
          );
        }

        lastDoc = snap.docs[snap.docs.length - 1];
        if (snap.docs.length < pageSize) hasMore = false;
      }
    }
  } catch {
    // Graceful fallback if listing collections lacks permissions
  }
}

/**
 * Recursively copies subcollections from Firestore to Local JSON.
 * If allowedSubcollections is provided, only those top-level subcollections will be traversed.
 */
async function copyFirestoreDocToLocalHierarchy(
  sourceDocRef: FirebaseFirestore.DocumentReference,
  targetConn: FirestoreConnectionConfig,
  targetDocPath: string,
  pageSize: number,
  token: vscode.CancellationToken,
  onDocCopied: (path: string) => void,
  onSubCollFound: (id: string) => void,
  allowedSubcollections?: string[]
): Promise<void> {
  if (token.isCancellationRequested) return;

  try {
    const subcollections = await executeWithRetry(async () => {
      return await sourceDocRef.listCollections();
    });

    for (const subColl of subcollections) {
      if (token.isCancellationRequested) break;
      if (allowedSubcollections && !allowedSubcollections.includes(subColl.id)) {
        continue;
      }
      onSubCollFound(subColl.id);

      let lastDoc: QueryDocumentSnapshot | null = null;
      let hasMore = true;

      while (hasMore && !token.isCancellationRequested) {
        let q = subColl.limit(pageSize);
        if (lastDoc) {
          q = q.startAfter(lastDoc);
        }

        const snap = await executeWithRetry(async () => {
          return await q.get();
        });

        if (snap.empty) break;

        for (const childDoc of snap.docs) {
          if (token.isCancellationRequested) break;
          const childTargetPath = `${targetDocPath}/${subColl.id}/${childDoc.id}`;
          LocalJsonService.getInstance().setDocument(targetConn, childTargetPath, childDoc.data());
          onDocCopied(childTargetPath);

          await copyFirestoreDocToLocalHierarchy(
            childDoc.ref,
            targetConn,
            childTargetPath,
            pageSize,
            token,
            onDocCopied,
            onSubCollFound
          );
        }

        lastDoc = snap.docs[snap.docs.length - 1];
        if (snap.docs.length < pageSize) hasMore = false;
      }
    }
  } catch {}
}

/**
 * Copies local directory-mode subcollections to Firestore.
 * If allowedSubcollections is provided, only those top-level subcollections will be traversed.
 */
async function copyLocalSubcollectionsToFirestore(
  sourceConn: FirestoreConnectionConfig,
  targetDocRef: FirebaseFirestore.DocumentReference,
  sourceDocPath: string,
  batchWriter: BatchWriter,
  merge: boolean,
  token: vscode.CancellationToken,
  onDocCopied: (path: string) => void,
  onSubCollFound: (id: string) => void,
  allowedSubcollections?: string[]
): Promise<void> {
  if (token.isCancellationRequested || !sourceConn.localJsonPath) return;

  const docDir = path.join(sourceConn.localJsonPath, sourceDocPath);
  if (!fs.existsSync(docDir) || !fs.statSync(docDir).isDirectory()) return;

  try {
    const entries = fs.readdirSync(docDir, { withFileTypes: true });
    for (const entry of entries) {
      if (token.isCancellationRequested) break;

      if (entry.isFile() && entry.name.endsWith(".json")) {
        const subCollId = entry.name.slice(0, -5);
        if (allowedSubcollections && !allowedSubcollections.includes(subCollId)) {
          continue;
        }
        onSubCollFound(subCollId);
        const subCollRef = targetDocRef.collection(subCollId);
        const filePath = path.join(docDir, entry.name);
        try {
          const content = JSON.parse(fs.readFileSync(filePath, "utf8"));
          if (content && typeof content === "object") {
            for (const [childId, childData] of Object.entries(content)) {
              if (token.isCancellationRequested) break;
              const childDocRef = subCollRef.doc(childId);
              await batchWriter.set(childDocRef, reviveTimestamps(childData), { merge });
              onDocCopied(childDocRef.path);
            }
          }
        } catch {}
      } else if (entry.isDirectory()) {
        const subCollId = entry.name;
        if (allowedSubcollections && !allowedSubcollections.includes(subCollId)) {
          continue;
        }
        onSubCollFound(subCollId);
        const subCollRef = targetDocRef.collection(subCollId);
        const subDirPath = path.join(docDir, entry.name);
        const subFiles = fs.readdirSync(subDirPath);
        for (const sf of subFiles) {
          if (token.isCancellationRequested) break;
          if (sf.endsWith(".json")) {
            const childId = sf.slice(0, -5);
            try {
              const childData = JSON.parse(fs.readFileSync(path.join(subDirPath, sf), "utf8"));
              const childDocRef = subCollRef.doc(childId);
              await batchWriter.set(childDocRef, reviveTimestamps(childData), { merge });
              onDocCopied(childDocRef.path);
            } catch {}
          }
        }
      }
    }
  } catch {}
}

/**
 * Command: Copy a Document with optional recursive subcollections to another instance or within the same instance.
 * Supports cross-substrate migration: Cloud Firestore, Local Emulators, and Local JSON stores.
 */
export async function copyDocumentToInstanceCommand(
  target?: DocumentItem | DocumentFieldItem | vscode.Uri,
  explorerDataProvider?: ExplorerDataProvider
): Promise<void> {
  const connectionManager = ConnectionManager.getInstance();
  const connections = connectionManager.getConnections();

  if (connections.length === 0) {
    vscode.window.showWarningMessage("No Firestore connections configured. Please add one first.");
    return;
  }

  // 1. Resolve source connection and source document path
  let sourceConnId: string | undefined;
  let sourceDocPath: string | undefined;

  if (
    target instanceof DocumentFieldItem ||
    (target && typeof target === "object" && "parentDocRef" in target && "fieldName" in target)
  ) {
    const fieldItem = target as DocumentFieldItem;
    sourceConnId = fieldItem.connectionId;
    sourceDocPath = fieldItem.parentDocRef?.path;
  } else if (
    target instanceof DocumentItem ||
    (target && typeof target === "object" && ("reference" in target || "documentId" in target) && "connectionId" in target)
  ) {
    const docItem = target as any;
    sourceConnId = docItem.connectionId;
    sourceDocPath = docItem.reference?.path;
  } else if (target instanceof vscode.Uri) {
    if (target.scheme === scheme) {
      const parsed = DocumentFileSystemProvider.getInstance().parseUri(target);
      sourceConnId = parsed.connectionId;
      sourceDocPath = parsed.docPath;
    } else if (target.scheme === "file") {
      const binding = SnapshotSyncService.getInstance().getBinding(target);
      if (binding) {
        sourceConnId = binding.connectionId;
        sourceDocPath = binding.docPath;
      }
    }
  } else if (!target && vscode.window.activeTextEditor) {
    // Only fall back to activeTextEditor when no target was passed (e.g. invoked via Command Palette)
    const activeUri = vscode.window.activeTextEditor.document.uri;
    if (activeUri.scheme === scheme) {
      const parsed = DocumentFileSystemProvider.getInstance().parseUri(activeUri);
      sourceConnId = parsed.connectionId;
      sourceDocPath = parsed.docPath;
    } else if (activeUri.scheme === "file") {
      const binding = SnapshotSyncService.getInstance().getBinding(activeUri);
      if (binding) {
        sourceConnId = binding.connectionId;
        sourceDocPath = binding.docPath;
      }
    }
  }

  // Fallback: Prompt for connection if not detected
  if (!sourceConnId) {
    if (connections.length === 1) {
      sourceConnId = connections[0].id;
    } else {
      const connPick = await vscode.window.showQuickPick(
        connections.map((c) => ({
          label: `$(database) ${c.name}`,
          description: c.isLocalJson
            ? `Local JSON (${c.localJsonPath})`
            : c.isEmulator
            ? `Emulator (${c.emulatorHost})`
            : c.projectId || "Cloud",
          config: c,
        })),
        { title: "Select Source Firestore Connection" }
      );
      if (!connPick) return;
      sourceConnId = connPick.config.id;
    }
  }

  // Fallback: Prompt for document path if not detected
  if (!sourceDocPath) {
    const pathInput = await vscode.window.showInputBox({
      title: "Source Document Path",
      prompt: "Enter Firestore document path to copy (e.g. dashboard/navigation)",
      placeHolder: "collection/documentId",
      validateInput: (v) => {
        if (!v || !v.trim()) return "Document path cannot be empty";
        const parts = v.trim().replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
        if (parts.length % 2 !== 0) {
          return "Path must point to a document (even number of segments, e.g. collection/doc)";
        }
        return null;
      },
    });
    if (!pathInput) return;
    sourceDocPath = pathInput.trim().replace(/^\/+|\/+$/g, "");
  }

  const sourceConn = connectionManager.getConnection(sourceConnId);
  if (!sourceConn) {
    vscode.window.showErrorMessage(`Source connection '${sourceConnId}' not found.`);
    return;
  }

  // 2. Select destination connection
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
      title: `Copy Document '${sourceDocPath}' to Destination Instance`,
      placeHolder: "Select destination Firebase / Firestore / Emulator database",
    }
  );

  if (!targetPick) return;
  const targetConn = targetPick.config;
  const isSameConnection = targetConn.id === sourceConnId;

  // 3. Discover available destination collections
  let targetCollections: string[] = [];
  if (targetConn.isLocalJson) {
    try {
      targetCollections = LocalJsonService.getInstance().listCollections(targetConn);
    } catch {}
  } else {
    try {
      const targetFirestore = await connectionManager.getFirestore(targetConn.id);
      const refs = await targetFirestore.listCollections();
      targetCollections = refs.map((r) => r.id);
    } catch {}
  }

  const segments = sourceDocPath.split("/").filter(Boolean);
  const sourceParentColl = segments.slice(0, -1).join("/");
  const docId = segments[segments.length - 1];

  // Pick or specify destination collection
  let destCollection = sourceParentColl;

  const collectionPickItems: vscode.QuickPickItem[] = [];
  // Option to keep original parent collection
  collectionPickItems.push({
    label: `$(folder) ${sourceParentColl}`,
    description: "Same collection as source document",
  });

  // Other available root collections in target connection
  for (const coll of targetCollections) {
    if (coll !== sourceParentColl) {
      collectionPickItems.push({
        label: `$(folder) ${coll}`,
        description: "Existing collection in destination instance",
      });
    }
  }

  // Custom / new collection option
  collectionPickItems.push({
    label: "$(add) Enter custom collection path...",
    description: "Specify any new root collection or subcollection path",
  });

  const collPick = await vscode.window.showQuickPick(collectionPickItems, {
    title: `Select Destination Collection in '${targetConn.name}'`,
    placeHolder: `Target collection for document '${docId}'`,
  });

  if (!collPick) return;

  if (collPick.label === "$(add) Enter custom collection path...") {
    const customCollInput = await vscode.window.showInputBox({
      title: "Enter Destination Collection Path",
      prompt: "Enter collection or subcollection path (e.g. users or tenants/corp/users)",
      value: sourceParentColl,
      validateInput: (v) => {
        if (!v || !v.trim()) return "Collection path cannot be empty";
        const parts = v.trim().replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
        if (parts.length % 2 === 0) {
          return "Path must point to a collection (odd number of segments, e.g. collection or parentDoc/subCollection)";
        }
        return null;
      },
    });
    if (!customCollInput) return;
    destCollection = customCollInput.trim().replace(/^\/+|\/+$/g, "");
  } else {
    // Extract collection name from label
    destCollection = collPick.label.replace(/^\$\([a-zA-Z-]+\)\s*/, "").trim();
  }

  // 4. Destination document ID input
  const defaultTargetDocId = (isSameConnection && destCollection === sourceParentColl)
    ? `${docId}_copy`
    : docId;

  const docIdInput = await vscode.window.showInputBox({
    title: "Destination Document ID",
    prompt: `Enter Document ID in collection '${destCollection}'`,
    value: defaultTargetDocId,
    validateInput: (v) => {
      if (!v || !v.trim()) return "Document ID cannot be empty";
      if (v.includes("/")) return "Document ID cannot contain slashes '/'";
      if (isSameConnection && destCollection === sourceParentColl && v.trim() === docId) {
        return "Target document ID must be different when copying to the exact same collection and instance";
      }
      return null;
    },
  });

  if (!docIdInput) return;
  const targetDocPath = `${destCollection}/${docIdInput.trim()}`;

  // 5. Discover subcollections on source document
  let discoveredSubcollections: string[] = [];
  if (sourceConn.isLocalJson) {
    if (sourceConn.localJsonPath) {
      const docDir = path.join(sourceConn.localJsonPath, sourceDocPath);
      if (fs.existsSync(docDir) && fs.statSync(docDir).isDirectory()) {
        try {
          const entries = fs.readdirSync(docDir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isFile() && entry.name.endsWith(".json")) {
              discoveredSubcollections.push(entry.name.slice(0, -5));
            } else if (entry.isDirectory()) {
              discoveredSubcollections.push(entry.name);
            }
          }
        } catch {}
      }
    }
  } else {
    try {
      const sourceFirestore = await connectionManager.getFirestore(sourceConn.id);
      const subRefs = await sourceFirestore.doc(sourceDocPath).listCollections();
      discoveredSubcollections = subRefs.map((r) => r.id);
    } catch {}
  }

  // 6. Subcollection depth & selection strategy
  let deep = false;
  let allowedSubcollections: string[] | undefined = undefined;

  const depthPickItems = [
    {
      label: "$(file) Document Fields Only",
      description: "Copy only root document fields without subcollections",
      strategy: "none",
    },
    {
      label: "$(checklist) Select Specific Subcollections...",
      description: discoveredSubcollections.length > 0
        ? `Pick from ${discoveredSubcollections.length} detected subcollection(s)`
        : "Choose or enter subcollection names to copy",
      strategy: "select",
    },
    {
      label: "$(repo-forked) Deep Copy (All Subcollections)",
      description: "Recursively copy document plus all nested subcollections & child documents",
      strategy: "all",
    },
  ];

  const depthPick = await vscode.window.showQuickPick(depthPickItems, {
    title: "Subcollections to Copy",
    placeHolder: "Choose whether and which subcollections to copy along with the document",
  });

  if (!depthPick) return;

  if (depthPick.strategy === "all") {
    deep = true;
    allowedSubcollections = undefined; // copy all
  } else if (depthPick.strategy === "select") {
    deep = true;
    if (discoveredSubcollections.length > 0) {
      const subPickItems = discoveredSubcollections.map((name) => ({
        label: `$(folder) ${name}`,
        subCollId: name,
        picked: true,
      }));

      const selectedSubPicks = await vscode.window.showQuickPick(subPickItems, {
        title: `Select Subcollections to Copy from '${sourceDocPath}'`,
        placeHolder: "Select subcollections to include (Space to toggle)",
        canPickMany: true,
      });

      if (!selectedSubPicks || selectedSubPicks.length === 0) {
        vscode.window.showInformationMessage("No subcollections selected. Copying document fields only.");
        deep = false;
      } else {
        allowedSubcollections = selectedSubPicks.map((p) => p.subCollId);
      }
    } else {
      const customSubInput = await vscode.window.showInputBox({
        title: "Subcollections to Copy",
        prompt: "Enter comma-separated subcollection names to copy (e.g. orders, logs, history)",
        placeHolder: "orders, logs",
      });
      if (!customSubInput || !customSubInput.trim()) {
        deep = false;
      } else {
        allowedSubcollections = customSubInput
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      }
    }
  } else {
    deep = false;
  }

  // 7. Write strategy: Merge/Patch vs Overwrite
  const strategyPick = await vscode.window.showQuickPick(
    [
      {
        label: "$(git-merge) Merge / Patch",
        description: "Preserve other fields on existing target document(s)",
        merge: true,
      },
      {
        label: "$(replace) Overwrite (Set)",
        description: "Replace target document contents completely",
        merge: false,
      },
    ],
    {
      title: "Write Strategy",
      placeHolder: "Select write strategy for existing destination documents",
    }
  );

  if (!strategyPick) return;

  // 6. Batch Size & Quota Safety
  let batchSize = 25;
  const batchPick = await vscode.window.showQuickPick(
    [
      {
        label: "$(shield) Safe / Large Documents (25 docs / batch)",
        description: "Recommended: Prevents gRPC 60s DEADLINE_EXCEEDED when docs contain large JSON payloads",
        size: 25,
      },
      {
        label: "$(package) Conservative (10 docs / batch)",
        description: "For very heavy documents (hundreds of KB to near 1MB Firestore limit)",
        size: 10,
      },
      {
        label: "$(rocket) Standard (50 docs / batch)",
        description: "Faster throughput for collections with small-to-medium documents",
        size: 50,
      },
      {
        label: "$(edit) Custom Batch Size...",
        description: "Specify a custom number of documents per batch and query page",
        size: -1,
      },
    ],
    {
      title: "Batch Size & Quota Safety",
      placeHolder: "Select batch chunk size for reading and writing",
    }
  );

  if (!batchPick) return;

  if (batchPick.size === -1) {
    const customInput = await vscode.window.showInputBox({
      title: "Custom Batch Size",
      prompt: "Enter number of documents per batch (1 - 100)",
      value: "20",
      validateInput: (v) => {
        const n = parseInt(v, 10);
        if (isNaN(n) || n < 1 || n > 200) return "Please enter a number between 1 and 200";
        return null;
      },
    });
    if (!customInput) return;
    batchSize = parseInt(customInput, 10);
  } else {
    batchSize = batchPick.size;
  }

  // 8. Confirmation dialog
  const depthNotice = !deep
    ? "(document fields only)"
    : allowedSubcollections && allowedSubcollections.length > 0
    ? `including ${allowedSubcollections.length} selected subcollection(s): [${allowedSubcollections.join(", ")}]`
    : "and ALL nested subcollections";
  const confirm = await vscode.window.showWarningMessage(
    `Copy document '${sourceDocPath}' ${depthNotice} from '${sourceConn.name}' to '${targetConn.name}' at '${targetDocPath}' (batch size: ${batchSize})?`,
    { modal: true },
    "Proceed with Copy"
  );

  if (confirm !== "Proceed with Copy") return;

  // 9. Execute copy with progress indicator
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Copying '${sourceDocPath}' to '${targetConn.name}/${targetDocPath}'...`,
      cancellable: true,
    },
    async (progress, token) => {
      try {
        let copiedDocsCount = 0;
        let subCollSet = new Set<string>();

        const onDocCopied = (_p: string) => {
          copiedDocsCount++;
          progress.report({
            message: `${copiedDocsCount} doc(s) copied (${subCollSet.size} subcollections)...`,
          });
        };

        const onSubCollFound = (id: string) => {
          subCollSet.add(id);
        };

        if (sourceConn.isLocalJson) {
          // ── Case A: Source is Local JSON ─────────────────────────────────────
          const sourceData = LocalJsonService.getInstance().getDocument(sourceConn, sourceDocPath);
          if (!sourceData) {
            vscode.window.showErrorMessage(`Source local document '${sourceDocPath}' not found.`);
            return;
          }

          if (targetConn.isLocalJson) {
            // Local JSON -> Local JSON
            LocalJsonService.getInstance().setDocument(targetConn, targetDocPath, sourceData);
            onDocCopied(targetDocPath);
          } else {
            // Local JSON -> Firestore / Emulator
            const targetFirestore = await connectionManager.getFirestore(targetConn.id);
            const targetDocRef = targetFirestore.doc(targetDocPath);
            const batchWriter = new BatchWriter(targetFirestore, batchSize);

            await batchWriter.set(targetDocRef, reviveTimestamps(sourceData), { merge: strategyPick.merge });
            onDocCopied(targetDocPath);

            if (deep) {
              await copyLocalSubcollectionsToFirestore(
                sourceConn,
                targetDocRef,
                sourceDocPath,
                batchWriter,
                strategyPick.merge,
                token,
                onDocCopied,
                onSubCollFound,
                allowedSubcollections
              );
            }

            await batchWriter.flush();
          }
        } else {
          // ── Case B: Source is Cloud Firestore or Emulator ─────────────────────
          const sourceFirestore = await connectionManager.getFirestore(sourceConn.id);
          const sourceDocRef = sourceFirestore.doc(sourceDocPath);

          const sourceSnap = await executeWithRetry(async () => {
            return await sourceDocRef.get();
          });

          if (!sourceSnap.exists && !deep) {
            vscode.window.showErrorMessage(`Source document '${sourceDocPath}' does not exist in '${sourceConn.name}'.`);
            return;
          }

          if (targetConn.isLocalJson) {
            // Firestore -> Local JSON
            if (sourceSnap.exists) {
              LocalJsonService.getInstance().setDocument(
                targetConn,
                targetDocPath,
                sourceSnap.data() || {}
              );
              onDocCopied(targetDocPath);
            }

            if (deep) {
              await copyFirestoreDocToLocalHierarchy(
                sourceDocRef,
                targetConn,
                targetDocPath,
                batchSize,
                token,
                onDocCopied,
                onSubCollFound,
                allowedSubcollections
              );
            }
          } else {
            // Firestore -> Firestore (Cloud/Emulator -> Cloud/Emulator)
            const targetFirestore = await connectionManager.getFirestore(targetConn.id);
            const targetDocRef = targetFirestore.doc(targetDocPath);
            const batchWriter = new BatchWriter(targetFirestore, batchSize);

            if (sourceSnap.exists) {
              await batchWriter.set(
                targetDocRef,
                reviveTimestamps(sourceSnap.data() || {}),
                { merge: strategyPick.merge }
              );
              onDocCopied(targetDocPath);
            }

            if (deep) {
              await copyFirestoreDocHierarchy(
                sourceDocRef,
                targetDocRef,
                batchWriter,
                strategyPick.merge,
                batchSize,
                token,
                onDocCopied,
                onSubCollFound,
                allowedSubcollections
              );
            }

            await batchWriter.flush();
          }
        }

        if (token.isCancellationRequested) {
          vscode.window.showWarningMessage(`Document copy stopped. ${copiedDocsCount} document(s) copied.`);
          return;
        }

        DocumentFileSystemProvider.getInstance().invalidateAndNotify(targetConn.id, targetDocPath);
        if (explorerDataProvider) {
          explorerDataProvider.refresh();
        }

        const openBtn = "Open Target Document";
        const collSummary = subCollSet.size > 0 ? ` across ${subCollSet.size} subcollection(s)` : "";
        const choice = await vscode.window.showInformationMessage(
          `Successfully copied document '${sourceDocPath}' (${copiedDocsCount} document(s)${collSummary}) from '${sourceConn.name}' to '${targetConn.name}/${targetDocPath}'!`,
          openBtn
        );

        if (choice === openBtn) {
          await openPath(targetDocPath, targetConn.id);
        }
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to copy document: ${err.message}`);
      }
    }
  );
}

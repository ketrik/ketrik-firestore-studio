import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { DocumentFieldItem, DocumentItem } from "../explorer/items";
import { ConnectionManager } from "../connections/ConnectionManager";
import { DocumentFileSystemProvider } from "../editor/DocumentFileSystemProvider";
import { SnapshotSyncService } from "../services/SnapshotSyncService";
import { LocalJsonService } from "../services/LocalJsonService";
import { scheme } from "../constants";
import { FieldPath } from "firebase-admin/firestore";
import { reviveTimestamps } from "../utils/timestampUtils";
import ExplorerDataProvider from "../explorer/ExplorerDataProvider";

/**
 * Helper to resolve nested field value from data object.
 */
function getNestedValue(data: any, fieldPath: string): any {
  if (!data || typeof data !== "object") return undefined;
  if (fieldPath in data) return data[fieldPath];
  const parts = fieldPath.split(".");
  let cur = data;
  for (const p of parts) {
    if (cur && typeof cur === "object" && p in cur) {
      cur = cur[p];
    } else {
      return undefined;
    }
  }
  return cur;
}

/**
 * Command: Open AI Scratchpad (Instant 0-prompt local physical file).
 * Automatically maps to .firestore/<conn>/<path>/[<field>.json] with zero naming overhead.
 * Isolates single fields for 1MB documents to reduce token input by 99%+.
 */
export async function openAiScratchpadCommand(
  target?: DocumentItem | DocumentFieldItem | vscode.Uri
): Promise<void> {
  const connectionManager = ConnectionManager.getInstance();
  const connections = connectionManager.getConnections();

  if (connections.length === 0) {
    vscode.window.showWarningMessage("No Firestore connections configured. Please add one first.");
    return;
  }

  let connectionId: string | undefined;
  let docPath: string | undefined;
  let fieldPath: string | undefined;

  if (target instanceof DocumentFieldItem || (target && typeof target === "object" && "parentDocRef" in target && "fieldName" in target)) {
    const fieldItem = target as DocumentFieldItem;
    connectionId = fieldItem.connectionId;
    docPath = fieldItem.parentDocRef?.path;
    fieldPath = fieldItem.fullFieldPath || fieldItem.fieldName;
  } else if (target instanceof DocumentItem || (target && typeof target === "object" && "reference" in target && "connectionId" in target && !("parentDocRef" in target))) {
    const docItem = target as DocumentItem;
    connectionId = docItem.connectionId;
    docPath = docItem.reference?.path;
  } else if (target instanceof vscode.Uri) {
    if (target.scheme === scheme) {
      const parsed = DocumentFileSystemProvider.getInstance().parseUri(target);
      connectionId = parsed.connectionId;
      docPath = parsed.docPath;
      fieldPath = parsed.fieldPath;
    } else if (target.scheme === "file") {
      const binding = SnapshotSyncService.getInstance().getBinding(target);
      if (binding) {
        connectionId = binding.connectionId;
        docPath = binding.docPath;
        fieldPath = binding.fieldPath;
      }
    }
  } else if (vscode.window.activeTextEditor) {
    const activeUri = vscode.window.activeTextEditor.document.uri;
    if (activeUri.scheme === scheme) {
      const parsed = DocumentFileSystemProvider.getInstance().parseUri(activeUri);
      connectionId = parsed.connectionId;
      docPath = parsed.docPath;
      fieldPath = parsed.fieldPath;
    } else if (activeUri.scheme === "file") {
      const binding = SnapshotSyncService.getInstance().getBinding(activeUri);
      if (binding) {
        connectionId = binding.connectionId;
        docPath = binding.docPath;
        fieldPath = binding.fieldPath;
      }
    }
  }

  if (!connectionId) {
    if (connections.length === 1) {
      connectionId = connections[0].id;
    } else {
      const pick = await vscode.window.showQuickPick(
        connections.map((c) => ({
          label: `$(database) ${c.name}`,
          description: c.id,
          conn: c,
        })),
        { title: "Select Firestore Connection for AI Scratchpad", placeHolder: "Select connection" }
      );
      if (!pick) return;
      connectionId = pick.conn.id;
    }
  }

  if (!docPath) {
    const input = await vscode.window.showInputBox({
      title: "Document Path",
      prompt: "Firestore document path (e.g. registers/navs or users/user123)",
      validateInput: (v) =>
        v && v.trim().split("/").filter(Boolean).length % 2 === 0
          ? null
          : "Path must have an even number of segments (collection/docId)",
    });
    if (!input) return;
    docPath = input.trim();
  }

  const syncService = SnapshotSyncService.getInstance();
  const filePath = syncService.getDeterministicSnapshotPath(connectionId, docPath, fieldPath);

  try {
    let targetData: any;
    const conn = connectionManager.getConnection(connectionId);

    if (conn?.isLocalJson) {
      const fullDoc = LocalJsonService.getInstance().getDocument(conn, docPath) || {};
      targetData = fieldPath ? getNestedValue(fullDoc, fieldPath) : fullDoc;
    } else {
      const firestore = await connectionManager.getFirestore(connectionId);
      const docRef = firestore.doc(docPath);
      const snap = await docRef.get();
      const fullDoc = snap.exists ? snap.data() || {} : {};
      targetData = fieldPath ? getNestedValue(fullDoc, fieldPath) : fullDoc;
    }

    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const jsonText = JSON.stringify(targetData ?? {}, null, 2) + "\n";
    fs.writeFileSync(filePath, jsonText, "utf8");

    syncService.ensureGitignored();

    await syncService.saveBinding({
      filePath,
      connectionId,
      docPath,
      fieldPath,
      lastSyncedAt: Date.now(),
      lastSyncedHash: SnapshotSyncService.computeHash(jsonText),
    });

    const fileUri = vscode.Uri.file(filePath);
    const textDoc = await vscode.workspace.openTextDocument(fileUri);
    await vscode.languages.setTextDocumentLanguage(textDoc, "json");
    await vscode.window.showTextDocument(textDoc, { preview: false });

    const sizeKb = (new TextEncoder().encode(jsonText).length / 1024).toFixed(1);
    const label = fieldPath ? `${docPath}#${fieldPath}` : docPath;
    vscode.window.showInformationMessage(
      `$(sparkle) AI Scratchpad opened for '${label}' (${sizeKb} KB). Edits directly by you or AI will auto-sync to Firestore on save.`
    );
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to open AI Scratchpad: ${err.message}`);
  }
}

/**
 * Command: Unpack a document's top-level fields into separate local files.
 * Perfect for 1MB documents so the AI only reads and edits the exact field needed.
 */
export async function unpackDocumentFieldsCommand(
  target?: DocumentItem | vscode.Uri
): Promise<void> {
  const connectionManager = ConnectionManager.getInstance();
  const connections = connectionManager.getConnections();

  if (connections.length === 0) {
    vscode.window.showWarningMessage("No Firestore connections configured. Please add one first.");
    return;
  }

  let connectionId: string | undefined;
  let docPath: string | undefined;

  if (target instanceof DocumentItem || (target && typeof target === "object" && "reference" in target && "connectionId" in target && !("parentDocRef" in target))) {
    const docItem = target as DocumentItem;
    connectionId = docItem.connectionId;
    docPath = docItem.reference?.path;
  } else if (target instanceof vscode.Uri) {
    if (target.scheme === scheme) {
      const parsed = DocumentFileSystemProvider.getInstance().parseUri(target);
      connectionId = parsed.connectionId;
      docPath = parsed.docPath;
    } else if (target.scheme === "file") {
      const binding = SnapshotSyncService.getInstance().getBinding(target);
      if (binding) {
        connectionId = binding.connectionId;
        docPath = binding.docPath;
      }
    }
  } else if (vscode.window.activeTextEditor) {
    const activeUri = vscode.window.activeTextEditor.document.uri;
    if (activeUri.scheme === scheme) {
      const parsed = DocumentFileSystemProvider.getInstance().parseUri(activeUri);
      connectionId = parsed.connectionId;
      docPath = parsed.docPath;
    } else if (activeUri.scheme === "file") {
      const binding = SnapshotSyncService.getInstance().getBinding(activeUri);
      if (binding) {
        connectionId = binding.connectionId;
        docPath = binding.docPath;
      }
    }
  }

  if (!connectionId || !docPath) {
    vscode.window.showWarningMessage("Please select a document to unpack into field files.");
    return;
  }

  try {
    let docData: Record<string, any> = {};
    const conn = connectionManager.getConnection(connectionId);

    if (conn?.isLocalJson) {
      docData = LocalJsonService.getInstance().getDocument(conn, docPath) || {};
    } else {
      const firestore = await connectionManager.getFirestore(connectionId);
      const snap = await firestore.doc(docPath).get();
      if (!snap.exists) {
        vscode.window.showWarningMessage(`Document '${docPath}' does not exist in Firestore.`);
        return;
      }
      docData = snap.data() || {};
    }

    const fieldKeys = Object.keys(docData);
    if (fieldKeys.length === 0) {
      vscode.window.showInformationMessage(`Document '${docPath}' has no fields to unpack.`);
      return;
    }

    const syncService = SnapshotSyncService.getInstance();
    let firstFileUri: vscode.Uri | undefined;

    for (const key of fieldKeys) {
      const filePath = syncService.getDeterministicSnapshotPath(connectionId, docPath, key);
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const jsonText = JSON.stringify(docData[key] ?? {}, null, 2) + "\n";
      fs.writeFileSync(filePath, jsonText, "utf8");

      await syncService.saveBinding({
        filePath,
        connectionId,
        docPath,
        fieldPath: key,
        lastSyncedAt: Date.now(),
        lastSyncedHash: SnapshotSyncService.computeHash(jsonText),
      });

      if (!firstFileUri) {
        firstFileUri = vscode.Uri.file(filePath);
      }
    }

    syncService.ensureGitignored();

    if (firstFileUri) {
      const doc = await vscode.workspace.openTextDocument(firstFileUri);
      await vscode.window.showTextDocument(doc, { preview: false });
    }

    vscode.window.showInformationMessage(
      `Unpacked ${fieldKeys.length} field files under .firestore/.../${docPath}/. Each field is isolated for AI editing.`
    );
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to unpack fields: ${err.message}`);
  }
}

/**
 * Command: Snapshot a Firestore document to a workspace file (interactive custom destination).
 */
export async function snapshotToWorkspaceCommand(
  target?: DocumentItem | vscode.Uri
): Promise<void> {
  const connectionManager = ConnectionManager.getInstance();
  const connections = connectionManager.getConnections();

  if (connections.length === 0) {
    vscode.window.showWarningMessage("No Firestore connections configured. Please add one first.");
    return;
  }

  let connectionId: string | undefined;
  let docPath: string | undefined;

  if (target instanceof DocumentItem) {
    connectionId = target.connectionId;
    docPath = target.reference.path;
  } else if (target instanceof vscode.Uri) {
    if (target.scheme === scheme) {
      const parsed = DocumentFileSystemProvider.getInstance().parseUri(target);
      connectionId = parsed.connectionId;
      docPath = parsed.docPath;
    }
  } else if (vscode.window.activeTextEditor?.document.uri.scheme === scheme) {
    const parsed = DocumentFileSystemProvider.getInstance().parseUri(
      vscode.window.activeTextEditor.document.uri
    );
    connectionId = parsed.connectionId;
    docPath = parsed.docPath;
  }

  if (!connectionId) {
    if (connections.length === 1) {
      connectionId = connections[0].id;
    } else {
      const pick = await vscode.window.showQuickPick(
        connections.map((c) => ({
          label: `$(database) ${c.name}`,
          description: c.id,
          conn: c,
        })),
        { title: "Select Firestore Connection for Snapshot", placeHolder: "Select connection" }
      );
      if (!pick) return;
      connectionId = pick.conn.id;
    }
  }

  if (!docPath) {
    const input = await vscode.window.showInputBox({
      title: "Document Path to Snapshot",
      prompt: "Enter Firestore document path (e.g. registers/navs or users/user123)",
      validateInput: (v) =>
        v && v.trim().split("/").filter(Boolean).length % 2 === 0
          ? null
          : "Path must have an even number of segments (collection/docId)",
    });
    if (!input) return;
    docPath = input.trim();
  }

  const docId = docPath.split("/").pop() || "document";
  const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const defaultDir = wsRoot ? path.join(wsRoot, "snapshots") : undefined;
  const defaultFilePath = defaultDir
    ? path.join(defaultDir, `${docId}.json`)
    : `${docId}_snapshot.json`;

  const saveUri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(defaultFilePath),
    filters: { "JSON Files": ["json"] },
    title: `Save Snapshot of '${docPath}' to Workspace`,
  });

  if (!saveUri) return;

  try {
    let docData: any = {};
    const conn = connectionManager.getConnection(connectionId);

    if (conn?.isLocalJson) {
      docData = LocalJsonService.getInstance().getDocument(conn, docPath) || {};
    } else {
      const firestore = await connectionManager.getFirestore(connectionId);
      const docRef = firestore.doc(docPath);
      const snap = await docRef.get();
      if (snap.exists) {
        docData = snap.data() || {};
      } else {
        const subcollections = await docRef.listCollections();
        if (subcollections.length === 0) {
          vscode.window.showWarningMessage(
            `Notice: Document '${docPath}' currently does not exist in Firestore. Creating an empty snapshot file.`
          );
        }
      }
    }

    const jsonText = JSON.stringify(docData, null, 2) + "\n";
    const bytes = new TextEncoder().encode(jsonText);
    await vscode.workspace.fs.writeFile(saveUri, bytes);

    await SnapshotSyncService.getInstance().saveBinding({
      filePath: saveUri.fsPath,
      connectionId,
      docPath,
      lastSyncedAt: Date.now(),
      lastSyncedHash: SnapshotSyncService.computeHash(jsonText),
    });

    const textDoc = await vscode.workspace.openTextDocument(saveUri);
    await vscode.languages.setTextDocumentLanguage(textDoc, "json");
    await vscode.window.showTextDocument(textDoc, { preview: false });

    const relPath = vscode.workspace.asRelativePath(saveUri);
    vscode.window
      .showInformationMessage(
        `Saved snapshot to '${relPath}'. Use the toolbar buttons to Push, Pull, or Diff against Firestore.`,
        "Compare with Firestore"
      )
      .then((action) => {
        if (action === "Compare with Firestore") {
          vscode.commands.executeCommand(
            "ketrik-firestore-studio.diffSnapshotWithFirestore",
            saveUri
          );
        }
      });
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to create snapshot: ${err.message}`);
  }
}

/**
 * Command: Diff local snapshot against remote Firestore document or field.
 */
export async function diffSnapshotWithFirestoreCommand(
  targetUri?: vscode.Uri
): Promise<void> {
  const syncService = SnapshotSyncService.getInstance();
  const uri = targetUri || vscode.window.activeTextEditor?.document.uri;

  if (!uri) {
    vscode.window.showWarningMessage("No active document selected to compare.");
    return;
  }

  let binding = syncService.getBinding(uri);
  if (!binding) {
    const bindPrompt = await vscode.window.showWarningMessage(
      `'${path.basename(uri.fsPath)}' is not bound to a Firestore document yet. Would you like to bind it?`,
      "Bind to Firestore Document",
      "Cancel"
    );
    if (bindPrompt === "Bind to Firestore Document") {
      await bindFileToFirestoreCommand(uri);
      binding = syncService.getBinding(uri);
    }
    if (!binding) return;
  }

  const targetPath = binding.fieldPath
    ? `/${binding.docPath}/${encodeURIComponent(binding.fieldPath)}.json`
    : `/${binding.docPath}.json`;

  const remoteUri = vscode.Uri.from({
    scheme,
    authority: binding.connectionId,
    path: targetPath,
  });

  const label = binding.fieldPath ? `${binding.docPath}#${binding.fieldPath}` : binding.docPath;
  const title = `${path.basename(uri.fsPath)} (Remote [${binding.connectionId}] ${label} ↔ Local File)`;
  await vscode.commands.executeCommand("vscode.diff", remoteUri, uri, title);
}

/**
 * Command: Push local snapshot file contents to Firestore.
 */
export async function pushSnapshotToFirestoreCommand(
  targetUri?: vscode.Uri,
  explorerDataProvider?: ExplorerDataProvider,
  silent: boolean = false
): Promise<void> {
  const syncService = SnapshotSyncService.getInstance();
  const uri = targetUri || vscode.window.activeTextEditor?.document.uri;

  if (!uri) {
    if (!silent) vscode.window.showWarningMessage("No active document to push to Firestore.");
    return;
  }

  let binding = syncService.getBinding(uri);
  if (!binding) {
    if (silent) return;
    const bindPrompt = await vscode.window.showWarningMessage(
      `'${path.basename(uri.fsPath)}' is not bound to a Firestore document yet. Would you like to bind it?`,
      "Bind to Firestore Document",
      "Cancel"
    );
    if (bindPrompt === "Bind to Firestore Document") {
      await bindFileToFirestoreCommand(uri);
      binding = syncService.getBinding(uri);
    }
    if (!binding) return;
  }

  const pushConn = ConnectionManager.getInstance().getConnection(binding.connectionId);
  if (pushConn?.readOnly) {
    if (!silent) {
      vscode.window.showErrorMessage(
        `Connection '${pushConn.name}' is in Read-Only mode. Unlock it from the connection context menu to push snapshots.`
      );
    }
    return;
  }

  let rawBytes: Uint8Array;
  try {
    rawBytes = await vscode.workspace.fs.readFile(uri);
  } catch (err: any) {
    if (!silent) vscode.window.showErrorMessage(`Failed to read local snapshot file: ${err.message}`);
    return;
  }

  const rawText = new TextDecoder().decode(rawBytes);
  let parsedData: any;
  try {
    parsedData = JSON.parse(rawText);
  } catch (err: any) {
    if (!silent) vscode.window.showErrorMessage(`Cannot push: Invalid JSON syntax in '${path.basename(uri.fsPath)}': ${err.message}`);
    return;
  }

  const conn = ConnectionManager.getInstance().getConnection(binding.connectionId);
  const connName = conn?.name || binding.connectionId;

  let isMerge = true;
  if (!silent && !binding.fieldPath) {
    const strategy = await vscode.window.showQuickPick(
      [
        {
          label: "$(git-merge) Merge / Patch",
          description: "Update matching fields, preserve untouched remote fields",
          merge: true,
        },
        {
          label: "$(replace) Overwrite (Set)",
          description: "Replace the entire remote document with local snapshot",
          merge: false,
        },
      ],
      {
        title: `Push '${path.basename(uri.fsPath)}' → [${connName}] ${binding.docPath}`,
        placeHolder: "Select write strategy",
      }
    );
    if (!strategy) return;
    isMerge = strategy.merge;
  }

  try {
    if (conn?.isLocalJson) {
      if (binding.fieldPath) {
        LocalJsonService.getInstance().updateField(conn, binding.docPath, binding.fieldPath, parsedData);
      } else {
        LocalJsonService.getInstance().setDocument(conn, binding.docPath, parsedData);
      }
    } else {
      const firestore = await ConnectionManager.getInstance().getFirestore(binding.connectionId);
      const docRef = firestore.doc(binding.docPath);
      const sanitized = reviveTimestamps(parsedData);

      if (binding.fieldPath) {
        const segments = binding.fieldPath.includes(".") ? binding.fieldPath.split(".") : [binding.fieldPath];
        const hasNumericIndex = segments.some((s) => /^\d+$/.test(s));

        if (hasNumericIndex) {
          // Firestore update with numeric segments turns arrays into maps { "0": ... }.
          // Mutate the parent array safely in memory and update the containing array field.
          const docSnap = await docRef.get();
          const docData = docSnap.exists ? docSnap.data() || {} : {};

          let target: any = docData;
          for (let i = 0; i < segments.length - 1; i++) {
            const key = segments[i];
            const nextKey = segments[i + 1];
            if (!target[key] || typeof target[key] !== "object") {
              target[key] = /^\d+$/.test(nextKey) ? [] : {};
            }
            target = target[key];
          }

          const lastKey = segments[segments.length - 1];
          if (Array.isArray(target) && /^\d+$/.test(lastKey)) {
            target[parseInt(lastKey, 10)] = sanitized;
          } else {
            target[lastKey] = sanitized;
          }

          const firstNumericIdx = segments.findIndex((s) => /^\d+$/.test(s));
          if (firstNumericIdx > 0) {
            const arrayParentSegments = segments.slice(0, firstNumericIdx);
            let arrayVal: any = docData;
            for (const seg of arrayParentSegments) {
              arrayVal = arrayVal?.[seg];
            }
            await docRef.update(new FieldPath(...arrayParentSegments), arrayVal);
          } else {
            await docRef.set(docData, { merge: true });
          }
        } else {
          await docRef.update(new FieldPath(...segments), sanitized);
        }
      } else {
        await docRef.set(sanitized, { merge: isMerge });
      }
    }

    DocumentFileSystemProvider.getInstance().invalidateAndNotify(binding.connectionId, binding.docPath);

    binding.lastSyncedAt = Date.now();
    binding.lastSyncedHash = SnapshotSyncService.computeHash(rawText);
    await syncService.saveBinding(binding);

    if (explorerDataProvider) {
      explorerDataProvider.refresh();
    }

    const label = binding.fieldPath ? `${binding.docPath}#${binding.fieldPath}` : binding.docPath;
    if (silent) {
      vscode.window.setStatusBarMessage(`$(check) Synced ${path.basename(uri.fsPath)} to [${connName}] ${label}`, 3000);
    } else {
      vscode.window.showInformationMessage(
        `Successfully pushed '${path.basename(uri.fsPath)}' to '[${connName}] ${label}'.`
      );
    }
  } catch (err: any) {
    if (!silent) {
      vscode.window.showErrorMessage(`Failed to push to Firestore: ${err.message}`);
    } else {
      vscode.window.showWarningMessage(`Auto-sync failed for '${path.basename(uri.fsPath)}': ${err.message}`);
    }
  }
}

/**
 * Command: Pull latest document data from Firestore into local snapshot.
 */
export async function pullSnapshotFromFirestoreCommand(
  targetUri?: vscode.Uri
): Promise<void> {
  const syncService = SnapshotSyncService.getInstance();
  const uri = targetUri || vscode.window.activeTextEditor?.document.uri;

  if (!uri) {
    vscode.window.showWarningMessage("No active document to pull for.");
    return;
  }

  const binding = syncService.getBinding(uri);
  if (!binding) {
    vscode.window.showWarningMessage(`'${path.basename(uri.fsPath)}' is not bound to a Firestore document.`);
    return;
  }

  // Check if local file has unpushed changes
  try {
    const currentBytes = await vscode.workspace.fs.readFile(uri);
    const currentText = new TextDecoder().decode(currentBytes);
    const currentHash = SnapshotSyncService.computeHash(currentText);

    if (binding.lastSyncedHash && currentHash !== binding.lastSyncedHash) {
      const confirm = await vscode.window.showWarningMessage(
        `Local file '${path.basename(uri.fsPath)}' contains edits that have not been pushed. Pulling from Firestore will overwrite them.`,
        { modal: true },
        "Overwrite Local File",
        "Compare Diff First",
        "Cancel"
      );

      if (confirm === "Compare Diff First") {
        await diffSnapshotWithFirestoreCommand(uri);
        return;
      }
      if (confirm !== "Overwrite Local File") {
        return;
      }
    }
  } catch {}

  const conn = ConnectionManager.getInstance().getConnection(binding.connectionId);
  const connName = conn?.name || binding.connectionId;

  try {
    let targetData: any = {};
    if (conn?.isLocalJson) {
      const fullDoc = LocalJsonService.getInstance().getDocument(conn, binding.docPath) || {};
      targetData = binding.fieldPath ? getNestedValue(fullDoc, binding.fieldPath) : fullDoc;
    } else {
      const firestore = await ConnectionManager.getInstance().getFirestore(binding.connectionId);
      const docRef = firestore.doc(binding.docPath);
      const snap = await docRef.get();
      if (!snap.exists) {
        vscode.window.showWarningMessage(
          `Document '${binding.docPath}' does not exist in Firestore database '[${connName}]'.`
        );
        return;
      }
      const fullDoc = snap.data() || {};
      targetData = binding.fieldPath ? getNestedValue(fullDoc, binding.fieldPath) : fullDoc;
    }

    const jsonText = JSON.stringify(targetData ?? {}, null, 2) + "\n";
    const bytes = new TextEncoder().encode(jsonText);
    await vscode.workspace.fs.writeFile(uri, bytes);

    binding.lastSyncedAt = Date.now();
    binding.lastSyncedHash = SnapshotSyncService.computeHash(jsonText);
    await syncService.saveBinding(binding);

    const label = binding.fieldPath ? `${binding.docPath}#${binding.fieldPath}` : binding.docPath;
    vscode.window.showInformationMessage(
      `Updated '${path.basename(uri.fsPath)}' with latest data from '[${connName}] ${label}'.`
    );
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to pull from Firestore: ${err.message}`);
  }
}

/**
 * Command: Bind any local JSON file to a Firestore document.
 */
export async function bindFileToFirestoreCommand(
  targetUri?: vscode.Uri
): Promise<void> {
  const uri = targetUri || vscode.window.activeTextEditor?.document.uri;
  if (!uri || uri.scheme !== "file") {
    vscode.window.showWarningMessage("Please select a local JSON file to bind.");
    return;
  }

  const connections = ConnectionManager.getInstance().getConnections();
  if (connections.length === 0) {
    vscode.window.showWarningMessage("No Firestore connections configured. Please add one first.");
    return;
  }

  let connectionId: string;
  if (connections.length === 1) {
    connectionId = connections[0].id;
  } else {
    const pick = await vscode.window.showQuickPick(
      connections.map((c) => ({
        label: `$(database) ${c.name}`,
        description: c.id,
        conn: c,
      })),
      { title: `Bind '${path.basename(uri.fsPath)}' to Connection`, placeHolder: "Select connection" }
    );
    if (!pick) return;
    connectionId = pick.conn.id;
  }

  const input = await vscode.window.showInputBox({
    title: "Target Document Path",
    prompt: `Firestore document path (and optional field like registers/navs#sidebar_finance)`,
    placeHolder: "collection/docId or collection/docId#field",
  });

  if (!input) return;
  const rawInput = input.trim();
  let docPath = rawInput;
  let fieldPath: string | undefined;

  if (rawInput.includes("#") || rawInput.includes(":")) {
    const sep = rawInput.includes("#") ? "#" : ":";
    const parts = rawInput.split(sep);
    docPath = parts[0];
    fieldPath = parts[1];
  }

  let initialHash: string | undefined;
  try {
    const currentBytes = await vscode.workspace.fs.readFile(uri);
    initialHash = SnapshotSyncService.computeHash(new TextDecoder().decode(currentBytes));
  } catch {}

  await SnapshotSyncService.getInstance().saveBinding({
    filePath: uri.fsPath,
    connectionId,
    docPath,
    fieldPath,
    lastSyncedAt: Date.now(),
    lastSyncedHash: initialHash,
  });

  const label = fieldPath ? `${docPath}#${fieldPath}` : docPath;
  vscode.window.showInformationMessage(
    `Bound '${path.basename(uri.fsPath)}' to '[${connectionId}] ${label}'. Toolbar sync buttons and auto-sync are now enabled.`
  );
}

/**
 * Command: Unbind a local file from Firestore.
 */
export async function unbindFileFromFirestoreCommand(
  targetUri?: vscode.Uri
): Promise<void> {
  const uri = targetUri || vscode.window.activeTextEditor?.document.uri;
  if (!uri) return;

  const binding = SnapshotSyncService.getInstance().getBinding(uri);
  if (!binding) return;

  const confirm = await vscode.window.showWarningMessage(
    `Unbind '${path.basename(uri.fsPath)}' from Firestore document '${binding.docPath}'?`,
    "Unbind",
    "Cancel"
  );

  if (confirm === "Unbind") {
    await SnapshotSyncService.getInstance().removeBinding(uri);
    vscode.window.showInformationMessage(`Unbound '${path.basename(uri.fsPath)}' from Firestore.`);
  }
}

/**
 * Command: Snapshot actions quick menu (shown on status bar click or palette).
 */
export async function snapshotActionsMenuCommand(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.scheme !== "file") {
    return;
  }

  const uri = editor.document.uri;
  const binding = SnapshotSyncService.getInstance().getBinding(uri);
  if (!binding) return;

  const lastSyncStr = binding.lastSyncedAt
    ? new Date(binding.lastSyncedAt).toLocaleTimeString()
    : "Never";

  const label = binding.fieldPath ? `${binding.docPath}#${binding.fieldPath}` : binding.docPath;

  const pick = await vscode.window.showQuickPick(
    [
      {
        label: "$(diff) Compare with Firestore",
        description: "Open side-by-side diff against live remote document/field",
        action: "diff",
      },
      {
        label: "$(cloud-upload) Push to Firestore",
        description: "Send local changes to remote document/field",
        action: "push",
      },
      {
        label: "$(cloud-download) Pull Latest from Firestore",
        description: "Fetch live data from remote document/field into this file",
        action: "pull",
      },
      {
        label: "$(x) Unbind from Firestore",
        description: `Remove binding to [${binding.connectionId}] ${label}`,
        action: "unbind",
      },
    ],
    {
      title: `Snapshot Sync: ${label} (Last Synced: ${lastSyncStr})`,
      placeHolder: "Select action",
    }
  );

  if (!pick) return;

  switch (pick.action) {
    case "diff":
      await diffSnapshotWithFirestoreCommand(uri);
      break;
    case "push":
      await pushSnapshotToFirestoreCommand(uri);
      break;
    case "pull":
      await pullSnapshotFromFirestoreCommand(uri);
      break;
    case "unbind":
      await unbindFileFromFirestoreCommand(uri);
      break;
  }
}

/**
 * Command: Delete all local .firestore/ scratchpad files and clean up registry.
 */
export async function cleanScratchpadsCommand(): Promise<void> {
  const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!wsRoot) return;

  const firestoreDir = path.join(wsRoot, ".firestore");
  if (!fs.existsSync(firestoreDir)) {
    vscode.window.showInformationMessage("No local .firestore scratchpads found.");
    return;
  }

  const confirm = await vscode.window.showWarningMessage(
    "Are you sure you want to delete all local .firestore scratchpads and clear their bindings?",
    { modal: true },
    "Delete Scratchpads",
    "Cancel"
  );

  if (confirm === "Delete Scratchpads") {
    try {
      fs.rmSync(firestoreDir, { recursive: true, force: true });
      await SnapshotSyncService.getInstance().clearAllBindings();
      vscode.window.showInformationMessage("All local .firestore scratchpads and bindings have been removed.");
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to remove scratchpads: ${err.message}`);
    }
  }
}

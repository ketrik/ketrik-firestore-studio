import * as vscode from "vscode";
import * as fs from "fs";
import { CollectionItem, ConnectionTreeItem, DocumentFieldItem, DocumentItem } from "../explorer/items";
import openPath from "./openPath";
import ExplorerDataProvider from "../explorer/ExplorerDataProvider";
import { DocumentFileSystemProvider } from "../editor/DocumentFileSystemProvider";
import { ConnectionManager } from "../connections/ConnectionManager";
import { DocumentClipboard } from "../services/DocumentClipboard";
import { DocumentCompareService } from "../services/DocumentCompareService";
import { EmulatorService } from "../emulator/EmulatorService";
import { TemplateService } from "../services/TemplateService";
import { LocalJsonService } from "../services/LocalJsonService";
import { CostService } from "../cost/costService";
import { promptAndCleanupOrphanStorageFiles } from "../storage/storageCommands";
import { StorageService } from "../storage/storageService";
import { FieldPath, FieldValue, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { openDocumentAsTable } from "../webview/openDocumentAsTable";
import { SnapshotSyncService } from "../services/SnapshotSyncService";
import { reviveTimestamps } from "../utils/timestampUtils";
import {
  collectSubcollectionStorageSample,
  confirmProductionAction,
  getEnvironmentWarningPrefix,
  recursiveDeleteWithCount,
} from "../utils/deleteUtils";
import { scheme } from "../constants";
import { maybePromptDeleteAuthUserForProfile } from "../auth/authCommands";

/**
 * Direct 1-read document ID lookup.
 */
export async function jumpToDocumentCommand(
  item: CollectionItem,
  explorerDataProvider: ExplorerDataProvider
) {
  if (!item?.collectionId) {
    vscode.window.showErrorMessage("No collection selected.");
    return;
  }

  const docId = await vscode.window.showInputBox({
    prompt: `Jump to Document ID in '${item.collectionId}'`,
    placeHolder: "Enter Document ID (e.g. user_123, msg_abc)",
    validateInput: (v) => (v.trim() ? undefined : "Document ID cannot be empty"),
  });

  if (!docId) {
    return;
  }

  const trimmedId = docId.trim();
  const conn = ConnectionManager.getInstance().getConnection(item.connectionId);

  if (conn?.isLocalJson) {
    const colPath = item.reference?.path || item.collectionId;
    const docPath = `${colPath}/${trimmedId}`;
    const doc = LocalJsonService.getInstance().getDocument(conn, docPath);
    if (!doc) {
      const createChoice = await vscode.window.showWarningMessage(
        `Document '${trimmedId}' does not exist in local collection '${colPath}'. Would you like to create it?`,
        "Create",
        "Cancel"
      );
      if (createChoice === "Create") {
        if (!ConnectionManager.getInstance().ensureWritable(item.connectionId, "create document")) {
          return;
        }
        LocalJsonService.getInstance().setDocument(conn, docPath, {});
        DocumentFileSystemProvider.getInstance().invalidateAndNotify(item.connectionId, docPath);
        await openPath(docPath, item.connectionId);
        explorerDataProvider.refreshNode(item);
      }
      return;
    }
    await openPath(docPath, item.connectionId);
    return;
  }

  try {
    const docRef = item.reference.doc(trimmedId);
    const snapshot = await docRef.get();
    if (!snapshot.exists) {
      try {
        const subcollections = await docRef.listCollections();
        if (subcollections.length > 0) {
          await openPath(docRef.path, item.connectionId);
          return;
        }
      } catch { }

      const createChoice = await vscode.window.showWarningMessage(
        `Document '${trimmedId}' does not exist in collection '${item.collectionId}'. Would you like to create it?`,
        "Create",
        "Cancel"
      );
      if (createChoice === "Create") {
        if (!ConnectionManager.getInstance().ensureWritable(item.connectionId, "create document")) {
          return;
        }
        await docRef.set({});
        DocumentFileSystemProvider.getInstance().invalidateAndNotify(item.connectionId, docRef.path);
        await openPath(docRef.path, item.connectionId);
        explorerDataProvider.refreshNode(item);
      }
      return;
    }

    await openPath(docRef.path, item.connectionId);
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to retrieve document: ${err.message}`);
  }
}

/**
 * Create a new document in the collection using templates or manual JSON.
 */
export async function createDocumentCommand(
  item: CollectionItem,
  explorerDataProvider: ExplorerDataProvider
) {
  if (!item?.collectionId) {
    vscode.window.showErrorMessage("No collection selected.");
    return;
  }

  if (!ConnectionManager.getInstance().ensureWritable(item.connectionId, "create documents")) {
    return;
  }
  const conn = ConnectionManager.getInstance().getConnection(item.connectionId);

  const docId = await vscode.window.showInputBox({
    prompt: "Enter Document ID (leave blank for auto-generated ID)",
    placeHolder: "Document ID",
  });

  const templates = TemplateService.getInstance().getTemplates();
  let data: any;

  if (templates.length > 0) {
    const picked = await vscode.window.showQuickPick(
      templates.map((t) => t.label),
      { placeHolder: "Select a template or ESC to enter JSON manually" }
    );

    if (picked) {
      data = templates.find((t) => t.label === picked)?.data;
    }
  }

  if (!data) {
    const json = await vscode.window.showInputBox({
      prompt: "Enter document data as JSON (press Enter to create empty document)",
      placeHolder: "{}",
      value: "{}",
    });

    if (json === undefined) {
      return;
    }

    const trimmed = json.trim();
    if (!trimmed || trimmed === "{}") {
      data = {};
    } else {
      try {
        data = JSON.parse(trimmed);
      } catch {
        vscode.window.showErrorMessage("Invalid JSON.");
        return;
      }
    }
  }

  if (conn?.isLocalJson) {
    const finalDocId = docId && docId.trim() ? docId.trim() : `doc_${Date.now()}`;
    const colPath = item.reference?.path || item.collectionId;
    const docPath = `${colPath}/${finalDocId}`;
    try {
      LocalJsonService.getInstance().setDocument(conn, docPath, data);
      DocumentFileSystemProvider.getInstance().invalidateAndNotify(item.connectionId, docPath);
      await openPath(docPath, item.connectionId);
      vscode.window.showInformationMessage("Local document created!");
      explorerDataProvider.refreshNode(item);
    } catch (err: any) {
      vscode.window.showErrorMessage("Failed to create local document: " + err.message);
    }
    return;
  }

  try {
    const ref = docId ? item.reference.doc(docId) : item.reference.doc();
    await ref.set(data);
    CostService.getInstance().recordOperation(item.connectionId, "write", 1);
    DocumentFileSystemProvider.getInstance().invalidateAndNotify(item.connectionId, ref.path);
    await openPath(ref.path, item.connectionId);
    vscode.window.showInformationMessage("Document created!");
    explorerDataProvider.refreshNode(item);
  } catch (err: any) {
    vscode.window.showErrorMessage("Failed to create document: " + err.message);
  }
}

/**
 * Delete a document with optional Deep Delete of subcollections.
 * Supports DocumentItem from Explorer Tree or virtual Document/Field editor Uri fallback.
 */
export async function deleteDocumentCommand(
  item: DocumentItem | vscode.Uri | undefined,
  explorerDataProvider: ExplorerDataProvider
) {
  let targetItem: DocumentItem | undefined = item instanceof DocumentItem ? item : undefined;
  let fieldTabNotice = "";

  if (!targetItem) {
    const targetUri =
      item instanceof vscode.Uri ? item : vscode.window.activeTextEditor?.document.uri;
    if (targetUri && targetUri.scheme === scheme) {
      const parsed = DocumentFileSystemProvider.getInstance().parseUri(targetUri);
      if (parsed.connectionId && parsed.docPath && !parsed.isRules) {
        if (parsed.fieldPath) {
          fieldTabNotice = `Note: You are currently viewing field '${parsed.fieldPath}'. This action will delete the ENTIRE parent document '${parsed.docPath}'.\n\n`;
        }
        try {
          const targetConn = ConnectionManager.getInstance().getConnection(parsed.connectionId);
          const docId = parsed.docPath.split("/").pop() || parsed.docPath;
          const lastSlash = parsed.docPath.lastIndexOf("/");
          const collPath = lastSlash > 0 ? parsed.docPath.substring(0, lastSlash) : parsed.docPath;
          const collId = collPath.split("/").pop() || collPath;
          let docRef: any;
          if (targetConn?.isLocalJson) {
            docRef = {
              id: docId,
              path: parsed.docPath,
              parent: { id: collId, path: collPath },
            };
          } else {
            const firestore = await ConnectionManager.getInstance().getFirestore(parsed.connectionId);
            docRef = firestore.doc(parsed.docPath);
          }
          targetItem = new DocumentItem(docId, docRef, parsed.connectionId);
        } catch (err: any) {
          vscode.window.showErrorMessage(`Failed to resolve document for deletion: ${err?.message || err}`);
          return;
        }
      }
    }
  }

  if (!targetItem?.documentId) {
    vscode.window.showErrorMessage("No document selected to delete.");
    return;
  }

  if (!ConnectionManager.getInstance().ensureWritable(targetItem.connectionId, "delete documents")) {
    return;
  }
  const conn = ConnectionManager.getInstance().getConnection(targetItem.connectionId);
  const envPrefix = getEnvironmentWarningPrefix(targetItem.connectionId);
  const docId = targetItem.documentId || targetItem.reference.id;

  if (conn?.isLocalJson) {
    const confirm = await vscode.window.showWarningMessage(
      `${envPrefix}${fieldTabNotice}Are you sure you want to delete local document "${targetItem.documentId}"?`,
      { modal: true },
      "Delete",
      "Cancel"
    );
    if (confirm !== "Delete") return;

    const confirmedProd = await confirmProductionAction({
      connectionId: targetItem.connectionId,
      actionLabel: "Delete Document",
      targetSummary: `document '${targetItem.reference.path}'`,
      expectedInput: "DELETE",
    });
    if (!confirmedProd) return;

    try {
      LocalJsonService.getInstance().deleteDocument(conn, targetItem.reference.path);
      DocumentFileSystemProvider.getInstance().invalidateAndNotifyDocumentDeleted(
        targetItem.connectionId,
        targetItem.reference.path
      );
      vscode.window.showInformationMessage(`Deleted local document "${targetItem.documentId}".`);
      const lastSlash = targetItem.reference.path.lastIndexOf("/");
      const collPath =
        lastSlash > 0
          ? targetItem.reference.path.substring(0, lastSlash)
          : targetItem.reference.path;
      const collId = collPath.split("/").pop() || collPath;
      const parentItem = new CollectionItem(collId, { id: collId, path: collPath } as any, targetItem.connectionId);
      explorerDataProvider.refreshNode(parentItem);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to delete local document: ${err.message}`);
    }
    return;
  }

  let subcollections: FirebaseFirestore.CollectionReference[];
  try {
    subcollections = await targetItem.reference.listCollections();
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to inspect subcollections: ${err.message}`);
    return;
  }
  const hasSubcollections = subcollections.length > 0;

  let confirm: string | undefined;

  if (hasSubcollections) {
    if (targetItem.isMissingDocument) {
      confirm = await vscode.window.showWarningMessage(
        `${envPrefix}${fieldTabNotice}Phantom document "${targetItem.label}" has ${subcollections.length} subcollection(s) (${subcollections.map((s) => s.id).join(", ")}). Delete all nested subcollections?`,
        { modal: true },
        "Deep Delete (Subcollections)",
        "Cancel"
      );
    } else {
      confirm = await vscode.window.showWarningMessage(
        `${envPrefix}${fieldTabNotice}Document "${targetItem.label}" has ${subcollections.length} subcollection(s) (${subcollections.map((s) => s.id).join(", ")}). How would you like to delete it?`,
        { modal: true },
        "Deep Delete (Doc + Subcollections)",
        "Delete Document Only",
        "Cancel"
      );
    }
  } else {
    confirm = await vscode.window.showWarningMessage(
      `${envPrefix}${fieldTabNotice}Are you sure you want to delete the document "${targetItem.label}"?`,
      { modal: true },
      "Delete",
      "Cancel"
    );
  }

  if (!confirm || confirm === "Cancel") {
    return;
  }

  const isDeepConfirm =
    confirm === "Deep Delete (Doc + Subcollections)" || confirm === "Deep Delete (Subcollections)";
  const confirmedProd = await confirmProductionAction({
    connectionId: targetItem.connectionId,
    actionLabel: isDeepConfirm ? "Deep Delete Document & Subcollections" : "Delete Document",
    targetSummary: `document '${targetItem.reference.path}'`,
    expectedInput: isDeepConfirm ? docId : "DELETE",
  });
  if (!confirmedProd) {
    return;
  }

  let docData: Record<string, any> | undefined;
  if (!targetItem.isMissingDocument) {
    try {
      const snap = await targetItem.reference.get();
      CostService.getInstance().recordOperation(targetItem.connectionId, "read", 1);
      if (snap.exists) {
        docData = snap.data();
      }
    } catch { }
  }

  if (isDeepConfirm) {
    const subSample = await collectSubcollectionStorageSample(targetItem.reference, targetItem.connectionId);
    let deepDeleted = false;
    let deletedCount = 0;

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Deep deleting document "${targetItem.label}" and all subcollections...`,
        cancellable: false,
      },
      async () => {
        try {
          const firestore = await ConnectionManager.getInstance().getFirestore(targetItem.connectionId);
          deletedCount = await recursiveDeleteWithCount(
            firestore,
            targetItem.reference,
            targetItem.connectionId
          );
          DocumentFileSystemProvider.getInstance().invalidateAndNotifyDocumentDeleted(
            targetItem.connectionId,
            targetItem.reference.path,
            true
          );
          vscode.window.showInformationMessage(
            `Deleted document "${targetItem.label}" and all nested subcollections (${deletedCount} doc(s)).`
          );
          const parentItem = new CollectionItem(
            targetItem.reference.parent.id,
            targetItem.reference.parent,
            targetItem.connectionId
          );
          explorerDataProvider.refreshNode(parentItem);
          deepDeleted = true;
        } catch (err: any) {
          vscode.window.showErrorMessage(`Failed deep delete: ${err.message}`);
        }
      }
    );

    if (deepDeleted) {
      const storageScanObj: Record<string, any> = {};
      if (docData) {
        storageScanObj.root = docData;
      }
      if (subSample) {
        storageScanObj.subcollections = subSample;
      }
      if (Object.keys(storageScanObj).length > 0) {
        try {
          await promptAndCleanupOrphanStorageFiles(
            targetItem.connectionId,
            storageScanObj,
            targetItem.label as string
          );
        } catch { }
      }
      try {
        await maybePromptDeleteAuthUserForProfile(
          targetItem.connectionId,
          targetItem.reference.path,
          targetItem.documentId || targetItem.reference.id,
          explorerDataProvider,
          docData
        );
      } catch { }
    }
  } else if (confirm === "Delete" || confirm === "Delete Document Only") {
    try {
      await targetItem.reference.delete();
      CostService.getInstance().recordOperation(targetItem.connectionId, "delete", 1);
      DocumentFileSystemProvider.getInstance().invalidateAndNotifyDocumentDeleted(
        targetItem.connectionId,
        targetItem.reference.path,
        false
      );
      vscode.window.showInformationMessage("Document deleted!");
      const parentItem = new CollectionItem(
        targetItem.reference.parent.id,
        targetItem.reference.parent,
        targetItem.connectionId
      );
      explorerDataProvider.refreshNode(parentItem);

      if (docData) {
        try {
          await promptAndCleanupOrphanStorageFiles(
            targetItem.connectionId,
            docData,
            targetItem.label as string
          );
        } catch { }
      }
      try {
        await maybePromptDeleteAuthUserForProfile(
          targetItem.connectionId,
          targetItem.reference.path,
          targetItem.documentId || targetItem.reference.id,
          explorerDataProvider,
          docData
        );
      } catch { }
    } catch (err: any) {
      vscode.window.showErrorMessage("Failed to delete document: " + err.message);
    }
  }
}

/**
 * Batch-delete multiple multi-selected DocumentItems from the Explorer Tree.
 */
export async function deleteMultipleDocumentsCommand(
  items: DocumentItem[],
  explorerDataProvider: ExplorerDataProvider
): Promise<void> {
  if (!items || items.length === 0) {
    return;
  }

  const byPath = new Map<string, DocumentItem>();
  for (const it of items) {
    if (it?.reference?.path) {
      byPath.set(it.reference.path, it);
    }
  }
  const uniqueItems = Array.from(byPath.values());
  if (uniqueItems.length === 0) {
    return;
  }
  if (uniqueItems.length === 1) {
    await deleteDocumentCommand(uniqueItems[0], explorerDataProvider);
    return;
  }

  const connIds = new Set(uniqueItems.map((it) => it.connectionId));
  if (connIds.size !== 1) {
    vscode.window.showWarningMessage(
      "Multi-select delete only supports documents within the same connection."
    );
    return;
  }

  const connectionId = uniqueItems[0].connectionId;
  if (!ConnectionManager.getInstance().ensureWritable(connectionId, "delete documents")) {
    return;
  }

  const conn = ConnectionManager.getInstance().getConnection(connectionId);
  const envPrefix = getEnvironmentWarningPrefix(connectionId);

  let isDeep = false;
  if (conn?.isLocalJson) {
    const confirm = await vscode.window.showWarningMessage(
      `${envPrefix}Are you sure you want to permanently delete ${uniqueItems.length} selected local document(s)? This action cannot be undone.`,
      { modal: true },
      "Delete Permanently",
      "Cancel"
    );
    if (confirm !== "Delete Permanently") {
      return;
    }
  } else {
    const confirm = await vscode.window.showWarningMessage(
      `${envPrefix}Are you sure you want to permanently delete ${uniqueItems.length} selected document(s)? This action cannot be undone.`,
      { modal: true },
      "Delete Documents Only",
      "Deep Delete (Docs + Subcollections)",
      "Cancel"
    );
    if (!confirm || confirm === "Cancel") {
      return;
    }
    isDeep = confirm === "Deep Delete (Docs + Subcollections)";
  }

  const confirmedProd = await confirmProductionAction({
    connectionId,
    actionLabel: isDeep ? "Batch Deep Delete Documents" : "Batch Delete Documents",
    targetSummary: `${uniqueItems.length} selected document(s)`,
    expectedInput: `DELETE ${uniqueItems.length}`,
  });
  if (!confirmedProd) {
    return;
  }

  const fsProvider = DocumentFileSystemProvider.getInstance();
  const affectedParents = new Map<string, CollectionItem>();
  const registerParent = (it: DocumentItem) => {
    const parentPath =
      it.reference.parent?.path ||
      (it.reference.path.includes("/")
        ? it.reference.path.substring(0, it.reference.path.lastIndexOf("/"))
        : "");
    const parentId = it.reference.parent?.id || parentPath.split("/").pop() || parentPath;
    if (parentPath && !affectedParents.has(parentPath)) {
      affectedParents.set(
        parentPath,
        new CollectionItem(parentId, it.reference.parent || ({ id: parentId, path: parentPath } as any), connectionId)
      );
    }
  };

  try {
    if (conn?.isLocalJson) {
      const grouped = new Map<string, DocumentItem[]>();
      for (const it of uniqueItems) {
        const docPath = it.reference.path;
        const lastSlash = docPath.lastIndexOf("/");
        const collPath = lastSlash > 0 ? docPath.substring(0, lastSlash) : docPath;
        const list = grouped.get(collPath) || [];
        list.push(it);
        grouped.set(collPath, list);
        registerParent(it);
      }
      for (const [collPath, groupItems] of grouped.entries()) {
        LocalJsonService.getInstance().deleteDocuments(
          conn,
          collPath,
          groupItems.map((it) => it.documentId || it.reference.id)
        );
      }
      for (const it of uniqueItems) {
        fsProvider.invalidateAndNotifyDocumentDeleted(connectionId, it.reference.path, false);
      }
      vscode.window.showInformationMessage(`Deleted ${uniqueItems.length} local document(s).`);
    } else {
      const firestore = await ConnectionManager.getInstance().getFirestore(connectionId);
      const storageUrls = new Set<string>();
      const storageService = StorageService.getInstance();
      const sampleItems = uniqueItems.slice(0, 25);
      try {
        const snapshots = await firestore.getAll(...sampleItems.map((it) => it.reference));
        if (snapshots.length > 0) {
          CostService.getInstance().recordOperation(connectionId, "read", snapshots.length);
        }
        for (const snap of snapshots) {
          if (snap.exists) {
            const found = storageService.extractStorageUrlsFromObject(snap.data());
            for (const ref of found) {
              if (ref.rawUrl) {
                storageUrls.add(ref.rawUrl);
              }
            }
          }
        }
      } catch { }

      if (isDeep) {
        const subSampleItems = uniqueItems.slice(0, 10);
        const perDocLimit = Math.max(1, Math.floor(25 / Math.min(uniqueItems.length, 25)));
        for (const it of subSampleItems) {
          const subSample = await collectSubcollectionStorageSample(
            it.reference,
            connectionId,
            perDocLimit
          );
          if (subSample) {
            for (const u of subSample.urls) {
              storageUrls.add(u);
            }
          }
        }

        const storageScanObj = storageUrls.size > 0 ? { urls: Array.from(storageUrls) } : undefined;
        let totalDocsDeleted = 0;
        let succeededDocs = 0;
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Deep deleting ${uniqueItems.length} document(s) and nested subcollections...`,
            cancellable: false,
          },
          async (progress) => {
            for (let i = 0; i < uniqueItems.length; i++) {
              const it = uniqueItems[i];
              progress.report({
                message: `[${i + 1}/${uniqueItems.length}] ${it.reference.path}`,
                increment: (1 / uniqueItems.length) * 100,
              });
              totalDocsDeleted += await recursiveDeleteWithCount(firestore, it.reference, connectionId);
              fsProvider.invalidateAndNotifyDocumentDeleted(connectionId, it.reference.path, true);
              registerParent(it);
              succeededDocs++;
            }
          }
        );
        vscode.window.showInformationMessage(
          `Deep deleted ${succeededDocs} document(s) and subcollections (${totalDocsDeleted.toLocaleString()} Firestore doc(s)).`
        );

        if (succeededDocs > 0 && storageScanObj) {
          try {
            await promptAndCleanupOrphanStorageFiles(
              connectionId,
              storageScanObj,
              `${uniqueItems.length} selected document(s)`
            );
          } catch { }
        }
      } else {
        const storageScanObj = storageUrls.size > 0 ? { urls: Array.from(storageUrls) } : undefined;
        const bulkWriter = firestore.bulkWriter();
        bulkWriter.onWriteError(() => false);
        let deletedCount = 0;
        let failedCount = 0;
        try {
          const ops = uniqueItems.map((it) =>
            bulkWriter
              .delete(it.reference)
              .then(() => {
                deletedCount++;
                fsProvider.invalidateAndNotifyDocumentDeleted(connectionId, it.reference.path, false);
                registerParent(it);
              })
              .catch(() => {
                failedCount++;
              })
          );
          await Promise.allSettled(ops);
        } finally {
          await bulkWriter.close().catch(() => {});
        }
        if (deletedCount > 0) {
          CostService.getInstance().recordOperation(connectionId, "delete", deletedCount);
        }
        if (failedCount > 0) {
          vscode.window.showWarningMessage(
            `Deleted ${deletedCount} document(s); ${failedCount} could not be deleted.`
          );
        } else {
          vscode.window.showInformationMessage(`Successfully deleted ${deletedCount} document(s).`);
        }

        if (deletedCount > 0 && storageScanObj) {
          try {
            await promptAndCleanupOrphanStorageFiles(
              connectionId,
              storageScanObj,
              `${uniqueItems.length} selected document(s)`
            );
          } catch { }
        }
      }
    }
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to delete documents: ${err?.message || err}`);
  } finally {
    for (const parentCol of affectedParents.values()) {
      explorerDataProvider.refreshNode(parentCol);
    }
  }
}

/**
 * Duplicate a document inside its parent collection.
 */
export async function duplicateDocumentCommand(
  item: DocumentItem,
  explorerDataProvider: ExplorerDataProvider
) {
  if (!item?.documentId) {
    vscode.window.showErrorMessage("No document selected.");
    return;
  }

  if (!ConnectionManager.getInstance().ensureWritable(item.connectionId, "duplicate documents")) {
    return;
  }
  const conn = ConnectionManager.getInstance().getConnection(item.connectionId);
  const newDocId = await vscode.window.showInputBox({
    prompt: `Duplicate document "${item.documentId}"`,
    value: `${item.documentId}_copy`,
    placeHolder: "Enter new Document ID (or leave blank to auto-generate)",
  });

  if (newDocId === undefined) {
    return; // User cancelled
  }

  if (conn?.isLocalJson) {
    const lastSlash = item.reference.path.lastIndexOf("/");
    const collPath = lastSlash > 0 ? item.reference.path.substring(0, lastSlash) : item.reference.path;
    const collId = collPath.split("/").pop() || collPath;
    const finalDocId = newDocId.trim() || `doc_${Date.now()}`;
    const targetDocPath = `${collPath}/${finalDocId}`;
    try {
      const data = LocalJsonService.getInstance().getDocument(conn, item.reference.path) || {};
      LocalJsonService.getInstance().setDocument(conn, targetDocPath, JSON.parse(JSON.stringify(data)));
      DocumentFileSystemProvider.getInstance().invalidateAndNotify(item.connectionId, targetDocPath);
      vscode.window.showInformationMessage(`Local document duplicated as "${finalDocId}"!`);
      await openPath(targetDocPath, item.connectionId);
      const parentItem = new CollectionItem(collId, { id: collId, path: collPath } as any, item.connectionId);
      explorerDataProvider.refreshNode(parentItem);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to duplicate local document: ${err.message}`);
    }
    return;
  }

  let snapshot: FirebaseFirestore.DocumentSnapshot;
  try {
    snapshot = await item.reference.get();
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to read document: ${err.message}`);
    return;
  }
  if (!snapshot.exists) {
    vscode.window.showErrorMessage(`Document "${item.documentId}" does not exist.`);
    return;
  }

  try {
    const targetRef = newDocId.trim()
      ? item.reference.parent.doc(newDocId.trim())
      : item.reference.parent.doc();

    await targetRef.set(snapshot.data() || {});
    CostService.getInstance().recordOperation(item.connectionId, "write", 1);
    DocumentFileSystemProvider.getInstance().invalidateAndNotify(item.connectionId, targetRef.path);
    vscode.window.showInformationMessage(`Document duplicated as "${targetRef.id}"!`);
    await openPath(targetRef.path, item.connectionId);
    const parentItem = new CollectionItem(item.reference.parent.id, item.reference.parent, item.connectionId);
    explorerDataProvider.refreshNode(parentItem);
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to duplicate document: ${err.message}`);
  }
}

/**
 * Copy document to internal studio clipboard buffer.
 */
export async function copyDocumentCommand(item: DocumentItem) {
  if (!item?.documentId) {
    vscode.window.showErrorMessage("No document selected.");
    return;
  }

  const conn = ConnectionManager.getInstance().getConnection(item.connectionId);
  if (conn?.isLocalJson) {
    const data = LocalJsonService.getInstance().getDocument(conn, item.reference.path);
    if (!data) {
      vscode.window.showErrorMessage(`Local document "${item.documentId}" does not exist.`);
      return;
    }

    DocumentClipboard.getInstance().set({
      sourceDocId: item.documentId,
      sourcePath: item.reference.path,
      sourceConnectionId: item.connectionId,
      data: JSON.parse(JSON.stringify(data)),
    });

    vscode.window.showInformationMessage(
      `Local document "${item.documentId}" copied to Firestore Studio clipboard.`
    );
    return;
  }

  try {
    const snapshot = await item.reference.get();
    if (!snapshot.exists) {
      vscode.window.showErrorMessage(`Document "${item.documentId}" does not exist.`);
      return;
    }

    DocumentClipboard.getInstance().set({
      sourceDocId: item.documentId,
      sourcePath: item.reference.path,
      sourceConnectionId: item.connectionId,
      data: snapshot.data() || {},
    });

    vscode.window.showInformationMessage(
      `Document "${item.documentId}" copied to Firestore Studio clipboard.`
    );
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to copy document: ${err.message}`);
  }
}

/**
 * Paste copied document into a target collection, document, or into a Map/Array field.
 */
export async function pasteDocumentCommand(
  item: CollectionItem | DocumentItem | DocumentFieldItem,
  explorerDataProvider: ExplorerDataProvider,
  documentFileSystemProvider: DocumentFileSystemProvider
) {
  if (!item) {
    vscode.window.showErrorMessage("No target selected.");
    return;
  }

  const targetConn = ConnectionManager.getInstance().getConnection(item.connectionId);
  if (targetConn?.readOnly) {
    vscode.window.showErrorMessage(
      `Connection '${targetConn.name}' is in Read-Only mode. Unlock it from the connection context menu to paste documents.`
    );
    return;
  }

  const clipboard = DocumentClipboard.getInstance().get();
  if (!clipboard) {
    vscode.window.showWarningMessage(
      "No document in Firestore Studio clipboard. Copy a document first."
    );
    return;
  }

  // Case A: Pasting into an in-document Map/Array field (Dual-Contract cross-substrate paste)
  if (item instanceof DocumentFieldItem) {
    if (!item.parentDocRef || !item.fieldName) {
      return;
    }

    const isArray = Array.isArray(item.value);
    const prompt = `Paste document as entry into Map "${item.fieldName}"`;

    const entryKey = isArray
      ? undefined
      : await vscode.window.showInputBox({
        prompt,
        value: clipboard.sourceDocId,
        placeHolder: "Enter key / ID for this entry",
      });

    if (!isArray && entryKey === undefined) {
      return; // cancelled
    }

    const segments = item.pathSegments && item.pathSegments.length > 0 ? item.pathSegments : [item.fieldName];
    const fullFieldPath = item.fullFieldPath || segments.join(".");

    const conn = ConnectionManager.getInstance().getConnection(item.connectionId);
    if (conn?.isLocalJson) {
      const key = entryKey?.trim() || clipboard.sourceDocId;
      const currentDoc = LocalJsonService.getInstance().getDocument(conn, item.parentDocRef.path) || {};
      let cur = currentDoc;
      for (const p of segments) {
        cur = cur?.[p];
      }
      if (isArray) {
        const arr = Array.isArray(cur) ? cur : [];
        arr.push(clipboard.data);
        LocalJsonService.getInstance().updateField(conn, item.parentDocRef.path, fullFieldPath, arr);
        vscode.window.showInformationMessage(`Appended document to local Array "${fullFieldPath}"!`);
      } else {
        const map = cur && typeof cur === "object" ? cur : {};
        map[key] = clipboard.data;
        LocalJsonService.getInstance().updateField(conn, item.parentDocRef.path, fullFieldPath, map);
        vscode.window.showInformationMessage(`Pasted document as key "${key}" into local Map "${fullFieldPath}"!`);
      }
      documentFileSystemProvider.invalidateAndNotify(item.connectionId, item.parentDocRef.path);
      explorerDataProvider.refreshNode(item);
      return;
    }

    try {
      const key = entryKey?.trim() || clipboard.sourceDocId;
      if (isArray) {
        await item.parentDocRef.update(
          new FieldPath(...segments),
          FieldValue.arrayUnion(clipboard.data)
        );
        CostService.getInstance().recordOperation(item.connectionId, "write", 1);
        vscode.window.showInformationMessage(
          `Appended document to Array "${fullFieldPath}"!`
        );
      } else {
        await item.parentDocRef.update(
          new FieldPath(...segments, key),
          clipboard.data
        );
        CostService.getInstance().recordOperation(item.connectionId, "write", 1);
        vscode.window.showInformationMessage(
          `Pasted document as key "${key}" into Map "${fullFieldPath}"!`
        );
      }

      documentFileSystemProvider.invalidateAndNotify(item.connectionId, item.parentDocRef.path);
      explorerDataProvider.refreshNode(item);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to paste into field: ${err.message}`);
    }
    return;
  }

  // Case B: Pasting into an existing/missing Document (Merge or Overwrite fields)
  if (item instanceof DocumentItem) {
    const strategyPick = await vscode.window.showQuickPick(
      [
        {
          label: "$(git-merge) Merge Fields into Document",
          description: `Preserve existing fields on '${item.documentId}'`,
          merge: true,
        },
        {
          label: "$(replace) Replace Entire Document",
          description: `Overwrite all fields of '${item.documentId}'`,
          merge: false,
        },
      ],
      { placeHolder: `Paste '${clipboard.sourceDocId}' into document '${item.documentId}'` }
    );

    if (!strategyPick) {
      return;
    }

    try {
      const payload =
        clipboard.data && typeof clipboard.data === "object"
          ? JSON.parse(JSON.stringify(clipboard.data))
          : {};

      if (targetConn?.isLocalJson) {
        if (strategyPick.merge) {
          const existing = LocalJsonService.getInstance().getDocument(targetConn, item.reference.path) || {};
          LocalJsonService.getInstance().setDocument(targetConn, item.reference.path, {
            ...existing,
            ...payload,
          });
        } else {
          LocalJsonService.getInstance().setDocument(targetConn, item.reference.path, payload);
        }
      } else {
        await item.reference.set(reviveTimestamps(payload), { merge: strategyPick.merge });
        CostService.getInstance().recordOperation(item.connectionId, "write", 1);
      }

      documentFileSystemProvider.invalidateAndNotify(item.connectionId, item.reference.path);
      if (item.isMissingDocument && item.reference?.parent) {
        explorerDataProvider.refreshNode(
          new CollectionItem(item.reference.parent.id, item.reference.parent, item.connectionId)
        );
      }
      explorerDataProvider.refreshNode(item);
      vscode.window.showInformationMessage(
        strategyPick.merge
          ? `Merged fields from "${clipboard.sourceDocId}" into "${item.documentId}"!`
          : `Replaced "${item.documentId}" with fields from "${clipboard.sourceDocId}"!`
      );
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to paste into document: ${err.message}`);
    }
    return;
  }

  // Case C: Pasting into a discrete Collection
  if (!item.collectionId) {
    vscode.window.showErrorMessage("No target collection selected.");
    return;
  }

  const targetDocId = await vscode.window.showInputBox({
    prompt: `Paste document into collection "${item.collectionId}"`,
    value: clipboard.sourceDocId,
    placeHolder: "Enter Document ID (or leave blank for auto-generated ID)",
  });

  if (targetDocId === undefined) {
    return; // User cancelled
  }

  const conn = ConnectionManager.getInstance().getConnection(item.connectionId);
  const colPath = item.reference?.path || item.collectionId;
  if (conn?.isLocalJson) {
    const finalDocId = targetDocId.trim() || `doc_${Date.now()}`;
    const docPath = `${colPath}/${finalDocId}`;
    try {
      LocalJsonService.getInstance().setDocument(conn, docPath, clipboard.data);
      documentFileSystemProvider.invalidateAndNotify(item.connectionId, docPath);
      vscode.window.showInformationMessage(
        `Pasted local document "${finalDocId}" into "${colPath}"!`
      );
      await openPath(docPath, item.connectionId);
      explorerDataProvider.refreshNode(item);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to paste local document: ${err.message}`);
    }
    return;
  }

  try {
    const targetRef = targetDocId.trim()
      ? item.reference.doc(targetDocId.trim())
      : item.reference.doc();

    await targetRef.set(clipboard.data);
    CostService.getInstance().recordOperation(item.connectionId, "write", 1);
    DocumentFileSystemProvider.getInstance().invalidateAndNotify(item.connectionId, targetRef.path);
    vscode.window.showInformationMessage(
      `Pasted document "${targetRef.id}" into "${item.collectionId}"!`
    );
    await openPath(targetRef.path, item.connectionId);
    explorerDataProvider.refreshNode(item);
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to paste document: ${err.message}`);
  }
}

/**
 * Copy formatted JSON of a document straight to the OS clipboard.
 */
export async function copyDocumentJsonCommand(item: DocumentItem) {
  if (!item?.documentId) {
    vscode.window.showErrorMessage("No document selected.");
    return;
  }

  const conn = ConnectionManager.getInstance().getConnection(item.connectionId);
  if (conn?.isLocalJson) {
    const data = LocalJsonService.getInstance().getDocument(conn, item.reference.path) || {};
    const jsonText = JSON.stringify(data, null, 2);
    await vscode.env.clipboard.writeText(jsonText);
    vscode.window.showInformationMessage(`Copied local document JSON to clipboard.`);
    return;
  }

  try {
    const snapshot = await item.reference.get();
    if (!snapshot.exists) {
      try {
        const subcollections = await item.reference.listCollections();
        if (subcollections.length === 0) {
          vscode.window.showErrorMessage(`Document "${item.documentId}" does not exist.`);
          return;
        }
      } catch {
        vscode.window.showErrorMessage(`Document "${item.documentId}" does not exist.`);
        return;
      }
    }

    const jsonText = JSON.stringify(snapshot.exists ? snapshot.data() || {} : {}, null, 2);
    await vscode.env.clipboard.writeText(jsonText);
    vscode.window.showInformationMessage(`Copied document JSON to clipboard.`);
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to copy JSON: ${err.message}`);
  }
}

/**
 * Prompt to filter documents in a collection by ID prefix/substring or keyword.
 */
export async function filterCollectionCommand(
  item: CollectionItem,
  explorerDataProvider: ExplorerDataProvider
) {
  if (!item?.collectionId || !item?.reference?.path) {
    vscode.window.showErrorMessage("No collection selected.");
    return;
  }

  const currentFilter = explorerDataProvider.getCollectionFilter(item.connectionId, item.reference.path) || "";
  const input = await vscode.window.showInputBox({
    prompt: `Filter documents in collection '${item.collectionId}'`,
    value: currentFilter,
    placeHolder: "Enter Doc ID prefix/substring or keyword (leave blank to clear)...",
  });

  if (input === undefined) {
    return;
  }

  const trimmed = input.trim();
  if (!trimmed) {
    explorerDataProvider.clearCollectionFilter(item.connectionId, item.reference.path);
    vscode.window.showInformationMessage(`Filter cleared for collection '${item.collectionId}'`);
  } else {
    explorerDataProvider.setCollectionFilter(item.connectionId, item.reference.path, trimmed);
    vscode.window.showInformationMessage(`Filtered '${item.collectionId}' by "${trimmed}"`);
  }
}

/**
 * Clear any active filter on a collection.
 */
export async function clearCollectionFilterCommand(
  item: CollectionItem,
  explorerDataProvider: ExplorerDataProvider
) {
  if (!item?.reference?.path) {
    return;
  }

  explorerDataProvider.clearCollectionFilter(item.connectionId, item.reference.path);
  vscode.window.showInformationMessage(`Filter cleared for collection '${item.collectionId || item.reference.path}'`);
}

/**
 * Open a Document as an interactive Table webview.
 */
export async function openDocumentAsTableCommand(
  itemOrUri?: DocumentItem | vscode.Uri | any,
  explorerDataProvider?: ExplorerDataProvider
) {
  if (itemOrUri instanceof DocumentItem) {
    await openDocumentAsTable(itemOrUri, explorerDataProvider);
    return;
  }

  if (itemOrUri instanceof vscode.Uri) {
    if (itemOrUri.scheme === "file" || itemOrUri.fsPath) {
      const binding = SnapshotSyncService.getInstance().getBinding(itemOrUri.fsPath);
      if (binding) {
        await openDocumentAsTable({ connectionId: binding.connectionId, docPath: binding.docPath }, explorerDataProvider);
        return;
      }
    }
    if (itemOrUri.scheme === "ketrik-firestore-studio") {
      const parsed = DocumentFileSystemProvider.getInstance().parseUri(itemOrUri);
      await openDocumentAsTable({ connectionId: parsed.connectionId, docPath: parsed.docPath }, explorerDataProvider);
      return;
    }
    const connectionId = itemOrUri.authority || "default";
    let rawPath = itemOrUri.path.replace(/^\//, "");
    if (rawPath.endsWith(".json")) {
      rawPath = rawPath.slice(0, -5);
    }
    await openDocumentAsTable({ connectionId, docPath: rawPath }, explorerDataProvider);
    return;
  }

  if (itemOrUri && typeof itemOrUri === "object" && itemOrUri.reference?.path) {
    await openDocumentAsTable(itemOrUri, explorerDataProvider);
    return;
  }

  // Check active text editor
  const activeEditor = vscode.window.activeTextEditor;
  if (activeEditor) {
    const uri = activeEditor.document.uri;
    if (uri.scheme === "ketrik-firestore-studio") {
      const parsed = DocumentFileSystemProvider.getInstance().parseUri(uri);
      await openDocumentAsTable({ connectionId: parsed.connectionId, docPath: parsed.docPath }, explorerDataProvider);
      return;
    }
    const binding = SnapshotSyncService.getInstance().getBinding(uri.fsPath);
    if (binding) {
      await openDocumentAsTable({ connectionId: binding.connectionId, docPath: binding.docPath }, explorerDataProvider);
      return;
    }
  }

  // Prompt user for connection and document path
  const connectionManager = ConnectionManager.getInstance();
  const connections = connectionManager.getConnections();
  if (connections.length === 0) {
    vscode.window.showWarningMessage("No Firestore connections configured.");
    return;
  }

  let connectionId = connections[0].id;
  if (connections.length > 1) {
    const pick = await vscode.window.showQuickPick(
      connections.map((c) => ({ label: c.name, description: c.id, connectionId: c.id })),
      { placeHolder: "Select Firestore connection" }
    );
    if (!pick) return;
    connectionId = pick.connectionId;
  }

  const pathInput = await vscode.window.showInputBox({
    prompt: "Enter Firestore document path to open as table",
    placeHolder: "e.g. users/alice or dashboard/navigation/board/metadata",
    validateInput: (v) => {
      const parts = v.trim().replace(/^\//, "").split("/").filter(Boolean);
      if (parts.length === 0) return "Document path cannot be empty";
      if (parts.length % 2 !== 0) return "Document path must have an even number of segments (collection/doc)";
      return undefined;
    },
  });

  if (!pathInput) return;
  const cleanPath = pathInput.trim().replace(/^\//, "");
  await openDocumentAsTable({ connectionId, docPath: cleanPath }, explorerDataProvider);
}

/**
 * Copy just the raw Firestore Document ID to the clipboard.
 */
export async function copyDocumentIdCommand(item?: DocumentItem): Promise<void> {
  if (!item?.documentId) {
    vscode.window.showWarningMessage("No document selected.");
    return;
  }
  await vscode.env.clipboard.writeText(item.documentId);
  vscode.window.showInformationMessage(`Copied Document ID: ${item.documentId}`);
}

/**
 * Mark a document as the left-hand side of a side-by-side diff comparison.
 */
export async function selectDocumentForCompareCommand(item?: DocumentItem): Promise<void> {
  if (!item?.reference?.path) {
    vscode.window.showWarningMessage("No document selected for compare.");
    return;
  }
  const connectionName =
    ConnectionManager.getInstance().getConnection(item.connectionId)?.name || item.connectionId;
  DocumentCompareService.getInstance().select({
    connectionId: item.connectionId,
    connectionName,
    docPath: item.reference.path,
    documentId: item.documentId,
  });
  vscode.window.showInformationMessage(
    `Selected '${connectionName}/${item.reference.path}' for compare. Right-click another document and select "Compare with Selected".`
  );
}

/**
 * Compare a document side-by-side against the previously selected document via VS Code diff.
 */
export async function compareDocumentWithSelectedCommand(item?: DocumentItem): Promise<void> {
  if (!item?.reference?.path) {
    vscode.window.showWarningMessage("No document selected to compare.");
    return;
  }
  const left = DocumentCompareService.getInstance().get();
  if (!left) {
    vscode.window.showWarningMessage(
      "No document selected for compare. Right-click a document and choose 'Select for Compare' first."
    );
    return;
  }
  const leftUri = vscode.Uri.from({
    scheme,
    authority: left.connectionId,
    path: `/${left.docPath}.json`,
  });
  const rightUri = vscode.Uri.from({
    scheme,
    authority: item.connectionId,
    path: `/${item.reference.path}.json`,
  });
  const rightConnName =
    ConnectionManager.getInstance().getConnection(item.connectionId)?.name || item.connectionId;
  const title = `${left.connectionName}:${left.docPath} ↔ ${rightConnName}:${item.reference.path}`;
  await vscode.commands.executeCommand("vscode.diff", leftUri, rightUri, title);
}

/**
 * Compare a document side-by-side with another instance (or another document path on the same instance).
 */
export async function compareDocumentWithInstanceCommand(
  target?: DocumentItem | vscode.Uri
): Promise<void> {
  const connectionManager = ConnectionManager.getInstance();
  const connections = connectionManager.getConnections();
  if (connections.length === 0) {
    vscode.window.showWarningMessage("No Firestore connections configured.");
    return;
  }

  let sourceConnId: string | undefined;
  let sourceDocPath: string | undefined;

  if (target instanceof DocumentItem) {
    sourceConnId = target.connectionId;
    sourceDocPath = target.reference?.path;
  } else if (target instanceof vscode.Uri) {
    if (target.scheme === scheme) {
      const parsed = DocumentFileSystemProvider.getInstance().parseUri(target);
      if (!parsed.isRules) {
        sourceConnId = parsed.connectionId;
        sourceDocPath = parsed.docPath;
      }
    } else if (target.scheme === "file") {
      const binding = SnapshotSyncService.getInstance().getBinding(target);
      if (binding) {
        sourceConnId = binding.connectionId;
        sourceDocPath = binding.docPath;
      }
    }
  } else if (vscode.window.activeTextEditor) {
    const activeUri = vscode.window.activeTextEditor.document.uri;
    if (activeUri.scheme === scheme) {
      const parsed = DocumentFileSystemProvider.getInstance().parseUri(activeUri);
      if (!parsed.isRules) {
        sourceConnId = parsed.connectionId;
        sourceDocPath = parsed.docPath;
      }
    } else if (activeUri.scheme === "file") {
      const binding = SnapshotSyncService.getInstance().getBinding(activeUri);
      if (binding) {
        sourceConnId = binding.connectionId;
        sourceDocPath = binding.docPath;
      }
    }
  }

  if (!sourceConnId || !sourceDocPath) {
    vscode.window.showWarningMessage("Please select or open a Firestore document to compare.");
    return;
  }

  const sourceConn = connectionManager.getConnection(sourceConnId);
  const sourceConnName = sourceConn?.name || sourceConnId;

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
      title: `Compare '${sourceDocPath}' With Instance`,
      placeHolder: "Select target connection to compare against",
    }
  );
  if (!targetPick) return;

  const targetConn = targetPick.config;
  const isSameConnection = targetConn.id === sourceConnId;

  const targetPathInput = await vscode.window.showInputBox({
    title: `Target Document Path in '${targetConn.name}'`,
    prompt: "Enter the document path to compare against",
    value: sourceDocPath,
    validateInput: (v) => {
      const cleaned = v.trim().replace(/^\/+|\/+$/g, "");
      if (!cleaned) return "Document path cannot be empty";
      const segs = cleaned.split("/").filter(Boolean);
      if (segs.length % 2 !== 0) {
        return "Document path must have an even number of segments (collection/docId)";
      }
      if (isSameConnection && cleaned === sourceDocPath) {
        return "Choose a different document path when comparing within the same connection";
      }
      return null;
    },
  });
  if (!targetPathInput) return;

  const targetDocPath = targetPathInput.trim().replace(/^\/+|\/+$/g, "");

  try {
    let exists = false;
    if (targetConn.isLocalJson) {
      exists = !!LocalJsonService.getInstance().getDocument(targetConn, targetDocPath);
    } else {
      const firestore = await connectionManager.getFirestore(targetConn.id);
      const snap = await firestore.doc(targetDocPath).get();
      CostService.getInstance().recordOperation(targetConn.id, "read", 1);
      exists = snap.exists;
    }

    if (!exists) {
      vscode.window.showWarningMessage(
        `Target document '${targetDocPath}' does not exist in '${targetConn.name}'.`
      );
      return;
    }
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to verify target document: ${err.message}`);
    return;
  }

  const leftUri = vscode.Uri.from({
    scheme,
    authority: sourceConnId,
    path: `/${sourceDocPath}.json`,
  });
  const rightUri = vscode.Uri.from({
    scheme,
    authority: targetConn.id,
    path: `/${targetDocPath}.json`,
  });
  const title = `${sourceConnName}:${sourceDocPath} ↔ ${targetConn.name}:${targetDocPath}`;
  await vscode.commands.executeCommand("vscode.diff", leftUri, rightUri, title);
}

async function copySubcollectionsForRename(
  firestore: FirebaseFirestore.Firestore,
  sourceDocRef: FirebaseFirestore.DocumentReference,
  targetDocRef: FirebaseFirestore.DocumentReference,
  connectionId: string,
  progress: vscode.Progress<{ message?: string }>
): Promise<number> {
  const BATCH_LIMIT = 200;
  const PAGE_SIZE = 50;
  let batch = firestore.batch();
  let batchOps = 0;
  let totalCopied = 0;

  const flushBatch = async () => {
    if (batchOps > 0) {
      await batch.commit();
      CostService.getInstance().recordOperation(connectionId, "write", batchOps);
      batch = firestore.batch();
      batchOps = 0;
    }
  };

  const recurse = async (
    srcRef: FirebaseFirestore.DocumentReference,
    dstRef: FirebaseFirestore.DocumentReference
  ) => {
    const subcolls = await srcRef.listCollections();
    for (const sub of subcolls) {
      const targetSub = dstRef.collection(sub.id);
      let lastDoc: QueryDocumentSnapshot | null = null;
      let hasMore = true;

      while (hasMore) {
        let q = sub.limit(PAGE_SIZE);
        if (lastDoc) q = q.startAfter(lastDoc);
        const snap = await q.get();
        if (snap.empty) break;
        CostService.getInstance().recordOperation(connectionId, "read", snap.docs.length);

        for (const childDoc of snap.docs) {
          const targetChild = targetSub.doc(childDoc.id);
          batch.set(targetChild, childDoc.data());
          batchOps++;
          totalCopied++;
          if (batchOps >= BATCH_LIMIT) {
            await flushBatch();
            progress.report({ message: `Copied ${totalCopied} nested document(s)...` });
          }
          await recurse(childDoc.ref, targetChild);
        }

        lastDoc = snap.docs[snap.docs.length - 1];
        if (snap.docs.length < PAGE_SIZE) hasMore = false;
      }
    }
  };

  await recurse(sourceDocRef, targetDocRef);
  await flushBatch();
  return totalCopied;
}

/**
 * Rename / move a document ID cleanly by writing the target first (including optional subcollections)
 * and deleting the source only after all destination writes succeed.
 */
export async function renameDocumentCommand(
  item: DocumentItem,
  explorerDataProvider: ExplorerDataProvider
): Promise<void> {
  if (!item?.documentId) {
    vscode.window.showErrorMessage("No document selected.");
    return;
  }
  if (!ConnectionManager.getInstance().ensureWritable(item.connectionId, "rename documents")) {
    return;
  }
  if (item.isMissingDocument) {
    vscode.window.showWarningMessage(
      "Cannot rename a missing phantom document. Add fields first or recreate documents under the target ID."
    );
    return;
  }

  const newDocIdInput = await vscode.window.showInputBox({
    title: `Rename / Move Document '${item.documentId}'`,
    prompt: "Enter the new Document ID",
    value: item.documentId,
    validateInput: (v) => {
      const trimmed = v.trim();
      if (!trimmed) return "Document ID cannot be empty";
      if (trimmed.includes("/")) return "Document ID cannot contain slashes '/'";
      if (trimmed === item.documentId) return "New Document ID must differ from current ID";
      return undefined;
    },
  });
  if (!newDocIdInput) return;

  const newDocId = newDocIdInput.trim();
  const conn = ConnectionManager.getInstance().getConnection(item.connectionId);

  if (conn?.isLocalJson) {
    const lastSlash = item.reference.path.lastIndexOf("/");
    const parentCollPath = lastSlash > 0 ? item.reference.path.substring(0, lastSlash) : item.reference.path;
    const collId = parentCollPath.split("/").pop() || parentCollPath;
    const targetPath = `${parentCollPath}/${newDocId}`;

    const existingTarget = LocalJsonService.getInstance().getDocument(conn, targetPath);
    if (existingTarget) {
      const overwriteChoice = await vscode.window.showWarningMessage(
        `Local document '${targetPath}' already exists. Overwrite it?`,
        { modal: true },
        "Overwrite",
        "Cancel"
      );
      if (overwriteChoice !== "Overwrite") return;
    }

    try {
      const sourceData = LocalJsonService.getInstance().getDocument(conn, item.reference.path) || {};
      LocalJsonService.getInstance().setDocument(conn, targetPath, JSON.parse(JSON.stringify(sourceData)));
      LocalJsonService.getInstance().deleteDocument(conn, item.reference.path);
      DocumentFileSystemProvider.getInstance().invalidateAndNotifyDocumentDeleted(item.connectionId, item.reference.path);
      DocumentFileSystemProvider.getInstance().invalidateAndNotify(item.connectionId, targetPath);

      const parentItem = new CollectionItem(collId, { id: collId, path: parentCollPath } as any, item.connectionId);
      explorerDataProvider.refreshNode(parentItem);
      await openPath(targetPath, item.connectionId);
      vscode.window.showInformationMessage(`Renamed local document '${item.documentId}' to '${newDocId}'.`);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to rename local document: ${err.message}`);
    }
    return;
  }

  let sourceSnap: FirebaseFirestore.DocumentSnapshot;
  try {
    sourceSnap = await item.reference.get();
    CostService.getInstance().recordOperation(item.connectionId, "read", 1);
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to read source document: ${err.message}`);
    return;
  }

  if (!sourceSnap.exists) {
    vscode.window.showErrorMessage(`Document '${item.documentId}' no longer exists.`);
    return;
  }

  const targetRef = item.reference.parent.doc(newDocId);
  try {
    const targetSnap = await targetRef.get();
    CostService.getInstance().recordOperation(item.connectionId, "read", 1);
    if (targetSnap.exists) {
      const overwriteChoice = await vscode.window.showWarningMessage(
        `Document '${targetRef.path}' already exists. Overwrite it?`,
        { modal: true },
        "Overwrite Target Document",
        "Cancel"
      );
      if (overwriteChoice !== "Overwrite Target Document") return;
    }
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to check target document collision: ${err.message}`);
    return;
  }

  let subcollections: FirebaseFirestore.CollectionReference[] = [];
  try {
    subcollections = await item.reference.listCollections();
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to inspect subcollections: ${err.message}`);
    return;
  }

  let moveSubcollections = false;
  if (subcollections.length > 0) {
    const subChoice = await vscode.window.showWarningMessage(
      `Document '${item.documentId}' has ${subcollections.length} subcollection(s) (${subcollections.map((s) => s.id).join(", ")}). How should it be moved to '${newDocId}'?`,
      { modal: true },
      "Move Doc + Subcollections",
      "Move Doc Fields Only",
      "Cancel"
    );
    if (!subChoice || subChoice === "Cancel") return;
    moveSubcollections = subChoice === "Move Doc + Subcollections";
  } else {
    const confirm = await vscode.window.showWarningMessage(
      `Rename document '${item.documentId}' to '${newDocId}'?`,
      { modal: true },
      "Rename Document",
      "Cancel"
    );
    if (confirm !== "Rename Document") return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Renaming '${item.documentId}' to '${newDocId}'...`,
      cancellable: false,
    },
    async (progress) => {
      try {
        const firestore = await ConnectionManager.getInstance().getFirestore(item.connectionId);
        // 1. Write destination document first
        await targetRef.set(sourceSnap.data() || {});
        CostService.getInstance().recordOperation(item.connectionId, "write", 1);

        // 2. Copy all nested subcollections if requested
        if (moveSubcollections) {
          progress.report({ message: "Copying nested subcollections..." });
          await copySubcollectionsForRename(firestore, item.reference, targetRef, item.connectionId, progress);
        }

        // 3. Delete source only after destination writes succeeded
        progress.report({ message: "Removing original document..." });
        if (moveSubcollections) {
          await recursiveDeleteWithCount(firestore, item.reference, item.connectionId);
        } else {
          await item.reference.delete();
          CostService.getInstance().recordOperation(item.connectionId, "delete", 1);
        }

        DocumentFileSystemProvider.getInstance().invalidateAndNotifyDocumentDeleted(
          item.connectionId,
          item.reference.path,
          moveSubcollections
        );
        DocumentFileSystemProvider.getInstance().invalidateAndNotify(item.connectionId, targetRef.path);

        const parentItem = new CollectionItem(
          item.reference.parent.id,
          item.reference.parent,
          item.connectionId
        );
        explorerDataProvider.refreshNode(parentItem);
        await openPath(targetRef.path, item.connectionId);
        vscode.window.showInformationMessage(`Renamed document '${item.documentId}' to '${newDocId}'.`);
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to rename document: ${err.message}`);
      }
    }
  );
}

/**
 * Open the selected Connection, Collection, or Document directly in Firebase Console or Local Emulator UI.
 */
export async function openInConsoleCommand(
  item?: ConnectionTreeItem | CollectionItem | DocumentItem
): Promise<void> {
  if (!item) {
    vscode.window.showWarningMessage("Select a connection, collection, or document to open in console.");
    return;
  }

  let connectionId: string;
  let resourcePath = "";

  if (item instanceof ConnectionTreeItem) {
    connectionId = item.config.id;
  } else {
    connectionId = item.connectionId;
    resourcePath = item.reference?.path || "";
  }

  const conn = ConnectionManager.getInstance().getConnection(connectionId);
  if (!conn || conn.isLocalJson) {
    vscode.window.showWarningMessage(
      "Open in Console is only available for Cloud Firestore and Firebase Emulator connections."
    );
    return;
  }

  if (conn.isEmulator) {
    const cfg = await EmulatorService.getInstance().getPrimaryConfig();
    const host = cfg?.uiHost || "localhost";
    const port = cfg?.uiPort || 4000;
    const cleanSegs = resourcePath.split("/").filter(Boolean).map(encodeURIComponent);
    const url = cleanSegs.length
      ? `http://${host}:${port}/firestore/default/data/${cleanSegs.join("/")}`
      : `http://${host}:${port}/firestore`;
    await vscode.env.openExternal(vscode.Uri.parse(url));
    return;
  }

  let projectId = conn.projectId;
  if (!projectId && conn.serviceAccountKeyPath && fs.existsSync(conn.serviceAccountKeyPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(conn.serviceAccountKeyPath, "utf8"));
      projectId = parsed.project_id;
    } catch {}
  }

  if (!projectId) {
    vscode.window.showWarningMessage("Could not determine GCP Project ID for this connection.");
    return;
  }

  const dbSegment =
    !conn.databaseId || conn.databaseId === "(default)"
      ? "-default-"
      : encodeURIComponent(conn.databaseId);
  const dataPath = resourcePath
    ? resourcePath
        .split("/")
        .filter(Boolean)
        .map((s) => `~2F${encodeURIComponent(s)}`)
        .join("")
    : "";

  const url = `https://console.firebase.google.com/project/${encodeURIComponent(
    projectId
  )}/firestore/databases/${dbSegment}/data/${dataPath}`;
  await vscode.env.openExternal(vscode.Uri.parse(url));
}



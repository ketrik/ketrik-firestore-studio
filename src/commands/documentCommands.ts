import * as vscode from "vscode";
import { CollectionItem, DocumentFieldItem, DocumentItem } from "../explorer/items";
import openPath from "./openPath";
import ExplorerDataProvider from "../explorer/ExplorerDataProvider";
import { DocumentFileSystemProvider } from "../editor/DocumentFileSystemProvider";
import { ConnectionManager } from "../connections/ConnectionManager";
import { DocumentClipboard } from "../services/DocumentClipboard";
import { TemplateService } from "../services/TemplateService";
import { FieldValue } from "firebase-admin/firestore";

/**
 * Direct 1-read document ID lookup.
 */
export async function jumpToDocumentCommand(
  item: CollectionItem,
  explorerDataProvider: ExplorerDataProvider
) {
  if (!item?.reference) {
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

  try {
    const docRef = item.reference.doc(docId.trim());
    const snapshot = await docRef.get();
    if (!snapshot.exists) {
      const createChoice = await vscode.window.showWarningMessage(
        `Document '${docId.trim()}' does not exist in collection '${item.collectionId}'. Would you like to create it?`,
        "Create",
        "Cancel"
      );
      if (createChoice === "Create") {
        await docRef.set({});
        await openPath(docRef.path, item.connectionId);
        explorerDataProvider.refresh();
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
  if (!item?.reference) {
    vscode.window.showErrorMessage("No collection selected.");
    return;
  }

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
      prompt: "Enter document data as JSON",
      placeHolder: '{"field1": "value1", "field2": 123}',
    });

    if (!json) {
      vscode.window.showWarningMessage("No data entered.");
      return;
    }

    try {
      data = JSON.parse(json);
    } catch {
      vscode.window.showErrorMessage("Invalid JSON.");
      return;
    }
  }

  try {
    const ref = docId ? item.reference.doc(docId) : item.reference.doc();
    await ref.set(data);
    await openPath(ref.path, item.connectionId);
    vscode.window.showInformationMessage("Document created!");
    explorerDataProvider.refresh();
  } catch (err: any) {
    vscode.window.showErrorMessage("Failed to create document: " + err.message);
  }
}

/**
 * Delete a document with optional Deep Delete of subcollections.
 */
export async function deleteDocumentCommand(
  item: DocumentItem,
  explorerDataProvider: ExplorerDataProvider
) {
  if (!item?.reference) {
    return;
  }

  const subcollections = await item.reference.listCollections();
  const hasSubcollections = subcollections.length > 0;

  let confirm: string | undefined;

  if (hasSubcollections) {
    confirm = await vscode.window.showWarningMessage(
      `Document "${item.label}" has ${subcollections.length} subcollection(s) (${subcollections.map((s) => s.id).join(", ")}). How would you like to delete it?`,
      { modal: true },
      "Deep Delete (Doc + Subcollections)",
      "Delete Document Only",
      "Cancel"
    );
  } else {
    confirm = await vscode.window.showWarningMessage(
      `Are you sure you want to delete the document "${item.label}"?`,
      { modal: true },
      "Delete",
      "Cancel"
    );
  }

  if (!confirm || confirm === "Cancel") {
    return;
  }

  if (confirm === "Deep Delete (Doc + Subcollections)") {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Deep deleting document "${item.label}" and all subcollections...`,
        cancellable: false,
      },
      async () => {
        try {
          const firestore = await ConnectionManager.getInstance().getFirestore(item.connectionId);
          await firestore.recursiveDelete(item.reference);
          vscode.window.showInformationMessage(`Deleted document "${item.label}" and all nested subcollections.`);
          explorerDataProvider.refresh();
        } catch (err: any) {
          vscode.window.showErrorMessage(`Failed deep delete: ${err.message}`);
        }
      }
    );
  } else if (confirm === "Delete" || confirm === "Delete Document Only") {
    try {
      await item.reference.delete();
      vscode.window.showInformationMessage("Document deleted!");
      explorerDataProvider.refresh();
    } catch (err: any) {
      vscode.window.showErrorMessage("Failed to delete document: " + err.message);
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
  if (!item?.reference) {
    vscode.window.showErrorMessage("No document selected.");
    return;
  }

  const snapshot = await item.reference.get();
  if (!snapshot.exists) {
    vscode.window.showErrorMessage(`Document "${item.documentId}" does not exist.`);
    return;
  }

  const newDocId = await vscode.window.showInputBox({
    prompt: `Duplicate document "${item.documentId}"`,
    value: `${item.documentId}_copy`,
    placeHolder: "Enter new Document ID (or leave blank to auto-generate)",
  });

  if (newDocId === undefined) {
    return; // User cancelled
  }

  try {
    const targetRef = newDocId.trim()
      ? item.reference.parent.doc(newDocId.trim())
      : item.reference.parent.doc();

    await targetRef.set(snapshot.data() || {});
    vscode.window.showInformationMessage(`Document duplicated as "${targetRef.id}"!`);
    await openPath(targetRef.path, item.connectionId);
    explorerDataProvider.refresh();
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to duplicate document: ${err.message}`);
  }
}

/**
 * Copy document to internal studio clipboard buffer.
 */
export async function copyDocumentCommand(item: DocumentItem) {
  if (!item?.reference) {
    vscode.window.showErrorMessage("No document selected.");
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
 * Paste copied document into a target collection or into a Map/Array field.
 */
export async function pasteDocumentCommand(
  item: CollectionItem | DocumentFieldItem,
  explorerDataProvider: ExplorerDataProvider,
  documentFileSystemProvider: DocumentFileSystemProvider
) {
  if (!item) {
    vscode.window.showErrorMessage("No target selected.");
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

    try {
      const key = entryKey?.trim() || clipboard.sourceDocId;
      if (isArray) {
        await item.parentDocRef.update({
          [item.fieldName]: FieldValue.arrayUnion(clipboard.data),
        });
        vscode.window.showInformationMessage(
          `Appended document to Array "${item.fieldName}"!`
        );
      } else {
        await item.parentDocRef.update({
          [`${item.fieldName}.${key}`]: clipboard.data,
        });
        vscode.window.showInformationMessage(
          `Pasted document as key "${key}" into Map "${item.fieldName}"!`
        );
      }

      documentFileSystemProvider.invalidateAndNotify(item.connectionId, item.parentDocRef.path);
      explorerDataProvider.refreshNode(item);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to paste into field: ${err.message}`);
    }
    return;
  }

  // Case B: Pasting into a discrete Collection
  if (!item.reference) {
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

  try {
    const targetRef = targetDocId.trim()
      ? item.reference.doc(targetDocId.trim())
      : item.reference.doc();

    await targetRef.set(clipboard.data);
    vscode.window.showInformationMessage(
      `Pasted document "${targetRef.id}" into "${item.collectionId}"!`
    );
    await openPath(targetRef.path, item.connectionId);
    explorerDataProvider.refresh();
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to paste document: ${err.message}`);
  }
}

/**
 * Copy formatted JSON of a document straight to the OS clipboard.
 */
export async function copyDocumentJsonCommand(item: DocumentItem) {
  if (!item?.reference) {
    vscode.window.showErrorMessage("No document selected.");
    return;
  }

  try {
    const snapshot = await item.reference.get();
    if (!snapshot.exists) {
      vscode.window.showErrorMessage(`Document "${item.documentId}" does not exist.`);
      return;
    }

    const jsonText = JSON.stringify(snapshot.data() || {}, null, 2);
    await vscode.env.clipboard.writeText(jsonText);
    vscode.window.showInformationMessage(`Copied document JSON to clipboard.`);
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to copy JSON: ${err.message}`);
  }
}

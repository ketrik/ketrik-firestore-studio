import { QueryDocumentSnapshot, Query, AggregateField, FieldValue } from "firebase-admin/firestore";
import * as vscode from "vscode";
import { CollectionItem } from "../explorer/items";
import { ConnectionManager } from "../connections/ConnectionManager";
import { DocumentFileSystemProvider } from "../editor/DocumentFileSystemProvider";
import openPath from "../commands/openPath";
import { QueryClause, sortHeaders, parseFilterValue } from "./common/tableUtils";
import { getCollectionTableHtml } from "./collectionTable/collectionTableHtml";

export { QueryClause };

export async function openCollectionAsTable(item: CollectionItem) {
  const panel = vscode.window.createWebviewPanel(
    "firestoreCollectionTable",
    `Collection: ${item.collectionId}`,
    vscode.ViewColumn.One,
    {
      enableScripts: true,
    }
  );

  const config = vscode.workspace.getConfiguration("ketrik-firestore-studio");
  const limit = (config.get<number>("pagingLimit") as number) || 10;
  const maxRows = Math.max(1, config.get<number>("maxTableRows") ?? 100);

  let loadedDocs: any[] = [];
  let lastDoc: QueryDocumentSnapshot | null = null;
  let headers: string[] = [];
  let activeQueryClauses: QueryClause[] = [];
  let isLoading = false;

  /**
   * Resolve the collection through the live connection on every query, so the table keeps
   * working after the connection was edited (its old Firestore instance is terminated).
   */
  async function getCollection() {
    const firestore = await ConnectionManager.getInstance().getFirestore(item.connectionId);
    return firestore.collection(item.reference.path);
  }

  /** Build an executable Firestore query applying all active where clauses. */
  async function buildBaseQuery(): Promise<Query> {
    let q: Query = await getCollection();
    for (const clause of activeQueryClauses) {
      if (clause.field && clause.op) {
        const parsedVal = parseFilterValue(clause.value, clause.op);
        q = q.where(clause.field, clause.op, parsedVal);
      }
    }
    return q;
  }

  /** Append the next page of documents from Firestore (never more than `maxRows` in total). */
  async function loadMoreDocs(): Promise<{ newDocs: any[]; hasMore: boolean }> {
    const pageSize = Math.min(limit, maxRows - loadedDocs.length);
    if (pageSize <= 0) {
      return { newDocs: [], hasMore: false };
    }

    try {
      let query = (await buildBaseQuery()).limit(pageSize);
      if (lastDoc) {
        query = query.startAfter(lastDoc);
      }
      const snapshot = await query.get();
      const docs = snapshot.docs.map((doc: QueryDocumentSnapshot) => ({
        ...doc.data(),
        __path: doc.ref.path,
        __id: doc.id,
      }));

      if (docs.length > 0) {
        const headerSet = new Set<string>(headers);
        docs.forEach((doc: any) => {
          Object.keys(doc).forEach((k) => {
            if (k !== "__path" && k !== "__id") {
              headerSet.add(k);
            }
          });
        });
        if (headerSet.size !== headers.length) {
          headers = sortHeaders(Array.from(headerSet));
        }
      }

      loadedDocs = loadedDocs.concat(docs);
      if (snapshot.docs.length > 0) {
        lastDoc = snapshot.docs[snapshot.docs.length - 1];
      }

      const reachedCap = loadedDocs.length >= maxRows;
      if (reachedCap && docs.length === pageSize) {
        vscode.window.showInformationMessage(
          `Table shows the first ${maxRows} documents (setting "ketrik-firestore-studio.maxTableRows"). Use Lookup or Query Builder to narrow results.`
        );
      }
      const hasMore = docs.length === pageSize && !reachedCap;
      return { newDocs: docs, hasMore };
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to load documents for '${item.collectionId}': ${err.message}`);
      return { newDocs: [], hasMore: false };
    }
  }

  async function getQueriesFileUri(): Promise<vscode.Uri | null> {
    const wsFolder = vscode.workspace.workspaceFolders?.[0];
    if (!wsFolder) return null;
    return vscode.Uri.joinPath(wsFolder.uri, ".vscode", "firestore-queries.json");
  }

  async function loadSavedBookmarks(): Promise<Record<string, QueryClause[]>> {
    const uri = await getQueriesFileUri();
    if (!uri) return {};
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      const parsed = JSON.parse(Buffer.from(bytes).toString("utf8"));
      return parsed[item.collectionId] || {};
    } catch {
      return {};
    }
  }

  async function saveBookmark(name: string, clauses: QueryClause[]) {
    const uri = await getQueriesFileUri();
    if (!uri) {
      vscode.window.showWarningMessage("Open a workspace folder to save query bookmarks to .vscode/firestore-queries.json");
      return;
    }
    let existing: Record<string, any> = {};
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      existing = JSON.parse(Buffer.from(bytes).toString("utf8"));
    } catch {}

    if (!existing[item.collectionId]) {
      existing[item.collectionId] = {};
    }
    existing[item.collectionId][name] = clauses;

    const content = Buffer.from(JSON.stringify(existing, null, 2), "utf8");
    await vscode.workspace.fs.writeFile(uri, content);
    vscode.window.showInformationMessage(`Saved query bookmark '${name}'!`);
  }

  // ── Initial load ──────────────────────────────────────────────────────────
  panel.webview.html = getCollectionTableHtml(item);

  // Start the first data fetch immediately; the webview is seeded once it reports 'ready'.
  let hasMoreState = false;
  const initialLoad = loadMoreDocs().then((r) => {
    hasMoreState = r.hasMore;
  });

  // ── Message handler ───────────────────────────────────────────────────────
  const messageSubscription = panel.webview.onDidReceiveMessage(async (message) => {
    if (message.command === "ready") {
      // Sent on every (re)load of the webview, e.g. when a hidden tab becomes visible again.
      await initialLoad;
      const bookmarks = await loadSavedBookmarks();
      panel.webview.postMessage({
        type: "init",
        headers,
        docs: loadedDocs,
        hasMore: hasMoreState,
        bookmarks,
      });
      return;
    }

    if (message.command === "loadMore") {
      if (isLoading) {
        return;
      }
      isLoading = true;
      try {
        const prevHeaders = [...headers];
        const { newDocs, hasMore } = await loadMoreDocs();
        hasMoreState = hasMore;
        const headersChanged = headers.length !== prevHeaders.length;

        panel.webview.postMessage({
          type: "appendRows",
          headers,
          headersChanged,
          newDocs,
          allDocs: headersChanged ? loadedDocs : undefined,
          totalCount: loadedDocs.length,
          hasMore,
        });
      } finally {
        isLoading = false;
      }
    }

    if (message.command === "runServerQuery") {
      activeQueryClauses = (message.clauses as QueryClause[]) || [];
      loadedDocs = [];
      lastDoc = null;
      headers = [];
      isLoading = true;

      try {
        const { newDocs, hasMore } = await loadMoreDocs();
        hasMoreState = hasMore;
        panel.webview.postMessage({
          type: "queryResult",
          isActive: true,
          headers,
          docs: newDocs,
          hasMore,
        });
      } finally {
        isLoading = false;
      }
    }

    if (message.command === "resetServerQuery") {
      activeQueryClauses = [];
      loadedDocs = [];
      lastDoc = null;
      headers = [];
      isLoading = true;

      try {
        const { newDocs, hasMore } = await loadMoreDocs();
        hasMoreState = hasMore;
        panel.webview.postMessage({
          type: "queryResult",
          isActive: false,
          headers,
          docs: newDocs,
          hasMore,
        });
      } finally {
        isLoading = false;
      }
    }

    if (message.command === "openDoc" && message.path) {
      openPath(message.path, item.connectionId);
    }

    if (message.command === "exportJson") {
      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(`${item.collectionId}_export.json`),
        filters: { JSON: ["json"] },
      });
      if (uri) {
        try {
          await vscode.workspace.fs.writeFile(
            uri,
            Buffer.from(JSON.stringify(message.data, null, 2))
          );
          vscode.window.showInformationMessage("Exported JSON successfully!");
        } catch (err: any) {
          vscode.window.showErrorMessage(`Failed to export JSON: ${err.message}`);
        }
      }
    }

    if (message.command === "jumpToId") {
      const docId = (message.docId as string || "").trim();
      if (!docId) {
        return;
      }
      try {
        const docRef = (await getCollection()).doc(docId);
        const snapshot = await docRef.get();
        if (!snapshot.exists) {
          panel.webview.postMessage({
            type: "lookupNotFound",
            docId,
          });
          return;
        }

        const docData = {
          ...snapshot.data(),
          __path: snapshot.ref.path,
          __id: snapshot.id,
        };

        const docKeys = Object.keys(snapshot.data() || {});
        const headerSet = new Set<string>(headers);
        for (const k of docKeys) {
          headerSet.add(k);
        }
        headers = sortHeaders(Array.from(headerSet));

        panel.webview.postMessage({
          type: "lookupResult",
          headers,
          doc: docData,
        });
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to lookup document '${docId}': ${err.message}`);
      }
    }

    if (message.command === "clearSearch") {
      panel.webview.postMessage({
        type: "clearSearch",
        headers,
        docs: loadedDocs,
        hasMore: hasMoreState,
      });
    }

    if (message.command === "countCollection") {
      try {
        const query = await buildBaseQuery();
        const countSnapshot = await query.count().get();
        const count = countSnapshot.data().count;
        panel.webview.postMessage({
          type: "countResult",
          count,
        });
        vscode.window.showInformationMessage(`Collection '${item.collectionId}' has ${count.toLocaleString()} document(s).`);
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to count collection: ${err.message}`);
      }
    }

    if (message.command === "calculateAggregates") {
      let field = message.field;
      if (!field) {
        field = await vscode.window.showInputBox({
          title: `Calculate Aggregates for '${item.collectionId}'`,
          prompt: "Enter numeric field name (e.g. amount, price, score, rating)",
          placeHolder: "amount",
          validateInput: (v) => (v.trim() ? undefined : "Field name is required"),
        });
      }
      if (!field) return;

      try {
        const query = await buildBaseQuery();
        const aggSnapshot = await query.aggregate({
          count: AggregateField.count(),
          sum: AggregateField.sum(field.trim()),
          avg: AggregateField.average(field.trim()),
        }).get();
        const data = aggSnapshot.data();
        panel.webview.postMessage({
          type: "aggregateResult",
          field: field.trim(),
          count: data.count,
          sum: data.sum,
          avg: data.avg,
        });
        vscode.window.showInformationMessage(
          `Aggregates for '${field.trim()}': Count = ${data.count.toLocaleString()}, Sum = ${data.sum ?? 0}, Average = ${data.avg !== null && data.avg !== undefined ? Number(data.avg).toFixed(2) : "N/A"}`
        );
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to calculate aggregates for '${field}': ${err.message}`);
      }
    }

    if (message.command === "promptBatchUpdate") {
      const docIds = (message.docIds as string[]) || [];
      if (docIds.length === 0) return;

      const fieldName = await vscode.window.showInputBox({
        title: `Batch Update Field on ${docIds.length} Selected Document(s)`,
        prompt: "Enter field name to update or delete",
        placeHolder: "status",
        validateInput: (v) => (v.trim() ? undefined : "Field name is required"),
      });
      if (!fieldName) return;

      const operationChoice = await vscode.window.showQuickPick(
        [
          { label: "Set Field Value", detail: "Assign a new value (string, number, boolean, or JSON) to this field across all selected documents", action: "set" },
          { label: "Delete Field (FieldValue.delete)", detail: "Remove this field completely from all selected documents", action: "delete" },
        ],
        { title: `Batch Action for '${fieldName.trim()}'` }
      );
      if (!operationChoice) return;

      const isDeleteField = operationChoice.action === "delete";
      let parsedValue: any = null;

      if (!isDeleteField) {
        const valStr = await vscode.window.showInputBox({
          title: `Set Value for Field '${fieldName.trim()}'`,
          prompt: "Enter value (e.g. true, false, 42, active, {\"tag\": \"vip\"})",
          placeHolder: "active",
        });
        if (valStr === undefined) return;
        parsedValue = parseFilterValue(valStr);
      }

      const confirm = await vscode.window.showWarningMessage(
        isDeleteField
          ? `Delete field '${fieldName.trim()}' across ${docIds.length} documents?`
          : `Update field '${fieldName.trim()}' to ${JSON.stringify(parsedValue)} across ${docIds.length} documents?`,
        { modal: true },
        "Proceed with Batch Update"
      );
      if (confirm !== "Proceed with Batch Update") return;

      try {
        const firestore = await ConnectionManager.getInstance().getFirestore(item.connectionId);
        const collRef = firestore.collection(item.reference.path);
        const chunkSize = 400;

        for (let i = 0; i < docIds.length; i += chunkSize) {
          const chunk = docIds.slice(i, i + chunkSize);
          const batch = firestore.batch();
          for (const id of chunk) {
            const docRef = collRef.doc(id);
            if (isDeleteField) {
              batch.update(docRef, { [fieldName.trim()]: FieldValue.delete() });
            } else {
              batch.update(docRef, { [fieldName.trim()]: parsedValue });
            }
          }
          await batch.commit();
        }

        for (const id of docIds) {
          DocumentFileSystemProvider.getInstance().invalidateAndNotify(item.connectionId, `${item.reference.path}/${id}`);
        }

        vscode.window.showInformationMessage(`Successfully updated field '${fieldName.trim()}' across ${docIds.length} document(s)!`);

        // Update in-memory loaded docs
        loadedDocs = loadedDocs.map((doc: any) => {
          if (docIds.includes(doc.__id)) {
            const updated = { ...doc };
            if (isDeleteField) {
              delete updated[fieldName.trim()];
            } else {
              updated[fieldName.trim()] = parsedValue;
            }
            return updated;
          }
          return doc;
        });

        panel.webview.postMessage({
          type: "batchSuccess",
          operation: "update",
          field: fieldName.trim(),
          value: parsedValue,
          isDeleteField,
          docIds,
          docs: loadedDocs,
        });
      } catch (err: any) {
        vscode.window.showErrorMessage(`Batch update failed: ${err.message}`);
      }
    }

    if (message.command === "promptBatchDelete") {
      const docIds = (message.docIds as string[]) || [];
      if (docIds.length === 0) return;

      const confirm = await vscode.window.showWarningMessage(
        `Are you sure you want to permanently delete ${docIds.length} document(s)? This action cannot be undone.`,
        { modal: true },
        "Delete Permanently"
      );
      if (confirm !== "Delete Permanently") return;

      try {
        const firestore = await ConnectionManager.getInstance().getFirestore(item.connectionId);
        const collRef = firestore.collection(item.reference.path);
        const chunkSize = 400;

        for (let i = 0; i < docIds.length; i += chunkSize) {
          const chunk = docIds.slice(i, i + chunkSize);
          const batch = firestore.batch();
          for (const id of chunk) {
            batch.delete(collRef.doc(id));
          }
          await batch.commit();
        }

        for (const id of docIds) {
          DocumentFileSystemProvider.getInstance().invalidateAndNotify(item.connectionId, `${item.reference.path}/${id}`);
        }

        vscode.window.showInformationMessage(`Successfully deleted ${docIds.length} document(s)!`);
        loadedDocs = loadedDocs.filter((doc: any) => !docIds.includes(doc.__id));

        panel.webview.postMessage({
          type: "batchSuccess",
          operation: "delete",
          docIds,
          docs: loadedDocs,
        });
      } catch (err: any) {
        vscode.window.showErrorMessage(`Batch delete failed: ${err.message}`);
      }
    }

    if (message.command === "promptSaveBookmark") {
      const clauses = (message.clauses as QueryClause[]) || [];
      if (clauses.length === 0) {
        vscode.window.showWarningMessage("No query clauses defined to bookmark.");
        return;
      }
      const bookmarkName = await vscode.window.showInputBox({
        title: "Bookmark Server Query",
        prompt: "Enter a friendly name for this query bookmark",
        placeHolder: "Active Premium Users",
        validateInput: (v) => (v.trim() ? undefined : "Bookmark name cannot be empty"),
      });
      if (!bookmarkName) return;

      await saveBookmark(bookmarkName.trim(), clauses);
      const updatedBookmarks = await loadSavedBookmarks();
      panel.webview.postMessage({
        type: "bookmarksLoaded",
        bookmarks: updatedBookmarks,
      });
    }

    if (message.command === "loadBookmarks") {
      const bookmarks = await loadSavedBookmarks();
      panel.webview.postMessage({
        type: "bookmarksLoaded",
        bookmarks,
      });
    }
  });

  panel.onDidDispose(() => {
    messageSubscription.dispose();
    loadedDocs = [];
    headers = [];
    lastDoc = null;
    activeQueryClauses = [];
  });
}
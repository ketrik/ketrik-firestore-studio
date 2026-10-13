import { QueryDocumentSnapshot, Query } from "firebase-admin/firestore";
import * as vscode from "vscode";
import { CollectionItem } from "../explorer/items";
import { ConnectionManager } from "../connections/ConnectionManager";
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
        const parsedVal = parseFilterValue(clause.value);
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

      if (docs.length > 0 && headers.length === 0) {
        headers = sortHeaders(Object.keys(docs[0]).filter((k) => k !== "__path" && k !== "__id"));
      }

      // Merge any new header keys from subsequent pages.
      if (docs.length > 0) {
        const newKeys = Object.keys(docs[0]).filter((k) => k !== "__path" && k !== "__id" && !headers.includes(k));
        if (newKeys.length > 0) {
          headers = sortHeaders([...headers, ...newKeys]);
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
      panel.webview.postMessage({
        type: "init",
        headers,
        docs: loadedDocs,
        hasMore: hasMoreState,
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
        await vscode.workspace.fs.writeFile(
          uri,
          Buffer.from(JSON.stringify(message.data, null, 2))
        );
        vscode.window.showInformationMessage("Exported JSON successfully!");
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
        const newHeaders = [...headers];
        for (const k of docKeys) {
          if (!newHeaders.includes(k)) {
            newHeaders.push(k);
          }
        }
        headers = newHeaders;

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
  });

  panel.onDidDispose(() => {
    messageSubscription.dispose();
    loadedDocs = [];
    headers = [];
    lastDoc = null;
    activeQueryClauses = [];
  });
}
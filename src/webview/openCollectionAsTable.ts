import { QueryDocumentSnapshot, Query, AggregateField, FieldValue, FieldPath, Filter } from "firebase-admin/firestore";
import * as vscode from "vscode";
import { CollectionItem, DocumentFieldItem } from "../explorer/items";
import { ConnectionManager } from "../connections/ConnectionManager";
import { DocumentFileSystemProvider } from "../editor/DocumentFileSystemProvider";
import openPath from "../commands/openPath";
import { QueryClause, sortHeaders, parseFilterValue } from "./common/tableUtils";
import { getCollectionTableHtml } from "./collectionTable/collectionTableHtml";
import { openFieldAsTable } from "./openFieldAsTable";
import { LocalJsonService } from "../services/LocalJsonService";
import { CostService } from "../cost/costService";

export { QueryClause };

export interface CollectionTableTarget {
  connectionId: string;
  collectionId: string;
  collectionPath?: string;
  reference?: import("firebase-admin/firestore").CollectionReference;
  isCollectionGroup?: boolean;
}

function sanitizeFirestoreValue(val: any): any {
  if (val === null || val === undefined) return val;
  if (typeof val !== "object") return val;
  if (val instanceof Date) return val.toISOString();
  if (typeof val._seconds === "number" && typeof val._nanoseconds === "number") {
    return { _seconds: val._seconds, _nanoseconds: val._nanoseconds };
  }
  if (typeof val._latitude === "number" && typeof val._longitude === "number") {
    return { _latitude: val._latitude, _longitude: val._longitude };
  }
  if (typeof val.path === "string" && (val._firestore || val.constructor?.name === "DocumentReference")) {
    return `[Ref: ${val.path}]`;
  }
  if (Buffer.isBuffer(val) || val instanceof Uint8Array) {
    return `[Blob: ${val.length} bytes]`;
  }
  if (Array.isArray(val)) {
    return val.map(sanitizeFirestoreValue);
  }
  const result: Record<string, any> = {};
  for (const k of Object.keys(val)) {
    result[k] = sanitizeFirestoreValue(val[k]);
  }
  return result;
}

export async function openCollectionAsTable(
  item: CollectionItem | CollectionTableTarget,
  isCollectionGroup = false
) {
  const isGroup = isCollectionGroup || (item as any).isCollectionGroup === true;
  const collectionId = item.collectionId;
  const connectionId = item.connectionId;
  const collectionPath =
    (item as any).reference?.path ||
    (item as any).collectionPath ||
    collectionId;

  const panel = vscode.window.createWebviewPanel(
    "firestoreCollectionTable",
    isGroup ? `Collection Group: ${collectionId}` : `Collection: ${collectionPath}`,
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
    }
  );

  const config = vscode.workspace.getConfiguration("ketrik-firestore-studio");
  const limit = (config.get<number>("pagingLimit") as number) || 10;
  const maxRows = Math.max(1, config.get<number>("maxTableRows") ?? 100);

  let loadedDocs: any[] = [];
  let lastDoc: QueryDocumentSnapshot | null = null;
  let headers: string[] = [];
  let activeQueryClauses: QueryClause[] = [];
  let activeMatchMode: "and" | "or" = "and";
  let isLoading = false;

  /**
   * Resolve the collection or collection group query target through the live connection.
   */
  async function getBaseQueryTarget(): Promise<Query> {
    const firestore = await ConnectionManager.getInstance().getFirestore(connectionId);
    if (isGroup) {
      return firestore.collectionGroup(collectionId);
    }
    return firestore.collection(collectionPath);
  }

  /** Build an executable Firestore query applying all active where clauses. */
  async function buildBaseQuery(): Promise<Query> {
    let q: Query = await getBaseQueryTarget();
    if (activeQueryClauses.length === 0) {
      return q;
    }

    const filters: import("firebase-admin/firestore").Filter[] = [];

    for (const clause of activeQueryClauses) {
      if (!clause.field || !clause.op) continue;

      if (clause.op === "starts-with") {
        const prefix = String(clause.value || "");
        const endPrefix = prefix + "\uf8ff";
        // Compiles to field >= prefix AND field < prefix + \uf8ff
        filters.push(
          Filter.and(
            Filter.where(clause.field, ">=", prefix),
            Filter.where(clause.field, "<", endPrefix)
          )
        );
      } else {
        const parsedVal = parseFilterValue(clause.value, clause.op);
        filters.push(Filter.where(clause.field, clause.op, parsedVal));
      }
    }

    if (filters.length === 0) {
      return q;
    }

    if (activeMatchMode === "or") {
      q = q.where(Filter.or(...filters));
    } else {
      q = q.where(Filter.and(...filters));
    }

    return q;
  }

  /** Append the next page of documents from Firestore (supports custom count, capped at maxRows and 1,000 for safety). */
  async function loadMoreDocs(requestedCount?: number): Promise<{ newDocs: any[]; hasMore: boolean }> {
    const effectiveLimit = Math.min(requestedCount && requestedCount > 0 ? requestedCount : limit, 1000);
    // If the user explicitly asks for a larger batch (e.g. 100 or 1000), allow expanding up to 1,000 max
    const effectiveMaxRows = requestedCount && requestedCount > limit ? Math.min(1000, Math.max(maxRows, requestedCount)) : maxRows;
    const conn = ConnectionManager.getInstance().getConnection(connectionId);
    if (conn?.isLocalJson) {
      const rawDocs = LocalJsonService.getInstance().listDocuments(conn, collectionId);
      const offset = loadedDocs.length;
      const targetCount = Math.min(rawDocs.length, effectiveMaxRows);
      const pageSize = Math.min(effectiveLimit, targetCount - offset);

      if (pageSize <= 0) {
        return { newDocs: [], hasMore: false };
      }

      const docs = rawDocs.slice(offset, offset + pageSize).map((d) => ({
        ...sanitizeFirestoreValue(d.data),
        __path: `${collectionId}/${d.id}`,
        __id: d.id,
        __parentPath: null,
      }));

      if (docs.length > 0) {
        const headerSet = new Set<string>(headers);
        docs.forEach((doc: any) => {
          Object.keys(doc).forEach((k) => {
            if (k !== "__path" && k !== "__id" && k !== "__parentPath") {
              headerSet.add(k);
            }
          });
        });
        headers = sortHeaders(Array.from(headerSet));
      }
      loadedDocs = loadedDocs.concat(docs);
      const hasMore = loadedDocs.length < targetCount && loadedDocs.length < rawDocs.length;
      return { newDocs: docs, hasMore };
    }

    // Reset lastDoc cursor if all loaded docs were deleted so it starts from the beginning
    if (loadedDocs.length === 0) {
      lastDoc = null;
    }

    const pageSize = Math.min(effectiveLimit, effectiveMaxRows - loadedDocs.length);
    if (pageSize <= 0) {
      return { newDocs: [], hasMore: false };
    }

    try {
      let query = (await buildBaseQuery()).limit(pageSize);
      if (lastDoc) {
        query = query.startAfter(lastDoc);
      }
      const snapshot = await query.get();
      CostService.getInstance().recordOperation(connectionId, "read", snapshot.docs.length);
      const docs = snapshot.docs.map((doc: QueryDocumentSnapshot) => ({
        ...sanitizeFirestoreValue(doc.data()),
        __path: doc.ref.path,
        __id: doc.id,
        __parentPath: doc.ref.parent && doc.ref.parent.parent ? doc.ref.parent.parent.path : null,
      }));

      if (docs.length > 0) {
        const headerSet = new Set<string>(headers);
        docs.forEach((doc: any) => {
          Object.keys(doc).forEach((k) => {
            if (k !== "__path" && k !== "__id" && k !== "__parentPath") {
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

      const reachedCap = loadedDocs.length >= effectiveMaxRows;
      if (reachedCap && docs.length === pageSize) {
        vscode.window.showInformationMessage(
          `Table shows ${loadedDocs.length} documents (maximum safety limit: ${effectiveMaxRows}). Use Lookup or Query Builder to narrow results.`
        );
      }
      const hasMore = docs.length === pageSize && !reachedCap;
      return { newDocs: docs, hasMore };
    } catch (err: any) {
      const match = (err.message || "").match(/https:\/\/console\.firebase\.google\.com\S+/);
      if (match) {
        const indexUrl = match[0];
        vscode.window.showErrorMessage(
          `Query requires a composite index. Create it via Firebase Console or Visual Studio Code:`,
          "Create Index in Firebase Console",
          "Build / Add to firestore.indexes.json",
          "Copy Index URL"
        ).then(async (action) => {
          if (action === "Create Index in Firebase Console") {
            vscode.env.openExternal(vscode.Uri.parse(indexUrl));
          } else if (action === "Build / Add to firestore.indexes.json") {
            // Trigger Visual Composite Index Builder pre-seeded with this collection & query
            await vscode.commands.executeCommand("ketrik-firestore-studio.buildCompositeIndex", {
              connectionId,
              collectionGroup: collectionId,
              collectionId,
            });
          } else if (action === "Copy Index URL") {
            vscode.env.clipboard.writeText(indexUrl);
            vscode.window.showInformationMessage("Index URL copied to clipboard!");
          }
        });
      } else {
        vscode.window.showErrorMessage(`Failed to load documents for '${collectionId}': ${err.message}`);
      }

      return { newDocs: [], hasMore: false };
    }
  }

  async function getQueriesFileUri(): Promise<vscode.Uri | null> {
    const wsFolder = vscode.workspace.workspaceFolders?.[0];
    if (!wsFolder) return null;
    return vscode.Uri.joinPath(wsFolder.uri, ".vscode", "firestore-queries.json");
  }

  const bookmarkKey = isGroup ? `group:${collectionId}` : collectionId;

  async function loadSavedBookmarks(): Promise<Record<string, QueryClause[]>> {
    const uri = await getQueriesFileUri();
    if (!uri) return {};
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      const parsed = JSON.parse(Buffer.from(bytes).toString("utf8"));
      return parsed[bookmarkKey] || {};
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

    if (!existing[bookmarkKey]) {
      existing[bookmarkKey] = {};
    }
    existing[bookmarkKey][name] = clauses;

    const content = Buffer.from(JSON.stringify(existing, null, 2), "utf8");
    await vscode.workspace.fs.writeFile(uri, content);
    vscode.window.showInformationMessage(`Saved query bookmark '${name}'!`);
  }

  // ── Data loading & Message handler ─────────────────────────────────────────
  // Start the first data fetch immediately; the webview is seeded once it reports 'ready'.
  let hasMoreState = false;
  const initialLoad = loadMoreDocs()
    .then((r) => {
      hasMoreState = r.hasMore;
    })
    .catch((err) => {
      vscode.window.showErrorMessage(`Failed to load initial documents: ${err.message}`);
    });

  // Assign HTML content to render webview and trigger client-side ready handshake
  panel.webview.html = getCollectionTableHtml({ collectionId, connectionId }, isGroup);

  const messageSubscription = panel.webview.onDidReceiveMessage(async (message) => {
    if (message.command === "ready") {
      // Sent on every (re)load of the webview, e.g. when a hidden tab becomes visible again.
      try {
        await initialLoad;
      } catch {}
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
        const requestedCount = typeof message.count === "number" ? message.count : undefined;
        const { newDocs, hasMore } = await loadMoreDocs(requestedCount);
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
      activeMatchMode = message.matchMode === "or" ? "or" : "and";
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
      activeMatchMode = "and";
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

    if (message.command === "openRef" && message.refPath) {
      openPath(message.refPath, connectionId);
      return;
    }

    if (message.command === "refresh") {
      loadedDocs = [];
      lastDoc = null;
      headers = [];
      isLoading = true;
      try {
        const { hasMore } = await loadMoreDocs();
        hasMoreState = hasMore;
        const bookmarks = await loadSavedBookmarks();
        panel.webview.postMessage({
          type: "init",
          headers,
          docs: loadedDocs,
          hasMore: hasMoreState,
          bookmarks,
        });
      } finally {
        isLoading = false;
      }
      return;
    }

    if (message.command === "createDoc") {
      try {
        const firestore = await ConnectionManager.getInstance().getFirestore(connectionId);
        const collRef = firestore.collection(collectionPath);
        const docId = await vscode.window.showInputBox({
          prompt: "Enter Document ID (leave blank for auto-generated ID)",
          placeHolder: "Document ID",
        });
        if (docId === undefined) return;

        const json = await vscode.window.showInputBox({
          prompt: "Enter document data as JSON (press Enter to create empty document)",
          placeHolder: "{}",
          value: "{}",
        });
        if (json === undefined) return;

        let data: any = {};
        const trimmed = (json || "").trim();
        if (trimmed && trimmed !== "{}") {
          try {
            data = JSON.parse(trimmed);
          } catch {
            vscode.window.showErrorMessage("Invalid JSON.");
            return;
          }
        }

        const docRef = docId.trim() ? collRef.doc(docId.trim()) : collRef.doc();
        await docRef.set(data);
        DocumentFileSystemProvider.getInstance().invalidateAndNotify(connectionId, docRef.path);
        vscode.window.showInformationMessage(`Document '${docRef.id}' created!`);

        // Reload collection table to show new document
        loadedDocs = [];
        lastDoc = null;
        headers = [];
        const { hasMore } = await loadMoreDocs();
        hasMoreState = hasMore;
        const bookmarks = await loadSavedBookmarks();
        panel.webview.postMessage({
          type: "init",
          headers,
          docs: loadedDocs,
          hasMore: hasMoreState,
          bookmarks,
        });
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to create document: ${err.message}`);
      }
      return;
    }

    if (message.command === "openDoc" && message.path) {
      openPath(message.path, connectionId);
    }

    if (message.command === "updateField" && message.docPath && message.field !== undefined) {
      const { docPath, field, value } = message;
      try {
        // Sanitize value for write
        let writeVal: any = value;
        if (value && typeof value === "object" && typeof value._seconds === "number" && typeof value._nanoseconds === "number") {
          const { Timestamp } = await import("firebase-admin/firestore");
          writeVal = new Timestamp(value._seconds, value._nanoseconds);
        }

        const conn = ConnectionManager.getInstance().getConnection(connectionId);
        if (conn?.isLocalJson) {
          LocalJsonService.getInstance().updateField(conn, docPath, field, writeVal);
        } else {
          const firestore = await ConnectionManager.getInstance().getFirestore(connectionId);
          const docRef = firestore.doc(docPath);
          await docRef.update(new FieldPath(field), writeVal);
        }

        // Invalidate DocumentFileSystemProvider cache so open JSON editors sync immediately
        DocumentFileSystemProvider.getInstance().invalidateAndNotify(connectionId, docPath);

        // Update local loadedDocs state
        const targetDoc = loadedDocs.find((d) => d.__path === docPath);
        if (targetDoc) {
          targetDoc[field] = sanitizeFirestoreValue(writeVal);
        }

        panel.webview.postMessage({
          type: "fieldUpdated",
          docPath,
          field,
          value: sanitizeFirestoreValue(writeVal),
        });
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to update '${field}': ${err.message}`);
        panel.webview.postMessage({
          type: "fieldUpdateFailed",
          docPath,
          field,
          error: err.message,
        });
      }
      return;
    }

    if (message.command === "openFieldAsTable" && message.docPath && message.field) {
      try {
        const firestore = await ConnectionManager.getInstance().getFirestore(connectionId);
        const docSnap = await firestore.doc(message.docPath).get();
        if (docSnap.exists) {
          const data = docSnap.data() || {};
          const fieldVal = data[message.field];
          const fieldItem = new DocumentFieldItem(
            message.field,
            fieldVal,
            docSnap.ref,
            connectionId
          );
          await openFieldAsTable(fieldItem);
        }
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to open field table: ${err.message}`);
      }
      return;
    }

    if (message.command === "exportJson") {
      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(`${isGroup ? "group_" : ""}${collectionId}_export.json`),
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
        const firestore = await ConnectionManager.getInstance().getFirestore(connectionId);
        let snapshot: QueryDocumentSnapshot | import("firebase-admin/firestore").DocumentSnapshot | null = null;

        if (isGroup) {
          if (docId.includes("/")) {
            const s = await firestore.doc(docId).get();
            if (s.exists) {
              snapshot = s;
            }
          } else {
            const querySnap = await firestore
              .collectionGroup(collectionId)
              .where(FieldPath.documentId(), "==", docId)
              .limit(1)
              .get();
            if (!querySnap.empty) {
              snapshot = querySnap.docs[0];
            }
          }
        } else {
          const s = await firestore.collection(collectionPath).doc(docId).get();
          if (s.exists) {
            snapshot = s;
          }
        }

        if (!snapshot || !snapshot.exists) {
          panel.webview.postMessage({
            type: "lookupNotFound",
            docId,
          });
          return;
        }

        const docData = {
          ...sanitizeFirestoreValue(snapshot.data()),
          __path: snapshot.ref.path,
          __id: snapshot.id,
          __parentPath: snapshot.ref.parent && snapshot.ref.parent.parent ? snapshot.ref.parent.parent.path : null,
        };

        const docKeys = Object.keys(snapshot.data() || {});
        const headerSet = new Set<string>(headers);
        for (const k of docKeys) {
          if (k !== "__path" && k !== "__id" && k !== "__parentPath") {
            headerSet.add(k);
          }
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
        vscode.window.showInformationMessage(
          `${isGroup ? "Collection Group" : "Collection"} '${collectionId}' has ${count.toLocaleString()} document(s).`
        );
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to count collection: ${err.message}`);
      }
    }

    if (message.command === "estimateQueryCost") {
      try {
        const query = await buildBaseQuery();
        const countSnapshot = await query.count().get();
        const count = countSnapshot.data().count;
        const estimation = CostService.getInstance().estimateQueryCost(count);
        panel.webview.postMessage({
          type: "queryCostEstimateResult",
          count: estimation.documentCount,
          cost: estimation.estimatedCost,
          warning: estimation.warning,
        });

        const costFormatted = `$${estimation.estimatedCost.toFixed(5)}`;
        if (estimation.warning) {
          vscode.window.showWarningMessage(
            `💰 Estimated Query Cost: ${costFormatted} for ${count.toLocaleString()} document reads. ⚠️ ${estimation.warning}`
          );
        } else {
          vscode.window.showInformationMessage(
            `💰 Estimated Query Cost: ${costFormatted} for ${count.toLocaleString()} document read(s) ($0.06/100K reads).`
          );
        }
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to estimate query cost: ${err.message}`);
      }
    }

    if (message.command === "calculateAggregates") {
      let field = message.field;
      const detectedNumericFields: string[] = Array.isArray(message.numericFields)
        ? message.numericFields.filter((f: any) => typeof f === "string" && f.trim().length > 0)
        : [];

      if (!field) {
        if (detectedNumericFields.length > 0) {
          const quickPickItems: vscode.QuickPickItem[] = detectedNumericFields.map((f) => ({
            label: `$(symbol-number) ${f}`,
            description: "Numeric field",
            detail: `Compute Sum and Average for '${f}'`,
          }));
          quickPickItems.push({
            label: "$(edit) Custom Field Path...",
            description: "Manual entry",
            detail: "Enter a custom field or nested dot-notation path to aggregate",
          });

          const selected = await vscode.window.showQuickPick(quickPickItems, {
            title: `Calculate Aggregates for ${isGroup ? "Collection Group" : "Collection"} '${collectionId}'`,
            placeHolder: "Select a numeric field to compute Sum and Average",
          });

          if (!selected) return;

          if (selected.label.startsWith("$(edit)")) {
            field = await vscode.window.showInputBox({
              title: `Calculate Aggregates for ${isGroup ? "Collection Group" : "Collection"} '${collectionId}'`,
              prompt: "Enter numeric field path (e.g. amount, stats.price, score)",
              placeHolder: detectedNumericFields[0] || "amount",
              validateInput: (v) => (v.trim() ? undefined : "Field path is required"),
            });
          } else {
            field = selected.label.replace(/^\$\(symbol-number\)\s*/, "");
          }
        } else {
          field = await vscode.window.showInputBox({
            title: `Calculate Aggregates for ${isGroup ? "Collection Group" : "Collection"} '${collectionId}'`,
            prompt: "Enter numeric field name (e.g. amount, price, score, rating)",
            placeHolder: "amount",
            validateInput: (v) => (v.trim() ? undefined : "Field name is required"),
          });
        }
      }
      if (!field) return;

      try {
        panel.webview.postMessage({ type: "aggregateStart" });
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
        panel.webview.postMessage({ type: "aggregateError", error: err.message });
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
        const firestore = await ConnectionManager.getInstance().getFirestore(connectionId);
        const docPathMap = new Map<string, string>();
        loadedDocs.forEach((d) => {
          if (d.__id && d.__path) {
            docPathMap.set(d.__id, d.__path);
          }
        });

        const chunkSize = 400;

        for (let i = 0; i < docIds.length; i += chunkSize) {
          const chunk = docIds.slice(i, i + chunkSize);
          const batch = firestore.batch();
          for (const id of chunk) {
            const targetPath = docPathMap.get(id) || `${collectionPath}/${id}`;
            const docRef = firestore.doc(targetPath);
            if (isDeleteField) {
              batch.update(docRef, { [fieldName.trim()]: FieldValue.delete() });
            } else {
              batch.update(docRef, { [fieldName.trim()]: parsedValue });
            }
          }
          await batch.commit();
        }

        DocumentFileSystemProvider.getInstance().invalidateAndNotifyMany(
          docIds.map((id) => ({
            connectionId,
            docPath: docPathMap.get(id) || `${collectionPath}/${id}`,
          }))
        );

        vscode.window.showInformationMessage(`Successfully updated field '${fieldName.trim()}' across ${docIds.length} document(s)!`);

        // Update in-memory loaded docs using O(1) Set lookup
        const docIdSet = new Set(docIds);
        loadedDocs = loadedDocs.map((doc: any) => {
          if (docIdSet.has(doc.__id)) {
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
        const firestore = await ConnectionManager.getInstance().getFirestore(connectionId);
        const docPathMap = new Map<string, string>();
        loadedDocs.forEach((d) => {
          if (d.__id && d.__path) {
            docPathMap.set(d.__id, d.__path);
          }
        });

        const chunkSize = 400;

        for (let i = 0; i < docIds.length; i += chunkSize) {
          const chunk = docIds.slice(i, i + chunkSize);
          const batch = firestore.batch();
          for (const id of chunk) {
            const targetPath = docPathMap.get(id) || `${collectionPath}/${id}`;
            batch.delete(firestore.doc(targetPath));
          }
          await batch.commit();
        }

        DocumentFileSystemProvider.getInstance().invalidateAndNotifyMany(
          docIds.map((id) => ({
            connectionId,
            docPath: docPathMap.get(id) || `${collectionPath}/${id}`,
          }))
        );

        vscode.window.showInformationMessage(`Successfully deleted ${docIds.length} document(s)!`);
        const delDocIdSet = new Set(docIds);
        loadedDocs = loadedDocs.filter((doc: any) => !delDocIdSet.has(doc.__id));

        // When documents are deleted, if more documents exist in Firestore,
        // automatically replenish the table by loading as many documents as were deleted!
        if (hasMoreState && docIds.length > 0) {
          const replenishCount = docIds.length;
          const { newDocs, hasMore } = await loadMoreDocs(replenishCount);
          hasMoreState = hasMore;
          panel.webview.postMessage({
            type: "batchSuccess",
            operation: "delete",
            docIds,
            docs: loadedDocs,
            hasMore: hasMoreState,
          });
          if (newDocs.length > 0) {
            panel.webview.postMessage({
              type: "appendRows",
              headers,
              headersChanged: true,
              newDocs,
              allDocs: loadedDocs,
              totalCount: loadedDocs.length,
              hasMore: hasMoreState,
            });
          }
        } else {
          panel.webview.postMessage({
            type: "batchSuccess",
            operation: "delete",
            docIds,
            docs: loadedDocs,
            hasMore: hasMoreState,
          });
        }
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

    if (message.command === "toggleLiveWatch") {
      toggleLiveWatch();
    }
  });

  // ── Live Watch Mode (Real-Time onSnapshot & Inactivity Watchdog) ─────────
  let liveWatchUnsubscribe: (() => void) | null = null;
  let liveWatchTimeout: NodeJS.Timeout | null = null;
  const LIVE_WATCH_AUTO_PAUSE_MS = 5 * 60 * 1000; // 5 minutes inactivity auto-pause

  function stopLiveWatch(silent = false) {
    if (liveWatchUnsubscribe) {
      liveWatchUnsubscribe();
      liveWatchUnsubscribe = null;
    }
    if (liveWatchTimeout) {
      clearTimeout(liveWatchTimeout);
      liveWatchTimeout = null;
    }
    panel.webview.postMessage({ type: "liveWatchState", active: false });
    if (!silent) {
      vscode.window.showInformationMessage(
        `Live Watch paused for ${isGroup ? "Collection Group" : "Collection"} '${collectionId}'.`
      );
    }
  }

  function resetLiveWatchWatchdog() {
    if (liveWatchTimeout) {
      clearTimeout(liveWatchTimeout);
    }
    liveWatchTimeout = setTimeout(() => {
      if (liveWatchUnsubscribe) {
        stopLiveWatch(true);
        vscode.window.showWarningMessage(
          `Live Watch auto-paused after 5 minutes of inactivity to protect Firestore quota for '${collectionId}'. Click 'Live Watch' to resume.`
        );
      }
    }, LIVE_WATCH_AUTO_PAUSE_MS);
  }

  async function startLiveWatch() {
    const conn = ConnectionManager.getInstance().getConnection(connectionId);
    if (conn?.isLocalJson) {
      vscode.window.showWarningMessage(
        "Live Watch mode is designed for Cloud Firestore and Firebase Emulators. Local JSON databases update synchronously."
      );
      return;
    }

    try {
      const baseQuery = await buildBaseQuery();
      const watchQuery = baseQuery.limit(Math.min(maxRows, 200));

      let isInitialSnapshot = true;
      liveWatchUnsubscribe = watchQuery.onSnapshot(
        (snapshot) => {
          resetLiveWatchWatchdog();

          if (isInitialSnapshot) {
            isInitialSnapshot = false;
            return;
          }

          const docChanges = snapshot.docChanges();
          for (const change of docChanges) {
            const doc = change.doc;
            const docData = {
              ...sanitizeFirestoreValue(doc.data()),
              __path: doc.ref.path,
              __id: doc.id,
              __parentPath: doc.ref.parent && doc.ref.parent.parent ? doc.ref.parent.parent.path : null,
            };

            // Invalidate virtual file system cache for open editor tabs
            DocumentFileSystemProvider.getInstance().invalidateAndNotify(connectionId, doc.ref.path);

            if (change.type === "added") {
              const headerSet = new Set(headers);
              Object.keys(docData).forEach((k) => {
                if (k !== "__path" && k !== "__id" && k !== "__parentPath") {
                  headerSet.add(k);
                }
              });
              const prevLen = headers.length;
              headers = sortHeaders(Array.from(headerSet));
              const headersChanged = headers.length !== prevLen;

              // Prepend or replace in loadedDocs
              const exIdx = loadedDocs.findIndex((d) => d.__path === doc.ref.path);
              if (exIdx >= 0) {
                loadedDocs[exIdx] = docData;
              } else {
                loadedDocs.unshift(docData);
              }

              panel.webview.postMessage({
                type: "liveWatchEvent",
                changeType: "added",
                doc: docData,
                docId: doc.id,
                docPath: doc.ref.path,
                updatedHeaders: headersChanged ? headers : undefined,
              });
            } else if (change.type === "modified") {
              const headerSet = new Set(headers);
              Object.keys(docData).forEach((k) => {
                if (k !== "__path" && k !== "__id" && k !== "__parentPath") {
                  headerSet.add(k);
                }
              });
              const prevLen = headers.length;
              headers = sortHeaders(Array.from(headerSet));
              const headersChanged = headers.length !== prevLen;

              const idx = loadedDocs.findIndex((d) => d.__path === doc.ref.path);
              if (idx >= 0) {
                loadedDocs[idx] = docData;
              } else {
                loadedDocs.unshift(docData);
              }

              panel.webview.postMessage({
                type: "liveWatchEvent",
                changeType: "modified",
                doc: docData,
                docId: doc.id,
                docPath: doc.ref.path,
                updatedHeaders: headersChanged ? headers : undefined,
              });
            } else if (change.type === "removed") {
              loadedDocs = loadedDocs.filter((d) => d.__path !== doc.ref.path);
              panel.webview.postMessage({
                type: "liveWatchEvent",
                changeType: "removed",
                docId: doc.id,
                docPath: doc.ref.path,
              });
            }
          }
        },
        (error) => {
          stopLiveWatch(true);
          vscode.window.showErrorMessage(`Live Watch subscription error: ${error.message}`);
        }
      );

      resetLiveWatchWatchdog();
      panel.webview.postMessage({ type: "liveWatchState", active: true });
      vscode.window.showInformationMessage(
        `📡 Live Watch active for ${isGroup ? "Collection Group" : "Collection"} '${collectionId}'. Real-time mutations will flash in the table.`
      );
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to start Live Watch: ${err.message}`);
    }
  }

  function toggleLiveWatch() {
    if (liveWatchUnsubscribe) {
      stopLiveWatch();
    } else {
      startLiveWatch();
    }
  }

  panel.onDidDispose(() => {
    stopLiveWatch(true);
    messageSubscription.dispose();
    loadedDocs = [];
    headers = [];
    lastDoc = null;
    activeQueryClauses = [];
  });
}
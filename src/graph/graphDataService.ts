import { ConnectionManager } from "../connections/ConnectionManager.js";
import { LocalJsonService } from "../services/LocalJsonService.js";
import { GraphData, GraphNode, GraphEdge } from "./graphModel.js";
import { CostService } from "../cost/costService.js";

/**
 * Format a value preview for node display.
 */
function formatValuePreview(val: any): string {
  if (val === null) return "null";
  if (val === undefined) return "undefined";
  if (typeof val === "boolean" || typeof val === "number") return String(val);
  if (typeof val === "string") {
    return val.length > 25 ? `"${val.slice(0, 22)}..."` : `"${val}"`;
  }
  if (Array.isArray(val)) {
    return `[${val.length} items]`;
  }
  if (typeof val === "object") {
    if (typeof val._seconds === "number" && typeof val._nanoseconds === "number") {
      const d = new Date(val._seconds * 1000);
      return d.toLocaleDateString();
    }
    if (typeof val._latitude === "number" && typeof val._longitude === "number") {
      return `Geo(${val._latitude.toFixed(2)}, ${val._longitude.toFixed(2)})`;
    }
    if (val.path && typeof val.path === "string") {
      return `Ref(${val.path})`;
    }
    return `{${Object.keys(val).length} keys}`;
  }
  return String(val);
}

/**
 * Extract fields and detect DocumentReference or path references.
 */
function extractFields(data: Record<string, any>): {
  fields: { name: string; type: string; valuePreview: string; isRef?: boolean; refPath?: string }[];
  detectedRefs: { field: string; path: string }[];
} {
  const fields: { name: string; type: string; valuePreview: string; isRef?: boolean; refPath?: string }[] = [];
  const detectedRefs: { field: string; path: string }[] = [];

  for (const [key, val] of Object.entries(data)) {
    let type: string = typeof val;
    let isRef = false;
    let refPath: string | undefined;

    if (val === null) {
      type = "null";
    } else if (Array.isArray(val)) {
      type = "array";
    } else if (typeof val === "object") {
      if (val instanceof Date) {
        type = "timestamp";
      } else if (typeof val._seconds === "number" && typeof val._nanoseconds === "number") {
        type = "timestamp";
      } else if (typeof val._latitude === "number" && typeof val._longitude === "number") {
        type = "geopoint";
      } else if (val.path && typeof val.path === "string" && (val._firestore || val.constructor?.name === "DocumentReference")) {
        type = "reference";
        isRef = true;
        refPath = val.path;
      } else if (typeof val.path === "string" && val.path.includes("/")) {
        // String ref heuristic or JSON ref
        type = "reference";
        isRef = true;
        refPath = val.path;
      } else {
        type = "map";
      }
    } else if (typeof val === "string") {
      // Check if string looks like an explicit document reference path e.g. "users/abc"
      const parts = val.split("/");
      if (parts.length >= 2 && parts.length % 2 === 0 && !val.includes("://") && !val.includes(" ") && val.length < 120) {
        if (key.toLowerCase().endsWith("ref") || key.toLowerCase().endsWith("id") || key.toLowerCase().includes("user") || key.toLowerCase().includes("parent")) {
          isRef = true;
          refPath = val;
        }
      }
    }

    if (isRef && refPath) {
      detectedRefs.push({ field: key, path: refPath });
    }

    fields.push({
      name: key,
      type,
      valuePreview: formatValuePreview(val),
      isRef,
      refPath,
    });
  }

  // Show first 6 key fields on node card to avoid overwhelming box height
  const topFields = fields.slice(0, 6);

  return { fields: topFields, detectedRefs };
}

export class GraphDataService {
  private static instance: GraphDataService;

  public static getInstance(): GraphDataService {
    if (!GraphDataService.instance) {
      GraphDataService.instance = new GraphDataService();
    }
    return GraphDataService.instance;
  }

  /**
   * Build initial graph data for a collection or document root.
   */
  public async buildGraphData(
    connectionId: string,
    rootPath: string,
    maxSampleDocs = 15
  ): Promise<GraphData> {
    const connectionManager = ConnectionManager.getInstance();
    const conn = connectionManager.getConnection(connectionId);
    if (!conn) {
      throw new Error(`Connection '${connectionId}' not found.`);
    }

    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const nodeMap = new Map<string, GraphNode>();
    const edgeKeySet = new Set<string>();

    const isDocumentPath = rootPath.split("/").length % 2 === 0;

    if (conn.isLocalJson) {
      const localService = LocalJsonService.getInstance();
      if (isDocumentPath) {
        const docData = localService.getDocument(conn, rootPath);
        if (docData) {
          const docId = rootPath.split("/").pop() || rootPath;
          const { fields, detectedRefs } = extractFields(docData);
          const node: GraphNode = {
            id: rootPath,
            label: docId,
            type: "document",
            collectionPath: rootPath.substring(0, rootPath.lastIndexOf("/")),
            data: docData,
            fields,
            referenceCount: detectedRefs.length,
          };
          nodes.push(node);
          nodeMap.set(rootPath, node);

          for (const ref of detectedRefs) {
            edges.push({
              id: `${rootPath}->${ref.path}`,
              source: rootPath,
              target: ref.path,
              type: "reference",
              label: ref.field,
            });
            // Try fetch linked doc if present
            const targetDoc = localService.getDocument(conn, ref.path);
            if (targetDoc && !nodeMap.has(ref.path)) {
              const targetDocId = ref.path.split("/").pop() || ref.path;
              const targetExtracted = extractFields(targetDoc);
              const targetNode: GraphNode = {
                id: ref.path,
                label: targetDocId,
                type: "document",
                collectionPath: ref.path.substring(0, ref.path.lastIndexOf("/")),
                data: targetDoc,
                fields: targetExtracted.fields,
              };
              nodes.push(targetNode);
              nodeMap.set(ref.path, targetNode);
            }
          }
        }
      } else {
        // Root is a collection
        const colNode: GraphNode = {
          id: rootPath,
          label: `📁 ${rootPath}`,
          type: "collection",
          collectionPath: rootPath,
        };
        nodes.push(colNode);
        nodeMap.set(rootPath, colNode);

        const colData = localService.getCollectionData(conn, rootPath);
        const docIds = Object.keys(colData).slice(0, maxSampleDocs);

        for (const docId of docIds) {
          const docPath = `${rootPath}/${docId}`;
          const data = colData[docId] || {};
          const { fields, detectedRefs } = extractFields(data);

          const docNode: GraphNode = {
            id: docPath,
            label: docId,
            type: "document",
            collectionPath: rootPath,
            data,
            fields,
            referenceCount: detectedRefs.length,
          };
          nodes.push(docNode);
          nodeMap.set(docPath, docNode);

          edges.push({
            id: `${rootPath}->${docPath}`,
            source: rootPath,
            target: docPath,
            type: "parent-child",
          });

          for (const ref of detectedRefs) {
            const edgeId = `${docPath}->${ref.path}`;
            if (!edgeKeySet.has(edgeId)) {
              edgeKeySet.add(edgeId);
              edges.push({
                id: edgeId,
                source: docPath,
                target: ref.path,
                type: "reference",
                label: ref.field,
              });
            }
            if (!nodeMap.has(ref.path)) {
              const targetDoc = localService.getDocument(conn, ref.path);
              if (targetDoc) {
                const targetDocId = ref.path.split("/").pop() || ref.path;
                const targetExtracted = extractFields(targetDoc);
                const targetNode: GraphNode = {
                  id: ref.path,
                  label: targetDocId,
                  type: "document",
                  collectionPath: ref.path.substring(0, ref.path.lastIndexOf("/")),
                  data: targetDoc,
                  fields: targetExtracted.fields,
                };
                nodes.push(targetNode);
                nodeMap.set(ref.path, targetNode);
              }
            }
          }
        }
      }

      return { connectionId, rootPath, nodes, edges };
    }

    // Cloud Firestore or Emulator
    const firestore = await connectionManager.getFirestore(connectionId);
    CostService.getInstance();

    if (isDocumentPath) {
      const docRef = firestore.doc(rootPath);
      const snapshot = await docRef.get();
      CostService.getInstance().recordOperation(connectionId, "read", 1);

      if (snapshot.exists) {
        const docData = snapshot.data() || {};
        const docId = snapshot.id;
        const { fields, detectedRefs } = extractFields(docData);

        // Check for subcollections
        let subcollections: string[] = [];
        try {
          const subs = await docRef.listCollections();
          subcollections = subs.map((s) => s.id);
        } catch {}

        const docNode: GraphNode = {
          id: rootPath,
          label: docId,
          type: "document",
          collectionPath: docRef.parent.path,
          data: docData,
          fields,
          subcollections,
          referenceCount: detectedRefs.length,
        };
        nodes.push(docNode);
        nodeMap.set(rootPath, docNode);

        // Fetch subcollection nodes if any
        for (const subId of subcollections) {
          const subPath = `${rootPath}/${subId}`;
          const subNode: GraphNode = {
            id: subPath,
            label: `📁 ${subId}`,
            type: "subcollection",
            collectionPath: subPath,
          };
          nodes.push(subNode);
          nodeMap.set(subPath, subNode);
          edges.push({
            id: `${rootPath}->${subPath}`,
            source: rootPath,
            target: subPath,
            type: "parent-child",
          });
        }

        // Fetch referenced documents (up to 5 for fast initial rendering)
        for (const ref of detectedRefs.slice(0, 5)) {
          const edgeId = `${rootPath}->${ref.path}`;
          edges.push({
            id: edgeId,
            source: rootPath,
            target: ref.path,
            type: "reference",
            label: ref.field,
          });

          if (!nodeMap.has(ref.path)) {
            try {
              const targetSnap = await firestore.doc(ref.path).get();
              CostService.getInstance().recordOperation(connectionId, "read", 1);
              if (targetSnap.exists) {
                const targetData = targetSnap.data() || {};
                const targetExtracted = extractFields(targetData);
                const targetNode: GraphNode = {
                  id: ref.path,
                  label: targetSnap.id,
                  type: "document",
                  collectionPath: targetSnap.ref.parent.path,
                  data: targetData,
                  fields: targetExtracted.fields,
                };
                nodes.push(targetNode);
                nodeMap.set(ref.path, targetNode);
              }
            } catch {}
          }
        }
      }
    } else {
      // Root is a collection
      const colRef = firestore.collection(rootPath);
      const colNode: GraphNode = {
        id: rootPath,
        label: `📁 ${rootPath}`,
        type: "collection",
        collectionPath: rootPath,
      };
      nodes.push(colNode);
      nodeMap.set(rootPath, colNode);

      const snapshot = await colRef.limit(maxSampleDocs).get();
      CostService.getInstance().recordOperation(connectionId, "read", snapshot.docs.length);

      const allRefsToFetch: { sourcePath: string; refPath: string; field: string }[] = [];

      for (const doc of snapshot.docs) {
        const docData = doc.data() || {};
        const { fields, detectedRefs } = extractFields(docData);

        const docNode: GraphNode = {
          id: doc.ref.path,
          label: doc.id,
          type: "document",
          collectionPath: rootPath,
          data: docData,
          fields,
          referenceCount: detectedRefs.length,
        };
        nodes.push(docNode);
        nodeMap.set(doc.ref.path, docNode);

        edges.push({
          id: `${rootPath}->${doc.ref.path}`,
          source: rootPath,
          target: doc.ref.path,
          type: "parent-child",
        });

        for (const ref of detectedRefs) {
          const edgeId = `${doc.ref.path}->${ref.path}`;
          if (!edgeKeySet.has(edgeId)) {
            edgeKeySet.add(edgeId);
            edges.push({
              id: edgeId,
              source: doc.ref.path,
              target: ref.path,
              type: "reference",
              label: ref.field,
            });
            if (allRefsToFetch.length < 8 && !nodeMap.has(ref.path)) {
              allRefsToFetch.push({ sourcePath: doc.ref.path, refPath: ref.path, field: ref.field });
            }
          }
        }
      }

      // Fetch sample target documents in parallel
      if (allRefsToFetch.length > 0) {
        await Promise.all(
          allRefsToFetch.map(async (r) => {
            if (nodeMap.has(r.refPath)) return;
            try {
              const targetSnap = await firestore.doc(r.refPath).get();
              CostService.getInstance().recordOperation(connectionId, "read", 1);
              if (targetSnap.exists && !nodeMap.has(r.refPath)) {
                const targetData = targetSnap.data() || {};
                const targetExtracted = extractFields(targetData);
                const targetNode: GraphNode = {
                  id: r.refPath,
                  label: targetSnap.id,
                  type: "document",
                  collectionPath: targetSnap.ref.parent.path,
                  data: targetData,
                  fields: targetExtracted.fields,
                };
                nodes.push(targetNode);
                nodeMap.set(r.refPath, targetNode);
              }
            } catch {}
          })
        );
      }
    }

    return { connectionId, rootPath, nodes, edges };
  }

  /**
   * Fetch a single target document node dynamically when expanding a reference port.
   */
  public async fetchSingleDocumentNode(
    connectionId: string,
    docPath: string
  ): Promise<{ node: GraphNode; edges: GraphEdge[] } | null> {
    const conn = ConnectionManager.getInstance().getConnection(connectionId);
    if (!conn) return null;

    if (conn.isLocalJson) {
      const data = LocalJsonService.getInstance().getDocument(conn, docPath);
      if (!data) return null;
      const { fields, detectedRefs } = extractFields(data);
      const node: GraphNode = {
        id: docPath,
        label: docPath.split("/").pop() || docPath,
        type: "document",
        collectionPath: docPath.substring(0, docPath.lastIndexOf("/")),
        data,
        fields,
        referenceCount: detectedRefs.length,
      };
      const edges: GraphEdge[] = detectedRefs.map((r) => ({
        id: `${docPath}->${r.path}`,
        source: docPath,
        target: r.path,
        type: "reference",
        label: r.field,
      }));
      return { node, edges };
    }

    const firestore = await ConnectionManager.getInstance().getFirestore(connectionId);
    const snap = await firestore.doc(docPath).get();
    CostService.getInstance().recordOperation(connectionId, "read", 1);

    if (!snap.exists) return null;
    const data = snap.data() || {};
    const { fields, detectedRefs } = extractFields(data);
    const node: GraphNode = {
      id: docPath,
      label: snap.id,
      type: "document",
      collectionPath: snap.ref.parent.path,
      data,
      fields,
      referenceCount: detectedRefs.length,
    };
    const edges: GraphEdge[] = detectedRefs.map((r) => ({
      id: `${docPath}->${r.path}`,
      source: docPath,
      target: r.path,
      type: "reference",
      label: r.field,
    }));
    return { node, edges };
  }
}

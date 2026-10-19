export interface GraphNode {
  id: string; // Document path (e.g., "users/usr_1" or collection path)
  label: string; // Display label (document ID or collection name)
  type: "collection" | "document" | "subcollection";
  collectionPath: string;
  data?: Record<string, any>;
  fields?: { name: string; type: string; valuePreview: string; isRef?: boolean; refPath?: string }[];
  subcollections?: string[];
  referenceCount?: number;
  x?: number;
  y?: number;
}

export interface GraphEdge {
  id: string;
  source: string; // source document path
  target: string; // target document path or collection path
  type: "reference" | "parent-child" | "foreign-key";
  label?: string; // field name that established the link
}

export interface GraphData {
  connectionId: string;
  rootPath: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

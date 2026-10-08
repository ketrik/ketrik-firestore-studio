import * as vscode from "vscode";
import { ConnectionManager } from "../connections/ConnectionManager";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface ParsedDocumentUri {
  connectionId: string;
  docPath: string;
  fieldPath?: string;
}

/**
 * Custom File System provider that allows interacting with Firestore documents and
 * their sub-fields/root-variables as virtual files in the editor, supporting multiple connections.
 */
export class DocumentFileSystemProvider implements vscode.FileSystemProvider {
  private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();

  readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> =
    this._emitter.event;

  watch(_uri: vscode.Uri): vscode.Disposable {
    return new vscode.Disposable(() => {});
  }

  public parseUri(uri: vscode.Uri): ParsedDocumentUri {
    const connectionManager = ConnectionManager.getInstance();
    const connections = connectionManager.getConnections();

    let connectionId = uri.authority;
    let pathStr = uri.path.startsWith("/") ? uri.path.slice(1) : uri.path;

    // Strip trailing .json if present
    if (pathStr.endsWith(".json")) {
      pathStr = pathStr.slice(0, -5);
    }

    if (!connectionId) {
      // Check if first segment of path is connectionId
      const parts = pathStr.split("/");
      if (connections.some((c) => c.id === parts[0])) {
        connectionId = parts[0];
        pathStr = parts.slice(1).join("/");
      } else {
        connectionId = connections[0]?.id || "default";
      }
    }

    const segments = pathStr.split("/").filter(Boolean);
    // Firestore doc paths always have an even number of segments (coll/doc or coll/doc/subcoll/subdoc).
    // If the path has an odd number >= 3, the trailing segment is a targeted fieldPath!
    if (segments.length % 2 === 1 && segments.length >= 3) {
      const fieldPath = decodeURIComponent(segments.pop()!);
      const docPath = segments.join("/");
      return { connectionId, docPath, fieldPath };
    }

    return { connectionId, docPath: segments.join("/") };
  }

  private serializeDoc(data: any): Uint8Array {
    return encoder.encode(JSON.stringify(data ?? {}, null, 2));
  }

  /**
   * Return document (or field) metadata. Confirms whether the document/field exists.
   */
  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const { connectionId, docPath, fieldPath } = this.parseUri(uri);
    const firestore = await ConnectionManager.getInstance().getFirestore(connectionId);
    const doc = await firestore.doc(docPath).get();
    const now = Date.now();

    if (!doc.exists) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }

    if (fieldPath !== undefined) {
      const data = doc.data();
      if (!data || !(fieldPath in data)) {
        throw vscode.FileSystemError.FileNotFound(uri);
      }
    }

    return {
      type: vscode.FileType.File,
      ctime: doc.createTime ? doc.createTime.toMillis() : now,
      mtime: doc.updateTime ? doc.updateTime.toMillis() : now,
      size: 0,
    };
  }

  readDirectory(
    _uri: vscode.Uri
  ): [string, vscode.FileType][] | Thenable<[string, vscode.FileType][]> {
    throw new Error("Read Directory Method not implemented.");
  }

  createDirectory(_uri: vscode.Uri): void | Thenable<void> {
    throw new Error("Create Directory Method not implemented.");
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const { connectionId, docPath, fieldPath } = this.parseUri(uri);
    const firestore = await ConnectionManager.getInstance().getFirestore(connectionId);
    const doc = await firestore.doc(docPath).get();

    if (!doc.exists) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }

    const data = doc.data() ?? {};
    if (fieldPath !== undefined) {
      if (!(fieldPath in data)) {
        throw vscode.FileSystemError.FileNotFound(uri);
      }
      return this.serializeDoc(data[fieldPath]);
    }

    return this.serializeDoc(data);
  }

  async writeFile(
    uri: vscode.Uri,
    content: Uint8Array,
    _options: { readonly create: boolean; readonly overwrite: boolean }
  ): Promise<void> {
    const { connectionId, docPath, fieldPath } = this.parseUri(uri);
    const firestore = await ConnectionManager.getInstance().getFirestore(connectionId);

    let json: any;
    try {
      json = JSON.parse(decoder.decode(content));
    } catch (e: any) {
      throw new Error(`Could not parse JSON: ${e.message}`);
    }

    try {
      if (fieldPath !== undefined) {
        // Atomic partial update: only update the targeted root field
        await firestore.doc(docPath).update({
          [fieldPath]: json,
        });
      } else {
        await firestore.doc(docPath).set(json);
      }
      this._emitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
    } catch (e: any) {
      throw new Error(`Could not write Firestore document: ${e.message}`);
    }
  }

  delete(
    _uri: vscode.Uri,
    _options: { readonly recursive: boolean }
  ): void | Thenable<void> {
    throw new Error("Delete Method not implemented.");
  }

  rename(
    _oldUri: vscode.Uri,
    _newUri: vscode.Uri,
    _options: { readonly overwrite: boolean }
  ): void | Thenable<void> {
    throw new Error("Rename Method not implemented.");
  }
}
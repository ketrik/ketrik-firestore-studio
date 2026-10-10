export interface CopiedDocument {
  sourceDocId: string;
  sourcePath: string;
  sourceConnectionId: string;
  data: any;
}

/**
 * In-memory document clipboard for copy/paste across collections, connections, and fields.
 */
export class DocumentClipboard {
  private static instance: DocumentClipboard;
  private buffer: CopiedDocument | null = null;

  private constructor() {}

  public static getInstance(): DocumentClipboard {
    if (!DocumentClipboard.instance) {
      DocumentClipboard.instance = new DocumentClipboard();
    }
    return DocumentClipboard.instance;
  }

  public set(doc: CopiedDocument): void {
    this.buffer = doc;
  }

  public get(): CopiedDocument | null {
    return this.buffer;
  }

  public hasItem(): boolean {
    return this.buffer !== null;
  }

  public clear(): void {
    this.buffer = null;
  }
}

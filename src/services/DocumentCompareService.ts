import * as vscode from "vscode";

export interface CompareDocumentTarget {
  connectionId: string;
  connectionName: string;
  docPath: string;
  documentId: string;
}

/**
 * Tracks the document selected as the left-hand side of a side-by-side diff comparison.
 */
export class DocumentCompareService {
  private static instance: DocumentCompareService;
  private selected: CompareDocumentTarget | null = null;

  private constructor() {}

  public static getInstance(): DocumentCompareService {
    if (!DocumentCompareService.instance) {
      DocumentCompareService.instance = new DocumentCompareService();
    }
    return DocumentCompareService.instance;
  }

  public select(target: CompareDocumentTarget): void {
    this.selected = target;
    void vscode.commands.executeCommand("setContext", "ketrik-firestore-studio.hasCompareDoc", true);
  }

  public get(): CompareDocumentTarget | null {
    return this.selected;
  }

  public hasSelection(): boolean {
    return this.selected !== null;
  }

  public clear(): void {
    this.selected = null;
    void vscode.commands.executeCommand("setContext", "ketrik-firestore-studio.hasCompareDoc", false);
  }
}

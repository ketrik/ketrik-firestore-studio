import * as vscode from "vscode";
import { scheme } from "../constants";
import { ConnectionManager } from "../connections/ConnectionManager";
import { getDocumentSizeInfo, DocumentSizeInfo } from "../utils/documentSizeUtils";

/**
 * Manages a dynamic Status Bar item that calculates and displays the active Firestore document size
 * whenever a `ketrik-firestore-studio://` document is open and focused in the editor.
 */
export class DocumentSizeStatusBarController implements vscode.Disposable {
  private _statusBarItem: vscode.StatusBarItem;
  private _disposables: vscode.Disposable[] = [];
  private _debounceTimer: NodeJS.Timeout | undefined;
  private _sizeCache = new Map<string, { version: number; sizeInfo: DocumentSizeInfo }>();
  private static readonly MAX_CACHE = 40;

  constructor() {
    this._statusBarItem = vscode.window.createStatusBarItem(
      "ketrik-firestore-studio.documentSize",
      vscode.StatusBarAlignment.Right,
      100
    );
    this._statusBarItem.name = "Firestore Document Size";
    this._disposables.push(this._statusBarItem);

    // Listen to active editor changes
    this._disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => this._updateStatusBar(editor))
    );

    // Listen to text changes within the active editor (debounced with size-aware delay)
    this._disposables.push(
      vscode.workspace.onDidChangeTextDocument((event) => {
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor && event.document === activeEditor.document) {
          this._scheduleUpdate(event.document);
        }
      })
    );

    // Free memory when documents are closed
    this._disposables.push(
      vscode.workspace.onDidCloseTextDocument((doc) => {
        this._sizeCache.delete(doc.uri.toString());
      })
    );

    // Initial update
    this._updateStatusBar(vscode.window.activeTextEditor);
  }

  private _scheduleUpdate(document: vscode.TextDocument): void {
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
    }
    const docUriStr = document.uri.toString();
    const isLarge = document.lineCount > 1000;
    const delay = isLarge ? 500 : 250;

    this._debounceTimer = setTimeout(() => {
      this._debounceTimer = undefined;
      const activeEditor = vscode.window.activeTextEditor;
      if (activeEditor && activeEditor.document.uri.toString() === docUriStr) {
        this._updateStatusBar(activeEditor);
      }
    }, delay);
  }

  private _isSupported(document: vscode.TextDocument): boolean {
    if (document.uri.scheme === scheme) {
      // Don't show for security rules
      const path = document.uri.path;
      return !path.endsWith(".rules") && !path.endsWith("/firestore.rules");
    }

    // Support local JSON documents matching configured connections
    if (document.uri.scheme === "file" && document.fileName.endsWith(".json")) {
      const connections = ConnectionManager.getInstance().getConnections();
      const filePath = document.uri.fsPath;
      return connections.some((c) => {
        if (!c.isLocalJson || !c.localJsonPath) return false;
        return filePath === c.localJsonPath || filePath.startsWith(c.localJsonPath);
      });
    }

    return false;
  }

  private _updateStatusBar(editor: vscode.TextEditor | undefined): void {
    if (!editor || !this._isSupported(editor.document)) {
      this._statusBarItem.hide();
      return;
    }

    const doc = editor.document;
    const uriKey = doc.uri.toString();
    const docPath = doc.uri.path.replace(/^\//, "").replace(/\.json$/, "");

    // Fast-path: Reuse cached size if document version has not changed
    const cached = this._sizeCache.get(uriKey);
    if (cached && cached.version === doc.version) {
      this._renderStatusBar(cached.sizeInfo, docPath);
      return;
    }

    try {
      const text = doc.getText();
      let parsed: any;
      try {
        parsed = JSON.parse(text);
      } catch {
        // If user is currently typing and JSON is temporarily malformed, estimate from raw string length
        parsed = text;
      }

      const sizeInfo = getDocumentSizeInfo(parsed, docPath);

      // LRU Eviction for cache
      if (this._sizeCache.size >= DocumentSizeStatusBarController.MAX_CACHE) {
        const oldest = this._sizeCache.keys().next().value;
        if (oldest !== undefined) {
          this._sizeCache.delete(oldest);
        }
      }
      this._sizeCache.set(uriKey, { version: doc.version, sizeInfo });

      this._renderStatusBar(sizeInfo, docPath);
    } catch {
      this._statusBarItem.hide();
    }
  }

  private _renderStatusBar(sizeInfo: DocumentSizeInfo, docPath: string): void {
    const percent = sizeInfo.percentageOfLimit;
    const formatted = sizeInfo.formatted;

    if (sizeInfo.isCritical) {
      this._statusBarItem.text = `$(warning) Firestore Doc: ${formatted} (${percent}%)`;
      this._statusBarItem.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
    } else if (sizeInfo.isWarning) {
      this._statusBarItem.text = `$(alert) Firestore Doc: ${formatted} (${percent}%)`;
      this._statusBarItem.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
    } else {
      this._statusBarItem.text = `$(database) Firestore Doc: ${formatted}`;
      this._statusBarItem.backgroundColor = undefined;
    }

    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.appendMarkdown(`### 📦 Firestore Document Size\n\n`);
    md.appendMarkdown(`- **Current Size:** \`${formatted}\` (\`${sizeInfo.bytes.toLocaleString()}\` bytes)\n`);
    md.appendMarkdown(`- **Maximum Allowed:** \`1,048,576\` bytes (1 MiB)\n`);
    md.appendMarkdown(`- **Capacity Used:** \`${percent}%\`\n`);
    md.appendMarkdown(`- **Document Path:** \`${docPath}\`\n\n`);

    if (sizeInfo.isCritical) {
      md.appendMarkdown(`> ⚠️ **CRITICAL**: Document is very close to or exceeds the 1MB Firestore limit. Writes may fail.\n`);
    } else if (sizeInfo.isWarning) {
      md.appendMarkdown(`> ⚠️ **WARNING**: Document exceeds 750 KB. Consider normalizing sub-fields or splitting into subcollections.\n`);
    } else {
      md.appendMarkdown(`*Calculated per Google Cloud Firestore storage size specs (fields, types, path overhead).*`);
    }

    this._statusBarItem.tooltip = md;
    this._statusBarItem.show();
  }

  public dispose(): void {
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = undefined;
    }
    this._sizeCache.clear();
    this._disposables.forEach((d) => d.dispose());
    this._disposables = [];
  }
}

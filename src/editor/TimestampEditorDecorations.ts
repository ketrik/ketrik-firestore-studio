import * as vscode from "vscode";
import { formatDateTime, formatRelativeTime } from "../utils/timestampUtils";
import { scheme } from "../constants";
import { ConnectionManager } from "../connections/ConnectionManager";

/**
 * Parses JSON documents open under the `ketrik-firestore-studio` scheme
 * and finds ranges of `{ "_seconds": ..., "_nanoseconds": ... }` objects.
 */
interface TimestampMatch {
  date: Date;
  seconds: number;
  nanoseconds: number;
  openBracePos: vscode.Position;
  closeBracePos: vscode.Position;
  secondsKeyRange: vscode.Range;
}

const MAX_TIMESTAMP_CACHE = 50;
const _docTimestampCache = new Map<string, { version: number; matches: TimestampMatch[] }>();

/**
 * Creates a disposable listener to clear cached timestamps when documents are closed.
 */
export function createTimestampDocumentCloseListener(): vscode.Disposable {
  return vscode.workspace.onDidCloseTextDocument((doc) => {
    _docTimestampCache.delete(doc.uri.toString());
  });
}

/**
 * Clear timestamp cache to free memory.
 */
export function clearTimestampCache(): void {
  _docTimestampCache.clear();
}

// Precompiled regex matching single-line and multi-line formatted timestamps in either order:
// Case A: { "_seconds": 123, "_nanoseconds": 456 }
// Case B: { "_nanoseconds": 456, "_seconds": 123 }
const TIMESTAMP_REGEX = /\{\s*(?:"_seconds"\s*:\s*(\d+)\s*,\s*"_nanoseconds"\s*:\s*(\d+)|"_nanoseconds"\s*:\s*(\d+)\s*,\s*"_seconds"\s*:\s*(\d+))\s*\}/g;

function findTimestampsInDocument(document: vscode.TextDocument): TimestampMatch[] {
  const uriKey = document.uri.toString();
  const cached = _docTimestampCache.get(uriKey);
  if (cached && cached.version === document.version) {
    // Refresh recency for LRU
    _docTimestampCache.delete(uriKey);
    _docTimestampCache.set(uriKey, cached);
    return cached.matches;
  }

  const text = document.getText();

  // Fast-path: If document doesn't contain both required timestamp keys, skip regex processing entirely
  if (!text.includes("_seconds") || !text.includes("_nanoseconds")) {
    if (_docTimestampCache.size >= MAX_TIMESTAMP_CACHE) {
      const oldest = _docTimestampCache.keys().next().value;
      if (oldest) _docTimestampCache.delete(oldest);
    }
    _docTimestampCache.set(uriKey, { version: document.version, matches: [] });
    return [];
  }

  const matches: TimestampMatch[] = [];

  TIMESTAMP_REGEX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TIMESTAMP_REGEX.exec(text)) !== null) {
    const rawMatch = m[0];
    const matchIndex = m.index;

    const seconds = m[1] !== undefined ? parseInt(m[1], 10) : parseInt(m[4], 10);
    const nanoseconds = m[2] !== undefined ? parseInt(m[2], 10) : parseInt(m[3], 10);

    if (!isNaN(seconds) && !isNaN(nanoseconds)) {
      const date = new Date(seconds * 1000 + Math.floor(nanoseconds / 1000000));
      if (!isNaN(date.getTime())) {
        const startPos = document.positionAt(matchIndex);
        const endPos = document.positionAt(matchIndex + rawMatch.length);

        matches.push({
          date,
          seconds,
          nanoseconds,
          openBracePos: startPos,
          closeBracePos: endPos,
          secondsKeyRange: new vscode.Range(startPos, endPos),
        });
      }
    }
  }

  if (_docTimestampCache.size >= MAX_TIMESTAMP_CACHE) {
    const oldest = _docTimestampCache.keys().next().value;
    if (oldest) _docTimestampCache.delete(oldest);
  }
  _docTimestampCache.set(uriKey, { version: document.version, matches });

  return matches;
}

function isSupportedDocument(document: vscode.TextDocument): boolean {
  if (document.uri.scheme === scheme) {
    return true;
  }
  if (document.uri.scheme === "file" && document.fileName.endsWith(".json")) {
    const filePath = document.uri.fsPath;
    if (filePath.includes(".firestore")) {
      return true;
    }
    const connections = ConnectionManager.getInstance().getConnections();
    for (const c of connections) {
      if (c.isLocalJson && c.localJsonPath && (filePath === c.localJsonPath || filePath.startsWith(c.localJsonPath))) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Inlay Hints Provider that displays human-readable date & relative time next to Firestore timestamps.
 */
export class TimestampInlayHintsProvider implements vscode.InlayHintsProvider {
  provideInlayHints(
    document: vscode.TextDocument,
    range: vscode.Range,
    _token: vscode.CancellationToken
  ): vscode.InlayHint[] {
    if (!isSupportedDocument(document)) {
      return [];
    }

    const matches = findTimestampsInDocument(document);
    const hints: vscode.InlayHint[] = [];

    for (const match of matches) {
      if (
        match.openBracePos.line >= range.start.line &&
        match.openBracePos.line <= range.end.line
      ) {
        const localFormatted = formatDateTime(match.date);
        const relative = formatRelativeTime(match.date);
        const label = ` 🕒 ${localFormatted} (${relative})`;

        const hint = new vscode.InlayHint(
          match.openBracePos,
          label,
          vscode.InlayHintKind.Type
        );
        hint.paddingLeft = true;
        hint.paddingRight = true;
        hint.tooltip = new vscode.MarkdownString(
          `**Firestore Timestamp**\n\n` +
          `- **Local Time:** \`${localFormatted}\`\n` +
          `- **UTC (ISO):** \`${match.date.toISOString()}\`\n` +
          `- **Relative:** \`${relative}\`\n` +
          `- **Seconds:** \`${match.seconds}\`\n` +
          `- **Nanoseconds:** \`${match.nanoseconds}\``
        );

        hints.push(hint);
      }
    }

    return hints;
  }
}

/**
 * Hover Provider that gives detailed date conversion and UTC/Local time breakdown.
 */
export class TimestampHoverProvider implements vscode.HoverProvider {
  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken
  ): vscode.Hover | undefined {
    if (!isSupportedDocument(document)) {
      return undefined;
    }

    const matches = findTimestampsInDocument(document);
    for (const match of matches) {
      if (match.secondsKeyRange.contains(position)) {
        const localFormatted = formatDateTime(match.date);
        const relative = formatRelativeTime(match.date);

        const md = new vscode.MarkdownString();
        md.isTrusted = true;
        md.appendMarkdown(`### 🕒 Firestore Timestamp\n\n`);
        md.appendMarkdown(`| Format | Value |\n`);
        md.appendMarkdown(`| :--- | :--- |\n`);
        md.appendMarkdown(`| **Local** | \`${localFormatted}\` |\n`);
        md.appendMarkdown(`| **ISO 8601** | \`${match.date.toISOString()}\` |\n`);
        md.appendMarkdown(`| **Relative** | ${relative} |\n`);
        md.appendMarkdown(`| **Unix Seconds** | \`${match.seconds}\` |\n`);
        md.appendMarkdown(`| **Nanoseconds** | \`${match.nanoseconds}\` |\n\n`);
        md.appendMarkdown(`---\n*Save document anytime — timestamps are preserved as native Firestore Timestamps.*`);

        return new vscode.Hover(md, match.secondsKeyRange);
      }
    }

    return undefined;
  }
}

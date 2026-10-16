import * as vscode from "vscode";
import { formatDateTime, formatRelativeTime } from "../utils/timestampUtils";
import { scheme } from "../constants";

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

// Free memory when documents are closed
vscode.workspace.onDidCloseTextDocument((doc) => {
  _docTimestampCache.delete(doc.uri.toString());
});

function findTimestampsInDocument(document: vscode.TextDocument): TimestampMatch[] {
  const uriKey = document.uri.toString();
  const cached = _docTimestampCache.get(uriKey);
  if (cached && cached.version === document.version) {
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

  // Regex to match JSON objects with _seconds and _nanoseconds (either order)
  const regex = /\{\s*"(?:_seconds|_nanoseconds)"\s*:\s*(\d+)\s*,\s*"(?:_seconds|_nanoseconds)"\s*:\s*(\d+)\s*\}/g;

  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    const rawMatch = m[0];
    const matchIndex = m.index;

    try {
      const parsed = JSON.parse(rawMatch);
      if (typeof parsed._seconds === "number" && typeof parsed._nanoseconds === "number") {
        const date = new Date(parsed._seconds * 1000 + Math.floor(parsed._nanoseconds / 1000000));
        if (!isNaN(date.getTime())) {
          const startPos = document.positionAt(matchIndex);
          const endPos = document.positionAt(matchIndex + rawMatch.length);

          // Find the exact line of the closing brace or first line
          matches.push({
            date,
            seconds: parsed._seconds,
            nanoseconds: parsed._nanoseconds,
            openBracePos: startPos,
            closeBracePos: endPos,
            secondsKeyRange: new vscode.Range(startPos, endPos),
          });
        }
      }
    } catch {
      // Ignore parse errors on partial matches
    }
  }

  // Also match multi-line formatted JSON:
  // "createdAt": {
  //   "_seconds": 1718365200,
  //   "_nanoseconds": 0
  // }
  const multilineRegex = /\{\s*\r?\n\s*"_seconds"\s*:\s*(\d+)\s*,\s*\r?\n\s*"_nanoseconds"\s*:\s*(\d+)\s*\r?\n\s*\}/g;
  while ((m = multilineRegex.exec(text)) !== null) {
    const rawMatch = m[0];
    const matchIndex = m.index;

    try {
      const parsed = JSON.parse(rawMatch);
      if (typeof parsed._seconds === "number" && typeof parsed._nanoseconds === "number") {
        const date = new Date(parsed._seconds * 1000 + Math.floor(parsed._nanoseconds / 1000000));
        if (!isNaN(date.getTime())) {
          const startPos = document.positionAt(matchIndex);
          const endPos = document.positionAt(matchIndex + rawMatch.length);

          matches.push({
            date,
            seconds: parsed._seconds,
            nanoseconds: parsed._nanoseconds,
            openBracePos: startPos,
            closeBracePos: endPos,
            secondsKeyRange: new vscode.Range(startPos, endPos),
          });
        }
      }
    } catch {
      // Ignore
    }
  }

  // Deduplicate matches by openBrace position offset
  const seen = new Set<number>();
  const uniqueMatches: TimestampMatch[] = [];
  for (const match of matches) {
    const offset = document.offsetAt(match.openBracePos);
    if (!seen.has(offset)) {
      seen.add(offset);
      uniqueMatches.push(match);
    }
  }

  if (_docTimestampCache.size >= MAX_TIMESTAMP_CACHE) {
    const oldest = _docTimestampCache.keys().next().value;
    if (oldest) _docTimestampCache.delete(oldest);
  }
  _docTimestampCache.set(uriKey, { version: document.version, matches: uniqueMatches });

  return uniqueMatches;
}

import { ConnectionManager } from "../connections/ConnectionManager";

function isSupportedDocument(document: vscode.TextDocument): boolean {
  if (document.uri.scheme === scheme) {
    return true;
  }
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

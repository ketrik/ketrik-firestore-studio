import * as vscode from "vscode";
import { CollectionItem } from "../explorer/items";
import { ConnectionManager } from "../connections/ConnectionManager";
import { DocumentFileSystemProvider } from "../editor/DocumentFileSystemProvider";
import ExplorerDataProvider from "../explorer/ExplorerDataProvider";
import { QueryDocumentSnapshot } from "firebase-admin/firestore";

/**
 * Basic CSV Parser supporting quoted fields and commas.
 */
function parseCsv(text: string): Record<string, any>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    return [];
  }

  function splitLine(line: string): string[] {
    const result: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (c === "," && !inQuotes) {
        result.push(cur.trim());
        cur = "";
      } else {
        cur += c;
      }
    }
    result.push(cur.trim());
    return result;
  }

  const headers = splitLine(lines[0]);
  const records: Record<string, any>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = splitLine(lines[i]);
    const record: Record<string, any> = {};
    for (let j = 0; j < headers.length; j++) {
      const header = headers[j];
      const rawVal = values[j] !== undefined ? values[j] : "";
      record[header] = coerceCsvValue(rawVal);
    }
    records.push(record);
  }

  return records;
}

function coerceCsvValue(val: string): any {
  if (val === "" || val === "null") return null;
  if (val === "true") return true;
  if (val === "false") return false;
  if (!isNaN(Number(val)) && val.trim() !== "") return Number(val);
  // ISO date
  if (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(val)) {
    const d = new Date(val);
    if (!isNaN(d.getTime())) return d;
  }
  // JSON object or array
  if ((val.startsWith("{") && val.endsWith("}")) || (val.startsWith("[") && val.endsWith("]"))) {
    try {
      return JSON.parse(val);
    } catch {}
  }
  return val;
}

/**
 * Format records to CSV.
 */
function recordsToCsv(records: Record<string, any>[]): string {
  if (records.length === 0) return "";
  const headerSet = new Set<string>();
  records.forEach((r) => Object.keys(r).forEach((k) => {
    if (k !== "__path" && k !== "__id") headerSet.add(k);
  }));
  const headers = ["id", ...Array.from(headerSet)];

  function escapeCsvCell(val: any): string {
    if (val === null || val === undefined) return "";
    let s = typeof val === "object" ? JSON.stringify(val) : String(val);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      s = `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  }

  const csvLines: string[] = [];
  csvLines.push(headers.map(escapeCsvCell).join(","));

  for (const r of records) {
    const line = headers.map((h) => {
      const v = h === "id" ? r.__id || r.id : r[h];
      return escapeCsvCell(v);
    });
    csvLines.push(line.join(","));
  }

  return csvLines.join("\n");
}

/**
 * Command: Export a collection to JSON, NDJSON, or CSV.
 */
export async function exportCollectionCommand(item: CollectionItem) {
  const collectionName = item.collectionId;
  const connectionId = item.connectionId;
  const collectionPath = item.reference.path;

  // 1. Choose format
  const formatChoice = await vscode.window.showQuickPick(
    [
      { label: "$(json) JSON Array (.json)", format: "json", ext: "json" },
      { label: "$(list-flat) NDJSON (Newline Delimited JSON)", format: "ndjson", ext: "ndjson" },
      { label: "$(table) CSV (.csv)", format: "csv", ext: "csv" },
    ],
    { title: `Export Collection: ${collectionName}`, placeHolder: "Select export file format" }
  );

  if (!formatChoice) return;

  // 2. Select save path
  const defaultFileName = `${collectionName}_export.${formatChoice.ext}`;
  const saveUri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(defaultFileName),
    filters: {
      [formatChoice.label]: [formatChoice.ext],
    },
  });

  if (!saveUri) return;

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Exporting '${collectionName}'...`,
      cancellable: true,
    },
    async (progress, token) => {
      try {
        const firestore = await ConnectionManager.getInstance().getFirestore(connectionId);
        const collRef = firestore.collection(collectionPath);

        const allDocs: Record<string, any>[] = [];
        let lastDoc: QueryDocumentSnapshot | null = null;
        let hasMore = true;
        const batchSize = 250;

        while (hasMore && !token.isCancellationRequested) {
          let query = collRef.limit(batchSize);
          if (lastDoc) {
            query = query.startAfter(lastDoc);
          }
          const snapshot = await query.get();
          if (snapshot.empty) {
            hasMore = false;
            break;
          }

          for (const doc of snapshot.docs) {
            allDocs.push({
              id: doc.id,
              __id: doc.id,
              ...doc.data(),
            });
          }

          lastDoc = snapshot.docs[snapshot.docs.length - 1];
          progress.report({ message: `Fetched ${allDocs.length} documents...` });
          if (snapshot.docs.length < batchSize) {
            hasMore = false;
          }
        }

        if (token.isCancellationRequested) {
          vscode.window.showWarningMessage("Export cancelled.");
          return;
        }

        let outputContent = "";
        if (formatChoice.format === "json") {
          // Clean internal helper keys before writing JSON
          const cleanDocs = allDocs.map(({ __path, __id, ...rest }) => rest);
          outputContent = JSON.stringify(cleanDocs, null, 2);
        } else if (formatChoice.format === "ndjson") {
          const cleanDocs = allDocs.map(({ __path, __id, ...rest }) => rest);
          outputContent = cleanDocs.map((d) => JSON.stringify(d)).join("\n");
        } else if (formatChoice.format === "csv") {
          outputContent = recordsToCsv(allDocs);
        }

        await vscode.workspace.fs.writeFile(saveUri, Buffer.from(outputContent, "utf8"));
        vscode.window.showInformationMessage(
          `Successfully exported ${allDocs.length} document(s) to ${saveUri.fsPath}!`
        );
      } catch (err: any) {
        vscode.window.showErrorMessage(`Export failed: ${err.message}`);
      }
    }
  );
}

/**
 * Command: Import dataset (CSV, JSON, NDJSON) into a Firestore collection.
 */
export async function importCollectionCommand(
  item: CollectionItem,
  explorerDataProvider: ExplorerDataProvider
) {
  const collectionName = item.collectionId;
  const connectionId = item.connectionId;
  const collectionPath = item.reference.path;

  // 1. Pick file
  const fileUris = await vscode.window.showOpenDialog({
    canSelectMany: false,
    openLabel: "Select Dataset File",
    filters: {
      "Data Files (JSON, NDJSON, CSV)": ["json", "ndjson", "csv"],
    },
  });

  if (!fileUris || fileUris.length === 0) return;
  const fileUri = fileUris[0];

  let rawBytes: Uint8Array;
  try {
    rawBytes = await vscode.workspace.fs.readFile(fileUri);
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to read file: ${err.message}`);
    return;
  }

  const rawText = Buffer.from(rawBytes).toString("utf8");
  let records: Record<string, any>[] = [];

  try {
    if (fileUri.fsPath.endsWith(".csv")) {
      records = parseCsv(rawText);
    } else if (fileUri.fsPath.endsWith(".ndjson")) {
      records = rawText
        .split(/\r?\n/)
        .filter((l) => l.trim().length > 0)
        .map((l) => JSON.parse(l));
    } else {
      const parsed = JSON.parse(rawText);
      records = Array.isArray(parsed) ? parsed : [parsed];
    }
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to parse file: ${err.message}`);
    return;
  }

  if (records.length === 0) {
    vscode.window.showWarningMessage("No valid records found in the selected file.");
    return;
  }

  // 2. Select ID strategy
  const sampleKeys = Object.keys(records[0] || {});
  const possibleIdKeys = sampleKeys.filter((k) => /^(id|uid|_id|key)$/i.test(k));

  const idOptions: vscode.QuickPickItem[] = [
    { label: "Auto-Generate Firestore Document IDs", detail: "Generate unique random document IDs (e.g. 7kF8x...)" },
  ];
  if (possibleIdKeys.length > 0) {
    possibleIdKeys.forEach((k) => {
      idOptions.push({
        label: `Use column '${k}' as Document ID`,
        detail: `Sample value: ${JSON.stringify(records[0][k])}`,
      });
    });
  }

  const idChoice = await vscode.window.showQuickPick(idOptions, {
    title: `Importing ${records.length} records into '${collectionName}'`,
    placeHolder: "Select Document ID Strategy",
  });

  if (!idChoice) return;

  const idField = possibleIdKeys.find((k) => idChoice.label.includes(`'${k}'`));

  // 3. Confirmation
  const confirm = await vscode.window.showWarningMessage(
    `Import ${records.length} document(s) into '${collectionName}'? This will write to Firestore.`,
    { modal: true },
    "Proceed with Import"
  );

  if (confirm !== "Proceed with Import") return;

  // 4. Batch import with progress
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Importing records into '${collectionName}'...`,
      cancellable: true,
    },
    async (progress, token) => {
      try {
        const firestore = await ConnectionManager.getInstance().getFirestore(connectionId);
        const collRef = firestore.collection(collectionPath);
        const batchLimit = 400; // Under Firestore 500 limit for safety
        let importedCount = 0;

        for (let i = 0; i < records.length; i += batchLimit) {
          if (token.isCancellationRequested) {
            vscode.window.showWarningMessage(`Import stopped. ${importedCount} documents imported.`);
            break;
          }

          const batch = firestore.batch();
          const chunk = records.slice(i, i + batchLimit);

          for (const item of chunk) {
            const docId = idField && item[idField] ? String(item[idField]).trim() : null;
            const docRef = docId ? collRef.doc(docId) : collRef.doc();
            const { id, _id, __id, __path, ...cleanData } = item;
            batch.set(docRef, cleanData);
          }

          await batch.commit();
          importedCount += chunk.length;
          progress.report({
            message: `${importedCount} / ${records.length} written...`,
            increment: (chunk.length / records.length) * 100,
          });
        }

        DocumentFileSystemProvider.getInstance().invalidateAndNotify(connectionId, collectionPath);
        explorerDataProvider.refreshNode(item);
        vscode.window.showInformationMessage(
          `Successfully imported ${importedCount} document(s) into '${collectionName}'!`
        );
      } catch (err: any) {
        vscode.window.showErrorMessage(`Import failed: ${err.message}`);
      }
    }
  );
}

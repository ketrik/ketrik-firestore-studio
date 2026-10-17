import * as vscode from "vscode";
import { ConnectionManager } from "../connections/ConnectionManager";
import { CollectionItem, DocumentItem } from "../explorer/items";
import { analyzeCollectionSchemaHealth, CollectionHealthReport } from "./schemaAnalyzer";
import { getSchemaReportHtml } from "../webview/schemaReport/schemaReportHtml";
import { LocalJsonService } from "../services/LocalJsonService";

// Active schema reports registry by collection key
const activeReportPanels = new Map<string, vscode.WebviewPanel>();

export async function openSchemaAnalyzer(
  target?: CollectionItem | DocumentItem | { connectionId: string; collectionPath: string },
  sampleSize = 50
) {
  let connectionId: string;
  let collectionPath: string;

  if (target instanceof CollectionItem) {
    connectionId = target.connectionId;
    collectionPath = target.reference.path;
  } else if (target instanceof DocumentItem) {
    connectionId = target.connectionId;
    collectionPath = target.reference.parent.path;
  } else if (target && "connectionId" in target && "collectionPath" in target) {
    connectionId = target.connectionId;
    collectionPath = target.collectionPath;
  } else {
    // Pick connection and collection interactively
    const connections = ConnectionManager.getInstance().getConnections();
    if (connections.length === 0) {
      vscode.window.showInformationMessage("No connections configured. Please add a connection first.");
      return;
    }
    let chosenConn = connections[0];
    if (connections.length > 1) {
      const picked = await vscode.window.showQuickPick(
        connections.map((c) => ({ label: c.name, description: c.id, connection: c })),
        { placeHolder: "Select connection to analyze schema" }
      );
      if (!picked) return;
      chosenConn = picked.connection;
    }
    connectionId = chosenConn.id;

    let colls: string[] = [];
    if (chosenConn.isLocalJson) {
      colls = LocalJsonService.getInstance().listCollections(chosenConn);
    } else {
      try {
        const firestore = await ConnectionManager.getInstance().getFirestore(connectionId);
        const colRefs = await firestore.listCollections();
        colls = colRefs.map((c) => c.id);
      } catch {}
    }

    const inputChoice = await vscode.window.showQuickPick(
      [
        ...colls.map((c) => ({ label: `📁 ${c}`, path: c })),
        { label: "$(edit) Enter custom collection path...", path: "__custom__" },
      ],
      { placeHolder: "Select collection to analyze" }
    );
    if (!inputChoice) return;

    if (inputChoice.path === "__custom__") {
      const customPath = await vscode.window.showInputBox({
        title: "Enter Collection Path",
        placeHolder: "users or orders/123/items",
        validateInput: (v) => (v.trim() ? undefined : "Path cannot be empty"),
      });
      if (!customPath) return;
      collectionPath = customPath.trim();
    } else {
      collectionPath = inputChoice.path;
    }
  }

  // Ask for sample size if desired
  const samplePick = await vscode.window.showQuickPick(
    [
      { label: "50 documents (Recommended)", size: 50 },
      { label: "25 documents (Fast)", size: 25 },
      { label: "100 documents (High accuracy)", size: 100 },
      { label: "250 documents (Deep scan)", size: 250 },
    ],
    { title: `Analyze Schema Drift & Anomalies: ${collectionPath}`, placeHolder: "Select sample size" }
  );
  if (!samplePick) return;
  sampleSize = samplePick.size;

  const panelKey = `${connectionId}:${collectionPath}`;
  const existingPanel = activeReportPanels.get(panelKey);
  if (existingPanel) {
    existingPanel.reveal(vscode.ViewColumn.One);
    return;
  }

  const conn = ConnectionManager.getInstance().getConnection(connectionId);
  const connectionName = conn?.name || connectionId;

  let report: CollectionHealthReport;

  try {
    report = await sampleAndAnalyze(connectionId, connectionName, collectionPath, sampleSize);
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to analyze collection schema: ${err.message}`);
    return;
  }

  const config = vscode.workspace.getConfiguration("ketrik-firestore-studio");
  const retainContextWhenHidden = config.get<boolean>("retainWebviewTabs", true);

  const panel = vscode.window.createWebviewPanel(
    "firestoreSchemaAnalyzer",
    `Schema Health: ${collectionPath}`,
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden,
    }
  );
  activeReportPanels.set(panelKey, panel);

  let messageSubscription: vscode.Disposable;

  panel.onDidDispose(() => {
    activeReportPanels.delete(panelKey);
    messageSubscription?.dispose();
    (report as any) = null;
  });

  panel.webview.html = getSchemaReportHtml(report);

  // Handle messages from webview
  messageSubscription = panel.webview.onDidReceiveMessage(async (msg) => {
    switch (msg.command) {
      case "rescan": {
        try {
          report = await sampleAndAnalyze(connectionId, connectionName, collectionPath, sampleSize);
          panel.webview.html = getSchemaReportHtml(report);
          vscode.window.showInformationMessage(`Resampled and updated schema health report for '${collectionPath}'.`);
        } catch (e: any) {
          vscode.window.showErrorMessage(`Failed to rescan: ${e.message}`);
        }
        break;
      }

      case "exportMarkdown": {
        const md = generateMarkdownReport(report);
        const doc = await vscode.workspace.openTextDocument({
          language: "markdown",
          content: md,
        });
        await vscode.window.showTextDocument(doc);
        break;
      }

      case "exportJson": {
        const jsonStr = JSON.stringify(report, null, 2);
        const doc = await vscode.workspace.openTextDocument({
          language: "json",
          content: jsonStr,
        });
        await vscode.window.showTextDocument(doc);
        break;
      }
    }
  });
}

async function sampleAndAnalyze(
  connectionId: string,
  connectionName: string,
  collectionPath: string,
  sampleSize: number
): Promise<CollectionHealthReport> {
  return await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Sampling & analyzing schema in '${collectionPath}' (${sampleSize} docs)...`,
      cancellable: false,
    },
    async () => {
      const conn = ConnectionManager.getInstance().getConnection(connectionId);
      if (conn?.isLocalJson) {
        const localDocs = LocalJsonService.getInstance().listDocuments(conn, collectionPath);
        const docs = localDocs.slice(0, sampleSize).map((d) => d.data);
        return analyzeCollectionSchemaHealth(collectionPath, connectionId, connectionName, docs);
      }

      const firestore = await ConnectionManager.getInstance().getFirestore(connectionId);
      const snapshot = await firestore.collection(collectionPath).limit(sampleSize).get();
      const docs: Record<string, any>[] = [];
      snapshot.forEach((d) => {
        if (d.exists) {
          docs.push(d.data());
        }
      });
      return analyzeCollectionSchemaHealth(collectionPath, connectionId, connectionName, docs);
    }
  );
}

function generateMarkdownReport(r: CollectionHealthReport): string {
  const lines: string[] = [
    `# Schema Drift & Anomaly Health Report: \`${r.collectionPath}\``,
    ``,
    `* **Connection**: ${r.connectionName} (\`${r.connectionId}\`)`,
    `* **Sampled Documents**: ${r.sampledCount}`,
    `* **Total Unique Keys**: ${r.totalUniqueFields}`,
    `* **Overall Health Score**: **${r.overallHealthScore}/100**`,
    `* **Mixed Data Types**: ${r.mixedTypesCount}`,
    `* **Orphan / Zombie Keys**: ${r.orphanKeysCount}`,
    `* **Generated At**: ${r.generatedAt}`,
    ``,
    `---`,
    ``,
    `## Field Breakdown & Presence`,
    ``,
    `| Field Path | Presence (%) | Count | Data Types | Status / Warnings |`,
    `| :--- | :--- | :--- | :--- | :--- |`,
  ];

  for (const f of r.fields) {
    const typesStr = f.typeDistributions.map((t) => `${t.type} (${t.percentage}%)`).join(", ");
    const warningsStr = f.sampleErrorsOrAnomalies.length > 0 ? f.sampleErrorsOrAnomalies.join("; ") : "Healthy";
    lines.push(`| \`${f.fieldPath}\` | ${f.presencePercentage}% | ${f.occurrenceCount}/${r.sampledCount} | ${typesStr} | ${warningsStr} |`);
  }

  lines.push(``);
  return lines.join("\n");
}

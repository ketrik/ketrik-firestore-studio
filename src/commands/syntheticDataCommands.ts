import * as vscode from "vscode";
import { CollectionItem } from "../explorer/items";
import { ConnectionManager } from "../connections/ConnectionManager";
import { LocalJsonService } from "../services/LocalJsonService";
import { inferCollectionSchema } from "./schemaCommands";
import {
  deduceFieldDomain,
  generateSyntheticDocument,
  FieldGeneratorConfig,
} from "../services/mockDataGenerators";
import ExplorerDataProvider from "../explorer/ExplorerDataProvider";
import { WriteBatch } from "firebase-admin/firestore";

/**
 * Generate 20-character alphanumeric Firestore Auto-ID.
 */
function autoId(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let autoId = "";
  for (let i = 0; i < 20; i++) {
    autoId += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return autoId;
}

/**
 * Command: Generate Synthetic Mock Data for a Collection.
 */
export async function generateSyntheticDataCommand(
  item: CollectionItem,
  explorerDataProvider: ExplorerDataProvider
): Promise<void> {
  const connectionManager = ConnectionManager.getInstance();
  const conn = connectionManager.getConnection(item.connectionId);
  if (!conn) {
    vscode.window.showErrorMessage(`Connection '${item.connectionId}' not found.`);
    return;
  }

  const collectionPath = item.reference?.path || item.collectionId;

  // Step 1: Sample existing documents (up to 30) to infer schema
  let sampledDocs: Record<string, any>[] = [];
  try {
    if (conn.isLocalJson) {
      const localDocs = LocalJsonService.getInstance().listDocuments(conn, collectionPath);
      sampledDocs = localDocs.slice(0, 30).map((d) => d.data);
    } else {
      const firestore = await connectionManager.getFirestore(item.connectionId);
      const snapshot = await firestore.collection(collectionPath).limit(30).get();
      sampledDocs = snapshot.docs.map((d) => d.data());
    }
  } catch (err: any) {
    vscode.window.showWarningMessage(`Could not sample existing documents: ${err.message}. Starting with blank schema.`);
  }

  // Infer field configurations
  const fieldConfigs: FieldGeneratorConfig[] = [];
  if (sampledDocs.length > 0) {
    const inferredSchema = inferCollectionSchema(sampledDocs);
    for (const [key, field] of inferredSchema.entries()) {
      const typeList = Array.from(field.types).filter((t) => t !== "null");
      const primaryType = typeList[0] || "string";
      const domain = deduceFieldDomain(key, primaryType);
      const enumValues = field.stringValues.size > 0 && field.stringValues.size <= 5
        ? Array.from(field.stringValues)
        : undefined;

      fieldConfigs.push({
        name: key,
        type: primaryType,
        isOptional: field.optional,
        domain,
        enumValues,
      });
    }
  } else {
    // Default starter fields if collection is currently completely empty
    fieldConfigs.push(
      { name: "name", type: "string", isOptional: false, domain: "name" },
      { name: "email", type: "string", isOptional: false, domain: "email" },
      { name: "status", type: "string", isOptional: false, domain: "status" },
      { name: "createdAt", type: "timestamp", isOptional: false, domain: "date" }
    );
  }

  // Step 2: Prompt for Document Count
  const countChoice = await vscode.window.showQuickPick(
    [
      { label: "10 documents", count: 10, description: "Fast preview batch" },
      { label: "50 documents", count: 50, description: "Standard test fixture" },
      { label: "100 documents", count: 100, description: "Small load test" },
      { label: "500 documents", count: 500, description: "Medium benchmark dataset" },
      { label: "Custom count...", count: -1, description: "Up to 2,000 documents" },
    ],
    { title: `Generate Synthetic Data for '${collectionPath}' (1/3): Document Count` }
  );
  if (!countChoice) return;

  let docCount = countChoice.count;
  if (docCount === -1) {
    const input = await vscode.window.showInputBox({
      prompt: "Enter number of documents to generate (1 - 2000)",
      value: "25",
      validateInput: (v) => {
        const n = parseInt(v, 10);
        return isNaN(n) || n < 1 || n > 2000 ? "Please enter an integer between 1 and 2,000" : null;
      },
    });
    if (!input) return;
    docCount = parseInt(input, 10);
  }

  // Step 3: Document ID Strategy
  const idStrategyChoice = await vscode.window.showQuickPick(
    [
      {
        label: "$(key) Auto-ID (Default)",
        strategy: "auto" as const,
        description: "Standard random 20-character Firestore ID (e.g. 7mKx8L9p2QvW1tZ3yN4r)",
      },
      {
        label: "$(list-ordered) Sequential Index",
        strategy: "sequential" as const,
        description: "Zero-padded numerical sequence (e.g. item_001, item_002...)",
      },
      {
        label: "$(symbol-string) Field Slug",
        strategy: "slug" as const,
        description: "Derives ID from the document's name or status field",
      },
    ],
    { title: `Generate Synthetic Data (2/3): Document ID Strategy` }
  );
  if (!idStrategyChoice) return;

  // Step 4: Preview Sample Documents
  const sampleDocs: Record<string, any>[] = [];
  for (let i = 0; i < 3; i++) {
    sampleDocs.push(generateSyntheticDocument(fieldConfigs));
  }

  const previewAction = await vscode.window.showInformationMessage(
    `Ready to generate ${docCount} documents for '${collectionPath}'. Detected ${fieldConfigs.length} fields: [${fieldConfigs.map((f) => f.name).join(", ")}].`,
    "Generate Now",
    "Preview Sample in Editor"
  );

  if (!previewAction) return;

  if (previewAction === "Preview Sample in Editor") {
    const previewDoc = await vscode.workspace.openTextDocument({
      language: "json",
      content: JSON.stringify(sampleDocs, null, 2),
    });
    await vscode.window.showTextDocument(previewDoc, { preview: true });

    const proceed = await vscode.window.showInformationMessage(
      `Generate ${docCount} documents into '${collectionPath}' now?`,
      "Generate Now"
    );
    if (proceed !== "Generate Now") return;
  }

  // Step 5: Execute Ingestion with Progress & Batching
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Generating ${docCount} synthetic documents for '${collectionPath}'...`,
      cancellable: true,
    },
    async (progress, token) => {
      const BATCH_SIZE = 400; // Safe below Firestore's 500 max writes per batch
      let totalCreated = 0;

      if (conn.isLocalJson) {
        // Local JSON batch insertion
        const currentLocal = LocalJsonService.getInstance().listDocuments(conn, collectionPath);
        const startIndex = currentLocal.length + 1;
        const generatedDocs: Array<{ id: string; data: Record<string, any> }> = [];

        for (let i = 0; i < docCount; i++) {
          if (token.isCancellationRequested) break;

          const data = generateSyntheticDocument(fieldConfigs);
          let docId: string;
          if (idStrategyChoice.strategy === "sequential") {
            docId = `doc_${String(startIndex + i).padStart(4, "0")}`;
          } else if (idStrategyChoice.strategy === "slug" && data.name) {
            docId = `${String(data.name).toLowerCase().replace(/[^a-z0-9]/g, "_")}_${i + 1}`;
          } else {
            docId = autoId();
          }

          generatedDocs.push({ id: docId, data });
          totalCreated++;
          progress.report({ increment: (1 / docCount) * 100 });
        }

        LocalJsonService.getInstance().setDocuments(conn, collectionPath, generatedDocs);
      } else {
        // Cloud Firestore / Emulator batch ingestion
        const firestore = await connectionManager.getFirestore(item.connectionId);
        const collectionRef = firestore.collection(collectionPath);

        let batch: WriteBatch = firestore.batch();
        let batchOps = 0;

        for (let i = 0; i < docCount; i++) {
          if (token.isCancellationRequested) {
            vscode.window.showWarningMessage("Synthetic data generation cancelled by user.");
            break;
          }

          const data = generateSyntheticDocument(fieldConfigs);
          let docRef;

          if (idStrategyChoice.strategy === "sequential") {
            const id = `doc_${String(i + 1).padStart(4, "0")}`;
            docRef = collectionRef.doc(id);
          } else if (idStrategyChoice.strategy === "slug" && data.name) {
            const slug = `${String(data.name).toLowerCase().replace(/[^a-z0-9]/g, "_")}_${i + 1}`;
            docRef = collectionRef.doc(slug);
          } else {
            docRef = collectionRef.doc();
          }

          batch.set(docRef, data);
          batchOps++;
          totalCreated++;

          if (batchOps >= BATCH_SIZE || i === docCount - 1) {
            await batch.commit();
            progress.report({ increment: (batchOps / docCount) * 100 });
            batch = firestore.batch();
            batchOps = 0;
          }
        }
      }

      vscode.window.showInformationMessage(
        `Successfully generated and seeded ${totalCreated} synthetic documents into '${collectionPath}'.`
      );
      explorerDataProvider.refreshNode(item);
    }
  );
}

import * as vscode from "vscode";
import { FieldPath, FieldValue } from "firebase-admin/firestore";
import { ConnectionManager } from "../connections/ConnectionManager";
import { LocalJsonService } from "../services/LocalJsonService";
import { CostService } from "../cost/costService";
import { DocumentFileSystemProvider } from "../editor/DocumentFileSystemProvider";
import {
  TransformRule,
  TransformSampleDiff,
  TransformPreviewResult,
  TransformExecutionResult,
  applyFieldTransformation,
} from "./types";
import { sanitizeFirestoreValue } from "../webview/common/tableUtils";

export class TransformService {
  private static instance: TransformService;

  public static getInstance(): TransformService {
    if (!TransformService.instance) {
      TransformService.instance = new TransformService();
    }
    return TransformService.instance;
  }

  /**
   * Helper to retrieve a nested property value from an object using a dot-delimited path.
   */
  public getNestedValue(obj: any, path: string): { found: boolean; value: any } {
    if (!obj || typeof obj !== "object") return { found: false, value: undefined };
    if (Object.prototype.hasOwnProperty.call(obj, path)) {
      return { found: true, value: obj[path] };
    }
    const parts = path.split(".");
    let cur = obj;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (cur === null || cur === undefined || typeof cur !== "object" || !(p in cur)) {
        return { found: false, value: undefined };
      }
      cur = cur[p];
    }
    return { found: true, value: cur };
  }

  /**
   * Samples up to `sampleSize` documents (default: 5) to generate a side-by-side preview diff.
   */
  public async previewTransformation(
    connectionId: string,
    collectionPath: string,
    rule: TransformRule,
    sampleSize = 5
  ): Promise<TransformPreviewResult> {
    const conn = ConnectionManager.getInstance().getConnection(connectionId);
    if (!conn) {
      throw new Error(`Connection '${connectionId}' not found.`);
    }

    const samples: TransformSampleDiff[] = [];
    let sampledDocs: { id: string; path: string; data: any }[] = [];

    if (conn.isLocalJson) {
      const collMap = LocalJsonService.getInstance().getCollectionData(conn, collectionPath);
      const allDocs = Object.keys(collMap).map((id) => ({ id, data: collMap[id] }));
      sampledDocs = allDocs.slice(0, sampleSize).map((d) => ({
        id: d.id,
        path: `${collectionPath}/${d.id}`,
        data: d.data,
      }));
    } else {
      const firestore = await ConnectionManager.getInstance().getFirestore(connectionId);
      const snapshot = await firestore.collection(collectionPath).limit(sampleSize).get();
      CostService.getInstance().recordOperation(connectionId, "read", snapshot.docs.length);
      sampledDocs = snapshot.docs.map((doc) => ({
        id: doc.id,
        path: doc.ref.path,
        data: doc.data() || {},
      }));
    }

    let modifiedCount = 0;

    for (const doc of sampledDocs) {
      const current = this.getNestedValue(doc.data, rule.targetField);
      const res = applyFieldTransformation(current.value, rule, current.found);

      if (res.modified) {
        modifiedCount++;
      }

      // Generate preview 'after' representation
      let afterVal: any;
      if (res.deleteField && res.newKeyName) {
        // rename
        afterVal = `[Renamed to '${res.newKeyName}']: ${JSON.stringify(sanitizeFirestoreValue(res.newValue))}`;
      } else if (res.deleteField) {
        // delete
        afterVal = "[Deleted]";
      } else {
        afterVal = res.modified ? sanitizeFirestoreValue(res.newValue) : sanitizeFirestoreValue(current.value);
      }

      samples.push({
        docId: doc.id,
        docPath: doc.path,
        before: current.found ? sanitizeFirestoreValue(current.value) : "[Not present]",
        after: afterVal,
        isModified: res.modified,
        statusNote: res.note,
      });
    }

    return {
      collectionPath,
      rule,
      totalSampled: sampledDocs.length,
      modifiedCount,
      samples,
    };
  }

  /**
   * Executes the transformation across all documents in the collection with chunked WriteBatch safety.
   */
  public async executeTransformation(
    connectionId: string,
    collectionPath: string,
    rule: TransformRule,
    progressToken?: vscode.CancellationToken,
    onProgress?: (processed: number, updated: number, totalEstimated?: number) => void
  ): Promise<TransformExecutionResult> {
    const conn = ConnectionManager.getInstance().getConnection(connectionId);
    if (!conn) {
      throw new Error(`Connection '${connectionId}' not found.`);
    }

    if (conn.readOnly) {
      throw new Error(
        `Connection '${conn.name}' is currently locked in Read-Only mode. Unlock it before running transformations.`
      );
    }

    let totalProcessed = 0;
    let totalUpdated = 0;
    let totalDeleted = 0;
    let totalSkipped = 0;
    const errors: string[] = [];
    const modifiedDocPaths: string[] = [];

    // Local JSON implementation
    if (conn.isLocalJson) {
      const collMap = LocalJsonService.getInstance().getCollectionData(conn, collectionPath);
      const allDocs = Object.keys(collMap).map((id) => ({ id, data: collMap[id] }));
      for (const d of allDocs) {
        if (progressToken?.isCancellationRequested) break;
        totalProcessed++;

        const current = this.getNestedValue(d.data, rule.targetField);
        const res = applyFieldTransformation(current.value, rule, current.found);

        if (!res.modified) {
          totalSkipped++;
          onProgress?.(totalProcessed, totalUpdated + totalDeleted, allDocs.length);
          continue;
        }

        const docPath = `${collectionPath}/${d.id}`;
        try {
          if (res.deleteField && res.newKeyName) {
            // Rename: set new field, then delete old
            LocalJsonService.getInstance().updateField(conn, docPath, res.newKeyName, res.newValue);
            LocalJsonService.getInstance().deleteField(conn, docPath, rule.targetField);
            totalUpdated++;
          } else if (res.deleteField) {
            LocalJsonService.getInstance().deleteField(conn, docPath, rule.targetField);
            totalDeleted++;
          } else {
            LocalJsonService.getInstance().updateField(conn, docPath, rule.targetField, res.newValue);
            totalUpdated++;
          }
          modifiedDocPaths.push(docPath);
        } catch (e: any) {
          errors.push(`Doc ${d.id}: ${e.message}`);
        }

        onProgress?.(totalProcessed, totalUpdated + totalDeleted, allDocs.length);
      }

      DocumentFileSystemProvider.getInstance().invalidateAndNotifyMany(
        modifiedDocPaths.map((p) => ({ connectionId, docPath: p }))
      );

      return {
        totalProcessed,
        totalUpdated,
        totalDeleted,
        totalSkipped,
        cancelled: !!progressToken?.isCancellationRequested,
        errors,
      };
    }

    // Cloud Firestore implementation with chunked WriteBatch (400 items per commit)
    const firestore = await ConnectionManager.getInstance().getFirestore(connectionId);
    const collectionRef = firestore.collection(collectionPath);
    const targetSegments = rule.targetField.split(".");
    const targetFieldPath = new FieldPath(...targetSegments);

    let lastDocSnapshot: import("firebase-admin/firestore").QueryDocumentSnapshot | null = null;
    const PAGE_SIZE = 400;
    let hasMore = true;

    while (hasMore && !progressToken?.isCancellationRequested) {
      let query = collectionRef.limit(PAGE_SIZE);
      if (lastDocSnapshot) {
        query = query.startAfter(lastDocSnapshot);
      }

      const snap = await query.get();
      if (snap.empty) {
        hasMore = false;
        break;
      }

      CostService.getInstance().recordOperation(connectionId, "read", snap.docs.length);
      lastDocSnapshot = snap.docs[snap.docs.length - 1];
      if (snap.docs.length < PAGE_SIZE) {
        hasMore = false;
      }

      const batch = firestore.batch();
      let batchCount = 0;
      const pageModifiedPaths: string[] = [];

      for (const docSnap of snap.docs) {
        totalProcessed++;
        const data = docSnap.data() || {};
        const hasLiteralTargetKey = Object.prototype.hasOwnProperty.call(data, rule.targetField);
        const docTargetFieldPath = hasLiteralTargetKey ? new FieldPath(rule.targetField) : targetFieldPath;
        const current = this.getNestedValue(data, rule.targetField);
        const res = applyFieldTransformation(current.value, rule, current.found);

        if (!res.modified) {
          totalSkipped++;
          continue;
        }

        try {
          if (res.deleteField && res.newKeyName) {
            if (Object.prototype.hasOwnProperty.call(data, res.newKeyName)) {
              errors.push(`Doc ${docSnap.id}: target field '${res.newKeyName}' already exists.`);
              totalSkipped++;
              continue;
            }
            // Rename: add new key, delete old key
            const newSegments = res.newKeyName.includes(".") ? res.newKeyName.split(".") : [res.newKeyName];
            const newFieldPath = new FieldPath(...newSegments);
            batch.update(docSnap.ref, newFieldPath, res.newValue, docTargetFieldPath, FieldValue.delete());
            totalUpdated++;
            batchCount++;
          } else if (res.deleteField) {
            batch.update(docSnap.ref, docTargetFieldPath, FieldValue.delete());
            totalDeleted++;
            batchCount++;
          } else {
            batch.update(docSnap.ref, docTargetFieldPath, res.newValue);
            totalUpdated++;
            batchCount++;
          }
          pageModifiedPaths.push(docSnap.ref.path);
        } catch (e: any) {
          errors.push(`Doc ${docSnap.id}: ${e.message}`);
        }
      }

      if (batchCount > 0) {
        try {
          await batch.commit();
          CostService.getInstance().recordOperation(connectionId, "write", batchCount);
          DocumentFileSystemProvider.getInstance().invalidateAndNotifyMany(
            pageModifiedPaths.map((p) => ({ connectionId, docPath: p }))
          );
        } catch (batchErr: any) {
          errors.push(`Batch commit failed (${batchCount} doc(s)): ${batchErr?.message || batchErr}`);
        }
      }

      onProgress?.(totalProcessed, totalUpdated + totalDeleted);
    }

    return {
      totalProcessed,
      totalUpdated,
      totalDeleted,
      totalSkipped,
      cancelled: !!progressToken?.isCancellationRequested,
      errors,
    };
  }
}

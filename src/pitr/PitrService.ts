import { Timestamp, Query } from "firebase-admin/firestore";
import * as vscode from "vscode";
import { ConnectionManager } from "../connections/ConnectionManager";
import { DatabaseConfigService } from "../databaseConfig/DatabaseConfigService";
import { HistoricalDocSnapshot, PitrStatus } from "./types";
import { CostService } from "../cost/costService";
import { DocumentFileSystemProvider } from "../editor/DocumentFileSystemProvider";
import { formatDateTime } from "../utils/timestampUtils";
import { scheme } from "../constants";

export class PitrService {
  private static instance: PitrService;

  private constructor() {}

  public static getInstance(): PitrService {
    if (!PitrService.instance) {
      PitrService.instance = new PitrService();
    }
    return PitrService.instance;
  }

  /**
   * Check if PITR is active and retrieve the earliest recovery timestamp.
   */
  public async getPitrStatus(connectionId: string): Promise<PitrStatus> {
    const meta = await DatabaseConfigService.getInstance().getDatabaseConfig(connectionId);
    const enabled = meta.pointInTimeRecoveryEnablement === "POINT_IN_TIME_RECOVERY_ENABLED";
    const earliestVersionTime = meta.earliestVersionTime ? new Date(meta.earliestVersionTime) : undefined;

    return {
      enabled,
      earliestVersionTime,
      databaseId: meta.databaseId,
      projectId: meta.projectId,
    };
  }

  /**
   * Fetch collection documents at a specific historical timestamp using atomic read-only transaction.
   */
  public async getCollectionAtTimestamp(
    connectionId: string,
    collectionPath: string,
    readTime: Date,
    options: {
      limit?: number;
      offset?: number;
      orderBy?: { fieldName: string; direction: "asc" | "desc" };
      whereClauses?: Array<{ field: string; op: any; value: any }>;
    } = {}
  ): Promise<HistoricalDocSnapshot[]> {
    const conn = ConnectionManager.getInstance().getConnection(connectionId);
    if (!conn) {
      throw new Error(`Connection with ID '${connectionId}' not found.`);
    }

    if (conn.isLocalJson) {
      throw new Error("Point-in-Time Recovery is not supported on Local JSON database instances.");
    }

    const firestore = await ConnectionManager.getInstance().getFirestore(connectionId);
    const targetTimestamp = Timestamp.fromDate(readTime);

    CostService.getInstance().recordOperation(connectionId, "read", options.limit || 20);

    return await firestore.runTransaction(
      async (transaction) => {
        let query: Query = firestore.collection(collectionPath);

        if (options.whereClauses && Array.isArray(options.whereClauses)) {
          for (const clause of options.whereClauses) {
            query = query.where(clause.field, clause.op, clause.value);
          }
        }

        if (options.orderBy) {
          query = query.orderBy(options.orderBy.fieldName, options.orderBy.direction);
        }

        if (typeof options.limit === "number" && options.limit > 0) {
          query = query.limit(options.limit);
        }

        if (typeof options.offset === "number" && options.offset > 0) {
          query = query.offset(options.offset);
        }

        const snapshot = await transaction.get(query);

        return snapshot.docs.map((doc) => ({
          id: doc.id,
          path: doc.ref.path,
          readTime,
          data: doc.data(),
          exists: true,
          createTime: doc.createTime ? doc.createTime.toDate() : undefined,
          updateTime: doc.updateTime ? doc.updateTime.toDate() : undefined,
        }));
      },
      { readOnly: true, readTime: targetTimestamp }
    );
  }

  /**
   * Fetch a single document at a historical timestamp using an atomic read-only transaction.
   */
  public async getDocumentAtTimestamp(
    connectionId: string,
    docPath: string,
    readTime: Date
  ): Promise<HistoricalDocSnapshot | null> {
    const conn = ConnectionManager.getInstance().getConnection(connectionId);
    if (!conn) {
      throw new Error(`Connection with ID '${connectionId}' not found.`);
    }

    if (conn.isLocalJson) {
      return null;
    }

    const firestore = await ConnectionManager.getInstance().getFirestore(connectionId);
    const targetTimestamp = Timestamp.fromDate(readTime);

    CostService.getInstance().recordOperation(connectionId, "read", 1);

    return await firestore.runTransaction(
      async (transaction) => {
        const docRef = firestore.doc(docPath);
        const docSnap = await transaction.get(docRef);

        if (!docSnap.exists) {
          return null;
        }

        return {
          id: docSnap.id,
          path: docRef.path,
          readTime,
          data: docSnap.data() || {},
          exists: true,
          createTime: docSnap.createTime ? docSnap.createTime.toDate() : undefined,
          updateTime: docSnap.updateTime ? docSnap.updateTime.toDate() : undefined,
        };
      },
      { readOnly: true, readTime: targetTimestamp }
    );
  }

  /**
   * Restore a historical document snapshot back into the live Firestore database.
   */
  public async restoreDocumentFromHistory(
    connectionId: string,
    docPath: string,
    historicalData: Record<string, any>,
    strategy: "overwrite" | "merge" = "overwrite"
  ): Promise<void> {
    const firestore = await ConnectionManager.getInstance().getFirestore(connectionId);
    const docRef = firestore.doc(docPath);

    CostService.getInstance().recordOperation(connectionId, "write", 1);

    if (strategy === "merge") {
      await docRef.set(historicalData, { merge: true });
    } else {
      await docRef.set(historicalData);
    }

    // Invalidate virtual file system and editor tabs so live view updates immediately
    DocumentFileSystemProvider.getInstance().invalidateAndNotify(connectionId, docPath);
  }

  /**
   * Open VS Code native side-by-side diff comparing the historical document with live state.
   */
  public async compareDocumentWithLive(
    connectionId: string,
    docPath: string,
    readTime: Date
  ): Promise<void> {
    const historicalUri = vscode.Uri.parse(
      `${scheme}://${connectionId}/${docPath}.json?readTime=${encodeURIComponent(readTime.toISOString())}`
    );
    const liveUri = vscode.Uri.parse(
      `${scheme}://${connectionId}/${docPath}.json`
    );

    const title = `${docPath} (${formatDateTime(readTime)}) ↔ Live Current State`;
    await vscode.commands.executeCommand("vscode.diff", historicalUri, liveUri, title);
  }
}


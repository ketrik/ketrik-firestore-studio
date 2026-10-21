import { ConnectionManager, FirestoreConnectionConfig } from "../connections/ConnectionManager";
import { calculateDocumentSize } from "../utils/documentSizeUtils";
import { TrafficMetricsProvider } from "./trafficMetricsProvider";
import { LocalJsonService } from "../services/LocalJsonService";
import {
  OverviewDashboardData,
  DatabaseMetricsSummary,
  AuthMetricsSummary,
  CollectionMetricItem,
} from "./overviewTypes";

export class OverviewService {
  private static instance: OverviewService;

  // Cache overview data for 60 seconds to prevent rapid redundant aggregations
  private cache = new Map<string, { timestamp: number; data: OverviewDashboardData }>();
  private readonly CACHE_TTL_MS = 60 * 1000;
  private readonly MAX_CACHE_ENTRIES = 20;

  private constructor() {
    ConnectionManager.getInstance().onDidChangeConnections(() => {
      this.invalidateCache();
    });
  }

  public static getInstance(): OverviewService {
    if (!OverviewService.instance) {
      OverviewService.instance = new OverviewService();
    }
    return OverviewService.instance;
  }

  /**
   * Invalidate cached data for a specific connection or all.
   */
  public invalidateCache(connectionId?: string) {
    if (connectionId) {
      this.cache.delete(connectionId);
    } else {
      this.cache.clear();
    }
  }

  /**
   * Gather aggregated overview data for a connection.
   */
  public async getOverviewData(
    connectionId: string,
    forceRefresh = false
  ): Promise<OverviewDashboardData> {
    if (!forceRefresh) {
      const cached = this.cache.get(connectionId);
      if (cached && Date.now() - cached.timestamp < this.CACHE_TTL_MS) {
        return cached.data;
      }
    }

    const conn = ConnectionManager.getInstance().getConnection(connectionId);
    if (!conn) {
      throw new Error(`Connection '${connectionId}' not found.`);
    }

    const [database, auth, traffic] = await Promise.all([
      this.fetchDatabaseMetrics(conn),
      this.fetchAuthMetrics(conn),
      TrafficMetricsProvider.getInstance().getTrafficMetrics(conn, 7),
    ]);

    const effectiveProjectId = ConnectionManager.getInstance().getEffectiveProjectId(conn);

    const data: OverviewDashboardData = {
      connectionId: conn.id,
      connectionName: conn.name,
      projectId: effectiveProjectId,
      databaseId: conn.databaseId || "(default)",
      isEmulator: !!conn.isEmulator,
      isLocalJson: !!conn.isLocalJson,
      lastRefreshed: new Date().toISOString(),
      database,
      auth,
      traffic,
    };

    if (this.cache.size >= this.MAX_CACHE_ENTRIES) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }
    this.cache.set(connectionId, { timestamp: Date.now(), data });
    return data;
  }

  /**
   * Fetch collection counts, document counts via server-side count(), and estimated storage.
   */
  private async fetchDatabaseMetrics(conn: FirestoreConnectionConfig): Promise<DatabaseMetricsSummary> {
    if (conn.isLocalJson) {
      const localService = LocalJsonService.getInstance();
      const collections = localService.listCollections(conn);
      const collectionMetrics: CollectionMetricItem[] = [];

      let totalDocs = 0;
      let totalEstimatedBytes = 0;

      for (const colName of collections) {
        const colData = localService.getCollectionData(conn, colName);
        const docIds = Object.keys(colData);
        const count = docIds.length;
        let sampleBytesTotal = 0;
        const sampleCount = Math.min(count, 5);

        for (const docId of docIds.slice(0, 5)) {
          sampleBytesTotal += calculateDocumentSize(colData[docId], `${colName}/${docId}`);
        }

        const avgDocSize = sampleCount > 0 ? Math.round(sampleBytesTotal / sampleCount) : 256;
        const colEstBytes = count * avgDocSize;

        totalDocs += count;
        totalEstimatedBytes += colEstBytes;

        collectionMetrics.push({
          id: colName,
          path: colName,
          documentCount: count,
          estimatedSizeBytes: colEstBytes,
          avgDocSizeBytes: avgDocSize,
          sampleCount,
        });
      }

      collectionMetrics.sort((a, b) => b.documentCount - a.documentCount);

      return {
        totalCollections: collections.length,
        totalDocuments: totalDocs,
        totalEstimatedSizeBytes: totalEstimatedBytes,
        topCollections: collectionMetrics.slice(0, 5),
      };
    }

    try {
      const connectionManager = ConnectionManager.getInstance();

      const firestore = await connectionManager.getFirestore(conn.id);
      const collections = await firestore.listCollections();
      const collectionMetrics: CollectionMetricItem[] = [];

      let totalDocs = 0;
      let totalEstimatedBytes = 0;

      // Process up to 20 collections in parallel to keep latency tight
      const targetCollections = collections.slice(0, 20);

      await Promise.all(
        targetCollections.map(async (col) => {
          try {
            // 1. Native count() aggregation
            const countSnap = await col.count().get();
            const count = countSnap.data().count;

            // 2. Sample up to 5 documents to calculate average document size
            const sampleSnap = await col.limit(5).get();
            let sampleBytesTotal = 0;
            let sampleCount = 0;

            for (const doc of sampleSnap.docs) {
              const data = doc.data();
              sampleBytesTotal += calculateDocumentSize(data, doc.ref.path);
              sampleCount++;
            }

            const avgDocSize = sampleCount > 0 ? Math.round(sampleBytesTotal / sampleCount) : 256;
            const colEstBytes = count * avgDocSize;

            totalDocs += count;
            totalEstimatedBytes += colEstBytes;

            collectionMetrics.push({
              id: col.id,
              path: col.path,
              documentCount: count,
              estimatedSizeBytes: colEstBytes,
              avgDocSizeBytes: avgDocSize,
              sampleCount,
            });
          } catch {
            collectionMetrics.push({
              id: col.id,
              path: col.path,
              documentCount: 0,
              estimatedSizeBytes: 0,
              avgDocSizeBytes: 0,
              sampleCount: 0,
            });
          }
        })
      );

      // Sort by document count descending
      collectionMetrics.sort((a, b) => b.documentCount - a.documentCount);

      return {
        totalCollections: collections.length,
        totalDocuments: totalDocs,
        totalEstimatedSizeBytes: totalEstimatedBytes,
        topCollections: collectionMetrics.slice(0, 5),
      };
    } catch {
      // Fallback if listCollections fails (e.g. offline local JSON or restricted permissions)
      return {
        totalCollections: 0,
        totalDocuments: 0,
        totalEstimatedSizeBytes: 0,
        topCollections: [],
      };
    }
  }

  /**
   * Fetch Firebase Auth user statistics (total users, active/disabled, email verified, provider breakdown).
   */
  private async fetchAuthMetrics(conn: FirestoreConnectionConfig): Promise<AuthMetricsSummary> {
    if (conn.isLocalJson) {
      return {
        isAvailable: false,
        totalUsers: 0,
        activeUsers: 0,
        disabledUsers: 0,
        verifiedEmailUsers: 0,
        recentActive7Days: 0,
        providers: {},
        errorMessage: "Auth not available on Local JSON connections.",
      };
    }

    try {
      return await ConnectionManager.getInstance().withAuth(conn.id, async (auth) => {
        // Sample up to 1,000 users for statistical breakdown
        const listRes = await auth.listUsers(1000);
        const users = listRes.users;

        const totalUsers = users.length;
        let disabledCount = 0;
        let verifiedCount = 0;
        let recentActive7Days = 0;
        const providers: Record<string, number> = {};

        const now = Date.now();
        const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

        for (const u of users) {
          if (u.disabled) disabledCount++;
          if (u.emailVerified) verifiedCount++;

          if (u.metadata.lastSignInTime) {
            const lastSign = new Date(u.metadata.lastSignInTime).getTime();
            if (now - lastSign <= sevenDaysMs) {
              recentActive7Days++;
            }
          }

          if (Array.isArray(u.providerData) && u.providerData.length > 0) {
            for (const p of u.providerData) {
              const pid = p.providerId || "password";
              providers[pid] = (providers[pid] || 0) + 1;
            }
          } else {
            const pid = "anonymous";
            providers[pid] = (providers[pid] || 0) + 1;
          }
        }

        return {
          isAvailable: true,
          totalUsers,
          activeUsers: totalUsers - disabledCount,
          disabledUsers: disabledCount,
          verifiedEmailUsers: verifiedCount,
          recentActive7Days,
          providers,
        };
      });
    } catch (err: any) {
      return {
        isAvailable: false,
        totalUsers: 0,
        activeUsers: 0,
        disabledUsers: 0,
        verifiedEmailUsers: 0,
        recentActive7Days: 0,
        providers: {},
        errorMessage: err?.message || "Firebase Auth is not enabled or accessible on this project.",
      };
    }
  }
}

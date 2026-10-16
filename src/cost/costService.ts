import * as vscode from "vscode";
import { ConnectionManager } from "../connections/ConnectionManager";

export interface QuotaLimits {
  readsPerDay: number;
  writesPerDay: number;
  deletesPerDay: number;
  storageGiB: number;
  egressGiBPerMonth: number;
}

export const SPARK_FREE_QUOTA: QuotaLimits = {
  readsPerDay: 50_000,
  writesPerDay: 20_000,
  deletesPerDay: 20_000,
  storageGiB: 1.0,
  egressGiBPerMonth: 10.0,
};

export interface PricingRates {
  readsPer100k: number; // $0.06 / 100k
  writesPer100k: number; // $0.18 / 100k
  deletesPer100k: number; // $0.02 / 100k
  storagePerGiBMonth: number; // $0.18 / GiB / month
  egressPerGiB: number; // $0.12 / GiB
}

export const BLAZE_PRICING: PricingRates = {
  readsPer100k: 0.06,
  writesPer100k: 0.18,
  deletesPer100k: 0.02,
  storagePerGiBMonth: 0.18,
  egressPerGiB: 0.12,
};

export interface SessionOperationCounts {
  reads: number;
  writes: number;
  deletes: number;
  lastUpdated: number;
}

export interface DailyUsageSnapshot {
  date: string; // YYYY-MM-DD
  source: "cloud-monitoring" | "session-accounting";
  reads: number;
  writes: number;
  deletes: number;
  storageBytes?: number;
  egressBytes?: number;
}

export interface CapacityPlanInputs {
  dau: number; // Daily Active Users
  readsPerUserSession: number;
  writesPerUserSession: number;
  deletesPerUserSession: number;
  averageDocSizeBytes: number; // e.g. 1024 (1 KB)
  daysRetention: number; // e.g. 30, 90, 365
  enableCaching: boolean; // e.g. 70% read reduction with cache
  cacheHitRatePercent: number; // e.g. 60-80%
}

export interface CapacityPlanResult {
  dailyReads: number;
  dailyWrites: number;
  dailyDeletes: number;
  billableDailyReads: number;
  billableDailyWrites: number;
  billableDailyDeletes: number;
  dailyCostReads: number;
  dailyCostWrites: number;
  dailyCostDeletes: number;
  dailyTotalCost: number;
  monthlyTotalCost: number;
  accumulatedStorageGiB: number;
  monthlyStorageCost: number;
  monthlyGrandTotal: number;
  savingsWithCaching: number;
}

export class CostService {
  private static instance: CostService;

  // Track session operations per connection
  private _sessionCounts: Map<string, SessionOperationCounts> = new Map();
  private _onDidChangeUsage = new vscode.EventEmitter<string>();
  public readonly onDidChangeUsage = this._onDidChangeUsage.event;

  private constructor() {}

  public static getInstance(): CostService {
    if (!CostService.instance) {
      CostService.instance = new CostService();
    }
    return CostService.instance;
  }

  /**
   * Record a document read, write, or delete operation in the active session.
   */
  public recordOperation(
    connectionId: string,
    type: "read" | "write" | "delete",
    count = 1
  ): void {
    if (count <= 0) return;
    let counts = this._sessionCounts.get(connectionId);
    if (!counts) {
      counts = { reads: 0, writes: 0, deletes: 0, lastUpdated: Date.now() };
      this._sessionCounts.set(connectionId, counts);
    }

    if (type === "read") {
      counts.reads += count;
    } else if (type === "write") {
      counts.writes += count;
    } else if (type === "delete") {
      counts.deletes += count;
    }
    counts.lastUpdated = Date.now();
    this._onDidChangeUsage.fire(connectionId);
  }

  /**
   * Reset session counters for a given connection or all connections.
   */
  public resetSessionCounts(connectionId?: string): void {
    if (connectionId) {
      this._sessionCounts.delete(connectionId);
      this._onDidChangeUsage.fire(connectionId);
    } else {
      this._sessionCounts.clear();
      this._onDidChangeUsage.fire("*");
    }
  }

  /**
   * Retrieve in-session operation counts for a connection.
   */
  public getSessionCounts(connectionId: string): SessionOperationCounts {
    return (
      this._sessionCounts.get(connectionId) ?? {
        reads: 0,
        writes: 0,
        deletes: 0,
        lastUpdated: Date.now(),
      }
    );
  }

  /**
   * Calculate Blaze pay-as-you-go cost for a given operation count beyond the free quota.
   */
  public calculateOperationsCost(
    reads: number,
    writes: number,
    deletes: number,
    applySparkFreeTier = true
  ): {
    billableReads: number;
    billableWrites: number;
    billableDeletes: number;
    costReads: number;
    costWrites: number;
    costDeletes: number;
    totalCost: number;
  } {
    const freeReads = applySparkFreeTier ? SPARK_FREE_QUOTA.readsPerDay : 0;
    const freeWrites = applySparkFreeTier ? SPARK_FREE_QUOTA.writesPerDay : 0;
    const freeDeletes = applySparkFreeTier ? SPARK_FREE_QUOTA.deletesPerDay : 0;

    const billableReads = Math.max(0, reads - freeReads);
    const billableWrites = Math.max(0, writes - freeWrites);
    const billableDeletes = Math.max(0, deletes - freeDeletes);

    const costReads = (billableReads / 100_000) * BLAZE_PRICING.readsPer100k;
    const costWrites = (billableWrites / 100_000) * BLAZE_PRICING.writesPer100k;
    const costDeletes = (billableDeletes / 100_000) * BLAZE_PRICING.deletesPer100k;
    const totalCost = costReads + costWrites + costDeletes;

    return {
      billableReads,
      billableWrites,
      billableDeletes,
      costReads: Number(costReads.toFixed(4)),
      costWrites: Number(costWrites.toFixed(4)),
      costDeletes: Number(costDeletes.toFixed(4)),
      totalCost: Number(totalCost.toFixed(4)),
    };
  }

  /**
   * Calculate pre-flight query cost estimate given a count of matching documents.
   */
  public estimateQueryCost(documentCount: number): {
    documentCount: number;
    estimatedCost: number;
    warning?: string;
  } {
    // Reads are billed at $0.06 per 100,000 documents
    const estimatedCost = (documentCount / 100_000) * BLAZE_PRICING.readsPer100k;
    let warning: string | undefined;

    if (documentCount > 50_000) {
      warning = "Exceeds daily Spark free tier limit (50,000 reads) in a single query execution!";
    } else if (documentCount > 10_000) {
      warning = "High read volume query (>10,000 reads). Consider adding server-side where filters or tighter limit.";
    }

    return {
      documentCount,
      estimatedCost: Number(estimatedCost.toFixed(5)),
      warning,
    };
  }

  /**
   * Run capacity planning modeling based on projected DAU, user action frequency, and data size.
   */
  public modelCapacity(inputs: CapacityPlanInputs): CapacityPlanResult {
    let effectiveReadsPerUser = inputs.readsPerUserSession;
    let unoptimizedDailyReads = inputs.dau * inputs.readsPerUserSession;

    if (inputs.enableCaching) {
      const hitRatio = Math.max(0, Math.min(100, inputs.cacheHitRatePercent)) / 100;
      effectiveReadsPerUser = inputs.readsPerUserSession * (1 - hitRatio);
    }

    const dailyReads = Math.round(inputs.dau * effectiveReadsPerUser);
    const dailyWrites = Math.round(inputs.dau * inputs.writesPerUserSession);
    const dailyDeletes = Math.round(inputs.dau * inputs.deletesPerUserSession);

    // Free Spark quota applied per day
    const billableDailyReads = Math.max(0, dailyReads - SPARK_FREE_QUOTA.readsPerDay);
    const billableDailyWrites = Math.max(0, dailyWrites - SPARK_FREE_QUOTA.writesPerDay);
    const billableDailyDeletes = Math.max(0, dailyDeletes - SPARK_FREE_QUOTA.deletesPerDay);

    const dailyCostReads = (billableDailyReads / 100_000) * BLAZE_PRICING.readsPer100k;
    const dailyCostWrites = (billableDailyWrites / 100_000) * BLAZE_PRICING.writesPer100k;
    const dailyCostDeletes = (billableDailyDeletes / 100_000) * BLAZE_PRICING.deletesPer100k;

    const dailyTotalCost = dailyCostReads + dailyCostWrites + dailyCostDeletes;
    const monthlyTotalCost = dailyTotalCost * 30.416; // Average days per month

    // Storage capacity calculation
    const netDailyDocGrowth = Math.max(0, dailyWrites - dailyDeletes);
    const totalDocsRetained = netDailyDocGrowth * inputs.daysRetention;
    const totalBytes = totalDocsRetained * inputs.averageDocSizeBytes;
    const accumulatedStorageGiB = totalBytes / (1024 * 1024 * 1024);

    const billableStorageGiB = Math.max(0, accumulatedStorageGiB - SPARK_FREE_QUOTA.storageGiB);
    const monthlyStorageCost = billableStorageGiB * BLAZE_PRICING.storagePerGiBMonth;

    const monthlyGrandTotal = monthlyTotalCost + monthlyStorageCost;

    // Savings calculation
    const uncachedDailyReads = Math.max(0, unoptimizedDailyReads - SPARK_FREE_QUOTA.readsPerDay);
    const uncachedDailyCostReads = (uncachedDailyReads / 100_000) * BLAZE_PRICING.readsPer100k;
    const uncachedMonthlyOpsCost = (uncachedDailyCostReads + dailyCostWrites + dailyCostDeletes) * 30.416;
    const savingsWithCaching = Math.max(0, uncachedMonthlyOpsCost - monthlyTotalCost);

    return {
      dailyReads,
      dailyWrites,
      dailyDeletes,
      billableDailyReads,
      billableDailyWrites,
      billableDailyDeletes,
      dailyCostReads: Number(dailyCostReads.toFixed(4)),
      dailyCostWrites: Number(dailyCostWrites.toFixed(4)),
      dailyCostDeletes: Number(dailyCostDeletes.toFixed(4)),
      dailyTotalCost: Number(dailyTotalCost.toFixed(4)),
      monthlyTotalCost: Number(monthlyTotalCost.toFixed(2)),
      accumulatedStorageGiB: Number(accumulatedStorageGiB.toFixed(3)),
      monthlyStorageCost: Number(monthlyStorageCost.toFixed(2)),
      monthlyGrandTotal: Number(monthlyGrandTotal.toFixed(2)),
      savingsWithCaching: Number(savingsWithCaching.toFixed(2)),
    };
  }

  /**
   * Attempt to query Google Cloud Monitoring API for real 24-hour Firestore document read/write/delete metrics.
   * If permissions are missing or connection is local/emulator, falls back gracefully.
   */
  public async fetchDailyUsage(connectionId: string): Promise<DailyUsageSnapshot> {
    const conn = ConnectionManager.getInstance().getConnection(connectionId);
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);

    if (!conn || conn.isLocalJson || conn.isEmulator || !conn.projectId) {
      const session = this.getSessionCounts(connectionId);
      return {
        date: dateStr,
        source: "session-accounting",
        reads: session.reads,
        writes: session.writes,
        deletes: session.deletes,
      };
    }

    try {
      const app = await ConnectionManager.getInstance().getApp(connectionId);
      const credential = app.options.credential;
      if (!credential || typeof (credential as any).getAccessToken !== "function") {
        throw new Error("No OAuth2 credential access available");
      }
      const tokenObj = await (credential as any).getAccessToken();
      const accessToken = tokenObj?.access_token;
      if (!accessToken) {
        throw new Error("Unable to retrieve OAuth2 access token");
      }

      const projectId = conn.projectId;
      const startTime = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const endTime = now.toISOString();

      // Cloud Monitoring metric queries:
      // firestore.googleapis.com/document/read_count
      // firestore.googleapis.com/document/write_count
      // firestore.googleapis.com/document/delete_count
      const fetchMetric = async (metricType: string): Promise<number> => {
        const filter = `metric.type="firestore.googleapis.com/document/${metricType}"`;
        const url = `https://monitoring.googleapis.com/v3/projects/${projectId}/timeSeries?filter=${encodeURIComponent(
          filter
        )}&interval.startTime=${startTime}&interval.endTime=${endTime}&aggregation.alignmentPeriod=86400s&aggregation.perSeriesAligner=ALIGN_SUM`;

        const res = await fetch(url, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
          },
        });

        if (!res.ok) {
          throw new Error(`Monitoring API error ${res.status}: ${res.statusText}`);
        }

        const data: any = await res.json();
        let total = 0;
        if (Array.isArray(data.timeSeries)) {
          for (const ts of data.timeSeries) {
            if (Array.isArray(ts.points)) {
              for (const pt of ts.points) {
                total += Number(pt.value?.int64Value || pt.value?.doubleValue || 0);
              }
            }
          }
        }
        return total;
      };

      const [reads, writes, deletes] = await Promise.all([
        fetchMetric("read_count").catch(() => -1),
        fetchMetric("write_count").catch(() => -1),
        fetchMetric("delete_count").catch(() => -1),
      ]);

      if (reads >= 0 || writes >= 0 || deletes >= 0) {
        return {
          date: dateStr,
          source: "cloud-monitoring",
          reads: Math.max(0, reads),
          writes: Math.max(0, writes),
          deletes: Math.max(0, deletes),
        };
      }
    } catch {
      // Fallback silently to session accounting
    }

    const session = this.getSessionCounts(connectionId);
    return {
      date: dateStr,
      source: "session-accounting",
      reads: session.reads,
      writes: session.writes,
      deletes: session.deletes,
    };
  }
}

/**
 * Data contracts and metric structures for the Studio Overview & Traffic Analytics Suite.
 */

export interface CollectionMetricItem {
  id: string;
  path: string;
  documentCount: number;
  estimatedSizeBytes: number;
  avgDocSizeBytes: number;
  sampleCount: number;
}

export interface DatabaseMetricsSummary {
  totalCollections: number;
  totalDocuments: number;
  totalEstimatedSizeBytes: number;
  topCollections: CollectionMetricItem[];
}

export interface AuthMetricsSummary {
  isAvailable: boolean;
  totalUsers: number;
  activeUsers: number;
  disabledUsers: number;
  verifiedEmailUsers: number;
  recentActive7Days: number;
  providers: Record<string, number>; // e.g. { "password": 40, "google.com": 15, "anonymous": 5 }
  errorMessage?: string;
}

export interface TrafficDataPoint {
  date: string; // YYYY-MM-DD
  reads: number;
  writes: number;
  deletes: number;
  sentBytes?: number;
  receivedBytes?: number;
  realtimeConnections?: number;
  rulesEvaluationsAllowed?: number;
  rulesEvaluationsDenied?: number;
}

export interface TrafficMetricsSummary {
  source: "cloud-monitoring" | "emulator-telemetry" | "session-accounting";
  status: "connected" | "degraded" | "unavailable";
  noticeMessage?: string;
  currentListenersCount: number;
  todayReads: number;
  todayWrites: number;
  todayDeletes: number;
  todaySentBytes: number;
  todayReceivedBytes: number;
  history7Days: TrafficDataPoint[];
}

export interface OverviewDashboardData {
  connectionId: string;
  connectionName: string;
  projectId?: string;
  databaseId?: string;
  isEmulator: boolean;
  isLocalJson: boolean;
  lastRefreshed: string; // ISO string
  database: DatabaseMetricsSummary;
  auth: AuthMetricsSummary;
  traffic: TrafficMetricsSummary;
}

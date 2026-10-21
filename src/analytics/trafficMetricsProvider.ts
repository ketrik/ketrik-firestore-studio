import { ConnectionManager, FirestoreConnectionConfig } from "../connections/ConnectionManager";
import { CostService } from "../cost/costService";
import { TrafficMetricsSummary, TrafficDataPoint } from "./overviewTypes";

export class TrafficMetricsProvider {
  private static instance: TrafficMetricsProvider;

  public static getInstance(): TrafficMetricsProvider {
    if (!TrafficMetricsProvider.instance) {
      TrafficMetricsProvider.instance = new TrafficMetricsProvider();
    }
    return TrafficMetricsProvider.instance;
  }

  /**
   * Fetch traffic metrics for a given connection, pulling from Cloud Monitoring
   * when available, or falling back cleanly to session accounting / emulator metrics.
   */
  public async getTrafficMetrics(
    conn: FirestoreConnectionConfig,
    days = 7
  ): Promise<TrafficMetricsSummary> {
    const costService = CostService.getInstance();
    const effectiveProjectId = ConnectionManager.getInstance().getEffectiveProjectId(conn);

    // If local JSON, return mock / zero-traffic summary
    if (conn.isLocalJson) {
      return this.getLocalJsonTraffic(conn);
    }

    // If emulator or missing GCP project ID, return session accounting summary
    if (conn.isEmulator || !effectiveProjectId) {
      return this.getSessionTraffic(conn, costService, conn.isEmulator ? "emulator-telemetry" : "session-accounting");
    }

    // Cloud Monitoring attempt
    try {
      const app = await ConnectionManager.getInstance().getApp(conn.id);
      const credential = app.options.credential;
      if (!credential || typeof (credential as any).getAccessToken !== "function") {
        return this.getSessionTraffic(conn, costService, "session-accounting", "Credentials do not support OAuth2 token exchange");
      }

      const tokenObj = await (credential as any).getAccessToken();
      const accessToken = tokenObj?.access_token;
      if (!accessToken) {
        return this.getSessionTraffic(conn, costService, "session-accounting", "Unable to obtain Google Cloud OAuth2 access token");
      }

      const now = Date.now();
      const oneDayMs = 24 * 60 * 60 * 1000;
      const startTime = new Date(now - days * oneDayMs).toISOString();
      const endTime = new Date(now).toISOString();

      let lastApiError: string | undefined;

      // Helper to query Cloud Monitoring metric time series
      const queryTimeSeries = async (
        metricType: string,
        perSeriesAligner = "ALIGN_SUM"
      ): Promise<Map<string, number>> => {
        const results = new Map<string, number>();
        try {
          const filter = `metric.type="firestore.googleapis.com/${metricType}"`;
          const url = `https://monitoring.googleapis.com/v3/projects/${effectiveProjectId}/timeSeries?filter=${encodeURIComponent(
            filter
          )}&interval.startTime=${startTime}&interval.endTime=${endTime}&aggregation.alignmentPeriod=86400s&aggregation.perSeriesAligner=${perSeriesAligner}`;

          const res = await fetch(url, {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: "application/json",
            },
          });

          if (!res.ok) {
            let detail = `${res.status} ${res.statusText}`;
            try {
              const errJson: any = await res.json();
              if (errJson?.error?.message) {
                detail = errJson.error.message;
              }
            } catch {}
            lastApiError = detail;
            return results;
          }

          const data: any = await res.json();
          if (Array.isArray(data.timeSeries)) {
            for (const ts of data.timeSeries) {
              if (Array.isArray(ts.points)) {
                for (const pt of ts.points) {
                  const end = pt.interval?.endTime;
                  if (end) {
                    const dateKey = end.slice(0, 10);
                    const val = Number(pt.value?.int64Value || pt.value?.doubleValue || 0);
                    results.set(dateKey, (results.get(dateKey) || 0) + val);
                  }
                }
              }
            }
          }
        } catch (err: any) {
          lastApiError = err?.message || String(err);
        }
        return results;
      };

      // Query core metrics in parallel
      const [
        readMap,
        writeMap,
        deleteMap,
        sentBytesMap,
        receivedBytesMap,
        listenersMap,
        rulesAllowMap,
        rulesDenyMap,
      ] = await Promise.all([
        queryTimeSeries("document/read_count"),
        queryTimeSeries("document/write_count"),
        queryTimeSeries("document/delete_count"),
        queryTimeSeries("network/sent_bytes_count"),
        queryTimeSeries("network/received_bytes_count"),
        queryTimeSeries("listen/realtime_connections_count", "ALIGN_MAX"),
        queryTimeSeries("rules/evaluation_count"),
        queryTimeSeries("rules/denied_evaluation_count"),
      ]);

      // If all document operations returned empty or errored, fall back cleanly
      if (readMap.size === 0 && writeMap.size === 0 && deleteMap.size === 0 && lastApiError) {
        return this.getSessionTraffic(
          conn,
          costService,
          "session-accounting",
          `Google Cloud Monitoring API notice: ${lastApiError}`
        );
      }

      // Build daily sequence
      const history7Days: TrafficDataPoint[] = [];
      const todayStr = new Date(now).toISOString().slice(0, 10);

      for (let i = days - 1; i >= 0; i--) {
        const dStr = new Date(now - i * oneDayMs).toISOString().slice(0, 10);
        history7Days.push({
          date: dStr,
          reads: readMap.get(dStr) || 0,
          writes: writeMap.get(dStr) || 0,
          deletes: deleteMap.get(dStr) || 0,
          sentBytes: sentBytesMap.get(dStr) || 0,
          receivedBytes: receivedBytesMap.get(dStr) || 0,
          realtimeConnections: listenersMap.get(dStr) || 0,
          rulesEvaluationsAllowed: rulesAllowMap.get(dStr) || 0,
          rulesEvaluationsDenied: rulesDenyMap.get(dStr) || 0,
        });
      }

      const todayPoint = history7Days.find((h) => h.date === todayStr) || history7Days[history7Days.length - 1];

      return {
        source: "cloud-monitoring",
        status: "connected",
        noticeMessage: undefined,
        currentListenersCount: todayPoint?.realtimeConnections || 0,
        todayReads: todayPoint?.reads || 0,
        todayWrites: todayPoint?.writes || 0,
        todayDeletes: todayPoint?.deletes || 0,
        todaySentBytes: todayPoint?.sentBytes || 0,
        todayReceivedBytes: todayPoint?.receivedBytes || 0,
        history7Days,
      };
    } catch (err: any) {
      return this.getSessionTraffic(
        conn,
        costService,
        "session-accounting",
        `Could not reach Cloud Monitoring: ${err?.message || String(err)}`
      );
    }
  }

  private getSessionTraffic(
    conn: FirestoreConnectionConfig,
    costService: CostService,
    source: "emulator-telemetry" | "session-accounting",
    noticeMessage?: string
  ): TrafficMetricsSummary {
    const session = costService.getSessionCounts(conn.id);
    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;
    const history7Days: TrafficDataPoint[] = [];

    for (let i = 6; i >= 0; i--) {
      const dStr = new Date(now - i * oneDayMs).toISOString().slice(0, 10);
      const isToday = i === 0;
      history7Days.push({
        date: dStr,
        reads: isToday ? session.reads : 0,
        writes: isToday ? session.writes : 0,
        deletes: isToday ? session.deletes : 0,
        sentBytes: isToday ? (session.reads + session.writes) * 1024 : 0,
        receivedBytes: isToday ? session.writes * 512 : 0,
        realtimeConnections: 0,
        rulesEvaluationsAllowed: 0,
        rulesEvaluationsDenied: 0,
      });
    }

    return {
      source,
      status: noticeMessage ? "degraded" : "connected",
      noticeMessage,
      currentListenersCount: 0,
      todayReads: session.reads,
      todayWrites: session.writes,
      todayDeletes: session.deletes,
      todaySentBytes: (session.reads + session.writes) * 1024,
      todayReceivedBytes: session.writes * 512,
      history7Days,
    };
  }

  private getLocalJsonTraffic(_conn: FirestoreConnectionConfig): TrafficMetricsSummary {
    const now = Date.now();
    const todayStr = new Date(now).toISOString().slice(0, 10);
    return {
      source: "session-accounting",
      status: "connected",
      noticeMessage: "Offline Local JSON connection. Metrics track local workspace reads and disk file persistence.",
      currentListenersCount: 0,
      todayReads: 0,
      todayWrites: 0,
      todayDeletes: 0,
      todaySentBytes: 0,
      todayReceivedBytes: 0,
      history7Days: [
        {
          date: todayStr,
          reads: 0,
          writes: 0,
          deletes: 0,
          sentBytes: 0,
          receivedBytes: 0,
        },
      ],
    };
  }
}

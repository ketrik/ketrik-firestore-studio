export interface HistoricalDocSnapshot {
  id: string;
  path: string;
  readTime: Date;
  data: Record<string, any>;
  exists: boolean;
  createTime?: Date;
  updateTime?: Date;
  isDeletedInLive?: boolean;
}

export interface PitrStatus {
  enabled: boolean;
  earliestVersionTime?: Date;
  databaseId: string;
  projectId: string;
}

export interface PitrPreset {
  id: string;
  label: string;
  durationMs: number;
}

export const PITR_PRESETS: PitrPreset[] = [
  { id: "15m", label: "15 minutes ago", durationMs: 15 * 60 * 1000 },
  { id: "1h", label: "1 hour ago", durationMs: 60 * 60 * 1000 },
  { id: "6h", label: "6 hours ago", durationMs: 6 * 60 * 60 * 1000 },
  { id: "24h", label: "24 hours ago (Yesterday)", durationMs: 24 * 60 * 60 * 1000 },
  { id: "3d", label: "3 days ago", durationMs: 3 * 24 * 60 * 60 * 1000 },
  { id: "7d", label: "7 days ago (Earliest Available)", durationMs: 7 * 24 * 60 * 60 * 1000 },
];


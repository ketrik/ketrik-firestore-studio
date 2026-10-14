import { Timestamp } from "firebase-admin/firestore";

export interface TimestampInfo {
  seconds: number;
  nanoseconds: number;
}

/**
 * Checks if a value looks like a Firestore Timestamp object.
 */
export function isTimestampLike(value: any): value is { _seconds: number; _nanoseconds: number } | Timestamp {
  if (!value || typeof value !== "object") {
    return false;
  }
  if (value instanceof Timestamp) {
    return true;
  }
  return typeof value._seconds === "number" && typeof value._nanoseconds === "number";
}

/**
 * Converts a Timestamp or Timestamp-like object into a JavaScript Date.
 */
export function timestampToDate(value: any): Date | undefined {
  if (!value) {
    return undefined;
  }
  if (value instanceof Timestamp) {
    return value.toDate();
  }
  if (typeof value._seconds === "number") {
    return new Date(value._seconds * 1000 + (value._nanoseconds ? Math.floor(value._nanoseconds / 1000000) : 0));
  }
  return undefined;
}

/**
 * Formats a Date or Timestamp into a human-friendly string:
 * "YYYY-MM-DD HH:mm:ss"
 */
export function formatDateTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * Formats a relative time string, e.g. "5m ago", "2h ago", "in 3d".
 */
export function formatRelativeTime(date: Date, now: Date = new Date()): string {
  const diffMs = now.getTime() - date.getTime();
  const isPast = diffMs >= 0;
  const absSec = Math.floor(Math.abs(diffMs) / 1000);

  if (absSec < 45) {
    return isPast ? "just now" : "in a few seconds";
  }
  const absMin = Math.floor(absSec / 60);
  if (absMin < 60) {
    return isPast ? `${absMin}m ago` : `in ${absMin}m`;
  }
  const absHour = Math.floor(absMin / 60);
  if (absHour < 24) {
    return isPast ? `${absHour}h ago` : `in ${absHour}h`;
  }
  const absDays = Math.floor(absHour / 24);
  if (absDays < 30) {
    return isPast ? `${absDays}d ago` : `in ${absDays}d`;
  }
  const absMonths = Math.floor(absDays / 30);
  if (absMonths < 12) {
    return isPast ? `${absMonths}mo ago` : `in ${absMonths}mo`;
  }
  const absYears = Math.floor(absDays / 365);
  return isPast ? `${absYears}y ago` : `in ${absYears}y`;
}

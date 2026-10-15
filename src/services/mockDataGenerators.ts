import { GeoPoint, Timestamp } from "firebase-admin/firestore";

export interface FieldGeneratorConfig {
  name: string;
  type: string;
  isOptional: boolean;
  domain?: "name" | "email" | "username" | "phone" | "avatar" | "price" | "status" | "id" | "geo" | "date" | "boolean" | "generic";
  enumValues?: string[];
  min?: number;
  max?: number;
}

const FIRST_NAMES = [
  "James", "Mary", "John", "Patricia", "Robert", "Jennifer", "Michael", "Linda",
  "William", "Elizabeth", "David", "Barbara", "Richard", "Susan", "Joseph", "Jessica",
  "Thomas", "Sarah", "Charles", "Karen", "Christopher", "Nancy", "Daniel", "Lisa",
  "Matthew", "Betty", "Anthony", "Margaret", "Mark", "Sandra", "Donald", "Ashley"
];

const LAST_NAMES = [
  "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis",
  "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson", "Thomas",
  "Taylor", "Moore", "Jackson", "Martin", "Lee", "Perez", "Thompson", "White", "Harris"
];

const DOMAINS = ["example.com", "mail.com", "test.org", "ketrik.dev", "demo.io"];

const CITIES = [
  { city: "San Francisco", lat: 37.7749, lng: -122.4194 },
  { city: "New York", lat: 40.7128, lng: -74.0060 },
  { city: "London", lat: 51.5074, lng: -0.1278 },
  { city: "Tokyo", lat: 35.6762, lng: 139.6503 },
  { city: "Berlin", lat: 52.5200, lng: 13.4050 },
  { city: "Sydney", lat: -33.8688, lng: 151.2093 }
];

const STATUSES = ["active", "pending", "completed", "archived", "draft", "in_review"];

function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomFloat(min: number, max: number, decimals = 2): number {
  const str = (Math.random() * (max - min) + min).toFixed(decimals);
  return parseFloat(str);
}

/**
 * Deduce the domain semantic of a field based on its key name.
 */
export function deduceFieldDomain(key: string, detectedType: string): FieldGeneratorConfig["domain"] {
  const lower = key.toLowerCase();
  if (lower.includes("email") || lower.includes("mail")) return "email";
  if (lower.includes("name") || lower.includes("author") || lower.includes("user")) return "name";
  if (lower.includes("username") || lower.includes("handle") || lower.includes("login")) return "username";
  if (lower.includes("phone") || lower.includes("mobile") || lower.includes("tel")) return "phone";
  if (lower.includes("avatar") || lower.includes("photo") || lower.includes("image") || lower.includes("picture") || lower.includes("icon")) return "avatar";
  if (lower.includes("price") || lower.includes("amount") || lower.includes("cost") || lower.includes("total") || lower.includes("fee") || lower.includes("balance")) return "price";
  if (lower.includes("status") || lower.includes("state") || lower.includes("role") || lower.includes("tier")) return "status";
  if (lower.endsWith("id") || lower.startsWith("id") || lower.includes("uuid") || lower.includes("uid")) return "id";
  if (lower.includes("geo") || lower.includes("location") || lower.includes("coord") || lower.includes("lat") || lower.includes("lng")) return "geo";
  if (lower.includes("date") || lower.includes("time") || lower.includes("at") || lower.includes("created") || lower.includes("updated")) return "date";
  if (detectedType === "boolean") return "boolean";
  return "generic";
}

/**
 * Generate a single realistic value based on configuration.
 */
export function generateFieldValue(
  config: FieldGeneratorConfig,
  existingDocIds?: string[]
): any {
  if (config.isOptional && Math.random() < 0.2) {
    return null;
  }

  if (config.enumValues && config.enumValues.length > 0) {
    return randomChoice(config.enumValues);
  }

  const { type, domain } = config;

  if (type === "boolean" || domain === "boolean") {
    return Math.random() > 0.5;
  }

  if (type === "number" || domain === "price") {
    if (domain === "price") {
      return randomFloat(config.min ?? 5, config.max ?? 500, 2);
    }
    return randomInt(config.min ?? 1, config.max ?? 1000);
  }

  if (type === "timestamp" || domain === "date") {
    // Relative date within the last 30 days
    const now = Date.now();
    const pastOffset = randomInt(0, 30 * 24 * 60 * 60 * 1000);
    const date = new Date(now - pastOffset);
    return Timestamp.fromDate(date);
  }

  if (type === "geopoint" || domain === "geo") {
    const loc = randomChoice(CITIES);
    const latDelta = randomFloat(-0.05, 0.05, 4);
    const lngDelta = randomFloat(-0.05, 0.05, 4);
    return new GeoPoint(loc.lat + latDelta, loc.lng + lngDelta);
  }

  // String domain handling
  const first = randomChoice(FIRST_NAMES);
  const last = randomChoice(LAST_NAMES);

  if (domain === "name") {
    return `${first} ${last}`;
  }
  if (domain === "username") {
    return `${first.toLowerCase()}_${last.toLowerCase()}${randomInt(10, 99)}`;
  }
  if (domain === "email") {
    return `${first.toLowerCase()}.${last.toLowerCase()}@${randomChoice(DOMAINS)}`;
  }
  if (domain === "phone") {
    return `+1 (${randomInt(200, 999)}) ${randomInt(100, 999)}-${randomInt(1000, 9999)}`;
  }
  if (domain === "avatar") {
    return `https://api.dicebear.com/7.x/avataaars/svg?seed=${first}_${last}`;
  }
  if (domain === "status") {
    return randomChoice(STATUSES);
  }
  if (domain === "id") {
    if (existingDocIds && existingDocIds.length > 0 && Math.random() < 0.7) {
      return randomChoice(existingDocIds);
    }
    return `id_${Math.random().toString(36).substring(2, 10)}`;
  }

  return `${config.name}_sample_${Math.random().toString(36).substring(2, 7)}`;
}

/**
 * Generate a full synthetic document based on a list of field configs.
 */
export function generateSyntheticDocument(
  fieldConfigs: FieldGeneratorConfig[],
  existingDocIds?: string[]
): Record<string, any> {
  const doc: Record<string, any> = {};
  for (const cfg of fieldConfigs) {
    const val = generateFieldValue(cfg, existingDocIds);
    if (val !== null && val !== undefined) {
      doc[cfg.name] = val;
    }
  }
  return doc;
}

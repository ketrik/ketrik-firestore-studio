import { Timestamp } from "firebase-admin/firestore";

export type TransformActionType =
  | "cast_string_to_number"
  | "cast_number_to_string"
  | "cast_string_to_timestamp"
  | "cast_timestamp_to_string"
  | "cast_timestamp_to_millis"
  | "cast_millis_to_timestamp"
  | "cast_string_to_boolean"
  | "wrap_in_array"
  | "backfill_default"
  | "rename_field"
  | "delete_field";

export interface TransformRule {
  targetField: string;
  action: TransformActionType;
  newFieldName?: string; // For rename_field
  defaultValue?: any;    // For backfill_default
  datePattern?: "iso" | "epoch_ms" | "epoch_sec"; // For date parsing
}

export interface TransformSampleDiff {
  docId: string;
  docPath: string;
  before: any;
  after: any;
  isModified: boolean;
  statusNote?: string;
}

export interface TransformPreviewResult {
  collectionPath: string;
  rule: TransformRule;
  totalSampled: number;
  modifiedCount: number;
  samples: TransformSampleDiff[];
}

export interface TransformExecutionResult {
  totalProcessed: number;
  totalUpdated: number;
  totalDeleted: number;
  totalSkipped: number;
  cancelled: boolean;
  errors: string[];
}

/**
 * Pure evaluation function that calculates the new value of a field according to a TransformRule.
 */
export function applyFieldTransformation(
  currentValue: any,
  rule: TransformRule,
  fieldExists: boolean
): { modified: boolean; newValue: any; deleteField?: boolean; newKeyName?: string; note?: string } {
  const { action, targetField, newFieldName, defaultValue } = rule;

  switch (action) {
    case "cast_string_to_number": {
      if (!fieldExists || currentValue === null || currentValue === undefined) {
        return { modified: false, newValue: currentValue, note: "Field missing or null" };
      }
      if (typeof currentValue === "number") {
        return { modified: false, newValue: currentValue, note: "Already a number" };
      }
      if (typeof currentValue === "string") {
        const cleaned = currentValue.trim().replace(/,/g, "");
        const num = Number(cleaned);
        if (!isNaN(num) && cleaned !== "") {
          return { modified: true, newValue: num };
        }
        return { modified: false, newValue: currentValue, note: "Could not parse into number" };
      }
      return { modified: false, newValue: currentValue, note: `Incompatible type: ${typeof currentValue}` };
    }

    case "cast_number_to_string": {
      if (!fieldExists || currentValue === null || currentValue === undefined) {
        return { modified: false, newValue: currentValue, note: "Field missing or null" };
      }
      if (typeof currentValue === "string") {
        return { modified: false, newValue: currentValue, note: "Already a string" };
      }
      if (typeof currentValue === "number") {
        return { modified: true, newValue: String(currentValue) };
      }
      return { modified: false, newValue: currentValue, note: `Incompatible type: ${typeof currentValue}` };
    }

    case "cast_string_to_timestamp": {
      if (!fieldExists || currentValue === null || currentValue === undefined) {
        return { modified: false, newValue: currentValue, note: "Field missing or null" };
      }
      // Check if already a Firestore Timestamp
      if (
        currentValue instanceof Timestamp ||
        (typeof currentValue === "object" &&
          typeof currentValue._seconds === "number" &&
          typeof currentValue._nanoseconds === "number")
      ) {
        return { modified: false, newValue: currentValue, note: "Already a Timestamp" };
      }
      if (typeof currentValue === "string") {
        const parsedMs = Date.parse(currentValue);
        if (!isNaN(parsedMs)) {
          return { modified: true, newValue: Timestamp.fromMillis(parsedMs) };
        }
        // Try numeric string as epoch milliseconds
        const asNum = Number(currentValue);
        if (!isNaN(asNum) && asNum > 0) {
          const ms = asNum < 1e11 ? asNum * 1000 : asNum; // detect seconds vs milliseconds
          return { modified: true, newValue: Timestamp.fromMillis(ms) };
        }
        return { modified: false, newValue: currentValue, note: "Invalid date string" };
      }
      return { modified: false, newValue: currentValue, note: `Incompatible type: ${typeof currentValue}` };
    }

    case "cast_timestamp_to_string": {
      if (!fieldExists || currentValue === null || currentValue === undefined) {
        return { modified: false, newValue: currentValue, note: "Field missing or null" };
      }
      if (typeof currentValue === "string") {
        return { modified: false, newValue: currentValue, note: "Already a string" };
      }
      if (
        currentValue instanceof Timestamp ||
        (typeof currentValue === "object" &&
          typeof currentValue._seconds === "number" &&
          typeof currentValue._nanoseconds === "number")
      ) {
        const ms = (currentValue._seconds || 0) * 1000 + Math.round((currentValue._nanoseconds || 0) / 1e6);
        return { modified: true, newValue: new Date(ms).toISOString() };
      }
      return { modified: false, newValue: currentValue, note: `Incompatible type: ${typeof currentValue}` };
    }

    case "cast_timestamp_to_millis": {
      if (!fieldExists || currentValue === null || currentValue === undefined) {
        return { modified: false, newValue: currentValue, note: "Field missing or null" };
      }
      if (typeof currentValue === "number") {
        return { modified: false, newValue: currentValue, note: "Already a number (millis)" };
      }
      if (
        currentValue instanceof Timestamp ||
        (typeof currentValue === "object" &&
          typeof currentValue._seconds === "number" &&
          typeof currentValue._nanoseconds === "number")
      ) {
        const ms = (currentValue._seconds || 0) * 1000 + Math.round((currentValue._nanoseconds || 0) / 1e6);
        return { modified: true, newValue: ms };
      }
      return { modified: false, newValue: currentValue, note: `Incompatible type: ${typeof currentValue}` };
    }

    case "cast_millis_to_timestamp": {
      if (!fieldExists || currentValue === null || currentValue === undefined) {
        return { modified: false, newValue: currentValue, note: "Field missing or null" };
      }
      if (
        currentValue instanceof Timestamp ||
        (typeof currentValue === "object" &&
          typeof currentValue._seconds === "number" &&
          typeof currentValue._nanoseconds === "number")
      ) {
        return { modified: false, newValue: currentValue, note: "Already a Timestamp" };
      }
      if (typeof currentValue === "number" && !isNaN(currentValue) && currentValue > 0) {
        const ms = currentValue < 1e11 ? currentValue * 1000 : currentValue;
        return { modified: true, newValue: Timestamp.fromMillis(ms) };
      }
      return { modified: false, newValue: currentValue, note: "Value is not a valid epoch number" };
    }

    case "cast_string_to_boolean": {
      if (!fieldExists || currentValue === null || currentValue === undefined) {
        return { modified: false, newValue: currentValue, note: "Field missing or null" };
      }
      if (typeof currentValue === "boolean") {
        return { modified: false, newValue: currentValue, note: "Already a boolean" };
      }
      if (typeof currentValue === "string") {
        const lower = currentValue.trim().toLowerCase();
        if (lower === "true" || lower === "1" || lower === "yes") {
          return { modified: true, newValue: true };
        }
        if (lower === "false" || lower === "0" || lower === "no") {
          return { modified: true, newValue: false };
        }
        return { modified: false, newValue: currentValue, note: "Not a recognizable boolean string" };
      }
      if (typeof currentValue === "number") {
        if (currentValue === 1) return { modified: true, newValue: true };
        if (currentValue === 0) return { modified: true, newValue: false };
      }
      return { modified: false, newValue: currentValue, note: `Incompatible type: ${typeof currentValue}` };
    }

    case "wrap_in_array": {
      if (!fieldExists || currentValue === null || currentValue === undefined) {
        return { modified: false, newValue: currentValue, note: "Field missing or null" };
      }
      if (Array.isArray(currentValue)) {
        return { modified: false, newValue: currentValue, note: "Already an array" };
      }
      return { modified: true, newValue: [currentValue] };
    }

    case "backfill_default": {
      if (fieldExists && currentValue !== null && currentValue !== undefined) {
        return { modified: false, newValue: currentValue, note: "Field already has a value" };
      }
      return { modified: true, newValue: defaultValue !== undefined ? defaultValue : "" };
    }

    case "rename_field": {
      if (!fieldExists) {
        return { modified: false, newValue: currentValue, note: "Field does not exist in document" };
      }
      if (!newFieldName || newFieldName.trim() === "" || newFieldName.trim() === targetField) {
        return { modified: false, newValue: currentValue, note: "Invalid or identical new field name" };
      }
      return {
        modified: true,
        newValue: currentValue,
        deleteField: true,
        newKeyName: newFieldName.trim(),
      };
    }

    case "delete_field": {
      if (!fieldExists) {
        return { modified: false, newValue: currentValue, note: "Field already absent" };
      }
      return { modified: true, newValue: undefined, deleteField: true };
    }

    default:
      return { modified: false, newValue: currentValue, note: "Unknown transform action" };
  }
}

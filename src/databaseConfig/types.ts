export interface DatabaseMetadata {
  name: string;
  databaseId: string;
  projectId: string;
  uid?: string;
  createTime?: string;
  updateTime?: string;
  locationId?: string;
  type?: "FIRESTORE_NATIVE" | "DATASTORE_MODE" | string;
  concurrencyMode?: "OPTIMISTIC" | "PESSIMISTIC" | "OPTIMISTIC_WITH_ENTITY_GROUPS" | string;
  appEngineIntegrationMode?: "ENABLED" | "DISABLED" | string;
  pointInTimeRecoveryEnablement?: "POINT_IN_TIME_RECOVERY_ENABLED" | "POINT_IN_TIME_RECOVERY_DISABLED" | string;
  earliestVersionTime?: string;
  versionRetentionPeriod?: string;
  deleteProtectionState?: "DELETE_PROTECTION_ENABLED" | "DELETE_PROTECTION_DISABLED" | string;
  cmekConfig?: {
    kmsKeyName?: string;
    activeKeyVersion?: string[];
  };
  etag?: string;
  // Metadata for Local JSON databases
  isLocalJson?: boolean;
  localJsonPath?: string;
  localJsonDocCount?: number;
  localJsonSizeBytes?: number;
  // Metadata for Local Emulator
  isEmulator?: boolean;
  emulatorHost?: string;
}

export interface UpdateDatabaseConfigPayload {
  pointInTimeRecoveryEnablement?: "POINT_IN_TIME_RECOVERY_ENABLED" | "POINT_IN_TIME_RECOVERY_DISABLED";
  deleteProtectionState?: "DELETE_PROTECTION_ENABLED" | "DELETE_PROTECTION_DISABLED";
  concurrencyMode?: "OPTIMISTIC" | "PESSIMISTIC" | "OPTIMISTIC_WITH_ENTITY_GROUPS";
  appEngineIntegrationMode?: "ENABLED" | "DISABLED";
}


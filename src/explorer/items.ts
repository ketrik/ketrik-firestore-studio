import { DocumentReference, CollectionReference, OrderByDirection } from "firebase-admin/firestore";
import * as vscode from "vscode";
import { ConnectionManager, FirestoreConnectionConfig } from "../connections/ConnectionManager";
import { RulesService } from "../rules/RulesService";
import { RulesParser } from "../rules/RulesParser";
import { isTimestampLike, timestampToDate, formatDateTime, formatRelativeTime } from "../utils/timestampUtils";
import { SecretManagerService, SecretMetadata, SecretVersionMetadata } from "../secrets/SecretManagerService";
import { isDryDashboard, isRuntimeDashboard } from "../services/dashboardTranspiler";
import { IndexesService } from "../indexes/indexesService";

function getConnectionMeta(connectionId: string): {
  substrate: "cloud" | "emulator" | "local";
  access: "rw" | "ro";
} {
  const conn = ConnectionManager.getInstance().getConnection(connectionId);
  const substrate = conn?.isLocalJson ? "local" : conn?.isEmulator ? "emulator" : "cloud";
  const access = conn?.readOnly ? "ro" : "rw";
  return { substrate, access };
}

export abstract class Item extends vscode.TreeItem {
  abstract reference?: DocumentReference | CollectionReference;
}

/**
 * A generic informational or action Tree View item (e.g. empty filter, notices).
 */
export class InfoMessageItem extends Item {
  reference = undefined;

  constructor(
    label: string,
    icon: string = "info",
    contextValue: string = "infoMessage",
    command?: vscode.Command
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(icon);
    this.contextValue = contextValue;
    this.command = command;
  }
}

/**
 * A Tree View item representing a Firestore Connection.
 */
export class ConnectionTreeItem extends Item {
  reference = undefined;

  constructor(public config: FirestoreConnectionConfig) {
    super(config.name, vscode.TreeItemCollapsibleState.Collapsed);
    this.id = `connection:${config.id}`;
    const substrate = config.isLocalJson ? "local" : config.isEmulator ? "emulator" : "cloud";
    const access = config.readOnly ? "ro" : "rw";
    this.contextValue = `connection:${substrate}:${access}`;

    const detail = config.isLocalJson
      ? `Local JSON (${config.localJsonPath || ""})`
      : config.isEmulator
        ? `Emulator (${config.emulatorHost || "localhost:8080"})${config.projectId ? ` [${config.projectId}]` : ""}`
        : config.databaseId && config.databaseId !== "(default)"
          ? `${config.projectId || "Project"} [${config.databaseId}]`
          : config.projectId || "Production";

    // Format environment prefix and lock status
    let envPrefix = "";
    if (config.environment === "production") {
      envPrefix = "🔴 [PROD]";
    } else if (config.environment === "staging") {
      envPrefix = "🟡 [STAGING]";
    } else if (config.environment === "development") {
      envPrefix = "🟢 [DEV]";
    }

    const lockBadge = config.readOnly ? "🔒" : "";
    const badges = [envPrefix, lockBadge].filter(Boolean).join(" ");
    this.description = badges ? `${badges} ${detail}` : detail;

    this.tooltip = `Connection: ${config.name}\nID: ${config.id}\nTarget: ${detail}${config.environment ? `\nEnvironment: ${config.environment.toUpperCase()}` : ""
      }${config.readOnly ? "\nStatus: 🔒 Read-Only Shield Enabled (All writes/mutations blocked)" : "\nStatus: Read/Write"}${config.isLocalJson
        ? `\nType: Local JSON Database\nPath: ${config.localJsonPath}`
        : config.isEmulator
          ? `\nType: Local Emulator Client (Requires running emulator process on ${config.emulatorHost || "localhost:8080"})${config.authEmulatorHost ? `\nAuth Emulator: ${config.authEmulatorHost}` : ""
          }`
          : ""
      }`;

    if (config.readOnly) {
      this.iconPath = new vscode.ThemeIcon(
        "lock",
        config.environment === "production" ? new vscode.ThemeColor("errorForeground") : undefined
      );
    } else {
      this.iconPath = new vscode.ThemeIcon(
        config.isLocalJson
          ? "file-code"
          : config.isEmulator
            ? "server-process"
            : "database",
        config.environment === "production"
          ? new vscode.ThemeColor("errorForeground")
          : config.environment === "staging"
            ? new vscode.ThemeColor("editorWarning.foreground")
            : undefined
      );
    }
  }
}

import { getDocumentSizeInfo } from "../utils/documentSizeUtils";

/**
 * A Tree View item representing a Firestore document.
 */
export class DocumentItem extends Item {
  constructor(
    public documentId: string,
    public reference: DocumentReference,
    public connectionId: string,
    docData?: any,
    isExpanded: boolean = false,
    public isMissingDocument: boolean = false
  ) {
    super(documentId, isExpanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed);
    this.command = {
      command: "ketrik-firestore-studio.clickDocument",
      title: "Open Document",
      arguments: [this],
    };

    this.id = `doc:${connectionId}:${reference.path}`;
    this.updateDocMeta(docData, isMissingDocument);
  }

  /**
   * Update document node metadata (size badge, icon, tooltip, contextValue) in place
   * so TreeView retains the exact object reference during targeted refreshes.
   */
  public updateDocMeta(docData?: any, isMissingDocument: boolean = false): void {
    this.isMissingDocument = isMissingDocument;
    const { substrate, access } = getConnectionMeta(this.connectionId);
    const docState = isMissingDocument ? "missing" : "exists";
    const dashKind =
      !isMissingDocument &&
      docData !== undefined &&
      (isDryDashboard(docData) || isRuntimeDashboard(docData))
        ? "dash"
        : "std";
    this.contextValue = `document:${substrate}:${docState}:${dashKind}:${access}`;

    if (isMissingDocument) {
      this.description = "(missing document)";
      this.iconPath = new vscode.ThemeIcon(
        "file-submodule",
        new vscode.ThemeColor("descriptionForeground")
      );
      this.tooltip =
        `Document: ${this.documentId}\n` +
        `Path: [${this.connectionId}] ${this.reference.path}\n` +
        `Status: Missing document (only exists as parent of subcollections)`;
    } else if (docData !== undefined) {
      const sizeInfo = getDocumentSizeInfo(docData, this.reference.path);
      const isExceeded = sizeInfo.isWarning || sizeInfo.isCritical;

      // When over 750 KB (or critical), show red icon and clear high-visibility label
      if (isExceeded) {
        this.description = sizeInfo.isCritical
          ? `⚠️ ${sizeInfo.formatted} (CRITICAL)`
          : `⚠️ ${sizeInfo.formatted}`;
        this.iconPath = new vscode.ThemeIcon(
          "file-code",
          new vscode.ThemeColor("charts.red")
        );
      } else {
        this.description = sizeInfo.formatted;
        this.iconPath = new vscode.ThemeIcon(
          "file-code",
          new vscode.ThemeColor("charts.blue")
        );
      }

      this.tooltip =
        `Document: ${this.documentId}\n` +
        `Path: [${this.connectionId}] ${this.reference.path}\n` +
        `Size: ${sizeInfo.formatted} (${sizeInfo.bytes.toLocaleString()} bytes)\n` +
        `Limit: ${sizeInfo.percentageOfLimit}% of 1 MB max${isExceeded
          ? `\n⚠️ High Document Size: Exceeds 750 KB quota threshold.`
          : ""
        }`;
    } else {
      this.description = undefined;
      this.tooltip = `[${this.connectionId}] ${this.reference.path}`;
      this.iconPath = new vscode.ThemeIcon(
        "file-code",
        new vscode.ThemeColor("charts.blue")
      );
    }
  }
}


/**
 * A Tree View item representing a top-level field / root variable inside a document.
 */
export class DocumentFieldItem extends Item {
  reference: DocumentReference;
  public pathSegments: string[];
  public parentFieldItem?: DocumentFieldItem;
  public isArrayElement?: boolean;
  public arrayIndex?: number;
  public parentArrayItem?: DocumentFieldItem;

  get fullFieldPath(): string {
    return this.pathSegments.join(".");
  }

  constructor(
    public fieldName: string,
    public value: any,
    public parentDocRef: DocumentReference,
    public connectionId: string,
    pathSegments?: string[],
    parentFieldItem?: DocumentFieldItem,
    isExpanded: boolean = false,
    isArrayElement?: boolean,
    arrayIndex?: number,
    parentArrayItem?: DocumentFieldItem
  ) {
    const segments = pathSegments && pathSegments.length > 0 ? pathSegments : [fieldName];
    const isTimestamp = value !== null && typeof value === "object" && isTimestampLike(value);
    const isVector =
      value &&
      (value.constructor?.name === "VectorValue" ||
        (Array.isArray(value._values) && typeof value.isEqual === "function") ||
        (value.__type === "VectorValue" && Array.isArray(value.values)));

    const valType = Array.isArray(value)
      ? "array"
      : isVector
        ? "vector"
        : value === null
          ? "null"
          : typeof value;

    const isArray = valType === "array";
    const isMap = valType === "object" && !isTimestamp && !isVector;
    let keyCount = 0;
    if (isMap && value) {
      for (const _k in value) {
        if (Object.prototype.hasOwnProperty.call(value, _k)) {
          keyCount++;
        }
      }
    } else if (isArray && value) {
      keyCount = value.length;
    }
    const isCollapsible = (isMap && keyCount > 0) || (isArray && keyCount > 0);

    super(
      fieldName,
      isCollapsible
        ? isExpanded
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None
    );

    this.reference = parentDocRef;
    this.pathSegments = segments;
    this.parentFieldItem = parentFieldItem;
    this.isArrayElement = isArrayElement;
    this.arrayIndex = arrayIndex;
    this.parentArrayItem = parentArrayItem;

    let icon = "symbol-variable";
    let iconColor: vscode.ThemeColor | undefined;

    // Dual-Prefix Protocol classification
    const isProtocol = fieldName.startsWith("__");
    const isEnvelope = fieldName.startsWith("_") && !isProtocol;

    const timestampDate = isTimestamp ? timestampToDate(value) : undefined;

    if (isTimestamp && timestampDate) {
      icon = isProtocol ? "shield" : isEnvelope ? "tag" : "calendar";
      iconColor = isProtocol
        ? new vscode.ThemeColor("charts.red")
        : isEnvelope
          ? new vscode.ThemeColor("charts.purple")
          : new vscode.ThemeColor("charts.blue");
      this.description = `${formatDateTime(timestampDate)} (${formatRelativeTime(timestampDate)})`;
    } else if (isVector) {
      icon = isProtocol ? "shield" : isEnvelope ? "tag" : "zap";
      iconColor = isProtocol
        ? new vscode.ThemeColor("charts.red")
        : isEnvelope
          ? new vscode.ThemeColor("charts.purple")
          : new vscode.ThemeColor("charts.orange");
      const dims =
        value.values?.length ||
        value._values?.length ||
        (typeof value.toArray === "function" ? value.toArray().length : 0);
      this.description = `[Vector: ${dims} dims]`;
    } else if (valType === "object") {
      if (isProtocol) {
        icon = "shield";
        iconColor = new vscode.ThemeColor("charts.red");
      } else if (isEnvelope) {
        icon = "tag";
        iconColor = new vscode.ThemeColor("charts.purple");
      } else {
        icon = "symbol-namespace";
        iconColor = new vscode.ThemeColor("symbolIcon.namespaceForeground");
      }
      this.description = `{${keyCount} keys}`;
    } else if (valType === "array") {
      icon = isProtocol ? "shield" : isEnvelope ? "tag" : "symbol-array";
      iconColor = isProtocol
        ? new vscode.ThemeColor("charts.red")
        : isEnvelope
          ? new vscode.ThemeColor("charts.purple")
          : new vscode.ThemeColor("symbolIcon.arrayForeground");
      this.description = `[${value.length}]`;
    } else if (typeof value === "string" && ((value.startsWith("projects/") && value.includes("/secrets/")) || value.startsWith("gcp-secret://"))) {
      icon = "key";
      iconColor = new vscode.ThemeColor("charts.yellow");
      const secretName = value.startsWith("gcp-secret://")
        ? value.replace("gcp-secret://", "").split("#")[0]
        : value.split("/secrets/")[1]?.split("/")[0] || value;
      this.description = `🔐 [Secret: ${secretName}]`;
    } else if (valType === "string") {
      icon = isProtocol ? "shield" : isEnvelope ? "tag" : "symbol-string";
      iconColor = isProtocol
        ? new vscode.ThemeColor("charts.red")
        : isEnvelope
          ? new vscode.ThemeColor("charts.purple")
          : new vscode.ThemeColor("symbolIcon.stringForeground");
      this.description = `"${value.length > 20 ? value.slice(0, 17) + "..." : value}"`;
    } else if (valType === "number") {
      icon = isProtocol ? "shield" : isEnvelope ? "tag" : "symbol-number";
      iconColor = isProtocol
        ? new vscode.ThemeColor("charts.red")
        : isEnvelope
          ? new vscode.ThemeColor("charts.purple")
          : new vscode.ThemeColor("symbolIcon.numberForeground");
      this.description = String(value);
    } else if (valType === "boolean") {
      icon = isProtocol ? "shield" : isEnvelope ? "tag" : "symbol-boolean";
      iconColor = isProtocol
        ? new vscode.ThemeColor("charts.red")
        : isEnvelope
          ? new vscode.ThemeColor("charts.purple")
          : new vscode.ThemeColor("symbolIcon.booleanForeground");
      this.description = String(value);
    } else {
      icon = isProtocol ? "shield" : isEnvelope ? "tag" : "symbol-variable";
      iconColor = isProtocol
        ? new vscode.ThemeColor("charts.red")
        : isEnvelope
          ? new vscode.ThemeColor("charts.purple")
          : undefined;
      this.description = String(value);
    }

    this.id = `field:${connectionId}:${parentDocRef.path}#${this.fullFieldPath}`;

    const isSecretRef = typeof value === "string" && ((value.startsWith("projects/") && value.includes("/secrets/")) || value.startsWith("gcp-secret://"));
    const { substrate, access } = getConnectionMeta(connectionId);
    const kind = isSecretRef
      ? "secretRef"
      : isTimestamp
        ? "timestamp"
        : isVector
          ? "vector"
          : valType === "object"
            ? "map"
            : valType === "array"
              ? "array"
              : valType === "null" && this.isArrayElement
                ? "null"
                : "scalar";
    this.contextValue = this.isArrayElement
      ? `documentFieldArrayItem:${kind}:${substrate}:${access}`
      : `documentField:${kind}:${substrate}:${access}`;

    const tierLabel = isProtocol
      ? " [Protocol / Operational]"
      : isEnvelope
        ? " [System Envelope / Index]"
        : "";
    const typeLabel = isTimestamp ? "timestamp" : valType;
    const parentCollId = parentDocRef?.parent?.id || "";
    const fieldOverrideMeta = parentCollId
      ? IndexesService.getInstance().getCachedFieldMeta(connectionId, parentCollId, this.fullFieldPath)
      : undefined;
    const isTtlActive = Boolean(fieldOverrideMeta?.ttlConfig);
    const isExpiredTtl =
      isTtlActive && timestampDate !== undefined && timestampDate.getTime() < Date.now();
    const isExemptField =
      Boolean(fieldOverrideMeta && !fieldOverrideMeta.usesAncestorConfig && fieldOverrideMeta.indexes.length === 0);

    if (isTtlActive && this.description) {
      this.description = `${this.description} • ⏳ TTL${isExpiredTtl ? " (⚠️ Expired)" : ""}`;
    } else if (isExemptField && this.description) {
      this.description = `${this.description} • 🚫 Unindexed`;
    }

    if (isSecretRef) {
      this.tooltip = `Field: ${this.fullFieldPath} (Google Secret Link)${tierLabel}\nSecret: ${value}\nDoc: ${parentDocRef.path}`;
    } else if (this.isArrayElement) {
      this.tooltip = `Array Item [${this.arrayIndex}] (${typeLabel})${tierLabel}\nPath: ${this.fullFieldPath}\nDoc: ${parentDocRef.path}`;
    } else if (isTimestamp && timestampDate) {
      const epochSec = Math.floor(timestampDate.getTime() / 1000);
      const ttlNote = isTtlActive
        ? `\nTTL Policy: ⏳ ${fieldOverrideMeta!.ttlConfig!.state}${isExpiredTtl ? " (⚠️ Expired — Pending GC)" : ""}`
        : "";
      this.tooltip = `Field: ${this.fullFieldPath} (timestamp)${tierLabel}\nDate: ${timestampDate.toISOString()}\nLocal: ${formatDateTime(timestampDate)}\nEpoch Seconds: ${epochSec}${ttlNote}\nDoc: ${parentDocRef.path}`;
    } else {
      const idxNote = isExemptField ? `\nSingle-Field Index: 🚫 Exempt (Unindexed)` : "";
      this.tooltip = `Field: ${this.fullFieldPath} (${typeLabel})${tierLabel}${idxNote}\nDoc: ${parentDocRef.path}`;
    }
    this.iconPath = new vscode.ThemeIcon(icon, iconColor);

    if (isCollapsible) {
      this.command = {
        command: "ketrik-firestore-studio.clickField",
        title: "Open Field",
        arguments: [this],
      };
    } else {
      this.command = {
        command: "ketrik-firestore-studio.openField",
        title: "Open Field",
        arguments: [this],
      };
    }
  }
}

/**
 * A Tree View item representing a Firestore collection.
 */
export class CollectionItem extends Item {
  constructor(
    public collectionId: string,
    public reference: CollectionReference,
    public connectionId: string,
    public orderBy: {
      fieldName: string;
      direction: OrderByDirection;
    } = { fieldName: "id", direction: "asc" },
    public filter?: string,
    public docCount?: number
  ) {
    super(collectionId, vscode.TreeItemCollapsibleState.Collapsed);

    this.id = `col:${connectionId}:${reference.path}`;
    // Folder icon with warm gold/amber color
    this.iconPath = new vscode.ThemeIcon(
      "folder",
      new vscode.ThemeColor("charts.orange")
    );
    this.updateMeta(orderBy, filter, docCount);
  }

  /**
   * Update collection node metadata (sort, filter, docCount, contextValue, description, tooltip)
   * in place so TreeView retains the exact object reference during targeted refreshes.
   */
  public updateMeta(
    orderBy: { fieldName: string; direction: OrderByDirection } = { fieldName: "id", direction: "asc" },
    filter?: string,
    docCount?: number
  ): void {
    this.orderBy = orderBy;
    this.filter = filter;
    this.docCount = docCount;

    const { substrate, access: writeAccess } = getConnectionMeta(this.connectionId);
    const pathSegments = (this.reference?.path || this.collectionId).split("/").filter(Boolean);
    const scope = pathSegments.length > 1 ? "sub" : "root";
    const filterState = filter ? "filtered" : "all";
    this.contextValue = `collection:${substrate}:${scope}:${filterState}:${writeAccess}`;

    let orderDesc = (orderBy.direction === "asc" ? "↑" : "↓") + orderBy.fieldName;
    if (docCount !== undefined) {
      orderDesc += ` · ${docCount.toLocaleString()} docs`;
    }
    if (filter) {
      orderDesc += `  [🔍 "${filter}"]`;
    }

    // Evaluate security access badge from rules
    const rulesService = RulesService.getInstance();
    const access = rulesService.getAccessForCollection(this.reference.path, this.connectionId);

    const baseTooltipParts = [`[${this.connectionId}] ${this.reference.path}`];
    if (docCount !== undefined) {
      baseTooltipParts.push(`Documents: ${docCount.toLocaleString()}`);
    }
    if (filter) {
      baseTooltipParts.push(`Active Filter: "${filter}"`);
    }

    if (access) {
      const { badge, tooltip: ruleTooltip } = RulesParser.formatBadge(access);
      this.description = badge ? `${orderDesc}  ${badge}` : orderDesc;
      this.tooltip = `${baseTooltipParts.join("\n")}\n\n${ruleTooltip}`;
    } else {
      this.description = orderDesc;
      this.tooltip = baseTooltipParts.join("\n");
    }
  }
}

/**
 * A Tree View item representing the "Show more" button.
 */
export class ShowMoreItemsItem extends Item {
  reference: CollectionReference;
  offset: number;
  connectionId: string;

  constructor(
    reference: CollectionReference,
    offset: number,
    connectionId: string,
    pagingLimit: number
  ) {
    super(`Load ${pagingLimit} more`, vscode.TreeItemCollapsibleState.None);
    this.reference = reference;
    this.connectionId = connectionId;
    this.id = `more:${connectionId}:${reference.path}`;
    this.offset = offset;
    this.iconPath = new vscode.ThemeIcon("more");
    this.command = {
      command: "ketrik-firestore-studio.showMoreItems",
      title: "More Items",
      arguments: [reference.path, connectionId],
    };
  }
}

/**
 * A Tree View item representing the Authentication & Users branch of a connection.
 */
export class AuthUsersBranchItem extends Item {
  reference = undefined;

  constructor(public connectionId: string) {
    super("Authentication (Users & Claims)", vscode.TreeItemCollapsibleState.Collapsed);
    this.id = `auth:${connectionId}`;
    const { access } = getConnectionMeta(connectionId);
    this.contextValue = `authBranch:${access}`;
    this.iconPath = new vscode.ThemeIcon("shield", new vscode.ThemeColor("charts.purple"));
    this.tooltip = "Firebase Authentication Users & Custom Claims";
  }
}

/**
 * A Tree View item representing an individual Firebase Auth User.
 */
export class AuthUserItem extends Item {
  reference = undefined;

  constructor(
    public user: import("firebase-admin/auth").UserRecord,
    public connectionId: string,
    public hasProfileDoc = false,
    public profileCollection = "users"
  ) {
    const label = user.email || user.displayName || user.phoneNumber || user.uid;
    super(label, vscode.TreeItemCollapsibleState.None);

    this.id = `authUser:${connectionId}:${user.uid}`;
    const { access } = getConnectionMeta(connectionId);
    const profileState = hasProfileDoc ? "hasProfile" : "noProfile";
    this.contextValue = `authUser:${profileState}:${access}`;

    const claims = user.customClaims || {};
    const claimKeys = Object.keys(claims);
    let claimsLabel = "";
    if (claims.admin === true) {
      claimsLabel = "🛡️ admin";
    } else if (claims.role) {
      claimsLabel = `🔑 ${claims.role}`;
    } else if (claimKeys.length > 0) {
      claimsLabel = `⚙️ ${claimKeys.length} claims`;
    }

    const docStatus = hasProfileDoc ? "📄 Profile exists" : "⚠️ No Profile doc";
    this.description = [claimsLabel, docStatus].filter(Boolean).join(" • ");

    this.tooltip = [
      `User: ${label}`,
      `UID: ${user.uid}`,
      user.email ? `Email: ${user.email} (${user.emailVerified ? "Verified" : "Unverified"})` : "",
      user.displayName ? `Name: ${user.displayName}` : "",
      user.disabled ? "Status: ⛔ Disabled" : "Status: Active",
      claimsLabel ? `Custom Claims: ${JSON.stringify(claims)}` : "Custom Claims: (none)",
      `Firestore Profile: ${hasProfileDoc ? `Found in /${profileCollection}` : `Not found in /${profileCollection}`}`,
    ].filter(Boolean).join("\n");

    this.iconPath = new vscode.ThemeIcon(
      user.disabled ? "circle-slash" : "person",
      user.customClaims?.admin
        ? new vscode.ThemeColor("charts.red")
        : hasProfileDoc
          ? new vscode.ThemeColor("charts.green")
          : new vscode.ThemeColor("charts.yellow")
    );

    this.command = {
      command: "ketrik-firestore-studio.openAuthUserClaims",
      title: "Edit Custom Claims",
      arguments: [this],
    };
  }
}

/**
 * A Tree View item representing "Load more users" for paginating through thousands of Auth users.
 */
export class ShowMoreAuthUsersItem extends Item {
  reference = undefined;

  constructor(
    public connectionId: string,
    public pageToken: string,
    pageSize: number
  ) {
    super(`Load ${pageSize} more users...`, vscode.TreeItemCollapsibleState.None);
    this.id = `authShowMore:${connectionId}:${pageToken}`;
    this.iconPath = new vscode.ThemeIcon("more");
    this.command = {
      command: "ketrik-firestore-studio.showMoreAuthUsers",
      title: "Load More Users",
      arguments: [connectionId],
    };
  }
}

/**
 * A Tree View item representing the "Composite Indexes" branch of a connection.
 */
export class CompositeIndexesBranchItem extends Item {
  reference = undefined;

  constructor(public connectionId: string) {
    super("Composite Indexes", vscode.TreeItemCollapsibleState.Collapsed);
    this.id = `indexes:${connectionId}`;
    const { access } = getConnectionMeta(connectionId);
    this.contextValue = `compositeIndexesBranch:${access}`;
    this.iconPath = new vscode.ThemeIcon("list-tree", new vscode.ThemeColor("charts.blue"));
    this.tooltip = "Firestore Composite Indexes (Live Cloud / Emulator)";
  }
}

/**
 * A Tree View item grouping Composite Indexes by collectionGroup when a project has many indexes.
 */
export class IndexCollectionGroupItem extends Item {
  reference = undefined;

  constructor(
    public connectionId: string,
    public collectionGroup: string,
    public indexes: import("../indexes/indexesService").FirestoreCompositeIndex[]
  ) {
    super(collectionGroup, vscode.TreeItemCollapsibleState.Collapsed);
    this.id = `indexGroup:${connectionId}:${collectionGroup}`;
    this.contextValue = "indexCollectionGroup";
    const creatingCount = indexes.filter((i) => i.state === "CREATING").length;
    const repairCount = indexes.filter((i) => i.state === "NEEDS_REPAIR").length;
    const statusParts: string[] = [`${indexes.length} index${indexes.length === 1 ? "" : "es"}`];
    if (creatingCount > 0) statusParts.push(`⏳ ${creatingCount} building`);
    if (repairCount > 0) statusParts.push(`⚠️ ${repairCount} needs repair`);
    this.description = statusParts.join(" • ");
    this.iconPath = new vscode.ThemeIcon("folder", new vscode.ThemeColor("charts.blue"));
    this.tooltip = `${collectionGroup}: ${indexes.length} composite/vector index(es)`;
  }
}

/**
 * A Tree View item representing an individual Composite Index.
 */
export class CompositeIndexItem extends Item {
  reference = undefined;

  constructor(
    public connectionId: string,
    public index: import("../indexes/indexesService").FirestoreCompositeIndex
  ) {
    // Formulate a concise summary of the index fields, e.g. "status ASC, createdAt DESC" or "embedding [VECTOR:768]"
    const fieldsDesc = index.fields
      .map((f) => {
        if (f.vectorConfig) {
          return `${f.fieldPath} [VECTOR:${f.vectorConfig.dimension}]`;
        }
        if (f.arrayConfig === "CONTAINS") {
          return `${f.fieldPath} ⋲ [CONTAINS]`;
        }
        if (f.order) {
          return `${f.fieldPath} ${f.order === "DESCENDING" ? "DESC" : "ASC"}`;
        }
        return f.fieldPath;
      })
      .join(", ");

    const label = `${index.collectionGroup} (${fieldsDesc})`;

    super(label, vscode.TreeItemCollapsibleState.None);

    this.id = `index:${connectionId}:${index.name}`;
    const { access } = getConnectionMeta(connectionId);
    this.contextValue = `compositeIndex:${access}`;

    const scopeBadge =
      index.queryScope === "COLLECTION_GROUP"
        ? "🌐 Group"
        : index.queryScope === "COLLECTION_RECURSIVE"
          ? "🌲 Recursive"
          : "📁 Collection";
    let stateBadge = "READY";
    let iconName = "check";
    let iconColor: vscode.ThemeColor | undefined = new vscode.ThemeColor("charts.green");

    if (index.state === "CREATING") {
      stateBadge = "⏳ Building";
      iconName = "sync~spin";
      iconColor = new vscode.ThemeColor("charts.yellow");
    } else if (index.state === "NEEDS_REPAIR") {
      stateBadge = "⚠️ Needs Repair";
      iconName = "warning";
      iconColor = new vscode.ThemeColor("charts.red");
    }

    this.description = `${scopeBadge} • ${stateBadge}`;

    this.tooltip = [
      `Collection Group: ${index.collectionGroup}`,
      `Query Scope: ${index.queryScope}`,
      `State: ${index.state}`,
      `Fields:\n${index.fields
        .map(
          (f) =>
            `  - ${f.fieldPath} (${f.vectorConfig
              ? `VECTOR:${f.vectorConfig.dimension}`
              : f.arrayConfig === "CONTAINS"
                ? "ARRAY_CONTAINS"
                : f.order || "ASCENDING"
            })`
        )
        .join("\n")}`,
      `Resource Name:\n${index.name}`,
    ].join("\n");

    this.iconPath = new vscode.ThemeIcon(iconName, iconColor);

    this.command = {
      command: "ketrik-firestore-studio.inspectIndexDefinition",
      title: "Inspect Index Definition",
      arguments: [this],
    };
  }
}

/**
 * A Tree View item representing the "Cost & Quotas" branch/link of a connection.
 */
export class CostQuotaBranchItem extends Item {
  reference = undefined;

  constructor(public connectionId: string) {
    super("Cost & Quotas", vscode.TreeItemCollapsibleState.None);
    this.id = `costQuota:${connectionId}`;
    this.contextValue = "costQuotaBranch";
    this.iconPath = new vscode.ThemeIcon("graph", new vscode.ThemeColor("charts.green"));
    this.description = "Simulator & Usage";
    this.tooltip = "Firestore Cost Simulator & Quota Usage (Daily free allowance & capacity planning)";
    this.command = {
      command: "ketrik-firestore-studio.openCostSimulator",
      title: "Open Cost Simulator",
      arguments: [{ connectionId }],
    };
  }
}

/**
 * Top-level branch for Cloud Storage Buckets under a Connection.
 */
export class StorageBucketsBranchItem extends Item {
  reference = undefined;

  constructor(public connectionId: string) {
    super("Cloud Storage", vscode.TreeItemCollapsibleState.Collapsed);
    this.id = `storage:${connectionId}`;
    const { access } = getConnectionMeta(connectionId);
    this.contextValue = `storageBucketsBranch:${access}`;
    this.iconPath = new vscode.ThemeIcon("cloud", new vscode.ThemeColor("charts.purple"));
    this.tooltip = "Firebase & Google Cloud Storage Buckets";
  }
}

/**
 * A specific Storage Bucket in the tree.
 */
export class StorageBucketTreeItem extends Item {
  reference = undefined;

  constructor(public connectionId: string, public bucketName: string) {
    super(bucketName, vscode.TreeItemCollapsibleState.Collapsed);
    this.id = `storageBucket:${connectionId}:${bucketName}`;
    const { access } = getConnectionMeta(connectionId);
    this.contextValue = `storageBucket:${access}`;
    this.iconPath = new vscode.ThemeIcon("archive", new vscode.ThemeColor("charts.blue"));
    this.tooltip = `Storage Bucket: ${bucketName}`;
  }
}

/**
 * A virtual folder inside a Storage Bucket.
 */
export class StorageFolderTreeItem extends Item {
  reference = undefined;

  constructor(
    public connectionId: string,
    public bucketName: string,
    public prefix: string
  ) {
    // Show only the directory segment name
    const cleanPrefix = prefix.replace(/\/$/, "");
    const folderName = cleanPrefix.split("/").pop() || cleanPrefix;
    super(folderName, vscode.TreeItemCollapsibleState.Collapsed);
    this.id = `storageFolder:${connectionId}:${bucketName}:${prefix}`;
    const { access } = getConnectionMeta(connectionId);
    this.contextValue = `storageFolder:${access}`;
    this.iconPath = new vscode.ThemeIcon("folder");
    this.tooltip = `Folder: ${prefix} (${bucketName})`;
  }
}

/**
 * An individual file / object inside a Storage Bucket.
 */
export class StorageFileTreeItem extends Item {
  reference = undefined;

  constructor(
    public connectionId: string,
    public bucketName: string,
    public fileData: import("../storage/storageService").StorageFileItemData
  ) {
    const fileName = fileData.name.split("/").pop() || fileData.name;
    super(fileName, vscode.TreeItemCollapsibleState.None);
    this.id = `storageFile:${connectionId}:${bucketName}:${fileData.name}`;
    const { access } = getConnectionMeta(connectionId);
    this.contextValue = `storageFile:${access}`;

    // Format file size
    const size = fileData.size ?? 0;
    const formattedSize =
      size < 1024
        ? `${size} B`
        : size < 1024 * 1024
          ? `${(size / 1024).toFixed(1)} KB`
          : `${(size / (1024 * 1024)).toFixed(1)} MB`;

    this.description = formattedSize;

    // Pick appropriate icon based on file extension
    const ext = fileName.split(".").pop()?.toLowerCase() || "";
    let icon = "file";
    if (["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp"].includes(ext)) {
      icon = "file-media";
    } else if (["mp3", "wav", "m4a", "ogg"].includes(ext)) {
      icon = "unmute";
    } else if (["mp4", "webm", "mov", "avi"].includes(ext)) {
      icon = "device-camera-video";
    } else if (["pdf", "doc", "docx", "txt", "md"].includes(ext)) {
      icon = "file-text";
    } else if (["json", "js", "ts", "html", "css"].includes(ext)) {
      icon = "file-code";
    } else if (["zip", "tar", "gz", "rar"].includes(ext)) {
      icon = "file-zip";
    }

    this.iconPath = new vscode.ThemeIcon(icon);
    this.tooltip = [
      `File: ${fileData.name}`,
      `Bucket: ${bucketName}`,
      `Size: ${formattedSize} (${size.toLocaleString()} bytes)`,
      fileData.contentType ? `Content-Type: ${fileData.contentType}` : undefined,
      fileData.updated ? `Updated: ${fileData.updated}` : undefined,
      `gs://${bucketName}/${fileData.name}`,
    ]
      .filter(Boolean)
      .join("\n");

    this.command = {
      command: "ketrik-firestore-studio.inspectStorageFile",
      title: "Inspect File",
      arguments: [this],
    };
  }
}

/**
 * A Tree View item representing the Google Secret Manager branch of a connection.
 */
export class SecretManagerBranchItem extends Item {
  reference = undefined;

  constructor(public connectionId: string) {
    super("Google Secret Manager", vscode.TreeItemCollapsibleState.Collapsed);
    this.id = `secrets:${connectionId}`;
    const { access } = getConnectionMeta(connectionId);
    this.contextValue = `secretManagerBranch:${access}`;
    this.iconPath = new vscode.ThemeIcon("key", new vscode.ThemeColor("charts.yellow"));
    this.tooltip = "Google Cloud Secret Manager — Secrets & Version Management";
  }
}

/**
 * A Tree View item representing an individual Google Secret Manager secret.
 */
export class SecretTreeItem extends Item {
  reference = undefined;

  constructor(
    public connectionId: string,
    public secret: SecretMetadata
  ) {
    super(secret.id, vscode.TreeItemCollapsibleState.Collapsed);
    this.id = `secret:${connectionId}:${secret.id}`;
    const { access } = getConnectionMeta(connectionId);
    this.contextValue = `secretItem:${access}`;
    const isLocked = SecretManagerService.getInstance().isSecretLocked(connectionId, secret.id);
    this.iconPath = new vscode.ThemeIcon(isLocked ? "lock" : "shield-lock", new vscode.ThemeColor("charts.yellow"));
    this.description = `${isLocked ? "🔒 Locked • " : ""}[${secret.replicationType || "automatic"}]`;
    this.tooltip = [
      `Secret: ${secret.id}`,
      `Resource: ${secret.name}`,
      `Project: ${secret.projectId}`,
      `Replication: ${secret.replicationType || "automatic"}`,
      secret.locations?.length ? `Locations: ${secret.locations.join(", ")}` : undefined,
      secret.createTime ? `Created: ${secret.createTime}` : undefined,
    ]
      .filter(Boolean)
      .join("\n");
  }
}

/**
 * A Tree View item representing a specific version of a Google Secret Manager secret.
 */
export class SecretVersionTreeItem extends Item {
  reference = undefined;

  constructor(
    public connectionId: string,
    public version: SecretVersionMetadata
  ) {
    const label = `Version ${version.versionId}`;
    super(label, vscode.TreeItemCollapsibleState.None);
    this.id = `secretVersion:${connectionId}:${version.secretId}:${version.versionId}`;

    const isEnabled = version.state === "ENABLED";
    const isDisabled = version.state === "DISABLED";
    const isDestroyed = version.state === "DESTROYED";

    const { access } = getConnectionMeta(connectionId);
    const baseCtx = isEnabled
      ? "secretVersionEnabled"
      : isDisabled
        ? "secretVersionDisabled"
        : "secretVersionDestroyed";
    this.contextValue = `${baseCtx}:${access}`;

    let icon = "symbol-variable";
    let iconColor: vscode.ThemeColor | undefined;
    if (isEnabled) {
      icon = "pass-filled";
      iconColor = new vscode.ThemeColor("charts.green");
    } else if (isDisabled) {
      icon = "circle-slash";
      iconColor = new vscode.ThemeColor("charts.orange");
    } else if (isDestroyed) {
      icon = "trash";
      iconColor = new vscode.ThemeColor("charts.red");
    }

    this.iconPath = new vscode.ThemeIcon(icon, iconColor);
    this.description = `[${version.state}]`;
    this.tooltip = [
      `Secret: ${version.secretId}`,
      `Version: ${version.versionId}`,
      `State: ${version.state}`,
      `Resource: ${version.name}`,
      version.createTime ? `Created: ${version.createTime}` : undefined,
      version.destroyTime ? `Destroyed: ${version.destroyTime}` : undefined,
    ]
      .filter(Boolean)
      .join("\n");

    if (isEnabled) {
      this.command = {
        command: "ketrik-firestore-studio.inspectSecretPayload",
        title: "Inspect Secret Payload",
        arguments: [this],
      };
    }
  }
}
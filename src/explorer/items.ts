import { DocumentReference, CollectionReference, OrderByDirection } from "firebase-admin/firestore";
import * as vscode from "vscode";
import { FirestoreConnectionConfig } from "../connections/ConnectionManager";
import { RulesService } from "../rules/RulesService";
import { RulesParser } from "../rules/RulesParser";
import { isTimestampLike, timestampToDate, formatDateTime, formatRelativeTime } from "../utils/timestampUtils";

export abstract class Item extends vscode.TreeItem {
  abstract reference?: DocumentReference | CollectionReference;
}

/**
 * A Tree View item representing a Firestore Connection.
 */
export class ConnectionTreeItem extends Item {
  reference = undefined;

  constructor(public config: FirestoreConnectionConfig) {
    super(config.name, vscode.TreeItemCollapsibleState.Collapsed);
    this.id = `connection:${config.id}`;
    this.contextValue = "connection";

    const detail = config.isLocalJson
      ? `Local JSON (${config.localJsonPath || ""})`
      : config.isEmulator
      ? `Emulator (${config.emulatorHost || "localhost:8080"})${config.projectId ? ` [${config.projectId}]` : ""}`
      : config.databaseId && config.databaseId !== "(default)"
      ? `${config.projectId || "Project"} [${config.databaseId}]`
      : config.projectId || "Production";

    this.description = detail;
    this.tooltip = `Connection: ${config.name}\nID: ${config.id}\nTarget: ${detail}${
      config.isLocalJson
        ? `\nType: Local JSON Database\nPath: ${config.localJsonPath}`
        : config.isEmulator
        ? `\nType: Local Emulator Client (Requires running emulator process on ${config.emulatorHost || "localhost:8080"})${
            config.authEmulatorHost ? `\nAuth Emulator: ${config.authEmulatorHost}` : ""
          }`
        : ""
    }`;
    this.iconPath = new vscode.ThemeIcon(
      config.isLocalJson
        ? "file-code"
        : config.isEmulator
        ? "server-process"
        : "database"
    );
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
    docData?: any
  ) {
    super(documentId, vscode.TreeItemCollapsibleState.Collapsed);
    this.command = {
      command: "ketrik-firestore-studio.openPath",
      title: "Open",
      arguments: [reference.path, connectionId],
    };

    this.id = `${connectionId}:${reference.path}`;
    this.contextValue = "document";

    if (docData !== undefined) {
      const sizeInfo = getDocumentSizeInfo(docData, reference.path);
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
        `Document: ${documentId}\n` +
        `Path: [${connectionId}] ${reference.path}\n` +
        `Size: ${sizeInfo.formatted} (${sizeInfo.bytes.toLocaleString()} bytes)\n` +
        `Limit: ${sizeInfo.percentageOfLimit}% of 1 MB max${
          isExceeded
            ? `\n⚠️ High Document Size: Exceeds 750 KB quota threshold.`
            : ""
        }`;
    } else {
      this.tooltip = `[${connectionId}] ${reference.path}`;
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

  constructor(
    public fieldName: string,
    public value: any,
    public parentDocRef: DocumentReference,
    public connectionId: string
  ) {
    super(fieldName, vscode.TreeItemCollapsibleState.None);
    this.reference = parentDocRef;

    const valType = Array.isArray(value)
      ? "array"
      : value === null
      ? "null"
      : typeof value;

    let icon = "symbol-variable";
    let iconColor: vscode.ThemeColor | undefined;

    // Dual-Prefix Protocol classification
    const isProtocol = fieldName.startsWith("__");
    const isEnvelope = fieldName.startsWith("_") && !isProtocol;

    const isTimestamp = valType === "object" && isTimestampLike(value);
    const timestampDate = isTimestamp ? timestampToDate(value) : undefined;

    if (isTimestamp && timestampDate) {
      icon = isProtocol ? "shield" : isEnvelope ? "tag" : "calendar";
      iconColor = isProtocol
        ? new vscode.ThemeColor("charts.red")
        : isEnvelope
        ? new vscode.ThemeColor("charts.purple")
        : new vscode.ThemeColor("charts.blue");
      this.description = `${formatDateTime(timestampDate)} (${formatRelativeTime(timestampDate)})`;
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
      const keyCount = Object.keys(value || {}).length;
      this.description = `{${keyCount} keys}`;
    } else if (valType === "array") {
      icon = isProtocol ? "shield" : isEnvelope ? "tag" : "symbol-array";
      iconColor = isProtocol
        ? new vscode.ThemeColor("charts.red")
        : isEnvelope
        ? new vscode.ThemeColor("charts.purple")
        : new vscode.ThemeColor("symbolIcon.arrayForeground");
      this.description = `[${value.length}]`;
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

    this.id = `${connectionId}:${parentDocRef.path}#${fieldName}`;
    this.contextValue = isTimestamp
      ? "documentFieldTimestamp"
      : valType === "object"
      ? "documentFieldMap"
      : valType === "array"
      ? "documentFieldArray"
      : "documentField";

    const tierLabel = isProtocol
      ? " [Protocol / Operational]"
      : isEnvelope
      ? " [System Envelope / Index]"
      : "";
    const typeLabel = isTimestamp ? "timestamp" : valType;
    if (isTimestamp && timestampDate) {
      const epochSec = Math.floor(timestampDate.getTime() / 1000);
      this.tooltip = `Field: ${fieldName} (timestamp)${tierLabel}\nDate: ${timestampDate.toISOString()}\nLocal: ${formatDateTime(timestampDate)}\nEpoch Seconds: ${epochSec}\nDoc: ${parentDocRef.path}`;
    } else {
      this.tooltip = `Field: ${fieldName} (${typeLabel})${tierLabel}\nDoc: ${parentDocRef.path}`;
    }
    this.iconPath = new vscode.ThemeIcon(icon, iconColor);

    this.command = {
      command: "ketrik-firestore-studio.openField",
      title: "Open Field",
      arguments: [this],
    };
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
    } = { fieldName: "id", direction: "asc" }
  ) {
    super(collectionId, vscode.TreeItemCollapsibleState.Collapsed);

    this.id = `${connectionId}:${reference.path}`;
    this.contextValue = "collection";
    this.tooltip = `[${connectionId}] ${reference.path}`;
    // Folder icon with warm gold/amber color
    this.iconPath = new vscode.ThemeIcon(
      "folder",
      new vscode.ThemeColor("charts.orange")
    );

    const orderDesc = (orderBy.direction === "asc" ? "↑" : "↓") + orderBy.fieldName;

    // Evaluate security access badge from rules
    const rulesService = RulesService.getInstance();
    const access = rulesService.getAccessForCollection(reference.path, connectionId);

    if (access) {
      const { badge, tooltip: ruleTooltip } = RulesParser.formatBadge(access);
      this.description = badge ? `${orderDesc}  ${badge}` : orderDesc;
      this.tooltip = `[${connectionId}] ${reference.path}\n\n${ruleTooltip}`;
    } else {
      this.description = orderDesc;
      this.tooltip = `[${connectionId}] ${reference.path}`;
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
    this.id = `${connectionId}:${reference.path}///showMore`;
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
    this.contextValue = "authBranch";
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
    public hasProfileDoc = false
  ) {
    const label = user.email || user.displayName || user.phoneNumber || user.uid;
    super(label, vscode.TreeItemCollapsibleState.None);

    this.id = `authUser:${connectionId}:${user.uid}`;
    this.contextValue = "authUser";

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
      `Firestore Profile: ${hasProfileDoc ? "Created" : "Not found in /users"}`,
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
    this.contextValue = "compositeIndexesBranch";
    this.iconPath = new vscode.ThemeIcon("list-tree", new vscode.ThemeColor("charts.blue"));
    this.tooltip = "Firestore Composite Indexes (Live Cloud / Emulator)";
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
    // Formulate a concise summary of the index fields, e.g. "status ASC, createdAt DESC" or "__name__ ASC, embedding (VECTOR)"
    const fieldsDesc = index.fields
      .map((f) => {
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
    this.contextValue = "compositeIndex";

    const scopeBadge = index.queryScope === "COLLECTION_GROUP" ? "🌐 Group" : "📁 Collection";
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
            `  - ${f.fieldPath} (${
              f.arrayConfig === "CONTAINS" ? "ARRAY_CONTAINS" : f.order || "ASCENDING"
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
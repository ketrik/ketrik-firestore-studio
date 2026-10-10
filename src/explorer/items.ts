import { DocumentReference, CollectionReference, OrderByDirection } from "firebase-admin/firestore";
import * as vscode from "vscode";
import { FirestoreConnectionConfig } from "../connections/ConnectionManager";

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

    const detail = config.isEmulator
      ? `Emulator (${config.emulatorHost || "localhost:8080"})`
      : config.databaseId && config.databaseId !== "(default)"
      ? `${config.projectId || "Project"} [${config.databaseId}]`
      : config.projectId || "Production";

    this.description = detail;
    this.tooltip = `Connection: ${config.name}\nID: ${config.id}\nTarget: ${detail}`;
    this.iconPath = new vscode.ThemeIcon(config.isEmulator ? "server-process" : "database");
  }
}

/**
 * A Tree View item representing a Firestore document.
 */
export class DocumentItem extends Item {
  constructor(
    public documentId: string,
    public reference: DocumentReference,
    public connectionId: string
  ) {
    super(documentId, vscode.TreeItemCollapsibleState.Collapsed);
    this.command = {
      command: "ketrik-firestore-studio.openPath",
      title: "Open",
      arguments: [reference.path, connectionId],
    };

    this.id = `${connectionId}:${reference.path}`;
    this.contextValue = "document";
    this.tooltip = `[${connectionId}] ${reference.path}`;
    // Distinct vibrant blue icon for documents
    this.iconPath = new vscode.ThemeIcon(
      "file-code",
      new vscode.ThemeColor("charts.blue")
    );
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

    if (valType === "object") {
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
    this.contextValue =
      valType === "object"
        ? "documentFieldMap"
        : valType === "array"
        ? "documentFieldArray"
        : "documentField";

    const tierLabel = isProtocol
      ? " [Protocol / Operational]"
      : isEnvelope
      ? " [System Envelope / Index]"
      : "";
    this.tooltip = `Field: ${fieldName} (${valType})${tierLabel}\nDoc: ${parentDocRef.path}`;
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
    this.description = (orderBy.direction === "asc" ? "↑" : "↓") + orderBy.fieldName;
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
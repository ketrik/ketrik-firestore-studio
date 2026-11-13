import * as vscode from "vscode";
import { ConnectionManager } from "../connections/ConnectionManager";
import { PitrService } from "./PitrService";
import { PITR_PRESETS } from "./types";
import { openCollectionAsTable } from "../webview/openCollectionAsTable";
import { formatDateTime } from "../utils/timestampUtils";
import { DatabaseConfigService } from "../databaseConfig/DatabaseConfigService";

/**
 * Command to launch the interactive Time-Travel Explorer for a collection or document.
 */
export async function openTimeTravelCommand(target?: any): Promise<void> {
  const connectionManager = ConnectionManager.getInstance();
  const connections = connectionManager.getConnections();

  if (connections.length === 0) {
    vscode.window.showWarningMessage("No Firestore connections configured. Add a connection first.");
    return;
  }

  let connectionId: string | undefined;
  let collectionPath: string | undefined;

  if (target) {
    if (typeof target === "string") {
      connectionId = target;
    } else if (target.connectionId) {
      connectionId = target.connectionId;
      collectionPath = target.collectionPath || target.collectionId;
    } else if (target.reference) {
      // Tree item
      connectionId = target.connectionId;
      if (target.reference.path) {
        const segments = target.reference.path.split("/");
        if (segments.length % 2 === 1) {
          collectionPath = target.reference.path;
        } else {
          collectionPath = segments.slice(0, -1).join("/");
        }
      }
    }
  }

  // 1. Pick Connection if needed
  if (!connectionId) {
    if (connections.length === 1) {
      connectionId = connections[0].id;
    } else {
      const picks = connections.map((c) => ({
        label: c.name,
        description: c.projectId || (c.isEmulator ? "Emulator" : "Local JSON"),
        detail: `ID: ${c.id}`,
        id: c.id,
      }));
      const picked = await vscode.window.showQuickPick(picks, {
        placeHolder: "Select a Firestore connection for Time-Travel (PITR)",
      });
      if (!picked) return;
      connectionId = picked.id;
    }
  }

  const conn = connectionManager.getConnection(connectionId);
  if (!conn) {
    vscode.window.showErrorMessage(`Connection '${connectionId}' not found.`);
    return;
  }

  if (conn.isLocalJson) {
    vscode.window.showWarningMessage("Point-in-Time Recovery is only supported on Google Cloud Firestore databases.");
    return;
  }

  // 2. Check PITR Status on the database
  const pitrService = PitrService.getInstance();
  let pitrStatus;
  try {
    pitrStatus = await pitrService.getPitrStatus(conn.id);
  } catch (err: any) {
    vscode.window.showErrorMessage(`Could not verify PITR status for '${conn.name}': ${err?.message || err}`);
    return;
  }

  if (!pitrStatus.enabled) {
    const choice = await vscode.window.showWarningMessage(
      `Point-in-Time Recovery (PITR) is currently DISABLED on database '${conn.databaseId || "(default)"}'. You must enable PITR before querying historical snapshots.`,
      "Enable PITR (1-Click)",
      "Open Database Settings",
      "Cancel"
    );

    if (choice === "Enable PITR (1-Click)") {
      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Enabling PITR on '${conn.name}'...`,
            cancellable: false,
          },
          async () => {
            await DatabaseConfigService.getInstance().enablePitr(conn.id);
          }
        );
        vscode.window.showInformationMessage(`Successfully enabled Point-in-Time Recovery on '${conn.name}'!`);
      } catch (enableErr: any) {
        vscode.window.showErrorMessage(`Failed to enable PITR: ${enableErr?.message || enableErr}`);
        return;
      }
    } else if (choice === "Open Database Settings") {
      await vscode.commands.executeCommand("ketrik-firestore-studio.openDatabaseConfiguration", { connectionId: conn.id });
      return;
    } else {
      return;
    }
  }

  // 3. Pick Collection if not provided
  if (!collectionPath) {
    const input = await vscode.window.showInputBox({
      prompt: "Enter the collection path to open in Time-Travel mode",
      placeHolder: "e.g. users or orders/ord_123/items",
      validateInput: (val) => (!val || !val.trim() ? "Collection path cannot be empty" : null),
    });
    if (!input) return;
    collectionPath = input.trim();
  }

  // 4. Select Historical Time Preset or Custom Timestamp
  const earliestStr = pitrStatus.earliestVersionTime
    ? `Earliest available: ${formatDateTime(pitrStatus.earliestVersionTime)}`
    : "Retained up to 7 days";

  const presetPicks = [
    ...PITR_PRESETS.map((p) => ({
      label: `$(history) ${p.label}`,
      description: formatDateTime(new Date(Date.now() - p.durationMs)),
      durationMs: p.durationMs,
    })),
    {
      label: "$(calendar) Custom Date & Time...",
      description: "Specify an exact historical date and time (ISO or YYYY-MM-DD HH:MM)",
      durationMs: -1,
    },
  ];

  const pickedPreset = await vscode.window.showQuickPick(presetPicks, {
    placeHolder: `Select historical timestamp (${earliestStr})`,
  });
  if (!pickedPreset) return;

  let selectedReadTime: Date;

  if (pickedPreset.durationMs === -1) {
    const customInput = await vscode.window.showInputBox({
      prompt: "Enter historical date and time in UTC or local format",
      placeHolder: "e.g. 2026-11-10 14:30:00 or 2026-11-10T14:30:00Z",
      validateInput: (val) => {
        if (!val || !val.trim()) return "Timestamp cannot be empty";
        const d = new Date(val);
        if (isNaN(d.getTime())) return "Invalid date/time format";
        if (d.getTime() > Date.now()) return "Historical timestamp cannot be in the future";
        if (pitrStatus.earliestVersionTime && d.getTime() < pitrStatus.earliestVersionTime.getTime()) {
          return `Timestamp cannot be earlier than ${formatDateTime(pitrStatus.earliestVersionTime)}`;
        }
        return null;
      },
    });
    if (!customInput) return;
    selectedReadTime = new Date(customInput.trim());
  } else {
    selectedReadTime = new Date(Date.now() - pickedPreset.durationMs);
  }

  // 5. Open Collection Table with the selected readTime
  await openCollectionAsTable({
    connectionId: conn.id,
    collectionId: collectionPath.split("/").pop() || collectionPath,
    collectionPath,
    readTime: selectedReadTime,
  });
}

/**
 * Command to restore a document from its historical snapshot back to the live database.
 */
export async function restoreDocumentFromHistoryCommand(options?: {
  connectionId?: string;
  docPath?: string;
  readTime?: Date | string;
  historicalData?: Record<string, any>;
}): Promise<void> {
  if (!options?.connectionId || !options?.docPath || !options?.readTime) {
    vscode.window.showErrorMessage("Missing required parameters for document historical restore.");
    return;
  }

  const { connectionId, docPath } = options;
  const readTime = typeof options.readTime === "string" ? new Date(options.readTime) : options.readTime;

  let data = options.historicalData;
  if (!data) {
    const historicalSnap = await PitrService.getInstance().getDocumentAtTimestamp(connectionId, docPath, readTime);
    if (!historicalSnap || !historicalSnap.exists) {
      vscode.window.showErrorMessage(`No historical snapshot found for document '${docPath}' at ${formatDateTime(readTime)}.`);
      return;
    }
    data = historicalSnap.data;
  }

  const choice = await vscode.window.showWarningMessage(
    `Restore document '${docPath}' from historical snapshot (${formatDateTime(readTime)}) back to live Firestore?`,
    { modal: true },
    "Restore (Overwrite Live Document)",
    "Restore (Merge with Live Document)",
    "Cancel"
  );

  if (!choice || choice === "Cancel") {
    return;
  }

  const strategy = choice.includes("Merge") ? "merge" : "overwrite";

  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Restoring '${docPath}' to live Firestore (${strategy})...`,
        cancellable: false,
      },
      async () => {
        await PitrService.getInstance().restoreDocumentFromHistory(connectionId, docPath, data!, strategy);
      }
    );
    vscode.window.showInformationMessage(`Successfully restored '${docPath}' from historical snapshot (${strategy})!`);
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to restore document: ${err?.message || err}`);
  }
}

/**
 * Command to compare a historical document snapshot side-by-side with live state.
 */
export async function compareDocumentWithLiveCommand(options?: {
  connectionId?: string;
  docPath?: string;
  readTime?: Date | string;
}): Promise<void> {
  if (!options?.connectionId || !options?.docPath || !options?.readTime) {
    vscode.window.showErrorMessage("Missing required parameters for document comparison.");
    return;
  }

  const readTime = typeof options.readTime === "string" ? new Date(options.readTime) : options.readTime;
  try {
    await PitrService.getInstance().compareDocumentWithLive(options.connectionId, options.docPath, readTime);
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to compare document with live state: ${err?.message || err}`);
  }
}

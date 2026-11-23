import * as vscode from "vscode";
import { AuthService, UserProfileInspection } from "./AuthService";
import { AuthUserItem, AuthUsersBranchItem, ConnectionTreeItem } from "../explorer/items";
import { ConnectionManager } from "../connections/ConnectionManager";
import ExplorerDataProvider from "../explorer/ExplorerDataProvider";
import { DocumentFileSystemProvider } from "../editor/DocumentFileSystemProvider";
import openPath from "../commands/openPath";
import { promptAndCleanupOrphanStorageFiles } from "../storage/storageCommands";
import {
  collectSubcollectionStorageSample,
  confirmProductionAction,
  getEnvironmentWarningPrefix,
} from "../utils/deleteUtils";

function resolveConnectionId(
  target?: AuthUserItem | AuthUsersBranchItem | ConnectionTreeItem | { id?: string; connectionId?: string } | string
): string {
  if (typeof target === "string") {
    return target;
  }
  if (target instanceof AuthUserItem || target instanceof AuthUsersBranchItem) {
    return target.connectionId;
  }
  if (target instanceof ConnectionTreeItem) {
    return target.config.id;
  }
  if (target && "connectionId" in target && target.connectionId) {
    return target.connectionId;
  }
  if (target && "id" in target && target.id) {
    return target.id;
  }
  const connections = ConnectionManager.getInstance().getConnections();
  return connections[0]?.id || "default";
}

function getNamedDatabaseAuthWarning(connectionId: string): string {
  const connManager = ConnectionManager.getInstance();
  const conn = connManager.getConnection(connectionId);
  if (
    conn &&
    !conn.isEmulator &&
    !conn.isLocalJson &&
    conn.databaseId &&
    conn.databaseId !== "(default)"
  ) {
    const projectLabel = connManager.getEffectiveProjectId(conn) || conn.projectId || conn.name;
    return `\n\n⚠️ Project-wide Auth scope: Firebase Authentication is shared across the entire project '${projectLabel}', not isolated to Firestore database '${conn.databaseId}'. Deleting Auth user(s) revokes sign-in access for ALL databases in this project.`;
  }
  return "";
}

/**
 * Open Custom Claims editor for a specific user.
 */
export async function editAuthUserClaimsCommand(
  item?: AuthUserItem,
  explorerDataProvider?: ExplorerDataProvider
) {
  const authService = AuthService.getInstance();
  let connectionId = resolveConnectionId(item);
  if (!ConnectionManager.getInstance().ensureWritable(connectionId, "edit user custom claims")) {
    return;
  }
  let uid = item?.user?.uid;
  let currentClaims: Record<string, any> = item?.user?.customClaims || {};

  // If no user was provided, let user search/pick one
  if (!uid) {
    const picked = await pickAuthUser(connectionId);
    if (!picked) {
      return;
    }
    uid = picked.uid;
    currentClaims = picked.customClaims || {};
  }

  const initialJson = JSON.stringify(currentClaims, null, 2);

  const newClaimsJson = await vscode.window.showInputBox({
    title: `Edit Custom Claims for UID: ${uid}`,
    prompt: "Enter valid JSON for custom claims (roles, permissions, RBAC tags). Example: {\"admin\": true, \"role\": \"editor\"}",
    value: initialJson,
    validateInput: (val) => {
      if (!val.trim()) {
        return undefined; // empty is allowed to clear claims
      }
      try {
        const parsed = JSON.parse(val);
        if (typeof parsed !== "object" || Array.isArray(parsed) || parsed === null) {
          return "Claims must be a JSON object (e.g. {\"admin\": true})";
        }
        return undefined;
      } catch (e: any) {
        return `Invalid JSON: ${e.message}`;
      }
    },
  });

  if (newClaimsJson === undefined) {
    return; // cancelled
  }

  try {
    const claimsToSet = newClaimsJson.trim() ? JSON.parse(newClaimsJson) : null;
    await authService.setCustomUserClaims(connectionId, uid, claimsToSet);
    vscode.window.showInformationMessage(`Updated custom claims for user ${uid}!`);

    if (explorerDataProvider) {
      explorerDataProvider.refresh();
    }
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to update custom claims: ${err.message}`);
  }
}

/**
 * Create a Firestore profile document for a Firebase Auth user.
 */
export async function createAuthUserProfileCommand(
  item?: AuthUserItem,
  explorerDataProvider?: ExplorerDataProvider,
  fsProvider?: DocumentFileSystemProvider
) {
  const authService = AuthService.getInstance();
  const connectionId = resolveConnectionId(item);
  if (!ConnectionManager.getInstance().ensureWritable(connectionId, "create user profile document")) {
    return;
  }
  let user = item?.user;

  if (!user) {
    const picked = await pickAuthUser(connectionId);
    if (!picked) {
      return;
    }
    user = picked;
  }

  // Ask for the profile collection name (defaults to configured collection)
  const defaultCollection = authService.getProfileCollection(connectionId);
  const collectionName = await vscode.window.showInputBox({
    title: `Create Profile Document for ${user.email || user.uid}`,
    prompt: "Collection to store user profiles in",
    value: defaultCollection,
    validateInput: (v) => {
      const normalized = v.trim().replace(/^\/+|\/+$/g, "");
      if (!normalized) {
        return "Collection name cannot be empty";
      }
      const segments = normalized.split("/").filter(Boolean);
      if (segments.length % 2 === 0) {
        return "Enter a collection path (odd number of segments, e.g. 'users' or 'org/default/members')";
      }
      return undefined;
    },
  });

  if (!collectionName) {
    return;
  }

  const normalizedColl = collectionName.trim().replace(/^\/+|\/+$/g, "");
  try {
    const docPath = await authService.createProfileDoc(
      connectionId,
      user,
      normalizedColl,
      fsProvider
    );

    vscode.window.showInformationMessage(`Created profile document: ${docPath}`);

    // Open the newly created document directly in the editor tab
    await openPath(docPath, connectionId);

    if (explorerDataProvider) {
      explorerDataProvider.refresh();
    }
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to create profile document: ${err.message}`);
  }
}

/**
 * Jump to the user's Firestore profile document if it exists, or offer to create it.
 */
export async function openAuthUserProfileCommand(
  item?: AuthUserItem,
  explorerDataProvider?: ExplorerDataProvider,
  fsProvider?: DocumentFileSystemProvider
) {
  const authService = AuthService.getInstance();
  const connectionId = resolveConnectionId(item);
  let user = item?.user;

  if (!user) {
    const picked = await pickAuthUser(connectionId);
    if (!picked) {
      return;
    }
    user = picked;
  }

  let profile: UserProfileInspection;
  try {
    profile = await authService.inspectProfile(connectionId, user.uid);
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to check user profile: ${err?.message || err}`);
    return;
  }

  if (profile.exists || profile.hasSubcollections) {
    await openPath(profile.docPath, connectionId);
  } else {
    const conn = ConnectionManager.getInstance().getConnection(connectionId);
    if (conn?.readOnly) {
      vscode.window.showWarningMessage(
        `No profile document exists at /${profile.docPath} (Connection is in Read-Only mode).`
      );
      return;
    }
    const choice = await vscode.window.showWarningMessage(
      `No profile document exists at /${profile.docPath}. Would you like to create one now?`,
      "Create Profile",
      "Cancel"
    );
    if (choice === "Create Profile") {
      await createAuthUserProfileCommand(
        item || new AuthUserItem(user, connectionId, false, profile.collectionName),
        explorerDataProvider,
        fsProvider
      );
    }
  }
}

/**
 * Manage Auth users via QuickPick search.
 */
export async function manageAuthUsersCommand(
  target?: ConnectionTreeItem | AuthUsersBranchItem | string,
  explorerDataProvider?: ExplorerDataProvider,
  fsProvider?: DocumentFileSystemProvider
) {
  const connectionId = resolveConnectionId(target);
  const picked = await pickAuthUser(connectionId);
  if (!picked) {
    return;
  }

  const action = await vscode.window.showQuickPick(
    [
      { label: "$(shield) Edit Custom Claims", action: "claims" },
      { label: "$(file-code) Open / Create Firestore Profile", action: "profile" },
      { label: "$(copy) Clone User to Another Connection...", action: "clone" },
      { label: "$(key) Mint Custom Auth Token (Login As User)", action: "mintToken" },
      { label: "$(mail) Generate Password Reset Link", action: "resetPassword" },
      { label: "$(history) Force Logout (Revoke Sessions)", action: "revokeSessions" },
      { label: "$(clippy) Copy UID", action: "copyUid" },
      { label: "$(trash) Delete User & Profile...", action: "delete" },
    ],
    {
      placeHolder: `Action for user: ${picked.email || picked.uid}`,
    }
  );

  if (!action) {
    return;
  }

  const profileCollection = AuthService.getInstance().getProfileCollection(connectionId);
  const dummyItem = new AuthUserItem(picked, connectionId, false, profileCollection);

  if (action.action === "claims") {
    await editAuthUserClaimsCommand(dummyItem, explorerDataProvider);
  } else if (action.action === "profile") {
    await openAuthUserProfileCommand(dummyItem, explorerDataProvider, fsProvider);
  } else if (action.action === "clone") {
    await cloneAuthUserCommand(dummyItem, explorerDataProvider, fsProvider);
  } else if (action.action === "mintToken") {
    await mintCustomTokenCommand(dummyItem);
  } else if (action.action === "resetPassword") {
    await resetAuthUserPasswordCommand(dummyItem);
  } else if (action.action === "revokeSessions") {
    await revokeUserSessionsCommand(dummyItem);
  } else if (action.action === "copyUid") {
    await vscode.env.clipboard.writeText(picked.uid);
    vscode.window.showInformationMessage(`Copied UID: ${picked.uid}`);
  } else if (action.action === "delete") {
    await deleteAuthUserCommand(dummyItem, explorerDataProvider, fsProvider);
  }
}

/**
 * Clone user from one connection to another target connection.
 */
export async function cloneAuthUserCommand(
  item?: AuthUserItem,
  explorerDataProvider?: ExplorerDataProvider,
  fsProvider?: DocumentFileSystemProvider
) {
  const authService = AuthService.getInstance();
  const sourceConnectionId = resolveConnectionId(item);
  let uid = item?.user?.uid;
  let userIdentifier = item?.user?.email || item?.user?.uid;

  if (!uid) {
    const picked = await pickAuthUser(sourceConnectionId);
    if (!picked) {
      return;
    }
    uid = picked.uid;
    userIdentifier = picked.email || picked.uid;
  }

  // Get available target connections
  const connections = ConnectionManager.getInstance().getConnections();
  const targetConnections = connections.filter((c) => c.id !== sourceConnectionId);

  if (targetConnections.length === 0) {
    vscode.window.showWarningMessage(
      "No other connection configured. Please add a second connection (e.g. Staging or Local Emulator) to clone to."
    );
    return;
  }

  const selectedConn = await vscode.window.showQuickPick(
    targetConnections.map((c) => ({
      label: c.name,
      description: `ID: ${c.id} • Project: ${c.projectId || "default"}`,
      connection: c,
    })),
    {
      placeHolder: `Select target connection to clone '${userIdentifier}' into`,
    }
  );

  if (!selectedConn) {
    return;
  }

  const targetConnectionId = selectedConn.connection.id;
  if (!ConnectionManager.getInstance().ensureWritable(targetConnectionId, "clone user to target connection")) {
    return;
  }
  const sourceColl = authService.getProfileCollection(sourceConnectionId);
  let hasProfile = false;
  try {
    hasProfile = await authService.checkProfileExists(sourceConnectionId, uid, sourceColl);
  } catch {
    hasProfile = false;
  }

  const cloneProfileChoice = hasProfile
    ? await vscode.window.showQuickPick(
        [
          { label: `Clone User Account & Firestore Profile (/${sourceColl})`, cloneProfile: true },
          { label: "Clone User Account Only", cloneProfile: false },
        ],
        { placeHolder: "Do you want to copy the user's Firestore profile doc as well?" }
      )
    : { cloneProfile: false };

  if (cloneProfileChoice === undefined) {
    return;
  }

  try {
    const result = await authService.cloneUserToConnection(
      sourceConnectionId,
      targetConnectionId,
      uid,
      {
        cloneProfile: cloneProfileChoice.cloneProfile,
        generateResetLink: true,
      },
      fsProvider
    );

    let msg = `Successfully cloned '${userIdentifier}' into '${selectedConn.connection.name}'.`;
    if (result.profileCloned) {
      msg += " Copied Firestore profile doc.";
    }

    if (result.resetLink) {
      await vscode.env.clipboard.writeText(result.resetLink);
      vscode.window.showInformationMessage(
        `${msg} A password reset link for the target connection was copied to your clipboard!`
      );
    } else {
      vscode.window.showInformationMessage(msg);
    }

    if (explorerDataProvider) {
      explorerDataProvider.refresh();
    }
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to clone user: ${err.message}`);
  }
}

/**
 * Mint custom auth token for user to test client apps / simulate login.
 */
export async function mintCustomTokenCommand(item?: AuthUserItem) {
  const authService = AuthService.getInstance();
  const connectionId = resolveConnectionId(item);
  let uid = item?.user?.uid;
  let userIdentifier = item?.user?.email || item?.user?.uid;

  if (!uid) {
    const picked = await pickAuthUser(connectionId);
    if (!picked) {
      return;
    }
    uid = picked.uid;
    userIdentifier = picked.email || picked.uid;
  }

  try {
    const token = await authService.createCustomToken(connectionId, uid);
    await vscode.env.clipboard.writeText(token);
    vscode.window.showInformationMessage(
      `Minted custom JWT token for '${userIdentifier}' (UID: ${uid}) and copied to clipboard!`
    );
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to mint custom token: ${err.message}`);
  }
}

/**
 * Revoke all active refresh tokens for user (force logout).
 */
export async function revokeUserSessionsCommand(item?: AuthUserItem) {
  const authService = AuthService.getInstance();
  const connectionId = resolveConnectionId(item);
  if (!ConnectionManager.getInstance().ensureWritable(connectionId, "revoke user refresh tokens")) {
    return;
  }
  let uid = item?.user?.uid;
  let userIdentifier = item?.user?.email || item?.user?.uid;

  if (!uid) {
    const picked = await pickAuthUser(connectionId);
    if (!picked) {
      return;
    }
    uid = picked.uid;
    userIdentifier = picked.email || picked.uid;
  }

  const confirm = await vscode.window.showWarningMessage(
    `Are you sure you want to revoke all active sessions for '${userIdentifier}'? They will be logged out of all devices.`,
    { modal: true },
    "Revoke Sessions",
    "Cancel"
  );

  if (confirm !== "Revoke Sessions") {
    return;
  }

  try {
    await authService.revokeRefreshTokens(connectionId, uid);
    vscode.window.showInformationMessage(`Successfully revoked all sessions for '${userIdentifier}'.`);
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to revoke sessions: ${err.message}`);
  }
}

/**
 * Generate password reset link for a user.
 */
export async function resetAuthUserPasswordCommand(item?: AuthUserItem) {
  const authService = AuthService.getInstance();
  const connectionId = resolveConnectionId(item);
  let email = item?.user?.email;

  if (!email) {
    const picked = await pickAuthUser(connectionId);
    if (!picked) {
      return;
    }
    email = picked.email;
  }

  if (!email) {
    vscode.window.showWarningMessage("Selected user does not have an email address associated with their account.");
    return;
  }

  try {
    const link = await authService.generatePasswordResetLink(connectionId, email);
    await vscode.env.clipboard.writeText(link);
    const choice = await vscode.window.showInformationMessage(
      `Password reset link generated for ${email} and copied to clipboard!`,
      "Open Link in Browser"
    );
    if (choice === "Open Link in Browser") {
      await vscode.env.openExternal(vscode.Uri.parse(link));
    }
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to generate password reset link: ${err.message}`);
  }
}

/**
 * Shared flow to delete a Firebase Auth user and/or their Firestore profile document (including subcollections),
 * refresh the Explorer tree, close stale tabs, and prompt for orphan Cloud Storage cleanup afterwards.
 */
export async function executeDeleteAuthUserFlow(params: {
  connectionId: string;
  uid: string;
  userIdentifier?: string;
  userRecord?: import("firebase-admin/auth").UserRecord;
  explorerDataProvider?: ExplorerDataProvider;
  fsProvider?: DocumentFileSystemProvider;
  collectionName?: string;
}): Promise<{ authDeleted: boolean; profileDeleted: boolean }> {
  const { connectionId, uid } = params;
  if (!ConnectionManager.getInstance().ensureWritable(connectionId, "delete auth user")) {
    return { authDeleted: false, profileDeleted: false };
  }

  const authService = AuthService.getInstance();
  const collectionName =
    params.collectionName?.trim().replace(/^\/+|\/+$/g, "") ||
    authService.getProfileCollection(connectionId);
  const userLabel = params.userIdentifier || uid;

  let profile: UserProfileInspection | undefined;
  try {
    profile = await authService.inspectProfile(connectionId, uid, collectionName);
  } catch {
    profile = undefined;
  }

  const hasProfileOrSub = !!(profile && (profile.exists || profile.hasSubcollections));
  const hasSubcollections = !!profile?.hasSubcollections;
  const profilePathLabel = profile?.docPath || `${collectionName}/${uid}`;
  const targetProfileDocPaths =
    hasProfileOrSub && profile
      ? [profile.docPath, ...(profile.additionalDocPaths || [])]
      : undefined;

  const uidFieldNote = profile?.matchedByUidField ? " (matched by 'uid' field)" : "";
  const extraCount = profile?.additionalDocPaths?.length || 0;
  const extraNote =
    extraCount > 0 ? ` (and ${extraCount} additional doc(s) matching 'uid')` : "";
  const subDetail = hasSubcollections
    ? ` (including ${profile!.subcollectionIds.length} subcollection(s): ${profile!.subcollectionIds.join(", ")})`
    : "";
  const profileDetail = hasProfileOrSub
    ? ` A Firestore profile${profile!.exists ? " document" : " container"} also exists at '/${profilePathLabel}'${uidFieldNote}${extraNote}${subDetail}.`
    : "";
  const namedDbWarning = getNamedDatabaseAuthWarning(connectionId);

  const deleteBothOption = hasSubcollections
    ? "Delete Auth User & Profile (+ Subcollections)"
    : `Delete Auth User & Profile Doc (/${collectionName})`;
  const deleteProfileOnlyOption = hasSubcollections
    ? "Delete Profile (+ Subcollections) Only"
    : "Delete Profile Doc Only";

  const options = hasProfileOrSub
    ? [deleteBothOption, "Delete Auth User Only", deleteProfileOnlyOption, "Cancel"]
    : ["Delete Auth User Only", "Cancel"];

  const envPrefix = getEnvironmentWarningPrefix(connectionId);
  const choice = await vscode.window.showWarningMessage(
    `${envPrefix}Are you sure you want to permanently delete user '${userLabel}' (UID: ${uid})?${profileDetail}${namedDbWarning}`,
    { modal: true },
    ...options
  );

  if (!choice || choice === "Cancel") {
    return { authDeleted: false, profileDeleted: false };
  }

  const confirmToken = params.userRecord?.email || params.userIdentifier || uid;
  const actionLabel =
    choice === deleteProfileOnlyOption
      ? "Delete User Profile"
      : choice === "Delete Auth User Only"
        ? "Delete Auth User"
        : "Delete Auth User & Profile";
  const targetSummary =
    choice === deleteProfileOnlyOption
      ? `profile '/${profilePathLabel}' for user '${userLabel}'`
      : `Auth user '${userLabel}' (UID: ${uid})${
          choice !== "Delete Auth User Only" && hasProfileOrSub
            ? ` and profile '/${profilePathLabel}'`
            : ""
        }`;
  const confirmedProd = await confirmProductionAction({
    connectionId,
    actionLabel,
    targetSummary,
    expectedInput: confirmToken,
  });
  if (!confirmedProd) {
    return { authDeleted: false, profileDeleted: false };
  }

  const sampleProfileSubcollections = async (docPaths: string[] | undefined): Promise<Record<string, any> | undefined> => {
    if (!hasSubcollections || !docPaths || docPaths.length === 0) {
      return undefined;
    }
    try {
      const firestore = await ConnectionManager.getInstance().getFirestore(connectionId);
      const samples: Record<string, any> = {};
      let remaining = 25;
      for (const p of docPaths) {
        if (remaining <= 0) break;
        const subSample = await collectSubcollectionStorageSample(
          firestore.doc(p),
          connectionId,
          remaining
        );
        if (subSample) {
          const count = Object.keys(subSample).length;
          samples[p] = subSample;
          remaining -= count;
        }
      }
      return Object.keys(samples).length > 0 ? samples : undefined;
    } catch {
      return undefined;
    }
  };

  if (choice === deleteProfileOnlyOption) {
    const subSample = await sampleProfileSubcollections(targetProfileDocPaths);
    try {
      const res = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Deleting Firestore profile for '${userLabel}'...`,
          cancellable: false,
        },
        async () => {
          return authService.deleteProfileDoc(
            connectionId,
            uid,
            collectionName,
            params.fsProvider,
            true,
            targetProfileDocPaths
          );
        }
      );

      params.explorerDataProvider?.refreshAfterAuthUserProfileDeleted(
        connectionId,
        uid,
        collectionName,
        targetProfileDocPaths
      );

      if (res.deleted) {
        const subText = res.subcollectionsDeleted
          ? ` and nested subcollections (${res.deletedDocsCount} Firestore doc(s))`
          : "";
        vscode.window.showInformationMessage(
          `Deleted Firestore profile '/${profilePathLabel}'${subText} while keeping Firebase Auth user '${userLabel}'.`
        );
        const profileStorageObj: Record<string, any> = {};
        if (profile?.data && Object.keys(profile.data).length > 0) {
          profileStorageObj.profileData = profile.data;
        }
        if (subSample) {
          profileStorageObj.subcollections = subSample;
        }
        if (Object.keys(profileStorageObj).length > 0) {
          try {
            await promptAndCleanupOrphanStorageFiles(
              connectionId,
              profileStorageObj,
              userLabel
            );
          } catch { }
        }
      } else {
        vscode.window.showInformationMessage(
          `No Firestore profile documents needed deletion at '/${profilePathLabel}'.`
        );
      }

      return { authDeleted: false, profileDeleted: res.deleted };
    } catch (err: any) {
      vscode.window.showErrorMessage(
        `Failed to delete Firestore profile '/${profilePathLabel}': ${err?.message || err}`
      );
      return { authDeleted: false, profileDeleted: false };
    }
  }

  const shouldDeleteProfile = choice !== "Delete Auth User Only";

  // Capture storage URLs before deleting Auth/Firestore records
  let storageScanObj: Record<string, any> | undefined;
  try {
    const userRecord = params.userRecord || (await authService.getUser(connectionId, uid));
    const scan: Record<string, any> = {};
    if (shouldDeleteProfile && profile?.data) {
      scan.profileData = profile.data;
    }
    if (shouldDeleteProfile && hasSubcollections) {
      const subSample = await sampleProfileSubcollections(targetProfileDocPaths);
      if (subSample) {
        scan.subcollections = subSample;
      }
    }
    if (userRecord?.photoURL) {
      scan.photoURL = userRecord.photoURL;
    }
    if (Object.keys(scan).length > 0) {
      storageScanObj = scan;
    }
  } catch {
    if (shouldDeleteProfile && profile?.data) {
      storageScanObj = { profileData: profile.data };
    }
  }

  try {
    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Deleting Auth user '${userLabel}'...`,
        cancellable: false,
      },
      async () => {
        return authService.deleteUserAndProfile(
          connectionId,
          uid,
          shouldDeleteProfile,
          collectionName,
          params.fsProvider,
          true,
          targetProfileDocPaths
        );
      }
    );

    params.explorerDataProvider?.refreshAfterAuthUserDeleted(
      connectionId,
      uid,
      result.profileDeleted ? collectionName : undefined,
      result.profileDeleted ? targetProfileDocPaths : undefined
    );

    if (result.profileError) {
      vscode.window.showWarningMessage(
        `Deleted Auth user '${userLabel}', but failed to delete Firestore profile '/${profilePathLabel}': ${result.profileError}`
      );
    } else if (result.profileDeleted && result.subcollectionsDeleted) {
      vscode.window.showInformationMessage(
        `Successfully deleted Auth user '${userLabel}', profile doc, and nested subcollections (${result.deletedProfileDocsCount} Firestore doc(s)).`
      );
    } else if (result.profileDeleted) {
      vscode.window.showInformationMessage(
        `Successfully deleted Auth user '${userLabel}' and associated Firestore profile doc.`
      );
    } else {
      vscode.window.showInformationMessage(`Successfully deleted Auth user '${userLabel}'.`);
    }

    if (storageScanObj && Object.keys(storageScanObj).length > 0) {
      try {
        await promptAndCleanupOrphanStorageFiles(connectionId, storageScanObj, userLabel);
      } catch { }
    }

    return { authDeleted: true, profileDeleted: result.profileDeleted };
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to delete user '${userLabel}': ${err.message}`);
    return { authDeleted: false, profileDeleted: false };
  }
}

/**
 * Bulk delete selected Firebase Auth users via auth.deleteUsers(), with optional recursive
 * deletion of their matching Firestore profile documents and subcollections.
 */
export async function executeBulkDeleteAuthUsersFlow(params: {
  connectionId: string;
  uids: string[];
  explorerDataProvider?: ExplorerDataProvider;
  fsProvider?: DocumentFileSystemProvider;
  collectionName?: string;
}): Promise<{ deletedUids: string[] }> {
  const { connectionId } = params;
  if (!ConnectionManager.getInstance().ensureWritable(connectionId, "bulk delete auth users")) {
    return { deletedUids: [] };
  }

  const uniqueUids = Array.from(
    new Set(params.uids.map((u) => String(u || "").trim()).filter((u) => u.length > 0))
  );
  if (uniqueUids.length === 0) {
    return { deletedUids: [] };
  }

  const authService = AuthService.getInstance();
  const collectionName =
    params.collectionName?.trim().replace(/^\/+|\/+$/g, "") ||
    authService.getProfileCollection(connectionId);
  const namedDbWarning = getNamedDatabaseAuthWarning(connectionId);

  const envPrefix = getEnvironmentWarningPrefix(connectionId);
  const choice = await vscode.window.showWarningMessage(
    `${envPrefix}Are you sure you want to permanently delete ${uniqueUids.length} selected Firebase Auth user(s)?\n\nSelecting profile deletion will also recursively delete any matching '/${collectionName}/<uid>' profile documents and all nested subcollections.${namedDbWarning}`,
    { modal: true },
    "Delete Auth Users & Profiles (+ Subcollections)",
    "Delete Auth Users Only",
    "Cancel"
  );

  if (!choice || choice === "Cancel") {
    return { deletedUids: [] };
  }

  const deleteProfiles = choice === "Delete Auth Users & Profiles (+ Subcollections)";
  const confirmedProd = await confirmProductionAction({
    connectionId,
    actionLabel: deleteProfiles ? "Bulk Delete Auth Users & Profiles" : "Bulk Delete Auth Users",
    targetSummary: `${uniqueUids.length} Firebase Auth user(s)${
      deleteProfiles ? ` and matching '/${collectionName}/<uid>' profiles` : ""
    }`,
    expectedInput: `DELETE ${uniqueUids.length}`,
  });
  if (!confirmedProd) {
    return { deletedUids: [] };
  }

  try {
    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Bulk deleting ${uniqueUids.length} Firebase Auth user(s)...`,
        cancellable: false,
      },
      async (progress) => {
        return authService.deleteUsersAndProfiles(
          connectionId,
          uniqueUids,
          deleteProfiles,
          collectionName,
          params.fsProvider,
          true,
          (completed, total) => {
            progress.report({
              message: `Cleaning up profiles (${completed}/${total})...`,
            });
          }
        );
      }
    );

    if (result.deletedUids.length > 0) {
      params.explorerDataProvider?.refreshAfterAuthUsersBulkDeleted(
        connectionId,
        result.deletedUids,
        deleteProfiles && result.profilesDeletedCount > 0 ? collectionName : undefined
      );
    }

    const parts: string[] = [`Deleted ${result.deletedUids.length} Auth user(s)`];
    if (deleteProfiles && result.profilesDeletedCount > 0) {
      parts.push(
        `and ${result.profilesDeletedCount} profile(s) (${result.deletedProfileDocsCount} Firestore doc(s))`
      );
    }
    const issueParts: string[] = [];
    if (result.authFailed.length > 0) {
      issueParts.push(
        `${result.authFailed.length} Auth error(s): ${result.authFailed[0].uid} (${result.authFailed[0].error})`
      );
    }
    if (result.profileErrors.length > 0) {
      issueParts.push(
        `${result.profileErrors.length} profile error(s): ${result.profileErrors[0].uid} (${result.profileErrors[0].error})`
      );
    }

    if (issueParts.length > 0) {
      vscode.window.showWarningMessage(
        `${parts.join(" ")}. Issues encountered: ${issueParts.join("; ")}.`
      );
    } else {
      vscode.window.showInformationMessage(`${parts.join(" ")}.`);
    }

    return { deletedUids: result.deletedUids };
  } catch (err: any) {
    vscode.window.showErrorMessage(`Bulk Auth user deletion failed: ${err?.message || err}`);
    return { deletedUids: [] };
  }
}

/**
 * Reverse prompt: after deleting a Firestore document inside the configured Auth profile collection,
 * check if a matching Firebase Auth user exists and offer to delete it as well.
 */
export async function maybePromptDeleteAuthUserForProfile(
  connectionId: string,
  docPath: string,
  docId: string,
  explorerDataProvider?: ExplorerDataProvider,
  docData?: Record<string, any>
): Promise<void> {
  const conn = ConnectionManager.getInstance().getConnection(connectionId);
  if (!conn || conn.isLocalJson || conn.readOnly) {
    return;
  }

  const cleanPath = docPath.replace(/^\/+|\/+$/g, "");
  const lastSlash = cleanPath.lastIndexOf("/");
  const parentColl = lastSlash > 0 ? cleanPath.substring(0, lastSlash) : "";
  const authService = AuthService.getInstance();
  const profileColl = authService.getProfileCollection(connectionId);

  if (!parentColl || parentColl !== profileColl) {
    return;
  }

  let authUser: import("firebase-admin/auth").UserRecord | undefined;
  try {
    authUser = await authService.getUser(connectionId, docId);
  } catch {
    const fieldUid = typeof docData?.uid === "string" ? docData.uid.trim() : "";
    if (fieldUid && fieldUid !== docId) {
      try {
        authUser = await authService.getUser(connectionId, fieldUid);
      } catch {
        authUser = undefined;
      }
    }
  }

  if (!authUser) {
    return;
  }

  const envPrefix = getEnvironmentWarningPrefix(connectionId);
  const userLabel = authUser.email || authUser.displayName || authUser.uid;
  const namedDbWarning = getNamedDatabaseAuthWarning(connectionId);
  const confirm = await vscode.window.showWarningMessage(
    `${envPrefix}Deleted Firestore profile '${cleanPath}'. A matching Firebase Auth account exists for '${userLabel}' (UID: ${authUser.uid}). Delete the Firebase Auth user as well?${namedDbWarning}`,
    { modal: true },
    "Delete Firebase Auth User",
    "Keep Auth User"
  );

  if (confirm !== "Delete Firebase Auth User") {
    return;
  }

  const confirmedProd = await confirmProductionAction({
    connectionId,
    actionLabel: "Delete Matching Auth User",
    targetSummary: `Firebase Auth user '${userLabel}' (UID: ${authUser.uid})`,
    expectedInput: authUser.email || authUser.uid,
  });
  if (!confirmedProd) {
    return;
  }

  try {
    await authService.deleteUser(connectionId, authUser.uid);
    explorerDataProvider?.refreshAfterAuthUserDeleted(connectionId, authUser.uid);
    vscode.window.showInformationMessage(
      `Deleted Firebase Auth user '${userLabel}' (UID: ${authUser.uid}).`
    );

    if (authUser.photoURL) {
      try {
        await promptAndCleanupOrphanStorageFiles(
          connectionId,
          { photoURL: authUser.photoURL },
          userLabel
        );
      } catch { }
    }
  } catch (err: any) {
    vscode.window.showErrorMessage(
      `Failed to delete Firebase Auth user '${userLabel}': ${err?.message || err}`
    );
  }
}

/**
 * Delete a user from Firebase Auth, with option to cascade-delete their Firestore profile document and subcollections.
 */
export async function deleteAuthUserCommand(
  item?: AuthUserItem,
  explorerDataProvider?: ExplorerDataProvider,
  fsProvider?: DocumentFileSystemProvider
) {
  let connectionId: string;
  if (!item) {
    const nonLocalConns = ConnectionManager.getInstance()
      .getConnections()
      .filter((c) => !c.isLocalJson);
    if (nonLocalConns.length === 0) {
      vscode.window.showWarningMessage(
        "No Cloud or Emulator Firebase connections configured."
      );
      return;
    }
    if (nonLocalConns.length === 1) {
      connectionId = nonLocalConns[0].id;
    } else {
      const pickedConn = await vscode.window.showQuickPick(
        nonLocalConns.map((c) => ({
          label: c.name,
          description: c.isEmulator
            ? `Emulator (${c.emulatorHost || "localhost"})`
            : c.projectId || c.id,
          connectionId: c.id,
        })),
        { placeHolder: "Select connection to delete Auth user from" }
      );
      if (!pickedConn) {
        return;
      }
      connectionId = pickedConn.connectionId;
    }
  } else {
    connectionId = resolveConnectionId(item);
  }

  if (!ConnectionManager.getInstance().ensureWritable(connectionId, "delete auth user")) {
    return;
  }

  let userRecord = item?.user;
  let uid = userRecord?.uid;
  let userIdentifier = userRecord?.email || userRecord?.uid;

  if (!uid) {
    const picked = await pickAuthUser(connectionId);
    if (!picked) {
      return;
    }
    userRecord = picked;
    uid = picked.uid;
    userIdentifier = picked.email || picked.uid;
  }

  await executeDeleteAuthUserFlow({
    connectionId,
    uid,
    userIdentifier,
    userRecord,
    explorerDataProvider,
    fsProvider,
  });
}

/**
 * Helper to display a paginated QuickPick list of Auth users with direct Email/UID server lookup.
 */
async function pickAuthUser(
  connectionId: string
): Promise<import("firebase-admin/auth").UserRecord | undefined> {
  const authService = AuthService.getInstance();
  let loadedUsers: import("firebase-admin/auth").UserRecord[] = [];
  let nextPageToken: string | undefined;

  try {
    const initial = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Loading Firebase Auth users...",
        cancellable: false,
      },
      async () => authService.listUsers(connectionId, 100)
    );
    loadedUsers = initial.users;
    nextPageToken = initial.pageToken;
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to fetch Auth users: ${err.message}`);
    return undefined;
  }

  if (loadedUsers.length === 0 && !nextPageToken) {
    vscode.window.showInformationMessage("No users found in Firebase Authentication.");
    return undefined;
  }

  type AuthPickItem = vscode.QuickPickItem & {
    kindType: "lookup" | "user" | "loadMore";
    user?: import("firebase-admin/auth").UserRecord;
  };

  while (true) {
    const items: AuthPickItem[] = [
      {
        label: "$(search) Lookup User by Email or UID...",
        description: "Direct server lookup across all Auth users",
        alwaysShow: true,
        kindType: "lookup",
      },
      ...loadedUsers.map((u): AuthPickItem => {
        const claims = u.customClaims || {};
        const claimsStr =
          Object.keys(claims).length > 0 ? JSON.stringify(claims) : "(no claims)";
        return {
          label: u.email || u.displayName || u.uid,
          description: `UID: ${u.uid}`,
          detail: `Claims: ${claimsStr} • ${u.disabled ? "Disabled" : "Active"}`,
          kindType: "user",
          user: u,
        };
      }),
    ];

    if (nextPageToken) {
      items.push({
        label: "$(more) Load next 100 users...",
        description: `${loadedUsers.length} loaded so far`,
        alwaysShow: true,
        kindType: "loadMore",
      });
    }

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: `Select a Firebase Auth user (${loadedUsers.length} loaded${nextPageToken ? "+" : ""})`,
      matchOnDescription: true,
      matchOnDetail: true,
    });

    if (!selected) {
      return undefined;
    }

    if (selected.kindType === "user") {
      return selected.user;
    }

    if (selected.kindType === "lookup") {
      const query = await vscode.window.showInputBox({
        title: "Lookup Firebase Auth User",
        prompt: "Enter exact user email address or UID",
        placeHolder: "user@example.com or uid123",
      });
      if (query === undefined) {
        continue;
      }
      const trimmed = query.trim();
      if (!trimmed) {
        continue;
      }
      try {
        const found = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Looking up user '${trimmed}'...`,
            cancellable: false,
          },
          async () => authService.findUserByEmailOrUid(connectionId, trimmed)
        );
        if (found) {
          return found;
        }
        vscode.window.showWarningMessage(
          `No Firebase Auth user found matching '${trimmed}'.`
        );
      } catch (err: any) {
        vscode.window.showErrorMessage(`User lookup failed: ${err?.message || err}`);
      }
      continue;
    }

    if (selected.kindType === "loadMore" && nextPageToken) {
      try {
        const nextPage = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "Loading next 100 Firebase Auth users...",
            cancellable: false,
          },
          async () => authService.listUsers(connectionId, 100, nextPageToken)
        );
        loadedUsers = loadedUsers.concat(nextPage.users);
        nextPageToken = nextPage.pageToken;
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to load more Auth users: ${err.message}`);
      }
    }
  }
}

/**
 * Command: Create a new Firebase Auth user with optional custom claims and profile doc.
 */
export async function createAuthUserCommand(
  item?: AuthUsersBranchItem | ConnectionTreeItem,
  explorerDataProvider?: ExplorerDataProvider,
  fsProvider?: DocumentFileSystemProvider
) {
  const authService = AuthService.getInstance();
  const connectionId = resolveConnectionId(item);
  if (!ConnectionManager.getInstance().ensureWritable(connectionId, "create auth user")) {
    return;
  }

  // 1. Email
  const email = await vscode.window.showInputBox({
    title: "Create Firebase Auth User (1/4)",
    prompt: "Enter email address for new user",
    placeHolder: "user@example.com",
    validateInput: (v) => {
      const trimmed = v.trim();
      if (!trimmed) return "Email is required";
      if (!trimmed.includes("@") || !trimmed.includes(".")) return "Invalid email address format";
      return undefined;
    },
  });
  if (!email) return;

  // 2. Password
  const password = await vscode.window.showInputBox({
    title: "Create Firebase Auth User (2/4)",
    prompt: "Enter initial password (minimum 6 characters)",
    placeHolder: "Temporary or initial password",
    password: true,
    validateInput: (v) => {
      if (!v || v.length < 6) return "Password must be at least 6 characters";
      return undefined;
    },
  });
  if (!password) return;

  // 3. Display Name
  const displayName = await vscode.window.showInputBox({
    title: "Create Firebase Auth User (3/4)",
    prompt: "Enter display name (optional)",
    placeHolder: "Jane Doe",
  });
  if (displayName === undefined) return;

  // 4. Custom Claims
  const claimsJson = await vscode.window.showInputBox({
    title: "Create Firebase Auth User (4/4)",
    prompt: "Enter custom claims as JSON (optional, e.g. {\"admin\": true, \"role\": \"editor\"})",
    value: "{}",
    validateInput: (v) => {
      if (!v.trim()) return undefined;
      try {
        const parsed = JSON.parse(v);
        if (typeof parsed !== "object" || Array.isArray(parsed) || parsed === null) {
          return "Claims must be a JSON object";
        }
        return undefined;
      } catch (e: any) {
        return `Invalid JSON: ${e.message}`;
      }
    },
  });
  if (claimsJson === undefined) return;

  let customClaims: Record<string, any> | undefined;
  try {
    const parsed = JSON.parse(claimsJson || "{}");
    if (Object.keys(parsed).length > 0) {
      customClaims = parsed;
    }
  } catch {}

  // Create user
  try {
    const user = await authService.createUser(
      connectionId,
      {
        email: email.trim(),
        password,
        displayName: displayName?.trim() || undefined,
        emailVerified: false,
      },
      customClaims
    );

    const action = await vscode.window.showInformationMessage(
      `Created user '${user.email || user.uid}' (UID: ${user.uid})!`,
      "Create Firestore Profile",
      "Dismiss"
    );

    if (action === "Create Firestore Profile") {
      const createdPath = await authService.createProfileDoc(connectionId, user, undefined, fsProvider);
      vscode.window.showInformationMessage(`Created Firestore profile document '${createdPath}' for ${user.uid}!`);
      await openPath(createdPath, connectionId);
    }

    if (explorerDataProvider) {
      explorerDataProvider.refresh();
    }
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to create user: ${err.message}`);
  }
}

/**
 * Command: Inspect and manage project authentication configuration & security policies.
 */
export async function inspectProjectAuthConfigCommand(
  item?: AuthUsersBranchItem | ConnectionTreeItem
) {
  const authService = AuthService.getInstance();
  const connectionId = resolveConnectionId(item);

  try {
    const config = await authService.getProjectConfig(connectionId);
    const pwdPolicy = config.passwordPolicyConfig;
    const emailPrivacy = config.emailPrivacyConfig;
    const mfa = config.multiFactorConfig;
    const sms = config.smsRegionConfig;

    const items: vscode.QuickPickItem[] = [
      {
        label: "$(lock) Password Policy",
        description: pwdPolicy ? `Enforcement: ${pwdPolicy.enforcementState || "OFF"}` : "Not Configured",
        detail: pwdPolicy
          ? `Min Length: ${pwdPolicy.constraints?.minLength ?? "none"}, Requirements: [${[
              pwdPolicy.constraints?.requireUppercase ? "Uppercase" : null,
              pwdPolicy.constraints?.requireLowercase ? "Lowercase" : null,
              pwdPolicy.constraints?.requireNumeric ? "Numeric" : null,
              pwdPolicy.constraints?.requireNonAlphanumeric ? "Special Chars" : null,
            ]
              .filter(Boolean)
              .join(", ") || "none"}]`
          : "Standard default password constraints apply",
      },
      {
        label: "$(shield) Email Enumeration Privacy",
        description: emailPrivacy?.enableImprovedEmailPrivacy ? "Enabled (Protected)" : "Disabled",
        detail: emailPrivacy?.enableImprovedEmailPrivacy
          ? "Firebase prevents email enumeration in sign-in & password recovery flows"
          : "Email enumeration protection is off",
      },
      {
        label: "$(device-mobile) Multi-Factor Authentication (MFA)",
        description: mfa?.state ? `State: ${mfa.state}` : "Disabled",
        detail: mfa?.factorIds?.length
          ? `Enabled factors: ${mfa.factorIds.join(", ")}`
          : "No MFA factors configured",
      },
      {
        label: "$(globe) SMS Region Policies",
        description: sms?.allowByDefault ? "Allow by default" : "Allowlist only",
        detail: sms?.allowlistOnly?.allowedRegions?.length
          ? `Allowed region calling codes: ${sms.allowlistOnly.allowedRegions.join(", ")}`
          : "All regions permitted or default Firebase policies apply",
      },
    ];

    await vscode.window.showQuickPick(items, {
      title: `Firebase Project Auth Security & Policies (${connectionId})`,
      placeHolder: "Project Auth Configuration Overview (admin.auth().projectConfigManager())",
    });
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to inspect project Auth config: ${err.message}`);
  }
}

/**
 * Generate email verification link for a user.
 */
export async function generateEmailVerificationLinkCommand(item?: AuthUserItem) {
  const authService = AuthService.getInstance();
  const connectionId = resolveConnectionId(item);
  let email = item?.user?.email;

  if (!email) {
    const picked = await pickAuthUser(connectionId);
    if (!picked) {
      return;
    }
    email = picked.email;
  }

  if (!email) {
    vscode.window.showWarningMessage("Selected user does not have an email address associated with their account.");
    return;
  }

  try {
    const link = await authService.generateEmailVerificationLink(connectionId, email);
    await vscode.env.clipboard.writeText(link);
    const choice = await vscode.window.showInformationMessage(
      `Email verification link generated for ${email} and copied to clipboard!`,
      "Open Link in Browser"
    );
    if (choice === "Open Link in Browser") {
      await vscode.env.openExternal(vscode.Uri.parse(link));
    }
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to generate email verification link: ${err.message}`);
  }
}

/**
 * Generate passwordless sign-in (email link) for a user.
 */
export async function generateSignInWithEmailLinkCommand(item?: AuthUserItem) {
  const authService = AuthService.getInstance();
  const connectionId = resolveConnectionId(item);
  let email = item?.user?.email;

  if (!email) {
    const picked = await pickAuthUser(connectionId);
    if (!picked) {
      return;
    }
    email = picked.email;
  }

  if (!email) {
    vscode.window.showWarningMessage("Selected user does not have an email address associated with their account.");
    return;
  }

  const redirectUrl = await vscode.window.showInputBox({
    title: `Generate Passwordless Sign-in Link for ${email}`,
    prompt: "Enter continue / redirect URL for the authentication completion flow",
    value: "http://localhost:3000/finishSignIn",
    placeHolder: "https://your-domain.com/finishSignIn",
  });
  if (redirectUrl === undefined) return;

  try {
    const link = await authService.generateSignInWithEmailLink(connectionId, email, {
      url: redirectUrl.trim() || "http://localhost:3000/finishSignIn",
      handleCodeInApp: true,
    });
    await vscode.env.clipboard.writeText(link);
    const choice = await vscode.window.showInformationMessage(
      `Passwordless sign-in link generated for ${email} and copied to clipboard!`,
      "Open Link in Browser"
    );
    if (choice === "Open Link in Browser") {
      await vscode.env.openExternal(vscode.Uri.parse(link));
    }
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to generate passwordless sign-in link: ${err.message}`);
  }
}

/**
 * View MFA factors enrolled for a user.
 */
export async function viewUserMfaCommand(item?: AuthUserItem) {
  const authService = AuthService.getInstance();
  const connectionId = resolveConnectionId(item);
  let user = item?.user;

  if (!user) {
    const picked = await pickAuthUser(connectionId);
    if (!picked) return;
    user = picked;
  }

  try {
    // Re-fetch latest user record to ensure accurate multiFactor data
    const fullUser = await authService.getUser(connectionId, user.uid);
    const factors = fullUser.multiFactor?.enrolledFactors || [];

    if (factors.length === 0) {
      vscode.window.showInformationMessage(`User '${fullUser.email || fullUser.uid}' has no enrolled Multi-Factor Authentication (MFA) factors.`);
      return;
    }

    const items: vscode.QuickPickItem[] = factors.map(f => ({
      label: `$(shield) ${f.factorId.toUpperCase()}: ${f.displayName || (f as any).phoneNumber || "Enrolled Factor"}`,
      description: `UID: ${f.uid}`,
      detail: `Enrolled at: ${f.enrollmentTime || "unknown"}`
    }));

    await vscode.window.showQuickPick(items, {
      title: `Enrolled MFA Factors for ${fullUser.email || fullUser.uid} (${factors.length})`,
      placeHolder: "Multi-Factor Authentication enrollment details"
    });
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to fetch MFA details: ${err.message}`);
  }
}

/**
 * Bulk import users wizard from JSON or CSV file.
 */
export async function importAuthUsersWizardCommand(
  item?: AuthUsersBranchItem | ConnectionTreeItem,
  explorerDataProvider?: ExplorerDataProvider
) {
  const authService = AuthService.getInstance();
  const connectionId = resolveConnectionId(item);
  if (!ConnectionManager.getInstance().ensureWritable(connectionId, "import auth users")) {
    return;
  }

  try {
    const files = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectMany: false,
      openLabel: "Select Auth Users Dataset (JSON/CSV)",
      filters: {
        "User Datasets": ["json", "csv"],
      },
    });
    if (!files || files.length === 0) return;

    const fileUri = files[0];
    const rawBuffer = await vscode.workspace.fs.readFile(fileUri);
    const content = Buffer.from(rawBuffer).toString("utf8");

    let usersToImport: import("firebase-admin/auth").UserImportRecord[] = [];
    if (fileUri.fsPath.endsWith(".json")) {
      const parsed = JSON.parse(content);
      const rawList = Array.isArray(parsed) ? parsed : (parsed.users || [parsed]);
      usersToImport = rawList.map((u: any) => ({
        uid: String(u.uid || u.localId || ""),
        email: u.email || undefined,
        emailVerified: !!u.emailVerified,
        displayName: u.displayName || undefined,
        photoURL: u.photoURL || undefined,
        phoneNumber: u.phoneNumber || undefined,
        disabled: !!u.disabled,
        customClaims: u.customClaims || undefined,
      })).filter((u: any) => u.uid);
    } else {
      const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
      if (lines.length > 1) {
        const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
          const rowObj: any = {};
          headers.forEach((h, idx) => {
            rowObj[h] = cols[idx];
          });
          if (rowObj.uid || rowObj.email) {
            usersToImport.push({
              uid: rowObj.uid || `import_${Date.now()}_${i}`,
              email: rowObj.email || undefined,
              displayName: rowObj.displayName || undefined,
              emailVerified: rowObj.emailVerified === "true",
              disabled: rowObj.disabled === "true",
            });
          }
        }
      }
    }

    if (usersToImport.length === 0) {
      vscode.window.showWarningMessage("No valid user records found in selected file.");
      return;
    }

    const hashPick = await vscode.window.showQuickPick(
      [
        { label: "None / Plain Accounts", description: "Users without password hashes or with external providers", value: "none" },
        { label: "BCRYPT", description: "Standard Bcrypt hash algorithm", value: "BCRYPT" },
        { label: "SCRYPT (Firebase Default)", description: "Firebase default scrypt hash config", value: "SCRYPT" },
        { label: "PBKDF2_SHA256", description: "Standard PBKDF2 with SHA-256 rounds", value: "PBKDF2_SHA256" },
      ],
      { title: "Select Password Hash Algorithm for Import (Optional)" }
    );
    if (!hashPick) return;

    let importOptions: import("firebase-admin/auth").UserImportOptions | undefined = undefined;
    if (hashPick.value === "BCRYPT") {
      importOptions = { hash: { algorithm: "BCRYPT" } };
    } else if (hashPick.value === "SCRYPT") {
      importOptions = {
        hash: {
          algorithm: "SCRYPT",
          key: Buffer.from("secret_key"),
          saltSeparator: Buffer.from("Bw=="),
          rounds: 8,
          memoryCost: 14,
        },
      };
    } else if (hashPick.value === "PBKDF2_SHA256") {
      importOptions = {
        hash: {
          algorithm: "PBKDF2_SHA256",
          rounds: 10000,
        },
      };
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Importing ${usersToImport.length} users to Firebase Auth (${connectionId})...`,
        cancellable: false,
      },
      async () => {
        const res = await authService.importUsers(connectionId, usersToImport, importOptions);
        if (res.errors && res.errors.length > 0) {
          vscode.window.showWarningMessage(
            `Imported ${res.successCount} users. Encountered ${res.failureCount} error(s) (first error: ${res.errors[0].error.message})`
          );
        } else {
          vscode.window.showInformationMessage(
            `Successfully imported ${res.successCount} user(s) into Firebase Authentication!`
          );
        }
        if (explorerDataProvider) {
          explorerDataProvider.refresh();
        }
      }
    );
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to import users: ${err.message}`);
  }
}


import * as vscode from "vscode";
import { AuthService } from "./AuthService";
import { AuthUserItem, AuthUsersBranchItem, ConnectionTreeItem } from "../explorer/items";
import { ConnectionManager } from "../connections/ConnectionManager";
import ExplorerDataProvider from "../explorer/ExplorerDataProvider";
import { DocumentFileSystemProvider } from "../editor/DocumentFileSystemProvider";
import openPath from "../commands/openPath";

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

/**
 * Open Custom Claims editor for a specific user.
 */
export async function editAuthUserClaimsCommand(
  item?: AuthUserItem,
  explorerDataProvider?: ExplorerDataProvider
) {
  const authService = AuthService.getInstance();
  let connectionId = resolveConnectionId(item);
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
  let user = item?.user;

  if (!user) {
    const picked = await pickAuthUser(connectionId);
    if (!picked) {
      return;
    }
    user = picked;
  }

  // Ask for the profile collection name (defaults to "users")
  const collectionName = await vscode.window.showInputBox({
    title: `Create Profile Document for ${user.email || user.uid}`,
    prompt: "Collection to store user profiles in",
    value: "users",
    validateInput: (v) => (v.trim() ? undefined : "Collection name cannot be empty"),
  });

  if (!collectionName) {
    return;
  }

  try {
    const docPath = await authService.createProfileDoc(
      connectionId,
      user,
      collectionName.trim(),
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

  const collectionName = "users";
  const exists = await authService.checkProfileExists(connectionId, user.uid, collectionName);

  if (exists) {
    await openPath(`${collectionName}/${user.uid}`, connectionId);
  } else {
    const choice = await vscode.window.showWarningMessage(
      `No profile document exists at /${collectionName}/${user.uid}. Would you like to create one now?`,
      "Create Profile",
      "Cancel"
    );
    if (choice === "Create Profile") {
      await createAuthUserProfileCommand(item, explorerDataProvider, fsProvider);
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

  const dummyItem = new AuthUserItem(picked, connectionId);

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
  const hasProfile = await authService.checkProfileExists(sourceConnectionId, uid);

  const cloneProfileChoice = hasProfile
    ? await vscode.window.showQuickPick(
        [
          { label: "Clone User Account & Firestore Profile (/users)", cloneProfile: true },
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
 * Delete a user from Firebase Auth, with option to cascade-delete their Firestore profile document.
 */
export async function deleteAuthUserCommand(
  item?: AuthUserItem,
  explorerDataProvider?: ExplorerDataProvider,
  fsProvider?: DocumentFileSystemProvider
) {
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

  const hasProfile = await authService.checkProfileExists(connectionId, uid);

  // Present explicit confirmation options with safe cancel
  const deleteProfileOption = hasProfile
    ? "Delete Auth User & Profile Doc (/users)"
    : "Delete Auth User Only";

  const options = hasProfile
    ? [deleteProfileOption, "Delete Auth User Only", "Cancel"]
    : ["Delete Auth User Only", "Cancel"];

  const choice = await vscode.window.showWarningMessage(
    `Are you sure you want to permanently delete user '${userIdentifier}' (UID: ${uid})?` +
      (hasProfile ? " A Firestore profile document also exists at '/users/" + uid + "'." : ""),
    { modal: true },
    ...options
  );

  if (!choice || choice === "Cancel") {
    return;
  }

  const shouldDeleteProfile = choice.includes("Profile Doc");

  try {
    const result = await authService.deleteUserAndProfile(
      connectionId,
      uid,
      shouldDeleteProfile,
      "users",
      fsProvider
    );

    const msg = result.profileDeleted
      ? `Successfully deleted Auth user '${userIdentifier}' and associated Firestore profile doc.`
      : `Successfully deleted Auth user '${userIdentifier}'.`;

    vscode.window.showInformationMessage(msg);

    if (explorerDataProvider) {
      explorerDataProvider.refreshNode(item);
    }
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to delete user '${userIdentifier}': ${err.message}`);
  }
}

/**
 * Helper to display a quick pick list of Auth users for a connection.
 */
async function pickAuthUser(connectionId: string): Promise<import("firebase-admin/auth").UserRecord | undefined> {
  const authService = AuthService.getInstance();

  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Loading Firebase Auth users...",
      cancellable: false,
    },
    async () => {
      try {
        const { users } = await authService.listUsers(connectionId, 100);
        if (users.length === 0) {
          vscode.window.showInformationMessage("No users found in Firebase Authentication.");
          return undefined;
        }

        const items = users.map((u) => {
          const claims = u.customClaims || {};
          const claimsStr = Object.keys(claims).length > 0 ? JSON.stringify(claims) : "(no claims)";
          return {
            label: u.email || u.displayName || u.uid,
            description: `UID: ${u.uid}`,
            detail: `Claims: ${claimsStr} • ${u.disabled ? "Disabled" : "Active"}`,
            user: u,
          };
        });

        const selected = await vscode.window.showQuickPick(items, {
          placeHolder: "Select a Firebase Auth user",
          matchOnDescription: true,
          matchOnDetail: true,
        });

        return selected?.user;
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to fetch Auth users: ${err.message}`);
        return undefined;
      }
    }
  );
}

import * as vscode from "vscode";
import { AuthService } from "../auth/AuthService";
import { DocumentFileSystemProvider } from "../editor/DocumentFileSystemProvider";
import { getAuthUsersTableHtml } from "./authUsersTable/authUsersTableHtml";
import openPath from "../commands/openPath";

/**
 * Open the Firebase Authentication users in a fast tabular webview.
 * Fetches users in bulk (up to 1,000 per request) without lagging,
 * supports in-memory instant sorting by Creation Date (newest first),
 * real-time filtering, custom claims editing, and Firestore profile linking.
 */
export async function openAuthUsersAsTable(
  connectionId: string,
  fsProvider?: DocumentFileSystemProvider
) {
  const panel = vscode.window.createWebviewPanel(
    "firestoreAuthUsersTable",
    `Auth Users: ${connectionId}`,
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
    }
  );

  panel.webview.html = getAuthUsersTableHtml(connectionId);

  const authService = AuthService.getInstance();
  let currentNextPageToken: string | undefined = undefined;

  async function loadInitialBatch() {
    panel.webview.postMessage({ type: "setLoading", loading: true, text: "Loading Firebase Auth users (up to 1,000)..." });
    try {
      const result = await authService.listUsers(connectionId, 1000);
      currentNextPageToken = result.pageToken;

      const userSummaries = result.users.map((u) => ({
        uid: u.uid,
        email: u.email,
        displayName: u.displayName,
        photoURL: u.photoURL,
        disabled: u.disabled,
        emailVerified: u.emailVerified,
        customClaims: u.customClaims || {},
        metadata: {
          creationTime: u.metadata.creationTime,
          lastSignInTime: u.metadata.lastSignInTime,
        },
        hasProfileDoc: undefined, // Lazy checked
      }));

      panel.webview.postMessage({
        type: "setUsers",
        users: userSummaries,
        hasMore: !!result.pageToken,
        pageToken: result.pageToken,
      });
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to load Firebase Auth users: ${err.message}`);
      panel.webview.postMessage({ type: "setLoading", loading: false });
    }
  }

  async function loadMoreBatch() {
    if (!currentNextPageToken) {
      return;
    }
    panel.webview.postMessage({ type: "setLoading", loading: true, text: "Loading next batch of users..." });
    try {
      const result = await authService.listUsers(connectionId, 1000, currentNextPageToken);
      currentNextPageToken = result.pageToken;

      const userSummaries = result.users.map((u) => ({
        uid: u.uid,
        email: u.email,
        displayName: u.displayName,
        photoURL: u.photoURL,
        disabled: u.disabled,
        emailVerified: u.emailVerified,
        customClaims: u.customClaims || {},
        metadata: {
          creationTime: u.metadata.creationTime,
          lastSignInTime: u.metadata.lastSignInTime,
        },
        hasProfileDoc: undefined,
      }));

      panel.webview.postMessage({
        type: "appendUsers",
        users: userSummaries,
        hasMore: !!result.pageToken,
        pageToken: result.pageToken,
      });
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to load more users: ${err.message}`);
      panel.webview.postMessage({ type: "setLoading", loading: false });
    }
  }

  async function fetchAllUsers() {
    if (!currentNextPageToken) {
      vscode.window.showInformationMessage("All users are already loaded.");
      return;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Streaming all Firebase Auth users...",
        cancellable: true,
      },
      async (_progress, token) => {
        while (currentNextPageToken && !token.isCancellationRequested) {
          try {
            const result = await authService.listUsers(connectionId, 1000, currentNextPageToken);
            currentNextPageToken = result.pageToken;

            const userSummaries = result.users.map((u) => ({
              uid: u.uid,
              email: u.email,
              displayName: u.displayName,
              photoURL: u.photoURL,
              disabled: u.disabled,
              emailVerified: u.emailVerified,
              customClaims: u.customClaims || {},
              metadata: {
                creationTime: u.metadata.creationTime,
                lastSignInTime: u.metadata.lastSignInTime,
              },
              hasProfileDoc: undefined,
            }));

            panel.webview.postMessage({
              type: "appendUsers",
              users: userSummaries,
              hasMore: !!result.pageToken,
              pageToken: result.pageToken,
            });
          } catch (err: any) {
            vscode.window.showErrorMessage(`Error streaming users: ${err.message}`);
            break;
          }
        }
      }
    );
  }

  panel.webview.onDidReceiveMessage(async (msg) => {
    switch (msg.command) {
      case "ready":
      case "refresh":
        await loadInitialBatch();
        break;

      case "loadMore":
        await loadMoreBatch();
        break;

      case "fetchAll":
        await fetchAllUsers();
        break;

      case "checkProfile": {
        try {
          const exists = await authService.checkProfileExists(connectionId, msg.uid);
          panel.webview.postMessage({ type: "profileStatus", uid: msg.uid, exists });
        } catch (err: any) {
          vscode.window.showErrorMessage(`Failed to check profile for ${msg.uid}: ${err.message}`);
        }
        break;
      }

      case "editClaims": {
        try {
          const user = await authService.getUser(connectionId, msg.uid);
          const initial = JSON.stringify(user.customClaims || {}, null, 2);
          const input = await vscode.window.showInputBox({
            title: `Edit Claims for UID: ${user.uid}`,
            prompt: "Enter valid JSON for custom claims (roles, admin, etc.)",
            value: initial,
            validateInput: (val) => {
              try {
                const parsed = JSON.parse(val || "{}");
                if (typeof parsed !== "object" || Array.isArray(parsed)) {
                  return "Must be a JSON object (e.g. {\"admin\": true})";
                }
                return null;
              } catch (e: any) {
                return `Invalid JSON: ${e.message}`;
              }
            },
          });

          if (input !== undefined) {
            const parsed = JSON.parse(input || "{}");
            await authService.setCustomUserClaims(connectionId, user.uid, parsed);
            vscode.window.showInformationMessage(`Updated custom claims for ${user.email || user.uid}`);
            panel.webview.postMessage({
              type: "userUpdated",
              user: { uid: user.uid, customClaims: parsed },
            });
          }
        } catch (err: any) {
          vscode.window.showErrorMessage(`Failed to update claims: ${err.message}`);
        }
        break;
      }

      case "openProfile": {
        try {
          const user = await authService.getUser(connectionId, msg.uid);
          const exists = await authService.checkProfileExists(connectionId, user.uid);
          if (exists) {
            await openPath(`users/${user.uid}`, connectionId);
          } else {
            const choice = await vscode.window.showInformationMessage(
              `No Firestore document exists at 'users/${user.uid}'. Would you like to create it?`,
              "Create Profile",
              "Cancel"
            );
            if (choice === "Create Profile") {
              const createdPath = await authService.createProfileDoc(connectionId, user, "users", fsProvider);
              vscode.window.showInformationMessage(`Created Firestore profile at '${createdPath}'`);
              panel.webview.postMessage({ type: "profileStatus", uid: user.uid, exists: true });
              await openPath(createdPath, connectionId);
            }
          }
        } catch (err: any) {
          vscode.window.showErrorMessage(`Failed to open profile: ${err.message}`);
        }
        break;
      }

      case "toggleDisable": {
        try {
          const updated = await authService.updateUser(connectionId, msg.uid, {
            disabled: msg.disabled,
          });
          vscode.window.showInformationMessage(
            `User ${updated.email || updated.uid} is now ${updated.disabled ? "Disabled" : "Active"}`
          );
          panel.webview.postMessage({
            type: "userUpdated",
            user: { uid: updated.uid, disabled: updated.disabled },
          });
        } catch (err: any) {
          vscode.window.showErrorMessage(`Failed to update user: ${err.message}`);
        }
        break;
      }

      case "exportJson": {
        try {
          const jsonContent = JSON.stringify(msg.users || [], null, 2);
          const doc = await vscode.workspace.openTextDocument({
            content: jsonContent,
            language: "json",
          });
          await vscode.window.showTextDocument(doc);
        } catch (err: any) {
          vscode.window.showErrorMessage(`Failed to export users: ${err.message}`);
        }
        break;
      }
    }
  });
}

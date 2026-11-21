import * as vscode from "vscode";
import { AuthService } from "../auth/AuthService";
import { DocumentFileSystemProvider } from "../editor/DocumentFileSystemProvider";
import { getAuthUsersTableHtml } from "./authUsersTable/authUsersTableHtml";
import openPath from "../commands/openPath";
import {
  cloneAuthUserCommand,
  executeBulkDeleteAuthUsersFlow,
  executeDeleteAuthUserFlow,
  mintCustomTokenCommand,
} from "../auth/authCommands";
import { ConnectionManager } from "../connections/ConnectionManager";
import ExplorerDataProvider from "../explorer/ExplorerDataProvider";

/**
 * Open the Firebase Authentication users in a fast tabular webview.
 * Fetches users in bulk (up to 1,000 per request) without lagging,
 * supports in-memory instant sorting by Creation Date (newest first),
 * real-time filtering, custom claims editing, and Firestore profile linking.
 */
// Active auth users table panels registry to avoid duplicate webviews and memory retention
const activeAuthPanels = new Map<string, vscode.WebviewPanel>();

export async function openAuthUsersAsTable(
  connectionId: string,
  fsProvider?: DocumentFileSystemProvider,
  explorerDataProvider?: ExplorerDataProvider
) {
  const existingPanel = activeAuthPanels.get(connectionId);
  if (existingPanel) {
    existingPanel.reveal(vscode.ViewColumn.One);
    return;
  }

  const config = vscode.workspace.getConfiguration("ketrik-firestore-studio");
  const retainContextWhenHidden = config.get<boolean>("retainWebviewTabs", true);

  const panel = vscode.window.createWebviewPanel(
    "firestoreAuthUsersTable",
    `Auth Users: ${connectionId}`,
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden,
    }
  );
  activeAuthPanels.set(connectionId, panel);

  panel.webview.html = getAuthUsersTableHtml(connectionId);

  const authService = AuthService.getInstance();
  let currentNextPageToken: string | undefined = undefined;

  function getConnectionStatePayload() {
    const conn = ConnectionManager.getInstance().getConnection(connectionId);
    return {
      type: "connectionState",
      isReadOnly: !!conn?.readOnly,
      environment: conn?.environment,
      profileCollection: authService.getProfileCollection(connectionId),
    };
  }

  const connChangeSub = ConnectionManager.getInstance().onDidChangeConnections(() => {
    panel.webview.postMessage(getConnectionStatePayload());
  });
  const configChangeSub = vscode.workspace.onDidChangeConfiguration((e) => {
    if (
      e.affectsConfiguration("ketrik-firestore-studio.authProfileCollection") ||
      e.affectsConfiguration("ketrik-firestore-studio.connections")
    ) {
      panel.webview.postMessage(getConnectionStatePayload());
    }
  });

  function mapUsers(users: import("firebase-admin/auth").UserRecord[]) {
    return users.map((u) => {
      const creationMs = u.metadata?.creationTime ? Date.parse(u.metadata.creationTime) || 0 : 0;
      const lastSignInMs = u.metadata?.lastSignInTime ? Date.parse(u.metadata.lastSignInTime) || 0 : 0;
      return {
        uid: u.uid,
        email: u.email,
        displayName: u.displayName,
        photoURL: u.photoURL,
        disabled: u.disabled,
        emailVerified: u.emailVerified,
        phoneNumber: u.phoneNumber,
        customClaims: u.customClaims || {},
        providerData: (u.providerData || []).map((p) => ({
          providerId: p.providerId,
          uid: p.uid,
          email: p.email,
          displayName: p.displayName,
        })),
        multiFactor: u.multiFactor?.enrolledFactors?.map((f: any) => ({
          uid: f.uid,
          factorId: f.factorId,
          displayName: f.displayName,
          enrollmentTime: f.enrollmentTime,
          phoneNumber: f.phoneNumber,
        })) || [],
        metadata: {
          creationTime: u.metadata?.creationTime,
          lastSignInTime: u.metadata?.lastSignInTime,
          creationMs,
          lastSignInMs,
        },
        hasProfileDoc: undefined, // Lazy checked
      };
    });
  }

  async function loadInitialBatch() {
    panel.webview.postMessage({ type: "setLoading", loading: true, text: "Loading Firebase Auth users (up to 1,000)..." });
    try {
      const result = await authService.listUsers(connectionId, 1000);
      currentNextPageToken = result.pageToken;

      const state = getConnectionStatePayload();
      panel.webview.postMessage({
        type: "setUsers",
        users: mapUsers(result.users),
        hasMore: !!result.pageToken,
        pageToken: result.pageToken,
        isReadOnly: state.isReadOnly,
        environment: state.environment,
        profileCollection: state.profileCollection,
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

      panel.webview.postMessage({
        type: "appendUsers",
        users: mapUsers(result.users),
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

            panel.webview.postMessage({
              type: "appendUsers",
              users: mapUsers(result.users),
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

  const messageSubscription = panel.webview.onDidReceiveMessage(async (msg) => {
    switch (msg.command) {
      case "ready":
        panel.webview.postMessage(getConnectionStatePayload());
        await loadInitialBatch();
        break;
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
          const profile = await authService.inspectProfile(connectionId, msg.uid);
          panel.webview.postMessage({
            type: "profileStatus",
            uid: msg.uid,
            exists: profile.exists || profile.hasSubcollections,
            docPath: profile.docPath,
          });
        } catch (err: any) {
          vscode.window.showErrorMessage(`Failed to check profile for ${msg.uid}: ${err.message}`);
        }
        break;
      }

      case "editClaims": {
        if (!ConnectionManager.getInstance().ensureWritable(connectionId, "edit user custom claims")) {
          break;
        }
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
          const profile = await authService.inspectProfile(connectionId, user.uid);
          if (profile.exists || profile.hasSubcollections) {
            panel.webview.postMessage({
              type: "profileStatus",
              uid: user.uid,
              exists: true,
              docPath: profile.docPath,
            });
            await openPath(profile.docPath, connectionId);
          } else {
            const conn = ConnectionManager.getInstance().getConnection(connectionId);
            panel.webview.postMessage({
              type: "profileStatus",
              uid: user.uid,
              exists: false,
              docPath: profile.docPath,
            });
            if (conn?.readOnly) {
              vscode.window.showWarningMessage(
                `No Firestore document exists at '${profile.docPath}' (Connection '${conn.name}' is in Read-Only mode).`
              );
              break;
            }
            const choice = await vscode.window.showInformationMessage(
              `No Firestore document exists at '${profile.docPath}'. Would you like to create it?`,
              "Create Profile",
              "Cancel"
            );
            if (choice === "Create Profile") {
              if (!ConnectionManager.getInstance().ensureWritable(connectionId, "create user profile document")) {
                break;
              }
              const createdPath = await authService.createProfileDoc(
                connectionId,
                user,
                profile.collectionName,
                fsProvider
              );
              vscode.window.showInformationMessage(`Created Firestore profile at '${createdPath}'`);
              panel.webview.postMessage({
                type: "profileStatus",
                uid: user.uid,
                exists: true,
                docPath: createdPath,
              });
              await openPath(createdPath, connectionId);
            }
          }
        } catch (err: any) {
          vscode.window.showErrorMessage(`Failed to open profile: ${err.message}`);
        }
        break;
      }

      case "cloneUser": {
        try {
          const user = await authService.getUser(connectionId, msg.uid);
          const dummyItem = { user, connectionId } as any;
          await cloneAuthUserCommand(dummyItem, undefined, fsProvider);
        } catch (err: any) {
          vscode.window.showErrorMessage(`Failed to clone user: ${err.message}`);
        }
        break;
      }

      case "mintToken": {
        try {
          const user = await authService.getUser(connectionId, msg.uid);
          const dummyItem = { user, connectionId } as any;
          await mintCustomTokenCommand(dummyItem);
        } catch (err: any) {
          vscode.window.showErrorMessage(`Failed to mint custom token: ${err.message}`);
        }
        break;
      }

      case "toggleDisable": {
        if (!ConnectionManager.getInstance().ensureWritable(connectionId, "toggle user disabled status")) {
          break;
        }
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

      case "resetPassword": {
        try {
          let email = msg.email;
          if (!email) {
            const user = await authService.getUser(connectionId, msg.uid);
            email = user.email;
          }
          if (!email) {
            vscode.window.showWarningMessage(`User '${msg.uid}' has no email address associated with their account.`);
            break;
          }
          const link = await authService.generatePasswordResetLink(connectionId, email);
          await vscode.env.clipboard.writeText(link);
          const copyChoice = await vscode.window.showInformationMessage(
            `Password reset link generated for ${email} and copied to clipboard!`,
            "Open Link in Browser"
          );
          if (copyChoice === "Open Link in Browser") {
            await vscode.env.openExternal(vscode.Uri.parse(link));
          }
        } catch (err: any) {
          vscode.window.showErrorMessage(`Failed to generate password reset link: ${err.message}`);
        }
        break;
      }

      case "generateVerificationLink": {
        try {
          let email = msg.email;
          if (!email) {
            const user = await authService.getUser(connectionId, msg.uid);
            email = user.email;
          }
          if (!email) {
            vscode.window.showWarningMessage(`User '${msg.uid}' has no email address associated with their account.`);
            break;
          }
          const link = await authService.generateEmailVerificationLink(connectionId, email);
          await vscode.env.clipboard.writeText(link);
          const copyChoice = await vscode.window.showInformationMessage(
            `Email verification link generated for ${email} and copied to clipboard!`,
            "Open Link in Browser"
          );
          if (copyChoice === "Open Link in Browser") {
            await vscode.env.openExternal(vscode.Uri.parse(link));
          }
        } catch (err: any) {
          vscode.window.showErrorMessage(`Failed to generate email verification link: ${err.message}`);
        }
        break;
      }

      case "generateSignInLink": {
        try {
          let email = msg.email;
          if (!email) {
            const user = await authService.getUser(connectionId, msg.uid);
            email = user.email;
          }
          if (!email) {
            vscode.window.showWarningMessage(`User '${msg.uid}' has no email address associated with their account.`);
            break;
          }
          const redirectUrl = await vscode.window.showInputBox({
            title: `Generate Passwordless Sign-in Link for ${email}`,
            prompt: "Enter continue/redirect URL for the sign-in completion flow",
            value: "http://localhost:3000/finishSignIn",
            placeHolder: "https://your-app.com/finishSignIn",
          });
          if (redirectUrl === undefined) break;

          const link = await authService.generateSignInWithEmailLink(connectionId, email, {
            url: redirectUrl.trim() || "http://localhost:3000/finishSignIn",
            handleCodeInApp: true,
          });
          await vscode.env.clipboard.writeText(link);
          const copyChoice = await vscode.window.showInformationMessage(
            `Passwordless sign-in link generated for ${email} and copied to clipboard!`,
            "Open Link in Browser"
          );
          if (copyChoice === "Open Link in Browser") {
            await vscode.env.openExternal(vscode.Uri.parse(link));
          }
        } catch (err: any) {
          vscode.window.showErrorMessage(`Failed to generate sign-in link: ${err.message}`);
        }
        break;
      }

      case "importUsersWizard": {
        if (!ConnectionManager.getInstance().ensureWritable(connectionId, "import auth users")) {
          break;
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
          if (!files || files.length === 0) break;

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
            // Basic CSV parser
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
            break;
          }

          // Optional hash algorithm picker
          const hashPick = await vscode.window.showQuickPick(
            [
              { label: "None / Plain Accounts", description: "Users without password hashes or with external providers", value: "none" },
              { label: "BCRYPT", description: "Standard Bcrypt hash support", value: "BCRYPT" },
              { label: "SCRYPT (Firebase / Standard)", description: "Firebase default scrypt hash config", value: "SCRYPT" },
              { label: "PBKDF2_SHA256", description: "Standard PBKDF2 with SHA-256 rounds", value: "PBKDF2_SHA256" },
            ],
            { title: "Select Password Hash Algorithm for Import (Optional)" }
          );
          if (!hashPick) break;

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
              title: `Importing ${usersToImport.length} users to Firebase Auth...`,
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
              // Reload table
              await loadInitialBatch();
            }
          );
        } catch (err: any) {
          vscode.window.showErrorMessage(`Failed to import users: ${err.message}`);
        }
        break;
      }

      case "deleteUser": {
        const res = await executeDeleteAuthUserFlow({
          connectionId,
          uid: msg.uid,
          userIdentifier: msg.email || msg.uid,
          explorerDataProvider,
          fsProvider,
        });
        if (res.authDeleted) {
          panel.webview.postMessage({
            type: "userDeleted",
            uid: msg.uid,
          });
        } else if (res.profileDeleted) {
          panel.webview.postMessage({
            type: "profileStatus",
            uid: msg.uid,
            exists: false,
          });
        }
        break;
      }

      case "deleteSelectedUsers": {
        const uids = Array.isArray(msg.uids) ? msg.uids : [];
        if (uids.length === 0) {
          break;
        }
        const res = await executeBulkDeleteAuthUsersFlow({
          connectionId,
          uids,
          explorerDataProvider,
          fsProvider,
        });
        if (res.deletedUids.length > 0) {
          panel.webview.postMessage({
            type: "usersDeleted",
            uids: res.deletedUids,
          });
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

  panel.onDidDispose(() => {
    activeAuthPanels.delete(connectionId);
    messageSubscription.dispose();
    connChangeSub.dispose();
    configChangeSub.dispose();
  });
}

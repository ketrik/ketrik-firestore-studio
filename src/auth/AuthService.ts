import * as vscode from "vscode";
import { UserRecord } from "firebase-admin/auth";
import { ConnectionManager } from "../connections/ConnectionManager";
import { DocumentFileSystemProvider } from "../editor/DocumentFileSystemProvider";
import { CostService } from "../cost/costService";
import { recursiveDeleteWithCount } from "../utils/deleteUtils";

export interface UserProfileInspection {
  exists: boolean;
  hasSubcollections: boolean;
  subcollectionIds: string[];
  data?: Record<string, any>;
  collectionName: string;
  docPath: string;
  additionalDocPaths?: string[];
  matchedByUidField?: boolean;
}

export interface DeleteUserAndProfileResult {
  authDeleted: boolean;
  profileDeleted: boolean;
  deletedProfileDocsCount: number;
  subcollectionsDeleted: boolean;
  profileError?: string;
}

export interface BulkDeleteAuthUsersResult {
  deletedUids: string[];
  authFailed: Array<{ uid: string; error: string }>;
  profilesDeletedCount: number;
  deletedProfileDocsCount: number;
  profileErrors: Array<{ uid: string; error: string }>;
  profileCollection: string;
}

export interface UserSummary {
  uid: string;
  email?: string;
  displayName?: string;
  photoURL?: string;
  disabled: boolean;
  customClaims?: Record<string, any>;
  hasProfileDoc?: boolean;
}

export class AuthService {
  private static instance: AuthService;

  public static getInstance(): AuthService {
    if (!AuthService.instance) {
      AuthService.instance = new AuthService();
    }
    return AuthService.instance;
  }

  private normalizeCollectionPath(raw?: string): string {
    return (raw || "").trim().replace(/^\/+|\/+$/g, "");
  }

  /**
   * Resolve the configured Firestore collection path for Auth user profiles.
   * Checks per-connection override first, then workspace setting, defaulting to "users".
   */
  public getProfileCollection(connectionId?: string): string {
    if (connectionId) {
      const connColl = this.normalizeCollectionPath(
        ConnectionManager.getInstance().getConnection(connectionId)?.authProfileCollection
      );
      if (connColl) {
        return connColl;
      }
    }
    const wsColl = this.normalizeCollectionPath(
      vscode.workspace
        .getConfiguration("ketrik-firestore-studio")
        .get<string>("authProfileCollection", "users")
    );
    return wsColl || "users";
  }

  /**
   * List users from Firebase Auth for a connection (up to maxResults).
   */
  public async listUsers(
    connectionId: string,
    maxResults = 50,
    pageToken?: string
  ): Promise<{ users: UserRecord[]; pageToken?: string }> {
    return ConnectionManager.getInstance().withAuth(connectionId, async (auth) => {
      const result = await auth.listUsers(maxResults, pageToken);
      return {
        users: result.users,
        pageToken: result.pageToken,
      };
    });
  }

  /**
   * Get a single user by UID.
   */
  public async getUser(connectionId: string, uid: string): Promise<UserRecord> {
    return ConnectionManager.getInstance().withAuth(connectionId, (auth) => auth.getUser(uid));
  }

  /**
   * Get a single user by email address.
   */
  public async getUserByEmail(connectionId: string, email: string): Promise<UserRecord> {
    return ConnectionManager.getInstance().withAuth(connectionId, (auth) => auth.getUserByEmail(email));
  }

  /**
   * Lookup a user by email or UID, returning undefined if not found.
   */
  public async findUserByEmailOrUid(connectionId: string, query: string): Promise<UserRecord | undefined> {
    const trimmed = query.trim();
    if (!trimmed) {
      return undefined;
    }

    const isNotFoundOrInvalid = (err: any): boolean => {
      const code = err?.code || "";
      return (
        code === "auth/user-not-found" ||
        code === "auth/invalid-email" ||
        code === "auth/invalid-uid"
      );
    };

    const lookups: Array<() => Promise<UserRecord>> = trimmed.includes("@")
      ? [
          () => this.getUserByEmail(connectionId, trimmed),
          () => this.getUser(connectionId, trimmed),
        ]
      : [
          () => this.getUser(connectionId, trimmed),
          () => this.getUserByEmail(connectionId, trimmed),
        ];

    for (const attempt of lookups) {
      try {
        return await attempt();
      } catch (err: any) {
        if (isNotFoundOrInvalid(err)) {
          continue;
        }
        throw err;
      }
    }
    return undefined;
  }

  /**
   * Set custom claims for a user (e.g., { admin: true, role: "editor" }).
   */
  public async setCustomUserClaims(
    connectionId: string,
    uid: string,
    customClaims: Record<string, any> | null
  ): Promise<void> {
    ConnectionManager.getInstance().throwIfReadOnly(connectionId, "update user custom claims");
    return ConnectionManager.getInstance().withAuth(connectionId, (auth) =>
      auth.setCustomUserClaims(uid, customClaims)
    );
  }

  /**
   * Update properties of an existing user (e.g. disabled status, displayName).
   */
  public async updateUser(
    connectionId: string,
    uid: string,
    properties: import("firebase-admin/auth").UpdateRequest
  ): Promise<UserRecord> {
    ConnectionManager.getInstance().throwIfReadOnly(connectionId, "update auth user");
    return ConnectionManager.getInstance().withAuth(connectionId, (auth) =>
      auth.updateUser(uid, properties)
    );
  }

  /**
   * Delete an existing user.
   */
  public async deleteUser(connectionId: string, uid: string): Promise<void> {
    ConnectionManager.getInstance().throwIfReadOnly(connectionId, "delete auth user");
    return ConnectionManager.getInstance().withAuth(connectionId, (auth) => auth.deleteUser(uid));
  }

  /**
   * Bulk delete Firebase Auth users using auth.deleteUsers() (up to 1,000 per RPC).
   */
  public async deleteUsers(
    connectionId: string,
    uids: string[]
  ): Promise<{ deletedUids: string[]; failed: Array<{ uid: string; error: string }> }> {
    ConnectionManager.getInstance().throwIfReadOnly(connectionId, "bulk delete auth users");
    const uniqueUids = Array.from(
      new Set(uids.map((u) => String(u || "").trim()).filter((u) => u.length > 0))
    );
    if (uniqueUids.length === 0) {
      return { deletedUids: [], failed: [] };
    }

    const deletedUids: string[] = [];
    const failed: Array<{ uid: string; error: string }> = [];
    const chunkSize = 1000;

    for (let i = 0; i < uniqueUids.length; i += chunkSize) {
      const chunk = uniqueUids.slice(i, i + chunkSize);
      const res = await ConnectionManager.getInstance().withAuth(connectionId, (auth) =>
        auth.deleteUsers(chunk)
      );
      const failedByIndex = new Map<number, string>();
      for (const err of res.errors || []) {
        failedByIndex.set(err.index, err.error?.message || "Unknown error");
      }
      for (let idx = 0; idx < chunk.length; idx++) {
        const errMsg = failedByIndex.get(idx);
        if (errMsg !== undefined) {
          failed.push({ uid: chunk[idx], error: errMsg });
        } else {
          deletedUids.push(chunk[idx]);
        }
      }
    }

    return { deletedUids, failed };
  }

  /**
   * Generate a password reset link for a user's email.
   */
  public async generatePasswordResetLink(connectionId: string, email: string): Promise<string> {
    return ConnectionManager.getInstance().withAuth(connectionId, (auth) =>
      auth.generatePasswordResetLink(email)
    );
  }

  /**
   * Generate an email verification link for a user's email.
   */
  public async generateEmailVerificationLink(connectionId: string, email: string): Promise<string> {
    return ConnectionManager.getInstance().withAuth(connectionId, (auth) =>
      auth.generateEmailVerificationLink(email)
    );
  }

  /**
   * Generate a passwordless email sign-in link (email link authentication).
   */
  public async generateSignInWithEmailLink(
    connectionId: string,
    email: string,
    actionCodeSettings?: import("firebase-admin/auth").ActionCodeSettings
  ): Promise<string> {
    const settings: import("firebase-admin/auth").ActionCodeSettings = actionCodeSettings || {
      url: "https://localhost:3000/finishSignUp",
      handleCodeInApp: true,
    };
    return ConnectionManager.getInstance().withAuth(connectionId, (auth) =>
      auth.generateSignInWithEmailLink(email, settings)
    );
  }

  /**
   * Bulk import users with optional password hash configuration (SCRYPT, BCRYPT, PBKDF2, HMAC).
   */
  public async importUsers(
    connectionId: string,
    users: import("firebase-admin/auth").UserImportRecord[],
    options?: import("firebase-admin/auth").UserImportOptions
  ): Promise<import("firebase-admin/auth").UserImportResult> {
    ConnectionManager.getInstance().throwIfReadOnly(connectionId, "import auth users");
    return ConnectionManager.getInstance().withAuth(connectionId, (auth) =>
      auth.importUsers(users, options)
    );
  }

  /**
   * Mint a custom JWT auth token for a user.
   */
  public async createCustomToken(
    connectionId: string,
    uid: string,
    developerClaims?: Record<string, any>
  ): Promise<string> {
    return ConnectionManager.getInstance().withAuth(connectionId, (auth) =>
      auth.createCustomToken(uid, developerClaims)
    );
  }

  /**
   * Revoke all active refresh tokens for a user (forces logout across devices).
   */
  public async revokeRefreshTokens(connectionId: string, uid: string): Promise<void> {
    ConnectionManager.getInstance().throwIfReadOnly(connectionId, "revoke user refresh tokens");
    return ConnectionManager.getInstance().withAuth(connectionId, (auth) =>
      auth.revokeRefreshTokens(uid)
    );
  }

  /**
   * Clone a user from a source connection to a target connection.
   * Copies Auth properties, custom claims, and optionally the Firestore profile document.
   */
  public async cloneUserToConnection(
    sourceConnectionId: string,
    targetConnectionId: string,
    uid: string,
    options: {
      cloneProfile?: boolean;
      collectionName?: string;
      generateResetLink?: boolean;
    } = {},
    fsProvider?: DocumentFileSystemProvider
  ): Promise<{
    user: UserRecord;
    profileCloned: boolean;
    resetLink?: string;
  }> {
    ConnectionManager.getInstance().throwIfReadOnly(targetConnectionId, "clone user to target connection");
    const sourceUser = await this.getUser(sourceConnectionId, uid);

    // Create user in target Auth instance
    let targetUser: UserRecord;
    try {
      targetUser = await this.createUser(
        targetConnectionId,
        {
          uid: sourceUser.uid,
          email: sourceUser.email,
          emailVerified: sourceUser.emailVerified,
          displayName: sourceUser.displayName,
          photoURL: sourceUser.photoURL,
          phoneNumber: sourceUser.phoneNumber,
          disabled: sourceUser.disabled,
        },
        sourceUser.customClaims && Object.keys(sourceUser.customClaims).length > 0
          ? sourceUser.customClaims
          : undefined
      );
    } catch (err: any) {
      if (err.code === "auth/uid-already-exists" || err.code === "auth/email-already-exists") {
        // User already exists in target; update properties
        targetUser = await this.updateUser(targetConnectionId, sourceUser.uid, {
          email: sourceUser.email,
          emailVerified: sourceUser.emailVerified,
          displayName: sourceUser.displayName,
          photoURL: sourceUser.photoURL,
          phoneNumber: sourceUser.phoneNumber,
          disabled: sourceUser.disabled,
        });
        if (sourceUser.customClaims && Object.keys(sourceUser.customClaims).length > 0) {
          await this.setCustomUserClaims(targetConnectionId, sourceUser.uid, sourceUser.customClaims);
        }
      } else {
        throw err;
      }
    }

    // Optionally clone Firestore profile document
    let profileCloned = false;
    const sourceColl =
      this.normalizeCollectionPath(options.collectionName) ||
      this.getProfileCollection(sourceConnectionId);
    const targetColl =
      this.normalizeCollectionPath(options.collectionName) ||
      this.getProfileCollection(targetConnectionId);
    if (options.cloneProfile) {
      const sourceFirestore = await ConnectionManager.getInstance().getFirestore(sourceConnectionId);
      const targetFirestore = await ConnectionManager.getInstance().getFirestore(targetConnectionId);
      const sourceDoc = await sourceFirestore.collection(sourceColl).doc(uid).get();

      if (sourceDoc.exists) {
        await targetFirestore.collection(targetColl).doc(uid).set(sourceDoc.data() || {}, { merge: true });
        profileCloned = true;
        if (fsProvider) {
          fsProvider.invalidateAndNotify(targetConnectionId, `${targetColl}/${uid}`);
        }
      }
    }

    // Optionally generate a password reset link on target connection
    let resetLink: string | undefined = undefined;
    if (options.generateResetLink && sourceUser.email) {
      try {
        resetLink = await this.generatePasswordResetLink(targetConnectionId, sourceUser.email);
      } catch {
        // Non-critical, ignore if reset link generation fails
      }
    }

    return { user: targetUser, profileCloned, resetLink };
  }

  /**
   * Inspect a user's Firestore profile document and its subcollections.
   * Checks `${coll}/${uid}` first, then runs a bounded fallback query (`where("uid", "==", uid).limit(5)`).
   */
  public async inspectProfile(
    connectionId: string,
    uid: string,
    collectionName?: string
  ): Promise<UserProfileInspection> {
    const coll = this.normalizeCollectionPath(collectionName) || this.getProfileCollection(connectionId);
    const firestore = await ConnectionManager.getInstance().getFirestore(connectionId);
    const docRef = firestore.collection(coll).doc(uid);
    const [doc, subcollections] = await Promise.all([docRef.get(), docRef.listCollections()]);
    CostService.getInstance().recordOperation(connectionId, "read", 1);

    if (doc.exists || subcollections.length > 0) {
      return {
        exists: doc.exists,
        hasSubcollections: subcollections.length > 0,
        subcollectionIds: subcollections.map((s) => s.id),
        data: doc.exists ? doc.data() : undefined,
        collectionName: coll,
        docPath: docRef.path,
        matchedByUidField: false,
      };
    }

    try {
      const querySnap = await firestore
        .collection(coll)
        .where("uid", "==", uid)
        .limit(5)
        .get();

      if (!querySnap.empty) {
        CostService.getInstance().recordOperation(connectionId, "read", querySnap.size);
        const subcollectionLists = await Promise.all(
          querySnap.docs.map((d) => d.ref.listCollections())
        );
        const subIdSet = new Set<string>();
        for (const list of subcollectionLists) {
          for (const sub of list) {
            subIdSet.add(sub.id);
          }
        }
        const primaryDoc = querySnap.docs[0];
        const data =
          querySnap.docs.length === 1
            ? primaryDoc.data()
            : Object.fromEntries(querySnap.docs.map((d, i) => [d.id || `match_${i}`, d.data()]));
        const additionalDocPaths =
          querySnap.docs.length > 1 ? querySnap.docs.slice(1).map((d) => d.ref.path) : undefined;

        return {
          exists: true,
          hasSubcollections: subIdSet.size > 0,
          subcollectionIds: Array.from(subIdSet),
          data,
          collectionName: coll,
          docPath: primaryDoc.ref.path,
          additionalDocPaths,
          matchedByUidField: true,
        };
      }
    } catch {
      // Fallback query failed; treat as missing
    }

    return {
      exists: false,
      hasSubcollections: false,
      subcollectionIds: [],
      collectionName: coll,
      docPath: docRef.path,
      matchedByUidField: false,
    };
  }

  /**
   * Check if a profile document (or phantom profile container with subcollections) exists in Firestore.
   */
  public async checkProfileExists(
    connectionId: string,
    uid: string,
    collectionName?: string
  ): Promise<boolean> {
    const coll = this.normalizeCollectionPath(collectionName) || this.getProfileCollection(connectionId);
    const firestore = await ConnectionManager.getInstance().getFirestore(connectionId);
    const docRef = firestore.collection(coll).doc(uid);
    const doc = await docRef.get();
    CostService.getInstance().recordOperation(connectionId, "read", 1);
    if (doc.exists) {
      return true;
    }
    const subcollections = await docRef.listCollections();
    return subcollections.length > 0;
  }

  /**
   * Check if profile documents exist in Firestore for a batch of UIDs in a single round-trip.
   * Uses firestore.getAll(...) batch RPC rather than serial/concurrent get() calls.
   */
  public async checkProfilesExist(
    connectionId: string,
    uids: string[],
    collectionName?: string
  ): Promise<Set<string>> {
    if (!uids || uids.length === 0) {
      return new Set();
    }
    const coll = this.normalizeCollectionPath(collectionName) || this.getProfileCollection(connectionId);
    const firestore = await ConnectionManager.getInstance().getFirestore(connectionId);
    const existingUids = new Set<string>();

    // Chunk in groups of up to 400 (well within Firestore getAll RPC limits)
    const chunkSize = 400;
    for (let i = 0; i < uids.length; i += chunkSize) {
      const chunk = uids.slice(i, i + chunkSize);
      const refs = chunk.map((uid) => firestore.collection(coll).doc(uid));
      try {
        const snapshots = await firestore.getAll(...refs);
        CostService.getInstance().recordOperation(
          connectionId,
          "read",
          snapshots.filter((s) => s.exists).length
        );
        for (const snap of snapshots) {
          if (snap.exists) {
            existingUids.add(snap.id);
          }
        }
      } catch {
        // Fallback to individual checks if batch RPC fails
        await Promise.all(
          chunk.map(async (uid) => {
            const snap = await firestore.collection(coll).doc(uid).get();
            if (snap.exists) {
              CostService.getInstance().recordOperation(connectionId, "read", 1);
              existingUids.add(uid);
            }
          })
        );
      }
    }
    return existingUids;
  }

  /**
   * Create a Firestore profile document for an Auth user.
   */
  public async createProfileDoc(
    connectionId: string,
    user: UserRecord,
    collectionName?: string,
    fsProvider?: DocumentFileSystemProvider
  ): Promise<string> {
    ConnectionManager.getInstance().throwIfReadOnly(connectionId, "create user profile document");
    const coll = this.normalizeCollectionPath(collectionName) || this.getProfileCollection(connectionId);
    const firestore = await ConnectionManager.getInstance().getFirestore(connectionId);
    const docRef = firestore.collection(coll).doc(user.uid);

    const profileData = {
      uid: user.uid,
      email: user.email || null,
      displayName: user.displayName || null,
      photoURL: user.photoURL || null,
      disabled: user.disabled,
      emailVerified: user.emailVerified,
      roles: user.customClaims?.roles || (user.customClaims?.admin ? ["admin"] : ["user"]),
      customClaims: user.customClaims || {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await docRef.set(profileData, { merge: true });

    if (fsProvider) {
      fsProvider.invalidateAndNotify(connectionId, docRef.path);
    }

    return docRef.path;
  }

  /**
   * Delete a Firestore profile document (and optionally all nested subcollections) if it exists.
   */
  public async deleteProfileDoc(
    connectionId: string,
    uid: string,
    collectionName?: string,
    fsProvider?: DocumentFileSystemProvider,
    deepDelete = true,
    explicitDocPaths?: string[]
  ): Promise<{ deleted: boolean; deletedDocsCount: number; subcollectionsDeleted: boolean }> {
    ConnectionManager.getInstance().throwIfReadOnly(connectionId, "delete user profile document");
    const coll = this.normalizeCollectionPath(collectionName) || this.getProfileCollection(connectionId);
    const firestore = await ConnectionManager.getInstance().getFirestore(connectionId);
    const targetPaths =
      explicitDocPaths && explicitDocPaths.length > 0
        ? Array.from(
            new Set(explicitDocPaths.map((p) => p.replace(/^\/+|\/+$/g, "")).filter(Boolean))
          )
        : [`${coll}/${uid}`];

    const targetFs = fsProvider ?? DocumentFileSystemProvider.getInstance();
    let deleted = false;
    let deletedDocsCount = 0;
    let subcollectionsDeleted = false;

    for (const docPath of targetPaths) {
      const docRef = firestore.doc(docPath);
      const [doc, subcollections] = await Promise.all([docRef.get(), docRef.listCollections()]);
      CostService.getInstance().recordOperation(connectionId, "read", 1);

      if (!doc.exists && subcollections.length === 0) {
        continue;
      }

      if (deepDelete && subcollections.length > 0) {
        const count = await recursiveDeleteWithCount(firestore, docRef, connectionId);
        targetFs.invalidateAndNotifyDocumentDeleted(connectionId, docPath, true);
        deleted = true;
        deletedDocsCount += count;
        subcollectionsDeleted = true;
      } else if (doc.exists) {
        await docRef.delete();
        CostService.getInstance().recordOperation(connectionId, "delete", 1);
        targetFs.invalidateAndNotifyDocumentDeleted(connectionId, docPath, false);
        deleted = true;
        deletedDocsCount += 1;
      }
    }

    return { deleted, deletedDocsCount, subcollectionsDeleted };
  }

  /**
   * Delete a Firebase Auth user and optionally their Firestore profile document (including subcollections).
   * Deletes the Auth user first so access is revoked immediately and Auth failures leave the profile intact.
   */
  public async deleteUserAndProfile(
    connectionId: string,
    uid: string,
    deleteProfile = true,
    collectionName?: string,
    fsProvider?: DocumentFileSystemProvider,
    deepDeleteProfile = true,
    explicitProfileDocPaths?: string[]
  ): Promise<DeleteUserAndProfileResult> {
    ConnectionManager.getInstance().throwIfReadOnly(connectionId, "delete auth user and profile");
    const coll = this.normalizeCollectionPath(collectionName) || this.getProfileCollection(connectionId);

    await this.deleteUser(connectionId, uid);

    if (!deleteProfile) {
      return {
        authDeleted: true,
        profileDeleted: false,
        deletedProfileDocsCount: 0,
        subcollectionsDeleted: false,
      };
    }

    try {
      const res = await this.deleteProfileDoc(
        connectionId,
        uid,
        coll,
        fsProvider,
        deepDeleteProfile,
        explicitProfileDocPaths
      );
      return {
        authDeleted: true,
        profileDeleted: res.deleted,
        deletedProfileDocsCount: res.deletedDocsCount,
        subcollectionsDeleted: res.subcollectionsDeleted,
      };
    } catch (err: any) {
      return {
        authDeleted: true,
        profileDeleted: false,
        deletedProfileDocsCount: 0,
        subcollectionsDeleted: false,
        profileError: err?.message || String(err),
      };
    }
  }

  /**
   * Bulk delete Firebase Auth users and optionally their direct `${coll}/${uid}` Firestore profiles (+ subcollections).
   * Deletes Auth accounts first via auth.deleteUsers(), then deletes profiles for successfully deleted UIDs
   * in bounded concurrency chunks.
   */
  public async deleteUsersAndProfiles(
    connectionId: string,
    uids: string[],
    deleteProfiles = true,
    collectionName?: string,
    fsProvider?: DocumentFileSystemProvider,
    deepDeleteProfiles = true,
    onProgress?: (completed: number, total: number) => void
  ): Promise<BulkDeleteAuthUsersResult> {
    ConnectionManager.getInstance().throwIfReadOnly(connectionId, "bulk delete auth users");
    const profileCollection =
      this.normalizeCollectionPath(collectionName) || this.getProfileCollection(connectionId);

    const { deletedUids, failed: authFailed } = await this.deleteUsers(connectionId, uids);

    let profilesDeletedCount = 0;
    let deletedProfileDocsCount = 0;
    const profileErrors: Array<{ uid: string; error: string }> = [];

    if (deleteProfiles && deletedUids.length > 0) {
      const concurrency = 5;
      let completed = 0;
      for (let i = 0; i < deletedUids.length; i += concurrency) {
        const batch = deletedUids.slice(i, i + concurrency);
        await Promise.all(
          batch.map(async (uid) => {
            try {
              const res = await this.deleteProfileDoc(
                connectionId,
                uid,
                profileCollection,
                fsProvider,
                deepDeleteProfiles
              );
              if (res.deleted) {
                profilesDeletedCount += 1;
                deletedProfileDocsCount += res.deletedDocsCount;
              }
            } catch (err: any) {
              profileErrors.push({ uid, error: err?.message || String(err) });
            } finally {
              completed += 1;
              onProgress?.(completed, deletedUids.length);
            }
          })
        );
      }
    }

    return {
      deletedUids,
      authFailed,
      profilesDeletedCount,
      deletedProfileDocsCount,
      profileErrors,
      profileCollection,
    };
  }

  /**
   * Create a new Firebase Auth user.
   */
  public async createUser(
    connectionId: string,
    properties: import("firebase-admin/auth").CreateRequest,
    customClaims?: Record<string, any>
  ): Promise<UserRecord> {
    ConnectionManager.getInstance().throwIfReadOnly(connectionId, "create auth user");
    return ConnectionManager.getInstance().withAuth(connectionId, async (auth) => {
      const user = await auth.createUser(properties);
      if (customClaims && Object.keys(customClaims).length > 0) {
        await auth.setCustomUserClaims(user.uid, customClaims);
      }
      return user;
    });
  }

  /**
   * Get project auth configuration (authorized domains, etc.).
   */
  public async getProjectConfig(connectionId: string): Promise<import("firebase-admin/auth").ProjectConfig> {
    return ConnectionManager.getInstance().withAuth(connectionId, (auth) =>
      auth.projectConfigManager().getProjectConfig()
    );
  }

  /**
   * Update project auth configuration.
   */
  public async updateProjectConfig(
    connectionId: string,
    config: import("firebase-admin/auth").UpdateProjectConfigRequest
  ): Promise<import("firebase-admin/auth").ProjectConfig> {
    ConnectionManager.getInstance().throwIfReadOnly(connectionId, "update project auth configuration");
    return ConnectionManager.getInstance().withAuth(connectionId, (auth) =>
      auth.projectConfigManager().updateProjectConfig(config)
    );
  }
}

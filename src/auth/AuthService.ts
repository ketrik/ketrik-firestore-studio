import { UserRecord } from "firebase-admin/auth";
import { ConnectionManager } from "../connections/ConnectionManager";
import { DocumentFileSystemProvider } from "../editor/DocumentFileSystemProvider";

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
   * Set custom claims for a user (e.g., { admin: true, role: "editor" }).
   */
  public async setCustomUserClaims(
    connectionId: string,
    uid: string,
    customClaims: Record<string, any> | null
  ): Promise<void> {
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
    return ConnectionManager.getInstance().withAuth(connectionId, (auth) =>
      auth.updateUser(uid, properties)
    );
  }

  /**
   * Delete an existing user.
   */
  public async deleteUser(connectionId: string, uid: string): Promise<void> {
    return ConnectionManager.getInstance().withAuth(connectionId, (auth) => auth.deleteUser(uid));
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
    const collectionName = options.collectionName || "users";
    if (options.cloneProfile) {
      const sourceFirestore = await ConnectionManager.getInstance().getFirestore(sourceConnectionId);
      const targetFirestore = await ConnectionManager.getInstance().getFirestore(targetConnectionId);
      const sourceDoc = await sourceFirestore.collection(collectionName).doc(uid).get();

      if (sourceDoc.exists) {
        await targetFirestore.collection(collectionName).doc(uid).set(sourceDoc.data() || {}, { merge: true });
        profileCloned = true;
        if (fsProvider) {
          fsProvider.invalidateAndNotify(targetConnectionId, `${collectionName}/${uid}`);
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
   * Check if a profile document exists in Firestore for the given user.
   */
  public async checkProfileExists(
    connectionId: string,
    uid: string,
    collectionName = "users"
  ): Promise<boolean> {
    const firestore = await ConnectionManager.getInstance().getFirestore(connectionId);
    const doc = await firestore.collection(collectionName).doc(uid).get();
    return doc.exists;
  }

  /**
   * Check if profile documents exist in Firestore for a batch of UIDs in a single round-trip.
   * Uses firestore.getAll(...) batch RPC rather than serial/concurrent get() calls.
   */
  public async checkProfilesExist(
    connectionId: string,
    uids: string[],
    collectionName = "users"
  ): Promise<Set<string>> {
    if (!uids || uids.length === 0) {
      return new Set();
    }
    const firestore = await ConnectionManager.getInstance().getFirestore(connectionId);
    const existingUids = new Set<string>();

    // Chunk in groups of up to 400 (well within Firestore getAll RPC limits)
    const chunkSize = 400;
    for (let i = 0; i < uids.length; i += chunkSize) {
      const chunk = uids.slice(i, i + chunkSize);
      const refs = chunk.map((uid) => firestore.collection(collectionName).doc(uid));
      try {
        const snapshots = await firestore.getAll(...refs);
        for (const snap of snapshots) {
          if (snap.exists) {
            existingUids.add(snap.id);
          }
        }
      } catch {
        // Fallback to individual checks if batch RPC fails
        await Promise.all(
          chunk.map(async (uid) => {
            const snap = await firestore.collection(collectionName).doc(uid).get();
            if (snap.exists) {
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
    collectionName = "users",
    fsProvider?: DocumentFileSystemProvider
  ): Promise<string> {
    const firestore = await ConnectionManager.getInstance().getFirestore(connectionId);
    const docRef = firestore.collection(collectionName).doc(user.uid);

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
      fsProvider.invalidateAndNotify(connectionId, `${collectionName}/${user.uid}`);
    }

    return `${collectionName}/${user.uid}`;
  }

  /**
   * Delete a Firestore profile document for a user if it exists.
   */
  public async deleteProfileDoc(
    connectionId: string,
    uid: string,
    collectionName = "users",
    fsProvider?: DocumentFileSystemProvider
  ): Promise<boolean> {
    const firestore = await ConnectionManager.getInstance().getFirestore(connectionId);
    const docRef = firestore.collection(collectionName).doc(uid);
    const doc = await docRef.get();
    if (doc.exists) {
      await docRef.delete();
      if (fsProvider) {
        fsProvider.invalidateAndNotify(connectionId, `${collectionName}/${uid}`);
      }
      return true;
    }
    return false;
  }

  /**
   * Delete a Firebase Auth user and optionally their Firestore profile document.
   */
  public async deleteUserAndProfile(
    connectionId: string,
    uid: string,
    deleteProfile = true,
    collectionName = "users",
    fsProvider?: DocumentFileSystemProvider
  ): Promise<{ authDeleted: boolean; profileDeleted: boolean }> {
    let profileDeleted = false;
    if (deleteProfile) {
      profileDeleted = await this.deleteProfileDoc(connectionId, uid, collectionName, fsProvider);
    }
    await this.deleteUser(connectionId, uid);
    return { authDeleted: true, profileDeleted };
  }

  /**
   * Create a new Firebase Auth user.
   */
  public async createUser(
    connectionId: string,
    properties: import("firebase-admin/auth").CreateRequest,
    customClaims?: Record<string, any>
  ): Promise<UserRecord> {
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
    return ConnectionManager.getInstance().withAuth(connectionId, (auth) =>
      auth.projectConfigManager().updateProjectConfig(config)
    );
  }
}

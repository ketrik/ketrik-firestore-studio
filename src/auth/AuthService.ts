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
    const auth = await ConnectionManager.getInstance().getAuth(connectionId);
    const result = await auth.listUsers(maxResults, pageToken);
    return {
      users: result.users,
      pageToken: result.pageToken,
    };
  }

  /**
   * Get a single user by UID.
   */
  public async getUser(connectionId: string, uid: string): Promise<UserRecord> {
    const auth = await ConnectionManager.getInstance().getAuth(connectionId);
    return auth.getUser(uid);
  }

  /**
   * Set custom claims for a user (e.g., { admin: true, role: "editor" }).
   */
  public async setCustomUserClaims(
    connectionId: string,
    uid: string,
    customClaims: Record<string, any> | null
  ): Promise<void> {
    const auth = await ConnectionManager.getInstance().getAuth(connectionId);
    await auth.setCustomUserClaims(uid, customClaims);
  }

  /**
   * Update properties of an existing user (e.g. disabled status, displayName).
   */
  public async updateUser(
    connectionId: string,
    uid: string,
    properties: import("firebase-admin/auth").UpdateRequest
  ): Promise<UserRecord> {
    const auth = await ConnectionManager.getInstance().getAuth(connectionId);
    return auth.updateUser(uid, properties);
  }

  /**
   * Delete an existing user.
   */
  public async deleteUser(connectionId: string, uid: string): Promise<void> {
    const auth = await ConnectionManager.getInstance().getAuth(connectionId);
    await auth.deleteUser(uid);
  }

  /**
   * Generate a password reset link for a user's email.
   */
  public async generatePasswordResetLink(connectionId: string, email: string): Promise<string> {
    const auth = await ConnectionManager.getInstance().getAuth(connectionId);
    return auth.generatePasswordResetLink(email);
  }

  /**
   * Mint a custom JWT auth token for a user.
   */
  public async createCustomToken(
    connectionId: string,
    uid: string,
    developerClaims?: Record<string, any>
  ): Promise<string> {
    const auth = await ConnectionManager.getInstance().getAuth(connectionId);
    return auth.createCustomToken(uid, developerClaims);
  }

  /**
   * Revoke all active refresh tokens for a user (forces logout across devices).
   */
  public async revokeRefreshTokens(connectionId: string, uid: string): Promise<void> {
    const auth = await ConnectionManager.getInstance().getAuth(connectionId);
    await auth.revokeRefreshTokens(uid);
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
    const sourceAuth = await ConnectionManager.getInstance().getAuth(sourceConnectionId);
    const targetAuth = await ConnectionManager.getInstance().getAuth(targetConnectionId);
    const sourceUser = await sourceAuth.getUser(uid);

    // Create user in target Auth instance
    let targetUser: UserRecord;
    try {
      targetUser = await targetAuth.createUser({
        uid: sourceUser.uid,
        email: sourceUser.email,
        emailVerified: sourceUser.emailVerified,
        displayName: sourceUser.displayName,
        photoURL: sourceUser.photoURL,
        phoneNumber: sourceUser.phoneNumber,
        disabled: sourceUser.disabled,
      });
    } catch (err: any) {
      if (err.code === "auth/uid-already-exists" || err.code === "auth/email-already-exists") {
        // User already exists in target; update properties
        targetUser = await targetAuth.updateUser(sourceUser.uid, {
          email: sourceUser.email,
          emailVerified: sourceUser.emailVerified,
          displayName: sourceUser.displayName,
          photoURL: sourceUser.photoURL,
          phoneNumber: sourceUser.phoneNumber,
          disabled: sourceUser.disabled,
        });
      } else {
        throw err;
      }
    }

    // Copy custom claims
    if (sourceUser.customClaims && Object.keys(sourceUser.customClaims).length > 0) {
      await targetAuth.setCustomUserClaims(sourceUser.uid, sourceUser.customClaims);
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
        resetLink = await targetAuth.generatePasswordResetLink(sourceUser.email);
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
}

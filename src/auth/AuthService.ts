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
}

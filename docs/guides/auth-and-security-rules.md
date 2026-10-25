---
title: Authentication & Security Rules Suite
description: Managing Firebase Auth users, custom JWT claims, password resets, session revocations, and two-way security rules deployment.
sidebar_position: 7
---

# Authentication & Security Rules Suite

**Ketrik Firestore Studio** provides native tooling for managing Firebase Authentication users and Cloud Firestore Security Rules directly from Visual Studio Code.

---

## 1. Firebase Authentication Management

The **Authentication** tree branch enables administrators and developers to inspect registered users, audit custom claims, and execute authentication workflows without switching to the Firebase Console.

```
▾ 🗂️ Production (default)
  ▾ 🛡️ Authentication (Users & Claims)
      👤 usr_abc123 (alice@company.com) • [admin: true]
      👤 usr_def456 (bob@company.com)   • [member]
  ▸ 🗂️ Composite Indexes
  ▸ 📁 users
```

### Registered User Operations
Right-click any user node in the tree to access authentication operations:

| Action | Description |
|---|---|
| **Edit Custom Claims** | Opens an interactive JSON editor to inspect and modify Firebase Auth custom claims (`admin`, `roles`, `tenantId`). |
| **Create Firestore Profile** | Initializes a linked document in your `users` collection matching the user's UID using predefined templates. |
| **Open Firestore Profile Document** | Directly opens the Firestore document corresponding to the selected user's UID. |
| **Clone User to Connection...** | Clones the user's profile and custom claims to another connection (e.g. from Production to Local Emulator). |
| **Mint Custom Auth Token** | Generates a signed Firebase custom auth token with active claims for API testing via cURL or Postman. |
| **Force Logout (Revoke Sessions)** | Revokes all active refresh tokens for the selected user. |
| **Generate Password Reset Link** | Generates an Out-Of-Band password reset link. |
| **Generate Email Verification Link** | Generates an email verification link. |
| **Generate Passwordless Sign-In Link** | Generates an email link sign-in URL. |
| **View Enrolled MFA Factors** | Inspects enrolled multi-factor authentication (MFA) methods (e.g. SMS, TOTP). |
| **Delete User & Profile...** | Deletes the authentication user and optionally deletes their linked Firestore document. |

### Bulk User Import Wizard (`importAuthUsersWizard`)
To seed test environments or migrate user accounts:
1. Right-click the **Authentication** branch $\rightarrow$ select **"Import Users from JSON/CSV..."**.
2. Select your JSON or CSV file containing user records.
3. Maps password hash configurations (SCRYPT, BCRYPT, PBKDF2) and bulk imports accounts directly into Firebase Auth.

---

## 2. Security Rules Governance (`firestore.rules`)

Managing and testing `firestore.rules` is integrated directly with your workspace repository.

### Open Live Rules (`openSecurityRules`)
- Right-click any connection $\rightarrow$ **"Open Live Security Rules (firestore.rules)"**.
- Fetches deployed rules directly from Google Cloud via Firebase Management API into a virtual preview tab.

### Side-by-Side Graphical Diff (`diffSecurityRules`)
- Right-click any connection $\rightarrow$ **"Diff Security Rules (Live vs Local)"**.
- Launches VS Code's native diff editor comparing your local workspace `firestore.rules` against the live deployed version.
- Highlights uncommitted rule changes, syntax modifications, and security policy discrepancies.

### Deploy Security Rules (`deploySecurityRules`)
- Right-click any connection $\rightarrow$ **"Deploy Security Rules to Active Connection"**.
- Validates syntax and deploys local `firestore.rules` directly to Cloud Firestore without running the Firebase CLI.

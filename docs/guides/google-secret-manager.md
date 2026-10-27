---
title: Google Secret Manager & Field Links
description: Enterprise Secret Management, Document Field Secret Links, Zero-Plaintext Credentials, and Ephemeral Inspection.
sidebar_position: 8
---

# Google Secret Manager & Field Links

Ketrik Firestore Studio integrates directly with **Google Cloud Secret Manager** and **VS Code SecretStorage** to eliminate plaintext credential storage, enable zero-leak document design patterns, and provide full secret lifecycle management directly within your IDE.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Secret Manager Architecture                     │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  Tree Explorer:                                                        │
│    └── 🔐 Google Secret Manager                                        │
│          ├── stripe-webhook-secret [Automatic • 2 Versions]           │
│          │     ├── Version 2 [ENABLED]                                 │
│          │     └── Version 1 [DISABLED]                                │
│          └── openai-api-key [Automatic • 1 Version]                   │
│                └── Version 1 [ENABLED]                                 │
│                                                                        │
│  Document Field Secret Linking & Smart Badging:                        │
│    ├── stripe_secret: "projects/my-app/secrets/stripe-webhook"  🔐    │
│    │     └── [Actions]: Link Secret • Reveal (••••) • Copy • Sync      │
│    └── api_key: "sk-live-12345"                                        │
│          └── [Action]: "Migrate Field to Secret Manager (Extract&Mask)" │
│                                                                        │
│  Enterprise Credentials (Zero Plaintext Keys):                         │
│    └── Service Account stored in OS Keychain (vscode.SecretStorage)    │
│        or dynamically resolved via GCP Secret Manager (secretUri)      │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 1. Why Secret Links in Firestore?

### The Plaintext Vulnerability
Many applications store third-party integration configs (e.g. Stripe webhook secrets, OpenAI API tokens, SendGrid credentials) inside Firestore configuration documents (e.g. `/tenants/{tenantId}/config` or `/settings/integrations`). 

Storing sensitive keys in plaintext inside Firestore poses serious risks:
- Accidental exposure via Firestore Security Rules misconfigurations.
- Accidental leakage in database backups, offline exports, or developer test environments.
- Non-compliance with enterprise security standards (SOC 2, ISO 27001, PCI-DSS).

### The Reference Link Pattern
The enterprise cloud pattern is to store a **canonical secret reference path** in Firestore:
```json
{
  "integration": "stripe",
  "webhookSecret": "projects/my-gcp-project/secrets/stripe-webhook-secret/versions/latest"
}
```
At runtime, backend services (Cloud Functions, Cloud Run, server containers) resolve the live secret payload from Google Secret Manager using IAM credentials.

---

## 2. Document Field Secret Links & Badging

Ketrik Firestore Studio makes working with secret references frictionless:

### Automatic URI Detection & Badging
Any document field containing a Google Secret Manager resource path (`projects/.../secrets/...` or `gcp-secret://`) is automatically recognized and decorated:
- **Visual Badge**: A yellow `key` icon (`🔐`) and badge `🔐 [Secret: <name>]`.
- **Rich Tooltip**: Displays the canonical secret resource name, target project, and parent document path.

### 1-Click "Link to Google Secret..."
Right-click any field in the Explorer Tree or Table View $\rightarrow$ **"Link to Google Secret..."**:
1. Fetches all secrets available in the connected GCP project.
2. Displays an interactive QuickPick with search and replication details.
3. Selecting a secret atomically updates the Firestore document field to the canonical resource name (`projects/<project-id>/secrets/<secret-id>`).
4. Live-reloads active editor tabs automatically via `DocumentFileSystemProvider`.

### 1-Click "Migrate Field to Secret Manager (Extract & Mask)"
If a document contains a sensitive plaintext string (e.g. `api_key: "sk-live-..."`):
1. Right-click the field $\rightarrow$ **"Migrate Field to Secret Manager (Extract & Mask)..."**.
2. Prompts for a Secret ID (defaults to `{documentId}_{fieldName}`).
3. Creates the secret in Google Secret Manager and uploads the current plaintext value as `v1`.
4. Atomically replaces the plaintext field in Firestore with the new secret reference path.
5. The sensitive key is instantly protected from database viewers and rule leaks.

### Inline Ephemeral Secret Reveal & Clipboard Copy
Click the inline action or right-click a linked secret field $\rightarrow$ **"Reveal Linked Secret Value"**:
- **Ephemeral Modal**: Inspect the live payload in a secure message modal without writing it to disk.
- **Copy with Auto-Wipe**: Copies the secret value to the clipboard with an automated **20-second security wipe timer** that clears your clipboard automatically to prevent paste leakage.

---

## 3. Dedicated Google Secret Manager Tree Explorer

Every connection in Ketrik Firestore Studio now includes a dedicated **`🔐 Google Secret Manager`** node in the Explorer Tree.

### Browsing Secrets & Versions
- **Secrets List**: View all secrets in the project with replication policy badges (`[automatic]` or `[user-managed]`) and creation timestamps.
- **Version Sub-Items**: Expand any secret to inspect its version lifecycle:
  - `Version 2 [ENABLED]` (Active, green pass icon)
  - `Version 1 [DISABLED]` (Inactive, orange slash icon)
  - `Version 0 [DESTROYED]` (Permanently wiped payload, red trash icon)

### Creating Secrets & Adding Versions
- **Create Secret** (`$(add)` on branch): Prompts for Secret ID and optional initial secret value.
- **Add Secret Version** (`$(plus)` on secret): Adds a new version payload via direct text prompt or by uploading a file (useful for private keys and certificates).
- **Inspect Payload** (`$(eye)`): Inspect the decrypted payload in a masked modal, open in a temporary virtual scratchpad buffer, or copy with security wipe.
- **Copy Resource Name** (`$(link)`): 1-Click copy of the full `projects/{project}/secrets/{secret}` resource string for pasting into code or document fields.
- **Disable / Enable Version**: Toggle version availability instantly without destroying data.
- **Destroy Version**: Permanently wipe compromised or expired secret versions with an enterprise confirmation modal.

---

## 4. Zero-Plaintext Connection Credentials

Historically, VS Code extensions required a physical path to a Service Account JSON file on disk (`serviceAccountKeyPath: "/path/to/key.json"`). If committed to Git or left on developer laptops, this represents a major security vulnerability.

Ketrik Firestore Studio provides two enterprise alternatives:

### Option A: VS Code SecretStorage (OS Keychain)
Store connection credentials securely in the operating system's native encrypted keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service):
- Set `"useSecretStorage": true` on the connection profile.
- Credentials are encrypted and managed via `vscode.SecretStorage`.
- Zero plaintext `.json` files on your hard drive, and zero secrets committed to `.vscode/settings.json`.

### Option B: Direct Secret Manager Resolution (`secretUri`)
Configure connections to fetch their own Service Account JSON dynamically from Google Secret Manager:
```jsonc
{
  "id": "prod-db",
  "name": "Production Firestore",
  "projectId": "my-enterprise-project",
  "secretUri": "projects/my-enterprise-project/secrets/firestore-admin-sa/versions/latest"
}
```
Upon activation, Ketrik Firestore Studio resolves the credential payload in memory without writing it to disk.

---

## 5. Configuring Google Cloud IAM & Service Account Access

By default, standard Firebase Admin SDK service accounts (`firebase-adminsdk-xxxxx@...`) only have permissions for Firebase, Firestore, and Cloud Storage. They do **not** have access to Google Cloud Secret Manager until granted.

To allow Ketrik Firestore Studio to manage secrets, follow these two setup steps:

### Step 1: Enable the Secret Manager API
The Secret Manager API (`secretmanager.googleapis.com`) must be enabled in your Google Cloud project:

```bash
gcloud services enable secretmanager.googleapis.com --project=YOUR_PROJECT_ID
```
*Or in the Google Cloud Console: Navigate to **APIs & Services $\rightarrow$ Enable APIs & Services**, search for **Secret Manager API**, and click **Enable**.*

---

### Step 2: Grant IAM Roles to Your Service Account

Identify your service account email address from the `"client_email"` field inside your downloaded Service Account JSON key (e.g. `firebase-adminsdk-xxxxx@YOUR_PROJECT_ID.iam.gserviceaccount.com`).

#### Option A: Full Secret Management (Recommended for Studio)
To allow creating secrets, adding versions, revealing payloads, and linking fields:

```bash
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:YOUR_SERVICE_ACCOUNT_EMAIL" \
  --role="roles/secretmanager.admin"
```

#### Option B: Read & Access Only (Least Privilege)
If you only want to browse secrets and inspect/reveal payloads (without creating or destroying secrets):

```bash
# Allow listing secrets and viewing metadata
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:YOUR_SERVICE_ACCOUNT_EMAIL" \
  --role="roles/secretmanager.viewer"

# Allow decrypting / accessing payload values
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:YOUR_SERVICE_ACCOUNT_EMAIL" \
  --role="roles/secretmanager.secretAccessor"
```

---

### Step 3: Configuring via Google Cloud Console (UI)
If you prefer configuring via the web console:
1. Open [Google Cloud Console: IAM & Admin](https://console.cloud.google.com/iam-admin/iam).
2. Ensure you have selected your target GCP project.
3. Locate your Service Account in the list and click the **Edit Principal** pencil icon (`✏️`) on the right.
4. Click **+ Add Another Role**.
5. Search for and select **Secret Manager Admin** (or **Secret Manager Secret Accessor**).
6. Click **Save**. *(Note: IAM changes typically take 30–60 seconds to propagate globally).*

---

## 6. Summary of Commands

| Command | Title | Location | Description |
| :--- | :--- | :--- | :--- |
| `ketrik-firestore-studio.createSecret` | **Create Secret...** | Secret Branch Menu (`$(add)`) | Provision a new secret in Google Secret Manager. |
| `ketrik-firestore-studio.addSecretVersion` | **Add Secret Version...** | Secret Item Menu (`$(plus)`) | Add a new payload version via text or file upload. |
| `ketrik-firestore-studio.inspectSecretPayload` | **Inspect Secret Payload** | Secret & Version Item (`$(eye)`) | Decrypt and inspect live payload in ephemeral view. |
| `ketrik-firestore-studio.copySecretPayload` | **Copy Secret Payload** | Secret & Version Item (`$(copy)`) | Copy secret value with 20s auto-wipe security timer. |
| `ketrik-firestore-studio.copySecretResourceName` | **Copy Secret Resource Name** | Secret & Version Item (`$(link)`) | Copy canonical `projects/.../secrets/...` path. |
| `ketrik-firestore-studio.disableSecretVersion` | **Disable Secret Version** | Version Item Menu | Disable an active secret version. |
| `ketrik-firestore-studio.enableSecretVersion` | **Enable Secret Version** | Version Item Menu | Re-enable a disabled secret version. |
| `ketrik-firestore-studio.destroySecretVersion` | **Destroy Secret Version** | Version Item Menu (`$(trash)`) | Permanently destroy a version payload with confirmation. |
| `ketrik-firestore-studio.linkFieldToSecret` | **Link to Google Secret...** | Field Context Menu (`$(key)`) | QuickPick to bind document field to a project secret. |
| `ketrik-firestore-studio.migrateFieldToSecret` | **Migrate Field to Secret Manager...** | Field Context Menu (`$(shield-lock)`) | Extract plaintext field into a new secret and mask value. |
| `ketrik-firestore-studio.revealFieldSecretPayload` | **Reveal Linked Secret Value** | Secret Field Menu (`$(eye)`) | Inline inspection of linked secret values from document fields. |
| `ketrik-firestore-studio.refreshSecrets` | **Refresh Secrets** | Secret Branch & Item Menu | Refresh secret and version tree hierarchy. |

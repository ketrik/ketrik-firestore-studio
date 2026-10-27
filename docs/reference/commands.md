---
title: Commands Reference
description: Complete listing of all commands and keyboard shortcuts provided by Ketrik Firestore Studio.
sidebar_position: 2
---

# Commands Reference

All commands can be executed via the VS Code Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`) or directly through tree view actions and context menus.

---

## AI Scratchpad & Workspace Sync

| Command ID | Title | Context / Location | Description |
| :--- | :--- | :--- | :--- |
| `ketrik-firestore-studio.openAiScratchpad` | **Firestore: Edit with AI (Open Scratchpad)** | Document & Field Menu / Inline `$(sparkle)` | Extracts document or targeted field into `.firestore/<conn>/<path>/[<field>.json]` with automatic live sync and gitignore protection. |
| `ketrik-firestore-studio.unpackDocumentFields` | **Firestore: Unpack Document Fields for AI...** | Document Context Menu / Palette | Unpacks monolithic document fields into individual files with an `_index.json` manifest to optimize LLM context token usage. |
| `ketrik-firestore-studio.diffSnapshotWithFirestore` | **Firestore: Compare Snapshot with Firestore** | Editor Title Bar / Palette | Opens native side-by-side diff between local workspace snapshot and remote Firestore document or field. |
| `ketrik-firestore-studio.pushSnapshotToFirestore` | **Firestore: Push Snapshot to Firestore** | Editor Title Bar / Palette | Pushes local changes back to Cloud Firestore with Merge/Patch or Overwrite conflict strategies. |
| `ketrik-firestore-studio.pullSnapshotFromFirestore` | **Firestore: Pull Latest from Firestore** | Editor Title Bar / Palette | Refreshes local snapshot file from Firestore with unsaved change detection. |
| `ketrik-firestore-studio.cleanScratchpads` | **Firestore: Clean All AI Scratchpads (.firestore)...** | Palette / Status Bar Menu | Purges all temporary snapshot files under `.firestore/` with one click for zero disk footprint. |
| `ketrik-firestore-studio.snapshotToWorkspace` | **Firestore: Snapshot Document to Workspace...** | Document Context Menu / Palette | Saves document as a tracked workspace snapshot file with custom location picker. |
| `ketrik-firestore-studio.bindFileToFirestore` | **Firestore: Bind File to Firestore Document...** | Editor Context Menu / Palette | Explicitly tracks an arbitrary workspace JSON file to a Firestore document path. |
| `ketrik-firestore-studio.unbindFileFromFirestore` | **Firestore: Unbind File from Firestore** | Editor Context Menu / Palette | Detaches a tracked workspace file from live synchronization. |
| `ketrik-firestore-studio.snapshotActionsMenu` | **Firestore: Snapshot Actions...** | Status Bar / Palette | QuickPick menu of snapshot actions (Diff, Push, Pull, Clean, Unbind). |

---

## Connection Management

| Command ID | Title | Context / Location | Description |
| :--- | :--- | :--- | :--- |
| `ketrik-firestore-studio.addConnection` | **Firestore: Add Connection** | Explorer Title Bar / Palette | Add a new Firestore connection via Service Account JSON, Application Default Credentials (ADC), or local Emulator host:port. |
| `ketrik-firestore-studio.editConnection` | **Firestore: Edit Connection** | Connection Context Menu | Update connection label, credentials file path, or emulator endpoints. |
| `ketrik-firestore-studio.deleteConnection` | **Firestore: Delete Connection** | Connection Context Menu | Remove an existing connection profile from VS Code settings. |
| `ketrik-firestore-studio.testConnection` | **Firestore: Test Connection** | Connection Context Menu | Verifies gRPC connectivity, project credentials, and database reachability with live status notifications. |
| `ketrik-firestore-studio.refreshExplorer` | **Firestore: Refresh Explorer** | Explorer Title Bar | Clears connection cache and re-enumerates all root collections across active databases. |

---

## Collections & Query Views

| Command ID | Title | Context / Location | Description |
| :--- | :--- | :--- | :--- |
| `ketrik-firestore-studio.openCollectionAsTable` | **Firestore: Open Collection as Table** | Collection Context Menu / Inline Icon | Launches the interactive collection table webview with sorting, search, single-read doc ID lookup, and server-side where query builder. |
| `ketrik-firestore-studio.queryCollectionGroup` | **Firestore: Query Collection Group...** | Connection / Collection Menu / Palette | Flattens all subcollections with the given ID database-wide into a unified collection group table view with origin parent document links. |
| `ketrik-firestore-studio.createDocument` | **Firestore: Create Document** | Collection Context Menu / Inline Icon | Creates a new document within the selected collection. Prompts for auto-generated ID or manual ID and opens in an editor tab. |
| `ketrik-firestore-studio.generateSyntheticData` | **Firestore: Generate Synthetic Data...** | Collection Context Menu / Palette | Ingests 1 to 5,000 realistic mock documents using domain-aware schema inference and chunked batch writes. |
| `ketrik-firestore-studio.deleteCollection` | **Firestore: Delete Collection...** | Collection Context Menu | Batch deletes all documents within the collection (prompts for confirmation). |
| `ketrik-firestore-studio.copyCollectionToInstance` | **Firestore: Copy Collection to Another Instance...** | Collection Context Menu | Batch copies an entire collection with batch writes and collision handling to another instance. |
| `ketrik-firestore-studio.copyMultipleCollections` | **Firestore: Copy Multiple Collections to Instance...** | Connection Menu / Palette | Multi-select dialog to batch copy multiple collections across database connections. |
| `ketrik-firestore-studio.deleteMultipleCollections` | **Firestore: Delete Multiple Collections...** | Connection Menu / Palette | Multi-select dialog to batch delete multiple collections with safety confirmation. |
| `ketrik-firestore-studio.exportCollection` | **Firestore: Export Collection (CSV, JSON, NDJSON)...** | Collection Menu / Palette | Exports collection records to CSV, formatted JSON, or NDJSON. |
| `ketrik-firestore-studio.importCollection` | **Firestore: Import Data (CSV, JSON, NDJSON)...** | Collection Menu / Palette | Imports datasets into Firestore with schema validation and chunked batch writes. |
| `ketrik-firestore-studio.analyzeCollectionSchema` | **Firestore: Analyze Schema Drift & Anomalies...** | Collection Menu / Palette | Deep-scans collection documents to report missing fields, type drifts, and null anomalies. |
| `ketrik-firestore-studio.generateSchema` | **Firestore: Generate TypeScript / Zod Schema...** | Collection Menu / Palette | Automatically infers TypeScript interfaces and Zod validation schemas from live documents. |
| `ketrik-firestore-studio.snapshotFirestoreToLocalJson` | **Firestore: Snapshot Collection to Local JSON Store...** | Collection Context Menu | Exports collection documents into a local JSON file for offline testing or mock stores. |
| `ketrik-firestore-studio.pushLocalCollectionToFirestore` | **Firestore: Push / Seed to Firestore (Cloud or Emulator)...** | Local Collection Menu | Seeds local JSON collection data back into Cloud Firestore or Emulator. |

---

## Document Operations

| Command ID | Title | Context / Location | Description |
| :--- | :--- | :--- | :--- |
| `ketrik-firestore-studio.openDocument` | **Firestore: Open Document** | Document Node Click | Opens the document in an editor tab (`virtual` or `workspace` mode depending on `openMode`). |
| `ketrik-firestore-studio.revealActiveDocumentInTree` | **Firestore: Reveal Active Document in Tree View** | Editor Title Bar / Palette | Focuses and expands the active editor tab's document in the Explorer Tree View. |
| `ketrik-firestore-studio.jumpToDocument` | **Firestore: Jump to Document ID...** | Collection Context Menu / Palette | Fast single-read lookup jumping straight to a specific document ID without collection paging. |
| `ketrik-firestore-studio.copyDocumentId` | **Firestore: Copy Document ID** | Document Context Menu | Copies the document ID to the system clipboard. |
| `ketrik-firestore-studio.copyPath` | **Firestore: Copy Path** | Context Menu | Copies the full Firestore document or collection path to clipboard. |
| `ketrik-firestore-studio.duplicateDocument` | **Firestore: Duplicate Document...** | Document Context Menu / Inline Icon | Clones document within the collection with a new ID prompt. |
| `ketrik-firestore-studio.copyDocument` | **Firestore: Copy Document** | Document Context Menu / Inline Icon | Copies document to internal clipboard for cross-collection or cross-connection pasting. |
| `ketrik-firestore-studio.copyDocumentToInstance` | **Firestore: Copy Document to Another Instance...** | Document Context Menu / Editor Title / Palette | Deep or shallow clone of an individual document plus all nested subcollections to any target database. |
| `ketrik-firestore-studio.pasteDocument` | **Firestore: Paste Document** | Collection / Document Menu | Pastes copied document into selected collection or connection. |
| `ketrik-firestore-studio.copyDocumentJson` | **Firestore: Copy as JSON** | Document Context Menu | Copies formatted JSON representation of the document directly to OS clipboard. |
| `ketrik-firestore-studio.deleteDocument` | **Firestore: Delete Document** | Document Context Menu / Inline Icon | Permanently deletes document with subcollection detection and deep delete option. |
| `ketrik-firestore-studio.addSubcollection` | **Firestore: Add Subcollection** | Document Context Menu | Creates a new subcollection under the selected document. |
| `ketrik-firestore-studio.refreshItem` | **Firestore: Refresh** | Context Menu | Granularly invalidates cached state for the selected node without refreshing the entire tree. |

---

## Field-Level Operations

| Command ID | Title | Context / Location | Description |
| :--- | :--- | :--- | :--- |
| `ketrik-firestore-studio.openFieldAsTable` | **Firestore: Open as Table View** | Map & Array Field Menu / Inline Icon | Opens in-document map (`Record<string, T>`) or sequence list (`T[]`) as an interactive tabular grid. |
| `ketrik-firestore-studio.openFieldInEditor` | **Firestore: Open in JSON Editor** | Field Context Menu | Opens a root variable/field in a virtual JSON tab. Saving performs atomic partial update. |
| `ketrik-firestore-studio.openField` | **Firestore: Edit Value / Open Field** | Field Double-Click / Context Menu | Quick-edit a scalar field value with type-preserving modal inputs. |
| `ketrik-firestore-studio.renameField` | **Firestore: Rename Field...** | Field Context Menu | Atomically renames a document field using field delete + set, validating destination collisions. |
| `ketrik-firestore-studio.addField` | **Firestore: Add Field...** | Document / Map Context Menu | Adds a new field with type selection (String, Number, Boolean, Timestamp, Vector, Map, Array, Null). |
| `ketrik-firestore-studio.addNestedProperty` | **Firestore: Add Nested Property...** | Map Context Menu | Adds a nested key into an existing Map field with type selection. |
| `ketrik-firestore-studio.deleteField` | **Firestore: Delete Field** | Field Context Menu | Atomically removes a field from the document via `FieldValue.delete()`. |
| `ketrik-firestore-studio.deleteMultipleFields` | **Firestore: Delete Multiple Fields...** | Document Context Menu | Multi-select dialog to atomically delete multiple fields in a single batch write. |
| `ketrik-firestore-studio.copyFieldJson` | **Firestore: Copy as JSON** | Field Context Menu | Copies serialized value of the field to the system clipboard. |
| `ketrik-firestore-studio.duplicateField` | **Firestore: Duplicate Field...** | Field Context Menu | Clones a field under a new key within the same document. |
| `ketrik-firestore-studio.explodeField` | **Firestore: Explode Field to Collection...** | Map / Array Context Menu | Substrate migration: explodes an in-document map or array into a standalone subcollection. |
| `ketrik-firestore-studio.consolidateCollection` | **Firestore: Consolidate Collection to Field...** | Collection Context Menu | Substrate migration: consolidates documents of a subcollection into a single parent document Map/Array field. |
| `ketrik-firestore-studio.purgeFieldTombstones` | **Firestore: Purge Field Tombstones...** | Field Context Menu | Scans and deletes obsolete or tombstoned keys within nested structures. |
| `ketrik-firestore-studio.purgeCollectionTombstones` | **Firestore: Purge Collection Tombstones...** | Collection Context Menu | Deletes soft-deleted or tombstoned records across an entire collection. |

---

## Firebase Authentication Suite

| Command ID | Title | Context / Location | Description |
| :--- | :--- | :--- | :--- |
| `ketrik-firestore-studio.manageAuthUsers` | **Firestore: Manage Auth Users & Custom Claims** | Explorer Title Bar / Palette | Launches the interactive Firebase Authentication user management dashboard. |
| `ketrik-firestore-studio.openAuthUsersAsTable` | **Firestore: Open Auth Users as Table** | Auth Tree Branch / Palette | Visualizes registered authentication users in a filterable, sortable grid. |
| `ketrik-firestore-studio.openAuthUserClaims` | **Firestore: Edit Custom Claims** | User Context Menu | Opens an inline JSON editor to inspect and update Firebase Auth custom claims (`admin`, `role`, etc.). |
| `ketrik-firestore-studio.createAuthUser` | **Firestore: Create New Auth User...** | Auth Branch Menu / Palette | Creates a new user profile with email/password, display name, and phone. |
| `ketrik-firestore-studio.deleteAuthUser` | **Firestore: Delete User & Profile...** | User Context Menu | Deletes auth user record and optionally purges corresponding user profile document in Firestore. |
| `ketrik-firestore-studio.cloneAuthUser` | **Firestore: Clone User to Connection...** | User Context Menu | Replicates an auth user profile and claims across connections (e.g. Prod $\rightarrow$ Emulator). |
| `ketrik-firestore-studio.mintCustomToken` | **Firestore: Mint Custom Auth Token** | User Context Menu | Generates a signed Firebase custom auth JWT token with active claims for API testing. |
| `ketrik-firestore-studio.revokeUserSessions` | **Firestore: Force Logout (Revoke Sessions)** | User Context Menu | Revokes all active refresh tokens for the selected user. |
| `ketrik-firestore-studio.resetAuthUserPassword` | **Firestore: Generate Password Reset Link** | User Context Menu | Generates an Out-Of-Band password reset link. |
| `ketrik-firestore-studio.generateEmailVerificationLink` | **Firestore: Generate Email Verification Link** | User Context Menu | Generates an email verification link. |
| `ketrik-firestore-studio.generateSignInWithEmailLink` | **Firestore: Generate Passwordless Sign-In Link** | User Context Menu | Generates an email link sign-in URL. |
| `ketrik-firestore-studio.viewUserMfa` | **Firestore: View Enrolled MFA Factors** | User Context Menu | Inspects enrolled multi-factor authentication (MFA) methods for a user. |
| `ketrik-firestore-studio.importAuthUsersWizard` | **Firestore: Import Users from JSON/CSV...** | Auth Branch Menu / Palette | Bulk imports user accounts with password hashes into Firebase Auth. |
| `ketrik-firestore-studio.createAuthUserProfile` | **Firestore: Create Firestore Profile** | User Context Menu | Initializes a linked Firestore document for an Auth user based on configured templates. |
| `ketrik-firestore-studio.openAuthUserProfile` | **Firestore: Open Firestore Profile Document** | User Context Menu | Jumps directly to the Firestore document matching the user's UID. |
| `ketrik-firestore-studio.inspectProjectAuthConfig` | **Firestore: Project Auth Security & Policies** | Auth Branch Menu / Palette | Inspects password requirements, sign-in methods, and SMS quotas. |

---

## Security Rules Suite

| Command ID | Title | Context / Location | Description |
| :--- | :--- | :--- | :--- |
| `ketrik-firestore-studio.openSecurityRules` | **Firestore: Open Live Security Rules (firestore.rules)** | Connection Menu / Palette | Fetches and opens live deployed `firestore.rules` from Cloud Firestore in a virtual editor tab. |
| `ketrik-firestore-studio.diffSecurityRules` | **Firestore: Diff Security Rules (Live vs Local)** | Connection Menu / Palette | Opens side-by-side diff between deployed cloud rules and local `firestore.rules` workspace file. |
| `ketrik-firestore-studio.deploySecurityRules` | **Firestore: Deploy Security Rules to Active Connection** | Connection Menu / Palette | Deploys local security rules directly to Cloud Firestore via Admin API. |

---

## Composite Indexes Management

| Command ID | Title | Context / Location | Description |
| :--- | :--- | :--- | :--- |
| `ketrik-firestore-studio.refreshIndexes` | **Firestore: Refresh Composite Indexes** | Composite Indexes Branch Context / Inline Icon | Granularly re-queries the Cloud Firestore Admin API to refresh index states and definitions. |
| `ketrik-firestore-studio.inspectIndexDefinition` | **Firestore: Inspect Composite Index Definition** | Composite Index Click / Context Menu | Opens the complete index JSON structure in a virtual preview editor tab. |
| `ketrik-firestore-studio.deleteIndex` | **Firestore: Delete Composite Index** | Composite Index Context Menu / Inline Trash Icon | Safely deletes an index via Cloud Firestore REST API with modal confirmation. |
| `ketrik-firestore-studio.snapshotLiveIndexes` | **Firestore: Snapshot Live Indexes to Workspace...** | Composite Indexes Branch Menu | Pull deployed cloud indexes into workspace `firestore.indexes.json` (Merge / Overwrite). |
| `ketrik-firestore-studio.diffIndexes` | **Firestore: Diff Indexes (Live Cloud ⇄ Local Workspace)** | Composite Indexes Branch Menu | Graphical side-by-side diff between deployed cloud indexes and local file. |
| `ketrik-firestore-studio.deployIndexes` | **Firestore: Deploy firestore.indexes.json to Cloud Firestore...** | Composite Indexes Branch Menu | Deploy local index definitions directly to Firestore via Admin REST API. |
| `ketrik-firestore-studio.buildCompositeIndex` | **Firestore: Create Composite Index...** | Composite Indexes Branch Menu / Inline `+` / Palette | Guided multi-step wizard to construct composite indexes and deploy or stage locally. |

---

## Firebase Emulator Suite

| Command ID | Title | Context / Location | Description |
| :--- | :--- | :--- | :--- |
| `ketrik-firestore-studio.emulatorStatusMenu` | **Firestore: Firebase Emulator Status & Actions...** | Status Bar / Title Bar / Palette | Opens interactive status dashboard showing emulator port states, UI links, and fast actions. |
| `ketrik-firestore-studio.startEmulator` | **Firestore: Start Local Firebase Emulator** | Palette / Status Menu | Launches the local emulator in an integrated VS Code terminal using workspace `firebase.json` configuration. |
| `ketrik-firestore-studio.stopEmulator` | **Firestore: Stop Local Firebase Emulator** | Palette / Status Menu | Safely terminates running emulator processes in the terminal. |
| `ketrik-firestore-studio.restartEmulator` | **Firestore: Restart Local Firebase Emulator** | Palette / Status Menu | Restarts the local emulator process cycle. |
| `ketrik-firestore-studio.openEmulatorUi` | **Firestore: Open Firebase Emulator UI** | Palette / Status Menu | Launches the Firebase Emulator UI web dashboard (`http://localhost:4000`) in the default browser. |
| `ketrik-firestore-studio.discoverEmulators` | **Firestore: Discover & Connect Local Emulator** | Palette / Status Menu | Probes active ports and connects to running Firestore and Auth emulators without needing credentials. |

---

## Cloud Storage Explorer

| Command ID | Title | Context / Location | Description |
| :--- | :--- | :--- | :--- |
| `ketrik-firestore-studio.refreshStorage` | **Firestore: Refresh Cloud Storage** | Storage Branch Menu / Inline Icon | Refreshes bucket file list and directory tree. |
| `ketrik-firestore-studio.uploadStorageFile` | **Firestore: Upload File to Cloud Storage...** | Storage Branch Menu / Palette | Uploads local workspace files to Cloud Storage bucket. |
| `ketrik-firestore-studio.inspectStorageFile` | **Firestore: Inspect Storage File...** | Storage File Click / Context Menu | Views object metadata, MD5 hash, content type, and download metrics. |
| `ketrik-firestore-studio.mintSignedUrl` | **Firestore: Generate Signed Download URL...** | Storage File Context Menu | Mints temporary cryptographic download URL with custom TTL expiration. |
| `ketrik-firestore-studio.deleteStorageFile` | **Firestore: Delete Storage File** | Storage File Context Menu | Permanently removes an object from Cloud Storage bucket. |
| `ketrik-firestore-studio.copyStorageGsUrl` | **Firestore: Copy gs:// URI** | Storage File Context Menu | Copies Google Cloud Storage resource URI (e.g. `gs://bucket/file.png`) to clipboard. |
| `ketrik-firestore-studio.copyStorageHttpUrl` | **Firestore: Copy Download URL** | Storage File Context Menu | Copies public HTTPS download URL to clipboard. |

---

## Monitoring, Dashboards & Cost Simulator

| Command ID | Title | Context / Location | Description |
| :--- | :--- | :--- | :--- |
| `ketrik-firestore-studio.openCostSimulator` | **Firestore: Open Cost Simulator & Quota Usage Dashboard** | Title Bar / Palette | Interactive quota tracker, real-time read/write billable counter, and monthly cost forecast. |
| `ketrik-firestore-studio.openOverviewDashboard` | **Firestore: Open Studio Overview & Traffic Analytics** | Title Bar / Palette | Comprehensive health panel with active connections, collection counts, and recent mutations. |
| `ketrik-firestore-studio.openDataGraph` | **Firestore: Visualize Data Graph (Boxes & Nodes)...** | Connection / Palette | Graphical visualization of entity relations and references across collections. |

---

## Google Secret Manager & Field Links

| Command ID | Title | Context / Location | Description |
| :--- | :--- | :--- | :--- |
| `ketrik-firestore-studio.createSecret` | **Firestore: Create Secret...** | Secret Branch Menu (`$(add)`) / Palette | Provision a new secret in Google Cloud Secret Manager with optional initial value. |
| `ketrik-firestore-studio.addSecretVersion` | **Firestore: Add Secret Version...** | Secret Item Menu (`$(plus)`) / Palette | Upload or input a new version payload for an existing secret. |
| `ketrik-firestore-studio.inspectSecretPayload` | **Firestore: Inspect Secret Payload** | Secret & Version Item (`$(eye)`) | Securely inspect live decrypted payload via ephemeral modal, virtual scratchpad, or auto-wipe copy. |
| `ketrik-firestore-studio.copySecretPayload` | **Firestore: Copy Secret Payload** | Secret & Version Item (`$(copy)`) | Copies secret payload to clipboard with an automated 20-second security auto-wipe timer. |
| `ketrik-firestore-studio.copySecretResourceName` | **Firestore: Copy Secret Resource Name** | Secret & Version Item (`$(link)`) | Copies canonical `projects/.../secrets/...` resource identifier to clipboard. |
| `ketrik-firestore-studio.disableSecretVersion` | **Firestore: Disable Secret Version** | Secret Version Menu | Disables an active secret version in Google Cloud. |
| `ketrik-firestore-studio.enableSecretVersion` | **Firestore: Enable Secret Version** | Secret Version Menu | Re-enables a previously disabled secret version. |
| `ketrik-firestore-studio.destroySecretVersion` | **Firestore: Destroy Secret Version** | Secret Version Menu (`$(trash)`) | Permanently wipes a compromised or obsolete secret version with safety confirmation. |
| `ketrik-firestore-studio.linkFieldToSecret` | **Firestore: Link to Google Secret...** | Field Context Menu (`$(key)`) | QuickPick to bind a document field directly to a Google Secret Manager resource link. |
| `ketrik-firestore-studio.migrateFieldToSecret` | **Firestore: Migrate Field to Secret Manager (Extract & Mask)...** | Field Context Menu (`$(shield-lock)`) | Extracts sensitive plaintext field into a new Google Secret and replaces the field with the secret reference link. |
| `ketrik-firestore-studio.revealFieldSecretPayload` | **Firestore: Reveal Linked Secret Value** | Secret Field Inline Menu (`$(eye)`) | Inline inspection of linked secret values directly from document fields. |
| `ketrik-firestore-studio.refreshSecrets` | **Firestore: Refresh Secrets** | Secret Branch Menu | Refreshes secrets list and version tree hierarchy from Google Cloud. |

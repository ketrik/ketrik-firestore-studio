---
title: Introduction
description: Overview and core features of Ketrik Firestore Studio for Visual Studio Code.
sidebar_position: 1
---

# Introduction

**Ketrik Firestore Studio** is an enterprise-grade developer tool and Visual Studio Code extension designed for viewing, querying, managing, and mutating multiple Google Cloud / Firebase Firestore databases seamlessly inside your editor.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Ketrik Firestore Studio                         │
│  ┌─────────────────────────┐  ┌─────────────────────────────────────┐  │
│  │   Interactive Tree      │  │   Dual-Mode Document Engine         │  │
│  │   • Multi-Connection    │  │   • Pure Virtual (0 disk bytes)     │  │
│  │   • Root Variables      │  │   • Workspace AI Mode (.firestore/) │  │
│  │   • Subcollections      │  │   • Atomic Live Sync on Save        │  │
│  └───────────┬─────────────┘  └──────────────────┬──────────────────┘  │
│              │                                   │                     │
│              ▼                                   ▼                     │
│  ┌─────────────────────────┐  ┌─────────────────────────────────────┐  │
│  │   Webview Tables        │  │   AI Scratchpad & Isolation         │  │
│  │   • Server Where Qs     │  │   • 99.8% Token Optimization        │  │
│  │   • 1-Read Doc Lookup   │  │   • Field-Level Scratchpads         │  │
│  │   • Dual-Contract Maps  │  │   • Document Unpacking & Diff       │  │
│  └───────────┬─────────────┘  └──────────────────┬──────────────────┘  │
│              │                                   │                     │
│              ▼                                   ▼                     │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │   Firebase Suites: Auth • Storage • Rules • Indexes • Simulator  │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

---

## Why Firestore Studio?

Operating on Firestore databases through the browser console is frequently cumbersome: switching between production and local emulators requires separate windows, viewing deeply nested JSON fields forces constant horizontal scrolling, and writing ad-hoc scripts just to query by field value or rename a typo in a key burns developer hours.

Ketrik Firestore Studio solves this by bringing your databases directly into VS Code:
- **Zero context switching**: Browse, query, and edit live databases inside your editor tabs.
- **AI-first workflow**: Deterministic scratchpads, 99%+ LLM token optimization via field isolation, and instant auto-sync on save for Cursor, Copilot, Gemini, and Claude.
- **Atomic mutations**: Partial updates and field renames modify only targeted paths without risking dirty overwrite of sibling data.
- **Dual-contract architecture**: View both discrete collections and aggregated in-document registry maps (`Record<string, T>`) or sequence lists (`T[]`) using identical, responsive table views.
- **Quota & memory aware**: Configurable memory caching, single-read direct lookups, cost simulation, and server-side query filters to save on cloud billing.

---

## Core Capabilities

| Capability | Summary |
|---|---|
| **Multi-Environment Support** | Connect to multiple service accounts, local emulators, and named database instances side-by-side. |
| **AI Scratchpad & Token Isolation** | 1-click zero-prompt scratchpad generation under `.firestore/` with atomic field synchronization and up to 99.8% token context reduction. |
| **Dual-Mode Architecture** | Pure Virtual mode (0 disk bytes, RAM-cached) or Workspace mode for seamless 0-click AI coding assistant compatibility. |
| **Virtual Subdocument Editor** | Open individual root variables/fields as standalone `.json` tabs. Saving applies atomic `.update()` calls. |
| **Server-Side Query Builder** | Construct multi-clause queries (`where(field, '==', val)`, `array-contains`, `in`) that execute directly on Firestore. |
| **Dual-Contract Perspective** | Open document Map and Array fields as interactive tables with columnar sorting and search. |
| **Batch Multi-Collection Ops** | Batch copy or delete multiple collections across instances with safety confirmations and chunked batch writes. |
| **Composite Indexes Suite** | Inspect live Cloud Firestore & Emulator composite indexes, inspect raw JSON definitions, diff, and deploy `firestore.indexes.json`. |
| **Firebase Auth & Custom Claims** | Manage registered auth users, edit custom JWT claims, force logout, and test sign-in workflows. |
| **Security Rules Governance** | Fetch, diff against workspace `firestore.rules`, and deploy security rules directly to Cloud Firestore. |
| **Cloud Storage Explorer** | Browse bucket hierarchies, upload/delete files, inspect metadata, and mint signed download URLs. |
| **Cost & Quota Simulator** | Monitor real-time read/write billable counters with daily warning thresholds against Google Cloud limits. |

---

## Roadmap & Releases

For detailed historical release dates and upcoming milestones, refer to [ROADMAP.md](../../ROADMAP.md).

---
title: Introduction
description: Overview and core features of Ketrik Firestore Studio for Visual Studio Code.
sidebar_position: 1
---

# Introduction

**Ketrik Firestore Studio** is an advanced developer tool and Visual Studio Code extension designed for viewing, querying, managing, and mutating multiple Google Cloud / Firebase Firestore databases seamlessly inside your editor.

```
┌────────────────────────────────────────────────────────┐
│               Ketrik Firestore Studio                  │
│  ┌─────────────────────────┐  ┌─────────────────────┐  │
│  │   Interactive Tree      │  │  Virtual Document   │  │
│  │   • Multi-Connection    │  │  File System (JSON) │  │
│  │   • Root Variables      │  │  • Partial Updates  │  │
│  │   • Subcollections      │  │  • Conflict Guards  │  │
│  └───────────┬─────────────┘  └──────────┬──────────┘  │
│              │                           │             │
│              ▼                           ▼             │
│  ┌─────────────────────────┐  ┌─────────────────────┐  │
│  │   Collection Table      │  │ Dual-Contract Table │  │
│  │   • Server Where Qs     │  │ • Record<string, T> │  │
│  │   • 1-Read Doc Lookup   │  │ • T[] Sequences     │  │
│  └─────────────────────────┘  └─────────────────────┘  │
└────────────────────────────────────────────────────────┘
```

---

## Why Firestore Studio?

Operating on Firestore databases through the browser console is frequently cumbersome: switching between production and local emulators requires separate windows, viewing deeply nested JSON fields forces constant horizontal scrolling, and writing ad-hoc scripts just to query by field value or rename a typo in a key burns developer hours.

Ketrik Firestore Studio solves this by bringing your databases directly into VS Code:
- **Zero context switching**: Browse, query, and edit live databases inside your editor tabs.
- **Atomic mutations**: Partial updates and field renames modify only targeted paths without risking dirty overwrite of sibling data.
- **Dual-contract architecture**: View both discrete collections and aggregated in-document registry maps (`Record<string, T>`) or sequence lists (`T[]`) using identical, responsive table views.
- **Quota & memory aware**: Configurable memory caching, single-read direct lookups, and server-side query filters to save on cloud billing.

---

## Core Capabilities

| Capability | Summary |
|---|---|
| **Multi-Environment Support** | Connect to multiple service accounts, local emulators, and named database instances side-by-side. |
| **Virtual Subdocument Editor** | Open individual root variables/fields as standalone `.json` tabs. Saving applies atomic `.update()` calls. |
| **Server-Side Query Builder** | Construct multi-clause queries (`where(field, '==', val)`, `array-contains`, `in`) that execute directly on Firestore. |
| **Dual-Contract Perspective** | Open document Map and Array fields as interactive tables with columnar sorting and search. |
| **Cross-Connection Copy & Paste** | Clone documents across connections (e.g. copy from Production $\rightarrow$ paste into Local Emulator). |
| **Recursive Deep Delete** | Deleting a document detects nested subcollections and offers recursive subcollection purging via batched deletes. |
| **Primitive Modal Editing** | QuickPick booleans (`true`/`false`) and validated modal inputs for numbers and strings without tab clutter. |
| **Atomic Field Renaming** | Rename root document fields safely with automatic conflict checks and live editor reloads. |

---

## Roadmap & Releases

For detailed historical release dates and upcoming milestones (including Dual-Prefix protocol support and Substrate Migrations), refer to [ROADMAP.md](../../ROADMAP.md).

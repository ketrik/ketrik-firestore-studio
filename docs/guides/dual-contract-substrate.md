---
title: Dual-Contract Substrate (Map & Array Table View)
description: Visualizing Record<string, T> registries and T[] sequences as virtual collection tables.
sidebar_position: 5
---

# Dual-Contract Substrate: Map & Array Table View

Modern reactive applications frequently bridge two computational shapes:
1. **The Registry / Keyed Map Boundary (`Record<string, T>`)**: Used when entities are indexed primarily by unique immutable keys (e.g. system configurations, settings, entity registries).
2. **The Sequence / Array Boundary (`T[]`)**: Used when items are ordered lists, carousels, feeds, or event streams.

In Firestore, storing bounded registries or sequences inside a single aggregated document (e.g. `doc.items: Record<string, T>`) gives $O(1)$ read cost and atomic batch updates, but inspecting deeply nested JSON files in traditional tools is painful.

---

## The Solution: "Open as Table View" on Fields

In **Ketrik Firestore Studio**, you can right-click any Map or Array root field in the Tree View and select:
**"Open as Table View"** (`ketrik-firestore-studio.openFieldAsTable`).

```
PERSISTENCE SUBSTRATES IN FIRESTORE                DUAL-CONTRACT STUDIO VIEW

[ Bounded Document ]
doc("registers/notifications")
{
  "ts": 1728212400,
  "items": {                                 ──►   Virtual Table View:
    "k1": { title: "Outage", code: 500 },           • Key/ID: k1  │ title: Outage │ code: 500
    "k2": { title: "Warning", code: 400 }           • Key/ID: k2  │ title: Warning│ code: 400
  }
}
```

---

## 1. Registry Boundary (`Record<string, T>`)
When opening a Map field:
- **Dictionary keys** (`k1`, `k2`) become the **Row IDs (`Key / ID`)**.
- The entity's nested properties are automatically projected across the table columns.
- The view displays a **`Registry (Keyed Map)`** substrate badge in the toolbar.

---

## 2. Sequence Boundary (`T[]`)
When opening an Array field:
- The **array index** (`0`, `1`, `2`) or internal `id` property becomes the **Row ID (`Index / ID`)**.
- Array items are mapped to tabular rows.
- The view displays a **`Sequence (Array)`** substrate badge in the toolbar.

---

## Interactive Features

- **In-Memory Search**: Filter entities in real-time across all properties.
- **`{ } Edit JSON`**: Click the toolbar button or any row to jump directly into the virtual `.json` editor tab.
- **Parent Document Navigation**: Click the parent doc link in the info bar to jump straight to the parent document.
- **Export JSON**: Export the parsed registry or sequence into a formatted `.json` file.

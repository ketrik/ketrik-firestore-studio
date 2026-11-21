import { OrderByDirection } from "firebase-admin/firestore";
import * as vscode from "vscode";
import ExplorerDataProvider from "../explorer/ExplorerDataProvider";
import { CollectionItem, DocumentItem, Item } from "../explorer/items";

export default async function orderBy(item: Item | undefined, explorerDataProvider: ExplorerDataProvider) {
  if (!item || !item.reference) {
    return;
  }

  const connectionId =
    (item as CollectionItem).connectionId || (item as DocumentItem).connectionId;

  const fieldChoice = await vscode.window.showQuickPick(
    [
      {
        label: "$(key) Document ID (Default)",
        description: "Sort by Firestore Document ID",
        mode: "id" as const,
      },
      {
        label: "$(edit) Custom Field Path...",
        description: "Enter a field name or dot-notation path (e.g. createdAt, meta.order)",
        mode: "custom" as const,
      },
      {
        label: "$(clear-all) Reset to Default (ID ↑)",
        description: "Restore ascending Document ID sort",
        mode: "reset" as const,
      },
    ],
    {
      title: "Order Collection By",
      placeHolder: "Select field to sort by",
    }
  );

  if (!fieldChoice) {
    return;
  }

  if (fieldChoice.mode === "reset") {
    await explorerDataProvider.orderBy(item.reference.path, "id", "asc", connectionId);
    return;
  }

  let field: string | undefined;
  if (fieldChoice.mode === "id") {
    field = "id";
  } else {
    const fieldString = await vscode.window.showInputBox({
      prompt: "Field name or dot-notation path to order by",
      title: "Order by",
      placeHolder: "e.g. createdAt or profile.name",
      validateInput: (v) => (v.trim() ? undefined : "Field path cannot be empty"),
    });

    if (!fieldString || !fieldString.trim()) {
      return;
    }
    field = fieldString.trim();
  }

  const pick = (await vscode.window.showQuickPick(
    [
      { label: "Ascending", picked: true },
      { label: "Descending" },
    ],
    {
      placeHolder: "Direction",
      title: "Order by",
    }
  )) as { label: string; picked: boolean } | undefined;

  if (!pick) {
    return;
  }

  const direction: OrderByDirection = pick.label === "Descending" ? "desc" : "asc";
  await explorerDataProvider.orderBy(item.reference.path, field, direction, connectionId);
}
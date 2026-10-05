import { OrderByDirection } from "firebase-admin/firestore";
import * as vscode from "vscode";
import ExplorerDataProvider from "../explorer/ExplorerDataProvider";
import { CollectionItem, DocumentItem, Item } from "../explorer/items";

export default async function orderBy(item: Item, explorerDataProvider: ExplorerDataProvider) {
  if (!item.reference) {
    return;
  }

  const fieldString = await vscode.window.showInputBox({
    prompt: "Field name to order by",
    title: "Order by",
    placeHolder: "Field path",
  });

  const field: string | undefined =
    fieldString === undefined || fieldString === "" ? undefined : fieldString;

  if (field === undefined) {
    return;
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
  const connectionId =
    (item as CollectionItem).connectionId || (item as DocumentItem).connectionId;

  explorerDataProvider.orderBy(item.reference.path, field, direction, connectionId);
}
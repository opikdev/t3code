import { expect, it } from "vite-plus/test";

import { blockedWorkItemIds, WorkItemId, type WorkItemStatus } from "./workItem.ts";

it("counts only open, live blockers", () => {
  const item = (id: string, status: WorkItemStatus, deletedAt: string | null = null) => ({
    id: WorkItemId.make(id),
    status,
    deletedAt,
  });
  const items = [
    item("open-blocker", "in_progress"),
    item("done-blocker", "done"),
    item("deleted-blocker", "todo", "2026-11-01T00:00:00.000Z"),
    item("a", "todo"),
    item("b", "todo"),
    item("c", "todo"),
    item("d", "todo"),
  ];
  const link = (sourceId: string, targetId: string, kind: "blocks" | "relates" = "blocks") => ({
    sourceId: WorkItemId.make(sourceId),
    targetId: WorkItemId.make(targetId),
    kind,
  });
  const blocked = blockedWorkItemIds(items, [
    link("open-blocker", "a"),
    link("done-blocker", "b"),
    link("deleted-blocker", "c"),
    link("open-blocker", "d", "relates"),
  ]);
  expect([...blocked]).toEqual(["a"]);
});

import { workItemColumns } from "@t3tools/client-runtime/state/work-items";
import {
  type WorkItem,
  WorkItemId,
  WorkItemSpaceId,
  type WorkItemStatus,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { dropPlacement, placementRank } from "./workItems.logic";

const item = (
  number: number,
  status: WorkItemStatus,
  rank: number,
  parent: number | null = null,
): WorkItem => ({
  id: WorkItemId.make(`item-${number}`),
  spaceId: WorkItemSpaceId.make("space"),
  number,
  type: "task",
  status,
  priority: "none",
  title: `Item ${number}`,
  projectId: null,
  parentId: parent === null ? null : WorkItemId.make(`item-${parent}`),
  assignee: null,
  labels: [],
  size: null,
  threadIds: [],
  rank,
  createdBy: { kind: "user" },
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
  completedAt: null,
  deletedAt: null,
});
const id = (number: number) => WorkItemId.make(`item-${number}`);

describe("board drops", () => {
  const columns = workItemColumns([
    item(1, "todo", 1024),
    item(2, "todo", 2048),
    item(3, "todo", 3072),
    item(4, "done", 1024),
  ]);

  it("takes the slot of the card it lands on, in either direction and across columns", () => {
    expect(dropPlacement(columns, id(1), { kind: "item", id: id(3) })).toEqual({
      status: "todo",
      afterId: id(3),
    });
    expect(dropPlacement(columns, id(3), { kind: "item", id: id(1) })).toEqual({
      status: "todo",
      afterId: null,
    });
    expect(dropPlacement(columns, id(3), { kind: "item", id: id(2) })).toEqual({
      status: "todo",
      afterId: id(1),
    });
    expect(dropPlacement(columns, id(4), { kind: "item", id: id(2) })).toEqual({
      status: "todo",
      afterId: id(1),
    });
    expect(dropPlacement(columns, id(1), { kind: "column", status: "done" })).toEqual({
      status: "done",
      afterId: undefined,
    });
    expect(dropPlacement(columns, id(1), { kind: "item", id: id(1) })).toBeNull();
  });

  it("predicts a rank that sorts the card where it was dropped", () => {
    const todo = columns.get("todo") ?? [];
    const ranks = [
      placementRank(todo, id(3), id(1)),
      placementRank(todo, id(3), null),
      placementRank(todo, id(1), undefined),
    ];
    expect(ranks[0]).toBeGreaterThan(1024);
    expect(ranks[0]).toBeLessThan(2048);
    expect(ranks[1]).toBeLessThan(1024);
    expect(ranks[2]).toBeGreaterThan(3072);
  });
});

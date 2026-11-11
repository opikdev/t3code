import { describe, expect, it } from "@effect/vitest";
import { type WorkItem, WorkItemId, type WorkItemLink, WorkItemSpaceId } from "@t3tools/contracts";

import { filterWorkItems, guidanceFor, relationsOf } from "./logic.ts";

const space = { key: "SHOP" };
const item = (number: number, overrides: Partial<WorkItem> = {}): WorkItem => ({
  id: WorkItemId.make(`item-${number}`),
  spaceId: WorkItemSpaceId.make("space"),
  number,
  type: "task",
  status: "todo",
  priority: "none",
  title: `Item ${number}`,
  projectId: null,
  parentId: null,
  assignee: null,
  labels: [],
  size: null,
  threadIds: [],
  rank: number,
  createdBy: { kind: "user" },
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
  completedAt: null,
  deletedAt: null,
  ...overrides,
});
const link = (source: number, target: number, kind: WorkItemLink["kind"]): WorkItemLink => ({
  sourceId: WorkItemId.make(`item-${source}`),
  targetId: WorkItemId.make(`item-${target}`),
  kind,
  createdAt: "2026-11-01T00:00:00.000Z",
});

describe("work item MCP logic", () => {
  it("offers only unblocked todo leaf items, most urgent first, then board order", () => {
    const items = [
      item(1, { priority: "low", rank: 1 }),
      item(2, { priority: "urgent", rank: 5 }),
      item(3, { priority: "urgent", rank: 2 }),
      item(4, { priority: "urgent" }),
      item(5, { status: "in_progress" }),
      item(6, { type: "epic", priority: "urgent" }),
      item(7, { status: "done" }),
      item(8, { priority: "high" }),
    ];
    const { items: ready } = filterWorkItems(
      items,
      [link(5, 4, "blocks"), link(7, 8, "blocks"), link(5, 1, "relates")],
      { ready: true },
    );
    expect(ready.map((entry) => entry.number)).toEqual([3, 2, 8, 1]);
  });

  it("names each relation from the item's side", () => {
    const items = [item(1), item(2), item(3), item(4)];
    const relations = relationsOf(
      space,
      WorkItemId.make("item-1"),
      [link(2, 1, "blocks"), link(1, 3, "blocks"), link(4, 1, "duplicates"), link(1, 2, "relates")],
      new Map(items.map((entry) => [entry.id, entry])),
    );
    expect(relations.map((relation) => `${relation.relation} ${relation.key}`)).toEqual([
      "blocked_by SHOP-2",
      "blocks SHOP-3",
      "duplicate_of SHOP-4",
      "relates SHOP-2",
    ]);
  });

  it("tells agents to split large items and finish blockers first", () => {
    const guidance = guidanceFor(item(1, { type: "bug", size: "xl" }), ["SHOP-2"]);
    expect(guidance).toContain("failing test first");
    expect(guidance).toContain("split it into child items");
    expect(guidance).toContain("Blocked by SHOP-2");
  });
});

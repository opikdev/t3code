import {
  type WorkItem,
  WorkItemId,
  type WorkItemLink,
  type WorkItemSpace,
  WorkItemSpaceId,
} from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import { applyWorkItemSpaceEvent, type WorkItemBoard } from "./workItems.ts";

const space: WorkItemSpace = {
  id: WorkItemSpaceId.make("space"),
  key: "SHOP",
  name: "Shop",
  description: "",
  projectIds: [],
  archivedAt: null,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
};
const item = (number: number, title = `Item ${number}`): WorkItem => ({
  id: WorkItemId.make(`item-${number}`),
  spaceId: space.id,
  number,
  type: "task",
  status: "todo",
  priority: "none",
  title,
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
});
const link: WorkItemLink = {
  sourceId: WorkItemId.make("item-1"),
  targetId: WorkItemId.make("item-2"),
  kind: "blocks",
  createdAt: "2026-11-01T00:00:00.000Z",
};

it("ignores deltas before the snapshot and replays deltas idempotently after it", () => {
  expect(applyWorkItemSpaceEvent(null, { type: "itemUpserted", item: item(1) })).toBeNull();

  const events = [
    { type: "snapshot", space, items: [item(1), item(2)], links: [link] },
    { type: "itemUpserted", item: item(1, "Renamed") },
    { type: "itemUpserted", item: item(1, "Renamed") },
    { type: "itemUpserted", item: item(3) },
    { type: "linkAdded", link },
    { type: "itemRemoved", id: WorkItemId.make("item-2") },
    { type: "linkRemoved", sourceId: link.sourceId, targetId: link.targetId, kind: "blocks" },
  ] as const;
  const board = events.reduce<WorkItemBoard | null>(applyWorkItemSpaceEvent, null);
  expect(board?.items.map((entry) => entry.title)).toEqual(["Renamed", "Item 3"]);
  expect(board?.links).toEqual([]);
});

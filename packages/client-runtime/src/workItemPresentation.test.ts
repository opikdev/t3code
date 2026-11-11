import {
  type WorkItem,
  WorkItemId,
  WorkItemSpaceId,
  type WorkItemStatus,
} from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import { workItemTree } from "./workItemPresentation.ts";

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
it("nests children under their parent when both are in the group", () => {
  const rows = workItemTree([
    item(1, "todo", 1),
    item(2, "todo", 2, 1),
    item(3, "todo", 3),
    item(4, "todo", 0, 2),
    item(5, "todo", 4, 9),
  ]);
  expect(rows.map((row) => `${row.item.number}:${row.depth}`)).toEqual([
    "1:0",
    "2:1",
    "4:2",
    "3:0",
    "5:0",
  ]);
});

import {
  blockedWorkItemIds,
  type WorkItem,
  type WorkItemAssignee,
  type WorkItemId,
  type WorkItemPriority,
  type WorkItemSize,
  type WorkItemStatus,
  type WorkItemType,
} from "@t3tools/contracts";

export const WORK_ITEM_STATUS_OPTIONS: ReadonlyArray<{
  readonly value: WorkItemStatus;
  readonly label: string;
}> = [
  { value: "backlog", label: "Backlog" },
  { value: "todo", label: "Todo" },
  { value: "in_progress", label: "In Progress" },
  { value: "in_review", label: "In Review" },
  { value: "done", label: "Done" },
  { value: "canceled", label: "Canceled" },
];

export const WORK_ITEM_TYPE_OPTIONS: ReadonlyArray<{
  readonly value: WorkItemType;
  readonly label: string;
}> = [
  { value: "epic", label: "Epic" },
  { value: "feature", label: "Feature" },
  { value: "task", label: "Task" },
  { value: "bug", label: "Bug" },
  { value: "chore", label: "Chore" },
  { value: "spike", label: "Spike" },
];

export const WORK_ITEM_PRIORITY_OPTIONS: ReadonlyArray<{
  readonly value: WorkItemPriority;
  readonly label: string;
}> = [
  { value: "urgent", label: "Urgent" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
  { value: "none", label: "No priority" },
];

export const WORK_ITEM_SIZE_OPTIONS: ReadonlyArray<{
  readonly value: WorkItemSize;
  readonly label: string;
}> = [
  { value: "xs", label: "XS" },
  { value: "s", label: "S" },
  { value: "m", label: "M" },
  { value: "l", label: "L" },
  { value: "xl", label: "XL" },
];

export const WORK_ITEM_ASSIGNEE_OPTIONS: ReadonlyArray<{
  readonly value: WorkItemAssignee;
  readonly label: string;
}> = [
  { value: "human", label: "Me" },
  { value: "agent", label: "Agent" },
];

export function optionLabel<V extends string>(
  options: ReadonlyArray<{ readonly value: V; readonly label: string }>,
  value: V | null,
  fallback = "None",
): string {
  return options.find((option) => option.value === value)?.label ?? fallback;
}

export type WorkItemView = "board" | "list" | "table";

export interface WorkItemFilterState {
  readonly query: string;
  readonly types: ReadonlyArray<WorkItemType>;
  readonly priorities: ReadonlyArray<WorkItemPriority>;
  readonly assignee: WorkItemAssignee | "unassigned" | null;
  readonly blockedOnly: boolean;
}

export const EMPTY_WORK_ITEM_FILTERS: WorkItemFilterState = {
  query: "",
  types: [],
  priorities: [],
  assignee: null,
  blockedOnly: false,
};

export function filterWorkItems(
  items: ReadonlyArray<WorkItem>,
  blocked: ReadonlySet<WorkItemId>,
  filters: WorkItemFilterState,
  keyOf: (item: WorkItem) => string,
): ReadonlyArray<WorkItem> {
  const query = filters.query.trim().toLowerCase();
  return items.filter(
    (item) =>
      (query === "" ||
        item.title.toLowerCase().includes(query) ||
        keyOf(item).toLowerCase() === query) &&
      (filters.types.length === 0 || filters.types.includes(item.type)) &&
      (filters.priorities.length === 0 || filters.priorities.includes(item.priority)) &&
      (filters.assignee === null ||
        (filters.assignee === "unassigned"
          ? item.assignee === null
          : item.assignee === filters.assignee)) &&
      (!filters.blockedOnly || blocked.has(item.id)),
  );
}

const PRIORITY_RANK: Record<WorkItemPriority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
  none: 4,
};
const STATUS_RANK = new Map(WORK_ITEM_STATUS_OPTIONS.map((option, index) => [option.value, index]));
const TYPE_RANK = new Map(WORK_ITEM_TYPE_OPTIONS.map((option, index) => [option.value, index]));

export type WorkItemSortKey = "key" | "title" | "type" | "status" | "priority" | "updated";

export function sortWorkItems(
  items: ReadonlyArray<WorkItem>,
  key: WorkItemSortKey,
  descending: boolean,
): ReadonlyArray<WorkItem> {
  const compare = (left: WorkItem, right: WorkItem): number => {
    switch (key) {
      case "key":
        return left.number - right.number;
      case "title":
        return left.title.localeCompare(right.title);
      case "type":
        return (TYPE_RANK.get(left.type) ?? 0) - (TYPE_RANK.get(right.type) ?? 0);
      case "status":
        return (STATUS_RANK.get(left.status) ?? 0) - (STATUS_RANK.get(right.status) ?? 0);
      case "priority":
        return PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority];
      case "updated":
        return left.updatedAt.localeCompare(right.updatedAt);
    }
  };
  return items.toSorted((left, right) => {
    const order = compare(left, right) || left.number - right.number;
    return descending ? -order : order;
  });
}

export interface WorkItemTreeRow {
  readonly item: WorkItem;
  readonly depth: number;
}

/** Board order, with each item's children right under it when they are in the same group. */
export function workItemTree(items: ReadonlyArray<WorkItem>): ReadonlyArray<WorkItemTreeRow> {
  const ordered = items.toSorted((left, right) => left.rank - right.rank);
  const ids = new Set(ordered.map((item) => item.id));
  const children = new Map<WorkItemId, Array<WorkItem>>();
  for (const item of ordered) {
    if (item.parentId === null || !ids.has(item.parentId)) continue;
    const list = children.get(item.parentId) ?? [];
    list.push(item);
    children.set(item.parentId, list);
  }
  const rows: Array<WorkItemTreeRow> = [];
  const visit = (item: WorkItem, depth: number) => {
    rows.push({ item, depth });
    for (const child of children.get(item.id) ?? []) visit(child, depth + 1);
  };
  for (const item of ordered) {
    if (item.parentId === null || !ids.has(item.parentId)) visit(item, 0);
  }
  return rows;
}

export { blockedWorkItemIds };

export type WorkItemDropTarget =
  | { readonly kind: "column"; readonly status: WorkItemStatus }
  | { readonly kind: "item"; readonly id: WorkItemId };

export interface WorkItemPlacement {
  readonly status: WorkItemStatus;
  /** Null: first in the column. Undefined: last. */
  readonly afterId: WorkItemId | null | undefined;
}

/** A card dropped on another card takes its slot; dropped on a column, it goes last. */
export function dropPlacement(
  columns: ReadonlyMap<WorkItemStatus, ReadonlyArray<WorkItem>>,
  activeId: WorkItemId,
  target: WorkItemDropTarget,
): WorkItemPlacement | null {
  if (target.kind === "column") return { status: target.status, afterId: undefined };
  if (target.id === activeId) return null;
  for (const [status, column] of columns) {
    const overIndex = column.findIndex((item) => item.id === target.id);
    if (overIndex === -1) continue;
    const activeIndex = column.findIndex((item) => item.id === activeId);
    const movingDown = activeIndex !== -1 && activeIndex < overIndex;
    if (movingDown) return { status, afterId: target.id };
    const others = column.filter((item) => item.id !== activeId);
    const before = others[others.findIndex((item) => item.id === target.id) - 1];
    return { status, afterId: before?.id ?? null };
  }
  return null;
}

/** The rank the server will give the item, so the card stays put while the move saves. */
export function placementRank(
  column: ReadonlyArray<WorkItem>,
  activeId: WorkItemId,
  afterId: WorkItemId | null | undefined,
): number {
  const others = column.filter((item) => item.id !== activeId);
  if (afterId === undefined) return (others.at(-1)?.rank ?? 0) + 1024;
  if (afterId === null) return (others[0]?.rank ?? 2048) - 1024;
  const index = others.findIndex((item) => item.id === afterId);
  const low = others[index];
  const high = others[index + 1];
  if (low === undefined) return (others.at(-1)?.rank ?? 0) + 1024;
  return high === undefined ? low.rank + 1024 : (low.rank + high.rank) / 2;
}

export function startAgentPrompt(key: string, title: string): string {
  return `Work on ${key}: ${title}. Read it with work_item_read, set it to in_progress, and follow its guidance.`;
}

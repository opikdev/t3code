import {
  blockedWorkItemIds,
  isWorkItemOpen,
  type WorkItem,
  type WorkItemId,
  type WorkItemLink,
  type WorkItemPriority,
  type WorkItemSpace,
  type WorkItemStatus,
  type WorkItemType,
} from "@t3tools/contracts";

const PRIORITY_ORDER: Record<WorkItemPriority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
  none: 4,
};

export interface WorkItemFilters {
  readonly status?: ReadonlyArray<WorkItemStatus> | undefined;
  readonly type?: ReadonlyArray<WorkItemType> | undefined;
  readonly parent?: WorkItemId | undefined;
  readonly query?: string | undefined;
  readonly ready?: boolean | undefined;
}

export const compactSpace = (space: WorkItemSpace) => ({
  key: space.key,
  name: space.name,
  projectIds: space.projectIds,
});

export function keyOf(space: Pick<WorkItemSpace, "key">, item: Pick<WorkItem, "number">) {
  return `${space.key}-${item.number}`;
}

export function compactItem(
  space: Pick<WorkItemSpace, "key">,
  item: WorkItem,
  numbers: ReadonlyMap<WorkItemId, number>,
  blocked: ReadonlySet<WorkItemId>,
) {
  const parentNumber = item.parentId === null ? undefined : numbers.get(item.parentId);
  return {
    key: keyOf(space, item),
    type: item.type,
    status: item.status,
    priority: item.priority,
    title: item.title,
    projectId: item.projectId,
    parent: parentNumber === undefined ? null : `${space.key}-${parentNumber}`,
    assignee: item.assignee,
    labels: item.labels,
    size: item.size,
    blocked: blocked.has(item.id),
  };
}

/** Ready work: todo leaf items with no open blocker, most urgent first, then board order. */
export function filterWorkItems(
  items: ReadonlyArray<WorkItem>,
  links: ReadonlyArray<WorkItemLink>,
  filters: WorkItemFilters,
): { readonly items: ReadonlyArray<WorkItem>; readonly blocked: ReadonlySet<WorkItemId> } {
  const blocked = blockedWorkItemIds(items, links);
  const query = filters.query?.trim().toLowerCase();
  const matched = items.filter(
    (item) =>
      (filters.status === undefined || filters.status.includes(item.status)) &&
      (filters.type === undefined || filters.type.includes(item.type)) &&
      (filters.parent === undefined || item.parentId === filters.parent) &&
      (query === undefined || query === "" || item.title.toLowerCase().includes(query)) &&
      (filters.ready !== true ||
        (item.status === "todo" && item.type !== "epic" && !blocked.has(item.id))),
  );
  const ordered = matched.toSorted((left, right) =>
    filters.ready === true
      ? PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority] || left.rank - right.rank
      : left.number - right.number,
  );
  return { items: ordered, blocked };
}

const TYPE_GUIDANCE: Record<WorkItemType, string> = {
  epic: "Plan, do not code. Split it into child items with work_item_save (parent = this key) and link blockers.",
  feature:
    "Build it in projectId's repo until the acceptance criteria pass, open a PR, then set status in_review.",
  task: "Do the work in projectId's repo, open a PR, then set status in_review.",
  bug: "Reproduce it with a failing test first, then fix it, open a PR, and set status in_review.",
  chore:
    "Change code without changing behavior, keep tests passing, open a PR, then set status in_review.",
  spike: "Research only and change no code. Post findings with `comment`, then set status done.",
};

export function guidanceFor(item: WorkItem, openBlockerKeys: ReadonlyArray<string>): string {
  const parts = [TYPE_GUIDANCE[item.type]];
  if (item.type !== "epic" && (item.size === "l" || item.size === "xl")) {
    parts.push("It is sized large: split it into child items before coding.");
  }
  if (openBlockerKeys.length > 0) {
    parts.push(`Blocked by ${openBlockerKeys.join(", ")}. Finish those first or ask the user.`);
  }
  if (!isWorkItemOpen(item.status)) parts.push(`It is already ${item.status}.`);
  return parts.join(" ");
}

type Relation = "blocks" | "blocked_by" | "relates" | "duplicates" | "duplicate_of";

/** The item's links, named from its side. */
export function relationsOf(
  space: Pick<WorkItemSpace, "key">,
  itemId: WorkItemId,
  links: ReadonlyArray<WorkItemLink>,
  itemsById: ReadonlyMap<WorkItemId, WorkItem>,
) {
  return links.flatMap((link) => {
    const outgoing = link.sourceId === itemId;
    if (!outgoing && link.targetId !== itemId) return [];
    const other = itemsById.get(outgoing ? link.targetId : link.sourceId);
    if (other === undefined) return [];
    const relation: Relation =
      link.kind === "relates"
        ? "relates"
        : link.kind === "blocks"
          ? outgoing
            ? "blocks"
            : "blocked_by"
          : outgoing
            ? "duplicates"
            : "duplicate_of";
    return [{ relation, key: keyOf(space, other), title: other.title, status: other.status }];
  });
}

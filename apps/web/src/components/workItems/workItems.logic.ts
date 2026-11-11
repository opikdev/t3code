import type { WorkItem, WorkItemId, WorkItemStatus } from "@t3tools/contracts";

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

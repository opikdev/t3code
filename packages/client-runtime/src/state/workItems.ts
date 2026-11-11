import {
  WORK_ITEM_WS_METHODS,
  type WorkItem,
  type WorkItemLink,
  type WorkItemSpace,
  type WorkItemSpaceEvent,
  type WorkItemStatus,
} from "@t3tools/contracts";
import * as Stream from "effect/Stream";
import type { Atom } from "effect/reactivity";

import type * as EnvironmentRegistry from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

export interface WorkItemBoard {
  readonly space: WorkItemSpace;
  readonly items: ReadonlyArray<WorkItem>;
  readonly links: ReadonlyArray<WorkItemLink>;
}

const sameLink = (
  link: Pick<WorkItemLink, "sourceId" | "targetId" | "kind">,
  other: Pick<WorkItemLink, "sourceId" | "targetId" | "kind">,
) =>
  link.sourceId === other.sourceId && link.targetId === other.targetId && link.kind === other.kind;

/** Deltas are idempotent, so replaying one the snapshot already has leaves the board unchanged. */
export function applyWorkItemSpaceEvent(
  board: WorkItemBoard | null,
  event: WorkItemSpaceEvent,
): WorkItemBoard | null {
  if (event.type === "snapshot") {
    return { space: event.space, items: event.items, links: event.links };
  }
  if (board === null) return null;
  switch (event.type) {
    case "spaceUpdated":
      return { ...board, space: event.space };
    case "itemUpserted": {
      const index = board.items.findIndex((item) => item.id === event.item.id);
      const items =
        index === -1 ? [...board.items, event.item] : board.items.with(index, event.item);
      return { ...board, items };
    }
    case "itemRemoved":
      return { ...board, items: board.items.filter((item) => item.id !== event.id) };
    case "linkAdded":
      return board.links.some((link) => sameLink(link, event.link))
        ? board
        : { ...board, links: [...board.links, event.link] };
    case "linkRemoved":
      return { ...board, links: board.links.filter((link) => !sameLink(link, event)) };
  }
}

export function workItemKey(space: Pick<WorkItemSpace, "key">, item: Pick<WorkItem, "number">) {
  return `${space.key}-${item.number}`;
}

/** Items per status in board order. */
export function workItemColumns(
  items: ReadonlyArray<WorkItem>,
): ReadonlyMap<WorkItemStatus, ReadonlyArray<WorkItem>> {
  const columns = new Map<WorkItemStatus, Array<WorkItem>>();
  for (const item of [...items].sort((left, right) => left.rank - right.rank)) {
    const column = columns.get(item.status) ?? [];
    column.push(item);
    columns.set(item.status, column);
  }
  return columns;
}

export function createWorkItemAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | R, E>,
) {
  const command = <Tag extends Parameters<typeof createEnvironmentRpcCommand>[1]["tag"]>(
    name: string,
    tag: Tag,
  ) => createEnvironmentRpcCommand(runtime, { label: `environment-data:work-items:${name}`, tag });
  return {
    spacesLive: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:work-items:spaces:live",
      tag: WORK_ITEM_WS_METHODS.subscribeSpaces,
    }),
    boardLive: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:work-items:board:live",
      tag: WORK_ITEM_WS_METHODS.subscribeSpace,
      transform: (stream) =>
        stream.pipe(
          Stream.scan((): WorkItemBoard | null => null, applyWorkItemSpaceEvent),
          Stream.filter((board): board is WorkItemBoard => board !== null),
        ),
    }),
    detail: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:work-items:detail",
      tag: WORK_ITEM_WS_METHODS.read,
    }),
    deleted: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:work-items:deleted",
      tag: WORK_ITEM_WS_METHODS.listDeleted,
    }),
    createSpace: command("create-space", WORK_ITEM_WS_METHODS.createSpace),
    updateSpace: command("update-space", WORK_ITEM_WS_METHODS.updateSpace),
    setSpaceArchived: command("set-space-archived", WORK_ITEM_WS_METHODS.setSpaceArchived),
    create: command("create", WORK_ITEM_WS_METHODS.create),
    update: command("update", WORK_ITEM_WS_METHODS.update),
    move: command("move", WORK_ITEM_WS_METHODS.move),
    setLink: command("set-link", WORK_ITEM_WS_METHODS.setLink),
    comment: command("comment", WORK_ITEM_WS_METHODS.comment),
    setDeleted: command("set-deleted", WORK_ITEM_WS_METHODS.setDeleted),
  };
}

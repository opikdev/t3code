import * as Schema from "effect/Schema";

import {
  ForwardCompatibleArray,
  IsoDateTime,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";

export const WorkItemSpaceId = TrimmedNonEmptyString.pipe(Schema.brand("WorkItemSpaceId"));
export type WorkItemSpaceId = typeof WorkItemSpaceId.Type;

export const WorkItemId = TrimmedNonEmptyString.pipe(Schema.brand("WorkItemId"));
export type WorkItemId = typeof WorkItemId.Type;

const WORK_ITEM_TYPES = ["epic", "feature", "task", "bug", "chore", "spike"] as const;
export const WorkItemType = Schema.Literals(WORK_ITEM_TYPES);
export type WorkItemType = typeof WorkItemType.Type;

const WORK_ITEM_STATUSES = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "canceled",
] as const;
export const WorkItemStatus = Schema.Literals(WORK_ITEM_STATUSES);
export type WorkItemStatus = typeof WorkItemStatus.Type;

const WORK_ITEM_PRIORITIES = ["urgent", "high", "medium", "low", "none"] as const;
export const WorkItemPriority = Schema.Literals(WORK_ITEM_PRIORITIES);
export type WorkItemPriority = typeof WorkItemPriority.Type;

const WORK_ITEM_SIZES = ["xs", "s", "m", "l", "xl"] as const;
export const WorkItemSize = Schema.Literals(WORK_ITEM_SIZES);
export type WorkItemSize = typeof WorkItemSize.Type;

export const WorkItemAssignee = Schema.Literals(["human", "agent"]);
export type WorkItemAssignee = typeof WorkItemAssignee.Type;

/** `blocks` is directional (source blocks target); `relates` is stored with the lower id first. */
const WORK_ITEM_LINK_KINDS = ["blocks", "relates", "duplicates"] as const;
export const WorkItemLinkKind = Schema.Literals(WORK_ITEM_LINK_KINDS);
export type WorkItemLinkKind = typeof WorkItemLinkKind.Type;

export const WorkItemActor = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("user") }),
  Schema.Struct({ kind: Schema.Literal("agent"), threadId: ThreadId }),
]);
export type WorkItemActor = typeof WorkItemActor.Type;

const WORK_ITEM_TITLE_MAX_CHARS = 200;
const WORK_ITEM_DESCRIPTION_MAX_CHARS = 50_000;
const WORK_ITEM_COMMENT_MAX_CHARS = 20_000;
const WORK_ITEM_MAX_LABELS = 20;

const WorkItemTitle = TrimmedNonEmptyString.check(Schema.isMaxLength(WORK_ITEM_TITLE_MAX_CHARS));
const WorkItemDescription = Schema.String.check(
  Schema.isMaxLength(WORK_ITEM_DESCRIPTION_MAX_CHARS),
);
const WorkItemLabel = TrimmedNonEmptyString.check(Schema.isMaxLength(40));
const WorkItemLabels = Schema.Array(WorkItemLabel).check(Schema.isMaxLength(WORK_ITEM_MAX_LABELS));

export const WorkItemSpaceKey = TrimmedNonEmptyString.check(
  Schema.isPattern(/^[A-Z][A-Z0-9]{1,5}$/),
).annotate({ description: "2-6 uppercase letters or digits, starting with a letter, like SHOP." });
export type WorkItemSpaceKey = typeof WorkItemSpaceKey.Type;

export const WorkItemSpace = Schema.Struct({
  id: WorkItemSpaceId,
  key: WorkItemSpaceKey,
  name: TrimmedNonEmptyString,
  description: Schema.String,
  projectIds: Schema.Array(ProjectId),
  archivedAt: Schema.NullOr(IsoDateTime),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type WorkItemSpace = typeof WorkItemSpace.Type;

/** List shape: the description and activity come from `workItems.read`. */
export const WorkItem = Schema.Struct({
  id: WorkItemId,
  spaceId: WorkItemSpaceId,
  number: Schema.Int.check(Schema.isGreaterThan(0)),
  type: WorkItemType,
  status: WorkItemStatus,
  priority: WorkItemPriority,
  title: WorkItemTitle,
  projectId: Schema.NullOr(ProjectId),
  parentId: Schema.NullOr(WorkItemId),
  assignee: Schema.NullOr(WorkItemAssignee),
  labels: WorkItemLabels,
  size: Schema.NullOr(WorkItemSize),
  threadIds: Schema.Array(ThreadId),
  rank: Schema.Number,
  createdBy: WorkItemActor,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  completedAt: Schema.NullOr(IsoDateTime),
  deletedAt: Schema.NullOr(IsoDateTime),
});
export type WorkItem = typeof WorkItem.Type;

export const WorkItemLink = Schema.Struct({
  sourceId: WorkItemId,
  targetId: WorkItemId,
  kind: WorkItemLinkKind,
  createdAt: IsoDateTime,
});
export type WorkItemLink = typeof WorkItemLink.Type;

export const WorkItemActivityKind = Schema.Literals([
  "created",
  "updated",
  "commented",
  "linked",
  "unlinked",
  "deleted",
  "restored",
]);
export type WorkItemActivityKind = typeof WorkItemActivityKind.Type;

export const WorkItemFieldChange = Schema.Struct({
  field: TrimmedNonEmptyString,
  from: Schema.NullOr(Schema.String),
  to: Schema.NullOr(Schema.String),
});
export type WorkItemFieldChange = typeof WorkItemFieldChange.Type;

export const WorkItemActivity = Schema.Struct({
  id: TrimmedNonEmptyString,
  workItemId: WorkItemId,
  actor: WorkItemActor,
  kind: Schema.Union([WorkItemActivityKind, Schema.String]),
  body: Schema.NullOr(Schema.String),
  changes: Schema.Array(WorkItemFieldChange),
  createdAt: IsoDateTime,
});
export type WorkItemActivity = typeof WorkItemActivity.Type;

export const WorkItemDetail = Schema.Struct({
  item: WorkItem,
  description: Schema.String,
  activity: ForwardCompatibleArray(WorkItemActivity),
});
export type WorkItemDetail = typeof WorkItemDetail.Type;

// Space stream: a snapshot, then idempotent deltas a client applies by id.
export const WorkItemSpaceEvent = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("snapshot"),
    space: WorkItemSpace,
    items: ForwardCompatibleArray(WorkItem),
    links: ForwardCompatibleArray(WorkItemLink),
  }),
  Schema.Struct({ type: Schema.Literal("spaceUpdated"), space: WorkItemSpace }),
  Schema.Struct({ type: Schema.Literal("itemUpserted"), item: WorkItem }),
  Schema.Struct({ type: Schema.Literal("itemRemoved"), id: WorkItemId }),
  Schema.Struct({ type: Schema.Literal("linkAdded"), link: WorkItemLink }),
  Schema.Struct({
    type: Schema.Literal("linkRemoved"),
    sourceId: WorkItemId,
    targetId: WorkItemId,
    kind: WorkItemLinkKind,
  }),
]);
export type WorkItemSpaceEvent = typeof WorkItemSpaceEvent.Type;

export const WorkItemSpaceListInput = Schema.Struct({});
export type WorkItemSpaceListInput = typeof WorkItemSpaceListInput.Type;

export const WorkItemSpaceListResult = Schema.Struct({
  spaces: ForwardCompatibleArray(WorkItemSpace),
});
export type WorkItemSpaceListResult = typeof WorkItemSpaceListResult.Type;

export const WorkItemSpaceSubscribeInput = Schema.Struct({ spaceId: WorkItemSpaceId });
export type WorkItemSpaceSubscribeInput = typeof WorkItemSpaceSubscribeInput.Type;

export const WorkItemSpaceCreateInput = Schema.Struct({
  key: WorkItemSpaceKey,
  name: TrimmedNonEmptyString,
  description: Schema.optional(Schema.String),
  projectIds: Schema.Array(ProjectId),
});
export type WorkItemSpaceCreateInput = typeof WorkItemSpaceCreateInput.Type;

/** The key is fixed at creation so existing references like SHOP-12 stay valid. */
export const WorkItemSpaceUpdateInput = Schema.Struct({
  id: WorkItemSpaceId,
  name: Schema.optional(TrimmedNonEmptyString),
  description: Schema.optional(Schema.String),
  projectIds: Schema.optional(Schema.Array(ProjectId)),
});
export type WorkItemSpaceUpdateInput = typeof WorkItemSpaceUpdateInput.Type;

export const WorkItemSpaceSetArchivedInput = Schema.Struct({
  id: WorkItemSpaceId,
  archived: Schema.Boolean,
});
export type WorkItemSpaceSetArchivedInput = typeof WorkItemSpaceSetArchivedInput.Type;

export const WorkItemSpaceMutationResult = Schema.Struct({ space: WorkItemSpace });
export type WorkItemSpaceMutationResult = typeof WorkItemSpaceMutationResult.Type;

export const WorkItemCreateInput = Schema.Struct({
  spaceId: WorkItemSpaceId,
  type: WorkItemType,
  title: WorkItemTitle,
  description: Schema.optional(WorkItemDescription),
  status: Schema.optional(WorkItemStatus).annotate({ description: "Default: backlog." }),
  priority: Schema.optional(WorkItemPriority).annotate({ description: "Default: none." }),
  projectId: Schema.optional(Schema.NullOr(ProjectId)).annotate({
    description: "The repo to work in. Required for every type except epic.",
  }),
  parentId: Schema.optional(Schema.NullOr(WorkItemId)),
  assignee: Schema.optional(Schema.NullOr(WorkItemAssignee)),
  labels: Schema.optional(WorkItemLabels),
  size: Schema.optional(Schema.NullOr(WorkItemSize)),
});
export type WorkItemCreateInput = typeof WorkItemCreateInput.Type;

/** Omitted fields keep their stored value; `null` clears a nullable field. */
export const WorkItemUpdateInput = Schema.Struct({
  id: WorkItemId,
  type: Schema.optional(WorkItemType),
  title: Schema.optional(WorkItemTitle),
  description: Schema.optional(WorkItemDescription),
  status: Schema.optional(WorkItemStatus),
  priority: Schema.optional(WorkItemPriority),
  projectId: Schema.optional(Schema.NullOr(ProjectId)),
  parentId: Schema.optional(Schema.NullOr(WorkItemId)),
  assignee: Schema.optional(Schema.NullOr(WorkItemAssignee)),
  labels: Schema.optional(WorkItemLabels),
  size: Schema.optional(Schema.NullOr(WorkItemSize)),
  threadIds: Schema.optional(Schema.Array(ThreadId)),
});
export type WorkItemUpdateInput = typeof WorkItemUpdateInput.Type;

export const WorkItemMoveInput = Schema.Struct({
  id: WorkItemId,
  status: WorkItemStatus,
  afterId: Schema.optional(Schema.NullOr(WorkItemId)).annotate({
    description: "Place right after this item in the column. Null: first. Omitted: last.",
  }),
});
export type WorkItemMoveInput = typeof WorkItemMoveInput.Type;

export const WorkItemSetLinkInput = Schema.Struct({
  sourceId: WorkItemId,
  targetId: WorkItemId,
  kind: WorkItemLinkKind,
  linked: Schema.Boolean,
});
export type WorkItemSetLinkInput = typeof WorkItemSetLinkInput.Type;

export const WorkItemCommentInput = Schema.Struct({
  id: WorkItemId,
  body: TrimmedNonEmptyString.check(Schema.isMaxLength(WORK_ITEM_COMMENT_MAX_CHARS)),
});
export type WorkItemCommentInput = typeof WorkItemCommentInput.Type;

export const WorkItemSetDeletedInput = Schema.Struct({
  id: WorkItemId,
  deleted: Schema.Boolean,
});
export type WorkItemSetDeletedInput = typeof WorkItemSetDeletedInput.Type;

export const WorkItemReadInput = Schema.Struct({ id: WorkItemId });
export type WorkItemReadInput = typeof WorkItemReadInput.Type;

export const WorkItemListDeletedInput = Schema.Struct({ spaceId: WorkItemSpaceId });
export type WorkItemListDeletedInput = typeof WorkItemListDeletedInput.Type;

export const WorkItemListDeletedResult = Schema.Struct({
  items: ForwardCompatibleArray(WorkItem),
});
export type WorkItemListDeletedResult = typeof WorkItemListDeletedResult.Type;

export const WorkItemMutationResult = Schema.Struct({ item: WorkItem });
export type WorkItemMutationResult = typeof WorkItemMutationResult.Type;

export const WorkItemReadResult = Schema.Struct({ detail: WorkItemDetail });
export type WorkItemReadResult = typeof WorkItemReadResult.Type;

export const WorkItemSetLinkResult = Schema.Struct({ links: Schema.Array(WorkItemLink) });
export type WorkItemSetLinkResult = typeof WorkItemSetLinkResult.Type;

export class WorkItemError extends Schema.TaggedError<WorkItemError>()("WorkItemError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

export function isWorkItemOpen(status: WorkItemStatus): boolean {
  return status !== "done" && status !== "canceled";
}

/** Epics sit at the top of the tree; every other type may nest under any non-epic or an epic. */
export function isAllowedWorkItemParent(childType: WorkItemType): boolean {
  return childType !== "epic";
}

/** Items with at least one open blocker. */
export function blockedWorkItemIds(
  items: ReadonlyArray<Pick<WorkItem, "id" | "status" | "deletedAt">>,
  links: ReadonlyArray<Pick<WorkItemLink, "sourceId" | "targetId" | "kind">>,
): ReadonlySet<WorkItemId> {
  const openIds = new Set(
    items
      .filter((item) => item.deletedAt === null && isWorkItemOpen(item.status))
      .map((item) => item.id),
  );
  const blocked = new Set<WorkItemId>();
  for (const link of links) {
    if (link.kind === "blocks" && openIds.has(link.sourceId)) blocked.add(link.targetId);
  }
  return blocked;
}

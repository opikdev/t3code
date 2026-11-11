import {
  IsoDateTime,
  OrchestratorMcpEnvironmentTarget,
  OrchestratorMcpFailure,
  ProjectId,
  TrimmedNonEmptyString,
  WorkItemAssignee,
  WorkItemLinkKind,
  WorkItemPriority,
  WorkItemSize,
  WorkItemStatus,
  WorkItemType,
} from "@t3tools/contracts";
import { Tool, Toolkit } from "effect/ai";
import * as Schema from "effect/Schema";

import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as WorkItemService from "../../../workItems/WorkItemService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  ThreadManagementService.ThreadManagementService,
  WorkItemService.WorkItemService,
];

const ItemRef = TrimmedNonEmptyString.annotate({ description: "Work item key, like SHOP-12." });

const McpWorkItemSpace = Schema.Struct({
  key: Schema.String,
  name: Schema.String,
  projectIds: Schema.Array(ProjectId),
});

const McpWorkItem = Schema.Struct({
  key: Schema.String,
  type: WorkItemType,
  status: WorkItemStatus,
  priority: WorkItemPriority,
  title: Schema.String,
  projectId: Schema.NullOr(ProjectId),
  parent: Schema.NullOr(Schema.String),
  assignee: Schema.NullOr(WorkItemAssignee),
  labels: Schema.Array(Schema.String),
  size: Schema.NullOr(WorkItemSize),
  blocked: Schema.Boolean,
});

const McpWorkItemRelation = Schema.Struct({
  relation: Schema.Literals(["blocks", "blocked_by", "relates", "duplicates", "duplicate_of"]),
  key: Schema.String,
  title: Schema.String,
  status: WorkItemStatus,
});

const WorkItemListTool = Tool.make("work_item_list", {
  description:
    "List work items in a space, the tracker for one or more repos. Omit `space` for the space holding this thread's repo; with none or several, `spaces` lists the choices. `ready=true`: unblocked todo items, most urgent first. Take the first to pick up work.",
  parameters: Schema.Struct({
    environmentId: OrchestratorMcpEnvironmentTarget,
    space: Schema.optional(
      TrimmedNonEmptyString.annotate({ description: "Space key, like SHOP." }),
    ),
    status: Schema.optional(Schema.Array(WorkItemStatus)),
    type: Schema.optional(Schema.Array(WorkItemType)),
    parent: Schema.optional(ItemRef),
    query: Schema.optional(Schema.String),
    ready: Schema.optional(Schema.Boolean),
    limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 200 }))),
  }),
  success: Schema.Struct({
    space: Schema.NullOr(McpWorkItemSpace),
    spaces: Schema.Array(McpWorkItemSpace),
    items: Schema.Array(McpWorkItem),
    truncated: Schema.Boolean,
  }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "List work items")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true);

const WorkItemReadTool = Tool.make("work_item_read", {
  description:
    "Read one work item: description, children, relations, recent activity, and `guidance` on how to work it. Read before you start.",
  parameters: Schema.Struct({
    environmentId: OrchestratorMcpEnvironmentTarget,
    item: ItemRef,
  }),
  success: Schema.Struct({
    item: Schema.Struct({ ...McpWorkItem.fields, description: Schema.String }),
    children: Schema.Array(
      Schema.Struct({ key: Schema.String, title: Schema.String, status: WorkItemStatus }),
    ),
    relations: Schema.Array(McpWorkItemRelation),
    activity: Schema.Array(
      Schema.Struct({
        at: IsoDateTime,
        by: Schema.String,
        kind: Schema.String,
        body: Schema.NullOr(Schema.String),
        changes: Schema.Array(Schema.String),
      }),
    ),
    guidance: Schema.String,
  }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Read a work item")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true);

const WorkItemSaveTool = Tool.make("work_item_save", {
  description:
    "Create a work item (omit `item`; needs `type` and `title`) or update one (only given fields change). Non-epics need `projectId`, by default this thread's repo. Set status in_progress when you start and in_review once your PR is open; that links your thread. `comment` posts a note, such as findings.",
  parameters: Schema.Struct({
    environmentId: OrchestratorMcpEnvironmentTarget,
    item: Schema.optional(ItemRef),
    space: Schema.optional(TrimmedNonEmptyString.annotate({ description: "For a new item." })),
    type: Schema.optional(WorkItemType),
    title: Schema.optional(TrimmedNonEmptyString),
    description: Schema.optional(
      Schema.String.annotate({ description: "Markdown, with acceptance criteria as a checklist." }),
    ),
    status: Schema.optional(WorkItemStatus),
    priority: Schema.optional(WorkItemPriority),
    projectId: Schema.optional(Schema.NullOr(ProjectId)),
    parent: Schema.optional(Schema.NullOr(ItemRef)),
    assignee: Schema.optional(Schema.NullOr(WorkItemAssignee)),
    labels: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
    size: Schema.optional(Schema.NullOr(WorkItemSize)),
    comment: Schema.optional(TrimmedNonEmptyString),
  }),
  success: Schema.Struct({ item: McpWorkItem }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Save a work item")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false);

const WorkItemLinkTool = Tool.make("work_item_link", {
  description:
    "Relate two work items: `item` blocks `target`, relates to it, or duplicates it. `linked=false` removes the link. Blocking loops are rejected.",
  parameters: Schema.Struct({
    environmentId: OrchestratorMcpEnvironmentTarget,
    item: ItemRef,
    kind: WorkItemLinkKind,
    target: ItemRef,
    linked: Schema.optional(Schema.Boolean),
  }),
  success: Schema.Struct({ relations: Schema.Array(McpWorkItemRelation) }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Link work items")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true);

export const WorkItemToolkit = Toolkit.make(
  WorkItemListTool,
  WorkItemReadTool,
  WorkItemSaveTool,
  WorkItemLinkTool,
);

import {
  OrchestratorMcpFailure,
  type WorkItem,
  type WorkItemActor,
  type WorkItemError,
  type WorkItemId,
  type WorkItemSpace,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as WorkItemService from "../../../workItems/WorkItemService.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { type Caller, readCaller } from "../../threadAccess.ts";
import {
  compactItem,
  compactSpace,
  filterWorkItems,
  guidanceFor,
  keyOf,
  relationsOf,
} from "./logic.ts";
import { WorkItemToolkit } from "./tools.ts";

const DEFAULT_LIST_LIMIT = 50;
const ACTIVITY_LIMIT = 20;

const invalid = (error: WorkItemError) =>
  new OrchestratorMcpFailure({ code: "invalid_request", message: error.message });

const actorOf = (context: Caller): WorkItemActor => ({
  kind: "agent",
  threadId: context.caller?.id ?? null,
});

/** The named space, or the one space holding the calling thread's repo. */
const callerSpace = Effect.fn("WorkItemMcp.callerSpace")(function* (
  context: Caller,
  ref: string | undefined,
) {
  const service = yield* WorkItemService.WorkItemService;
  if (ref !== undefined) return { space: yield* service.resolveSpace(ref), choices: [] };
  const choices =
    context.caller === undefined
      ? (yield* service.listSpaces()).spaces.filter((space) => space.archivedAt === null)
      : yield* service.spacesForProject(context.caller.projectId);
  const [only] = choices;
  return { space: choices.length === 1 && only !== undefined ? only : null, choices };
});

const loadSpace = Effect.fn("WorkItemMcp.loadSpace")(function* (space: WorkItemSpace) {
  const service = yield* WorkItemService.WorkItemService;
  const snapshot = yield* service.snapshot(space.id);
  const itemsById = new Map(snapshot.items.map((item) => [item.id, item]));
  const numbers = new Map(snapshot.items.map((item) => [item.id, item.number]));
  return { ...snapshot, itemsById, numbers };
});

const compactOne = Effect.fn("WorkItemMcp.compactOne")(function* (item: WorkItem) {
  const service = yield* WorkItemService.WorkItemService;
  const space = yield* service.resolveSpace(item.spaceId);
  const loaded = yield* loadSpace(space);
  const { blocked } = filterWorkItems(loaded.items, loaded.links, {});
  return compactItem(space, item, loaded.numbers, blocked);
});

const handlers = {
  work_item_list: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      const context = yield* readCaller();
      const { space, choices } = yield* callerSpace(context, input.space);
      if (space === null) {
        return { space: null, spaces: choices.map(compactSpace), items: [], truncated: false };
      }
      const service = yield* WorkItemService.WorkItemService;
      const loaded = yield* loadSpace(space);
      const parent =
        input.parent === undefined ? undefined : (yield* service.resolveItem(input.parent)).id;
      const { items, blocked } = filterWorkItems(loaded.items, loaded.links, {
        status: input.status,
        type: input.type,
        parent,
        query: input.query,
        ready: input.ready,
      });
      const limit = input.limit ?? DEFAULT_LIST_LIMIT;
      return {
        space: compactSpace(space),
        spaces: [],
        items: items
          .slice(0, limit)
          .map((item) => compactItem(space, item, loaded.numbers, blocked)),
        truncated: items.length > limit,
      };
    }).pipe(Effect.catchTags({ WorkItemError: (error) => Effect.fail(invalid(error)) })),
  ),
  work_item_read: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      yield* readCaller();
      const service = yield* WorkItemService.WorkItemService;
      const target = yield* service.resolveItem(input.item);
      const space = yield* service.resolveSpace(target.spaceId);
      const loaded = yield* loadSpace(space);
      const { detail } = yield* service.read(target.id);
      const { blocked } = filterWorkItems(loaded.items, loaded.links, {});
      const relations = relationsOf(space, target.id, loaded.links, loaded.itemsById);
      const openBlockers = relations.filter(
        (relation) =>
          relation.relation === "blocked_by" &&
          relation.status !== "done" &&
          relation.status !== "canceled",
      );
      return {
        item: {
          ...compactItem(space, detail.item, loaded.numbers, blocked),
          description: detail.description,
        },
        children: loaded.items
          .filter((item) => item.parentId === target.id)
          .map((item) => ({ key: keyOf(space, item), title: item.title, status: item.status })),
        relations,
        activity: detail.activity.slice(-ACTIVITY_LIMIT).map((entry) => ({
          at: entry.createdAt,
          by: entry.actor.kind,
          kind: entry.kind,
          body: entry.body,
          changes: entry.changes.map(
            (change) => `${change.field}: ${change.from ?? "-"} -> ${change.to ?? "-"}`,
          ),
        })),
        guidance: guidanceFor(
          detail.item,
          openBlockers.map((relation) => relation.key),
        ),
      };
    }).pipe(Effect.catchTags({ WorkItemError: (error) => Effect.fail(invalid(error)) })),
  ),
  work_item_save: McpToolAccess.writes(
    (input) =>
      Effect.gen(function* () {
        const context = yield* readCaller();
        const service = yield* WorkItemService.WorkItemService;
        const actor = actorOf(context);
        const parentId =
          input.parent === undefined
            ? undefined
            : input.parent === null
              ? null
              : (yield* service.resolveItem(input.parent)).id;
        const threadId = context.caller?.id;
        const linksThread =
          threadId !== undefined &&
          (input.status === "in_progress" || input.status === "in_review");
        let saved: WorkItem;
        if (input.item === undefined) {
          if (input.type === undefined || input.title === undefined) {
            return yield* new OrchestratorMcpFailure({
              code: "invalid_request",
              message: "A new work item needs `type` and `title`. To update one, pass `item`.",
            });
          }
          const { space, choices } = yield* callerSpace(context, input.space);
          if (space === null) {
            return yield* new OrchestratorMcpFailure({
              code: "target_required",
              message:
                choices.length === 0
                  ? "No space holds this thread's repo. Pass `space`; work_item_list lists spaces."
                  : `Pass \`space\`: ${choices.map((choice) => choice.key).join(", ")}.`,
            });
          }
          const callerRepo = context.caller?.projectId;
          const projectId =
            input.projectId !== undefined
              ? input.projectId
              : input.type !== "epic" &&
                  callerRepo !== undefined &&
                  space.projectIds.includes(callerRepo)
                ? callerRepo
                : null;
          saved = (yield* service.create(
            {
              spaceId: space.id,
              type: input.type,
              title: input.title,
              projectId,
              ...(input.description === undefined ? {} : { description: input.description }),
              ...(input.status === undefined ? {} : { status: input.status }),
              ...(input.priority === undefined ? {} : { priority: input.priority }),
              ...(parentId === undefined ? {} : { parentId }),
              ...(input.assignee === undefined ? {} : { assignee: input.assignee }),
              ...(input.labels === undefined ? {} : { labels: input.labels }),
              ...(input.size === undefined ? {} : { size: input.size }),
            },
            actor,
          )).item;
          if (linksThread) {
            saved = (yield* service.update({ id: saved.id, threadIds: [threadId] }, actor)).item;
          }
        } else {
          const target = yield* service.resolveItem(input.item);
          saved = (yield* service.update(
            {
              id: target.id,
              ...(input.type === undefined ? {} : { type: input.type }),
              ...(input.title === undefined ? {} : { title: input.title }),
              ...(input.description === undefined ? {} : { description: input.description }),
              ...(input.status === undefined ? {} : { status: input.status }),
              ...(input.priority === undefined ? {} : { priority: input.priority }),
              ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
              ...(parentId === undefined ? {} : { parentId }),
              ...(input.assignee === undefined ? {} : { assignee: input.assignee }),
              ...(input.labels === undefined ? {} : { labels: input.labels }),
              ...(input.size === undefined ? {} : { size: input.size }),
              ...(linksThread && !target.threadIds.includes(threadId)
                ? { threadIds: [...target.threadIds, threadId] }
                : {}),
            },
            actor,
          )).item;
        }
        if (input.comment !== undefined) {
          yield* service.comment({ id: saved.id, body: input.comment }, actor);
        }
        return { item: yield* compactOne(saved) };
      }).pipe(Effect.catchTags({ WorkItemError: (error) => Effect.fail(invalid(error)) })),
    { linkedCallers: "allowed" },
  ),
  work_item_link: McpToolAccess.writes(
    (input) =>
      Effect.gen(function* () {
        const context = yield* readCaller();
        const service = yield* WorkItemService.WorkItemService;
        const source = yield* service.resolveItem(input.item);
        const target = yield* service.resolveItem(input.target);
        yield* service.setLink(
          {
            sourceId: source.id,
            targetId: target.id,
            kind: input.kind,
            linked: input.linked ?? true,
          },
          actorOf(context),
        );
        const space = yield* service.resolveSpace(source.spaceId);
        const loaded = yield* loadSpace(space);
        return {
          relations: relationsOf(
            space,
            source.id satisfies WorkItemId,
            loaded.links,
            loaded.itemsById,
          ),
        };
      }).pipe(Effect.catchTags({ WorkItemError: (error) => Effect.fail(invalid(error)) })),
    { linkedCallers: "allowed" },
  ),
} satisfies McpToolAccess.Handlers<typeof WorkItemToolkit.tools>;

export const layer = McpToolAccess.toLayer(WorkItemToolkit, handlers);

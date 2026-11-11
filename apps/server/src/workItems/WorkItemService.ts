import {
  isAllowedWorkItemParent,
  isWorkItemOpen,
  type ProjectId,
  WorkItem,
  WorkItemActivity,
  type WorkItemActor,
  type WorkItemCommentInput,
  type WorkItemCreateInput,
  WorkItemError,
  type WorkItemFieldChange,
  WorkItemId,
  type WorkItemLink,
  type WorkItemLinkKind,
  type WorkItemListDeletedResult,
  type WorkItemMoveInput,
  type WorkItemMutationResult,
  type WorkItemReadResult,
  type WorkItemSetDeletedInput,
  type WorkItemSetLinkInput,
  type WorkItemSetLinkResult,
  WorkItemSpace,
  type WorkItemSpaceCreateInput,
  type WorkItemSpaceEvent,
  WorkItemSpaceId,
  type WorkItemSpaceListResult,
  type WorkItemSpaceMutationResult,
  type WorkItemSpaceSetArchivedInput,
  type WorkItemSpaceUpdateInput,
  type WorkItemStatus,
  type WorkItemUpdateInput,
  WorkItemLink as WorkItemLinkSchema,
  WorkItemActor as WorkItemActorSchema,
  WorkItemFieldChange as WorkItemFieldChangeSchema,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import type * as SqlError from "effect/sql/SqlError";

import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import { runWorkItemMigrations } from "./WorkItemMigrations.ts";

export const USER_ACTOR: WorkItemActor = { kind: "user" };

const RANK_STEP = 1024;
const MIN_RANK_GAP = 1e-6;
const ACTIVITY_READ_LIMIT = 500;

export interface WorkItemSpaceSnapshot {
  readonly space: WorkItemSpace;
  readonly items: ReadonlyArray<WorkItem>;
  readonly links: ReadonlyArray<WorkItemLink>;
}

export class WorkItemService extends Context.Service<
  WorkItemService,
  {
    readonly listSpaces: () => Effect.Effect<WorkItemSpaceListResult, WorkItemError>;
    readonly subscribeSpaces: () => Stream.Stream<WorkItemSpaceListResult, WorkItemError>;
    readonly snapshot: (
      spaceId: WorkItemSpaceId,
    ) => Effect.Effect<WorkItemSpaceSnapshot, WorkItemError>;
    readonly subscribeSpace: (
      spaceId: WorkItemSpaceId,
    ) => Stream.Stream<WorkItemSpaceEvent, WorkItemError>;
    readonly spacesForProject: (
      projectId: ProjectId,
    ) => Effect.Effect<ReadonlyArray<WorkItemSpace>, WorkItemError>;
    readonly read: (id: WorkItemId) => Effect.Effect<WorkItemReadResult, WorkItemError>;
    readonly listDeleted: (
      spaceId: WorkItemSpaceId,
    ) => Effect.Effect<WorkItemListDeletedResult, WorkItemError>;
    readonly createSpace: (
      input: WorkItemSpaceCreateInput,
    ) => Effect.Effect<WorkItemSpaceMutationResult, WorkItemError>;
    readonly updateSpace: (
      input: WorkItemSpaceUpdateInput,
    ) => Effect.Effect<WorkItemSpaceMutationResult, WorkItemError>;
    readonly setSpaceArchived: (
      input: WorkItemSpaceSetArchivedInput,
    ) => Effect.Effect<WorkItemSpaceMutationResult, WorkItemError>;
    readonly create: (
      input: WorkItemCreateInput,
      actor: WorkItemActor,
    ) => Effect.Effect<WorkItemMutationResult, WorkItemError>;
    readonly update: (
      input: WorkItemUpdateInput,
      actor: WorkItemActor,
    ) => Effect.Effect<WorkItemMutationResult, WorkItemError>;
    readonly move: (
      input: WorkItemMoveInput,
      actor: WorkItemActor,
    ) => Effect.Effect<WorkItemMutationResult, WorkItemError>;
    readonly setLink: (
      input: WorkItemSetLinkInput,
      actor: WorkItemActor,
    ) => Effect.Effect<WorkItemSetLinkResult, WorkItemError>;
    readonly comment: (
      input: WorkItemCommentInput,
      actor: WorkItemActor,
    ) => Effect.Effect<WorkItemReadResult, WorkItemError>;
    readonly setDeleted: (
      input: WorkItemSetDeletedInput,
      actor: WorkItemActor,
    ) => Effect.Effect<WorkItemMutationResult, WorkItemError>;
  }
>()("t3/workItems/WorkItemService") {}

const fail = (message: string) => new WorkItemError({ message });
const failWith = (message: string) => (cause: unknown) => new WorkItemError({ message, cause });

interface SpaceRow {
  readonly space_id: string;
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly next_number: number;
  readonly archived_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

interface ItemRow {
  readonly work_item_id: string;
  readonly space_id: string;
  readonly number: number;
  readonly type: string;
  readonly status: string;
  readonly priority: string;
  readonly title: string;
  readonly description: string;
  readonly project_id: string | null;
  readonly parent_id: string | null;
  readonly assignee: string | null;
  readonly labels_json: string;
  readonly size: string | null;
  readonly thread_ids_json: string;
  readonly rank: number;
  readonly created_by_json: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly completed_at: string | null;
  readonly deleted_at: string | null;
}

interface LinkRow {
  readonly source_id: string;
  readonly target_id: string;
  readonly kind: string;
  readonly created_at: string;
}

interface ActivityRow {
  readonly activity_id: string;
  readonly work_item_id: string;
  readonly actor_json: string;
  readonly kind: string;
  readonly body: string | null;
  readonly changes_json: string;
  readonly created_at: string;
}

const decodeSpace = Schema.decodeUnknownEffect(WorkItemSpace);
const decodeItem = Schema.decodeUnknownEffect(WorkItem);
const decodeLink = Schema.decodeUnknownEffect(WorkItemLinkSchema);
const decodeActivity = Schema.decodeUnknownEffect(WorkItemActivity);
const ActorJson = Schema.fromJsonString(WorkItemActorSchema);
const encodeActorJson = Schema.encodeSync(ActorJson);
const ChangesJson = Schema.fromJsonString(Schema.Array(WorkItemFieldChangeSchema));
const encodeChangesJson = Schema.encodeSync(ChangesJson);

const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const StringListJson = Schema.fromJsonString(Schema.Array(Schema.String));
const encodeStringListJson = Schema.encodeSync(StringListJson);

const rowToItem = Effect.fnUntraced(function* (row: ItemRow) {
  return yield* decodeItem({
    id: row.work_item_id,
    spaceId: row.space_id,
    number: row.number,
    type: row.type,
    status: row.status,
    priority: row.priority,
    title: row.title,
    projectId: row.project_id,
    parentId: row.parent_id,
    assignee: row.assignee,
    labels: yield* decodeJson(row.labels_json),
    size: row.size,
    threadIds: yield* decodeJson(row.thread_ids_json),
    rank: row.rank,
    createdBy: yield* decodeJson(row.created_by_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    deletedAt: row.deleted_at,
  });
});

const rowToLink = (row: LinkRow) =>
  decodeLink({
    sourceId: row.source_id,
    targetId: row.target_id,
    kind: row.kind,
    createdAt: row.created_at,
  });

const rowToActivity = Effect.fnUntraced(function* (row: ActivityRow) {
  return yield* decodeActivity({
    id: row.activity_id,
    workItemId: row.work_item_id,
    actor: yield* decodeJson(row.actor_json),
    kind: row.kind,
    body: row.body,
    changes: yield* decodeJson(row.changes_json),
    createdAt: row.created_at,
  });
});

const dedupe = <A>(values: ReadonlyArray<A>): Array<A> => [...new Set(values)];

const fieldValue = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
};

/** Description changes are recorded without their text to keep activity small. */
function diffItems(
  before: WorkItem,
  after: WorkItem,
  descriptionChanged: boolean,
): Array<WorkItemFieldChange> {
  const fields = [
    "title",
    "type",
    "status",
    "priority",
    "projectId",
    "parentId",
    "assignee",
    "labels",
    "size",
    "threadIds",
  ] as const;
  const changes: Array<WorkItemFieldChange> = [];
  for (const field of fields) {
    const from = fieldValue(before[field]);
    const to = fieldValue(after[field]);
    if (from !== to) changes.push({ field, from, to });
  }
  if (descriptionChanged) changes.push({ field: "description", from: null, to: null });
  return changes;
}

const isClosedStatus = (status: WorkItemStatus) => !isWorkItemOpen(status);

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const random = yield* SecureRandom.SecureRandom;
  const projects = yield* ProjectStore.ProjectStoreV2;

  yield* runWorkItemMigrations().pipe(Effect.orDie);

  // Writes are few and small; one permit keeps numbering, ranks and cycle checks consistent.
  const writeLock = yield* Semaphore.make(1);
  const spaceEvents = yield* PubSub.unbounded<{
    readonly spaceId: WorkItemSpaceId;
    readonly event: WorkItemSpaceEvent;
  }>();
  // Space list subscribers re-read the whole (small) list, so they need only the newest signal.
  const spacesChanged = yield* PubSub.sliding<void>(1);

  const now = DateTime.now.pipe(Effect.map((value) => DateTime.formatIso(value)));
  const newId = (prefix: string) =>
    random.uuidV4().pipe(
      Effect.map((uuid) => `${prefix}:${uuid}`),
      Effect.mapError(failWith("Could not generate an id.")),
    );

  const query = <A>(effect: Effect.Effect<A, SqlError.SqlError>, message: string) =>
    effect.pipe(Effect.mapError(failWith(message)));

  const selectSpaceRows = (spaceId?: WorkItemSpaceId) =>
    sql<SpaceRow>`
      SELECT * FROM work_item_spaces
      ${spaceId === undefined ? sql`` : sql`WHERE space_id = ${spaceId}`}
      ORDER BY name COLLATE NOCASE, created_at
    `;

  const loadSpaces = Effect.fn("WorkItemService.loadSpaces")(function* (spaceId?: WorkItemSpaceId) {
    const rows = yield* query(selectSpaceRows(spaceId), "Could not read spaces.");
    if (rows.length === 0) return [];
    const memberRows = yield* query(
      sql<{ readonly space_id: string; readonly project_id: string }>`
        SELECT space_id, project_id FROM work_item_space_projects
        WHERE ${sql.in(
          "space_id",
          rows.map((row) => row.space_id),
        )}
        ORDER BY position
      `,
      "Could not read space repos.",
    );
    const members = new Map<string, Array<string>>();
    for (const member of memberRows) {
      const list = members.get(member.space_id) ?? [];
      list.push(member.project_id);
      members.set(member.space_id, list);
    }
    return yield* Effect.forEach(rows, (row) =>
      decodeSpace({
        id: row.space_id,
        key: row.key,
        name: row.name,
        description: row.description,
        projectIds: members.get(row.space_id) ?? [],
        archivedAt: row.archived_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }).pipe(Effect.mapError(failWith("A stored space is invalid."))),
    );
  });

  const requireSpace = Effect.fn("WorkItemService.requireSpace")(function* (
    spaceId: WorkItemSpaceId,
  ) {
    const [space] = yield* loadSpaces(spaceId);
    if (space === undefined) return yield* fail(`Space ${spaceId} does not exist.`);
    return space;
  });

  const requireWritableSpace = Effect.fn("WorkItemService.requireWritableSpace")(function* (
    spaceId: WorkItemSpaceId,
  ) {
    const space = yield* requireSpace(spaceId);
    if (space.archivedAt !== null) {
      return yield* fail(`Space ${space.key} is archived. Restore it first.`);
    }
    return space;
  });

  const findItemRow = (id: WorkItemId) =>
    query(
      sql<ItemRow>`SELECT * FROM work_items WHERE work_item_id = ${id}`,
      "Could not read the work item.",
    ).pipe(Effect.map((rows) => rows[0]));

  const requireItem = Effect.fn("WorkItemService.requireItem")(function* (
    id: WorkItemId,
    options?: { readonly includeDeleted?: boolean },
  ) {
    const row = yield* findItemRow(id);
    if (row === undefined || (row.deleted_at !== null && options?.includeDeleted !== true)) {
      return yield* fail(`Work item ${id} does not exist.`);
    }
    const item = yield* rowToItem(row).pipe(
      Effect.mapError(failWith("A stored work item is invalid.")),
    );
    return { row, item };
  });

  const loadItems = Effect.fn("WorkItemService.loadItems")(function* (
    spaceId: WorkItemSpaceId,
    deleted: boolean,
  ) {
    const rows = yield* query(
      deleted
        ? sql<ItemRow>`
            SELECT * FROM work_items WHERE space_id = ${spaceId} AND deleted_at IS NOT NULL
            ORDER BY deleted_at DESC`
        : sql<ItemRow>`
            SELECT * FROM work_items WHERE space_id = ${spaceId} AND deleted_at IS NULL
            ORDER BY status, rank`,
      "Could not read work items.",
    );
    return yield* Effect.forEach(rows, (row) =>
      rowToItem(row).pipe(Effect.mapError(failWith("A stored work item is invalid."))),
    );
  });

  const loadLinks = Effect.fn("WorkItemService.loadLinks")(function* (spaceId: WorkItemSpaceId) {
    const rows = yield* query(
      sql<LinkRow>`SELECT * FROM work_item_links WHERE space_id = ${spaceId} ORDER BY created_at`,
      "Could not read work item links.",
    );
    return yield* Effect.forEach(rows, (row) =>
      rowToLink(row).pipe(Effect.mapError(failWith("A stored link is invalid."))),
    );
  });

  const publishSpaceEvents = (
    spaceId: WorkItemSpaceId,
    events: ReadonlyArray<WorkItemSpaceEvent>,
  ) =>
    Effect.forEach(events, (event) => PubSub.publish(spaceEvents, { spaceId, event }), {
      discard: true,
    });

  const notifySpacesChanged = PubSub.publish(spacesChanged, undefined).pipe(Effect.asVoid);

  const insertActivity = Effect.fn("WorkItemService.insertActivity")(function* (input: {
    readonly workItemId: WorkItemId;
    readonly actor: WorkItemActor;
    readonly kind: string;
    readonly body?: string;
    readonly changes?: ReadonlyArray<WorkItemFieldChange>;
    readonly at: string;
  }) {
    const id = yield* newId("work-item-activity");
    yield* query(
      sql`
        INSERT INTO work_item_activity
          (activity_id, work_item_id, actor_json, kind, body, changes_json, created_at)
        VALUES (
          ${id}, ${input.workItemId}, ${encodeActorJson(input.actor)}, ${input.kind},
          ${input.body ?? null}, ${encodeChangesJson(input.changes ?? [])}, ${input.at}
        )
      `,
      "Could not record work item activity.",
    );
  });

  const validateProjectIds = Effect.fn("WorkItemService.validateProjectIds")(function* (
    projectIds: ReadonlyArray<ProjectId>,
  ) {
    if (projectIds.length === 0) return;
    const found = yield* projects
      .list({ projectIds })
      .pipe(Effect.mapError(failWith("Could not read projects.")));
    const foundIds = new Set(found.map((project) => project.projectId));
    const missing = projectIds.filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
      return yield* fail(`Unknown project: ${missing.join(", ")}.`);
    }
  });

  const validateRepo = Effect.fn("WorkItemService.validateRepo")(function* (
    space: WorkItemSpace,
    type: WorkItem["type"],
    projectId: ProjectId | null,
  ) {
    if (projectId === null) {
      if (type !== "epic") {
        return yield* fail(
          `A ${type} needs a repo. Pick one of space ${space.key}'s repos as projectId.`,
        );
      }
      return;
    }
    if (!space.projectIds.includes(projectId)) {
      return yield* fail(`Project ${projectId} is not a repo in space ${space.key}.`);
    }
  });

  const validateParent = Effect.fn("WorkItemService.validateParent")(function* (input: {
    readonly itemId: WorkItemId | null;
    readonly spaceId: WorkItemSpaceId;
    readonly type: WorkItem["type"];
    readonly parentId: WorkItemId | null;
  }) {
    if (input.parentId === null) return;
    if (!isAllowedWorkItemParent(input.type)) {
      return yield* fail("An epic cannot have a parent.");
    }
    if (input.parentId === input.itemId) return yield* fail("An item cannot be its own parent.");
    const { item: parent } = yield* requireItem(input.parentId);
    if (parent.spaceId !== input.spaceId) {
      return yield* fail("The parent must be in the same space.");
    }
    if (input.itemId === null) return;
    const ancestors = yield* query(
      sql<{ readonly work_item_id: string }>`
        WITH RECURSIVE ancestors(id) AS (
          SELECT ${input.parentId}
          UNION
          SELECT work_items.parent_id FROM work_items
          JOIN ancestors ON work_items.work_item_id = ancestors.id
          WHERE work_items.parent_id IS NOT NULL
        )
        SELECT id AS work_item_id FROM ancestors WHERE id = ${input.itemId}
      `,
      "Could not check the parent chain.",
    );
    if (ancestors.length > 0) {
      return yield* fail("That parent is one of this item's children, which would make a loop.");
    }
  });

  const columnRanks = (spaceId: WorkItemSpaceId, status: WorkItemStatus, excludeId: WorkItemId) =>
    query(
      sql<{ readonly work_item_id: string; readonly rank: number }>`
        SELECT work_item_id, rank FROM work_items
        WHERE space_id = ${spaceId} AND status = ${status} AND deleted_at IS NULL
          AND work_item_id != ${excludeId}
        ORDER BY rank
      `,
      "Could not read the column order.",
    );

  const endRank = Effect.fn("WorkItemService.endRank")(function* (
    spaceId: WorkItemSpaceId,
    status: WorkItemStatus,
    excludeId: WorkItemId,
  ) {
    const column = yield* columnRanks(spaceId, status, excludeId);
    const last = column.at(-1);
    return last === undefined ? RANK_STEP : last.rank + RANK_STEP;
  });

  /** Returns the new rank and any items whose rank was respaced to make room. */
  const rankAfter = Effect.fn("WorkItemService.rankAfter")(function* (
    spaceId: WorkItemSpaceId,
    status: WorkItemStatus,
    itemId: WorkItemId,
    afterId: WorkItemId | null,
  ) {
    const slot = (
      column: ReadonlyArray<{ readonly work_item_id: string; readonly rank: number }>,
    ) => {
      if (afterId === null) return { low: undefined, high: column[0]?.rank };
      const index = column.findIndex((entry) => entry.work_item_id === afterId);
      const low = column[index];
      return low === undefined ? undefined : { low: low.rank, high: column[index + 1]?.rank };
    };
    let column = yield* columnRanks(spaceId, status, itemId);
    let gap = slot(column);
    if (gap === undefined)
      return yield* fail(`Work item ${afterId} is not in the ${status} column.`);
    const respaced: Array<WorkItemId> = [];
    if (gap.low !== undefined && gap.high !== undefined && gap.high - gap.low < MIN_RANK_GAP) {
      for (const [index, entry] of column.entries()) {
        yield* query(
          sql`UPDATE work_items SET rank = ${(index + 1) * RANK_STEP}
              WHERE work_item_id = ${entry.work_item_id}`,
          "Could not reorder the column.",
        );
        respaced.push(WorkItemId.make(entry.work_item_id));
      }
      column = yield* columnRanks(spaceId, status, itemId);
      gap = slot(column) ?? gap;
    }
    const rank =
      gap.low === undefined
        ? gap.high === undefined
          ? RANK_STEP
          : gap.high - RANK_STEP
        : gap.high === undefined
          ? gap.low + RANK_STEP
          : (gap.low + gap.high) / 2;
    return { rank, respaced };
  });

  const writeItem = (item: WorkItem, description: string) =>
    query(
      sql`
        UPDATE work_items SET
          type = ${item.type},
          status = ${item.status},
          priority = ${item.priority},
          title = ${item.title},
          description = ${description},
          project_id = ${item.projectId},
          parent_id = ${item.parentId},
          assignee = ${item.assignee},
          labels_json = ${encodeStringListJson(item.labels)},
          size = ${item.size},
          thread_ids_json = ${encodeStringListJson(item.threadIds)},
          rank = ${item.rank},
          updated_at = ${item.updatedAt},
          completed_at = ${item.completedAt},
          deleted_at = ${item.deletedAt}
        WHERE work_item_id = ${item.id}
      `,
      "Could not save the work item.",
    );

  const reloadItems = (ids: ReadonlyArray<WorkItemId>) =>
    Effect.forEach(ids, (id) => requireItem(id).pipe(Effect.map(({ item }) => item)));

  /** Runs a write under the lock and in one transaction, then publishes its events. */
  const write = <A>(
    effect: Effect.Effect<
      {
        readonly result: A;
        readonly spaceId?: WorkItemSpaceId;
        readonly events?: ReadonlyArray<WorkItemSpaceEvent>;
        readonly spacesChanged?: boolean;
      },
      WorkItemError
    >,
  ) =>
    writeLock.withPermits(1)(
      Effect.gen(function* () {
        const outcome = yield* sql.withTransaction(effect).pipe(
          Effect.catchTags({
            SqlError: (cause) =>
              Effect.fail(new WorkItemError({ message: "Could not save the change.", cause })),
          }),
        );
        if (outcome.spaceId !== undefined && outcome.events !== undefined) {
          yield* publishSpaceEvents(outcome.spaceId, outcome.events);
        }
        if (outcome.spacesChanged === true) yield* notifySpacesChanged;
        return outcome.result;
      }),
    );

  const listSpaces: WorkItemService["Service"]["listSpaces"] = () =>
    loadSpaces().pipe(Effect.map((spaces) => ({ spaces })));

  const subscribeSpaces: WorkItemService["Service"]["subscribeSpaces"] = () =>
    Stream.unwrap(
      Effect.gen(function* () {
        const subscription = yield* PubSub.subscribe(spacesChanged);
        return Stream.concat(
          Stream.fromEffect(listSpaces()),
          Stream.fromSubscription(subscription).pipe(Stream.mapEffect(() => listSpaces())),
        );
      }),
    );

  const snapshot: WorkItemService["Service"]["snapshot"] = Effect.fn("WorkItemService.snapshot")(
    function* (spaceId) {
      const space = yield* requireSpace(spaceId);
      const items = yield* loadItems(spaceId, false);
      const links = yield* loadLinks(spaceId);
      return { space, items, links };
    },
  );

  const subscribeSpace: WorkItemService["Service"]["subscribeSpace"] = (spaceId) =>
    Stream.unwrap(
      Effect.gen(function* () {
        // Subscribe before reading; deltas are idempotent, so replaying ones the snapshot has is safe.
        const subscription = yield* PubSub.subscribe(spaceEvents);
        const initial = yield* snapshot(spaceId);
        return Stream.concat(
          Stream.succeed<WorkItemSpaceEvent>({ type: "snapshot", ...initial }),
          Stream.fromSubscription(subscription).pipe(
            Stream.filter((entry) => entry.spaceId === spaceId),
            Stream.map((entry) => entry.event),
          ),
        );
      }),
    );

  const spacesForProject: WorkItemService["Service"]["spacesForProject"] = Effect.fn(
    "WorkItemService.spacesForProject",
  )(function* (projectId) {
    const rows = yield* query(
      sql<{ readonly space_id: string }>`
        SELECT space_id FROM work_item_space_projects WHERE project_id = ${projectId}
      `,
      "Could not read spaces for the project.",
    );
    const ids = new Set(rows.map((row) => row.space_id));
    const spaces = yield* loadSpaces();
    return spaces.filter((space) => ids.has(space.id) && space.archivedAt === null);
  });

  const read: WorkItemService["Service"]["read"] = Effect.fn("WorkItemService.read")(
    function* (id) {
      const { row, item } = yield* requireItem(id, { includeDeleted: true });
      const activityRows = yield* query(
        sql<ActivityRow>`
          SELECT * FROM (
            SELECT *, rowid AS seq FROM work_item_activity WHERE work_item_id = ${id}
            ORDER BY created_at DESC, seq DESC LIMIT ${ACTIVITY_READ_LIMIT}
          ) ORDER BY created_at, seq
        `,
        "Could not read work item activity.",
      );
      const activity = yield* Effect.forEach(activityRows, (activityRow) =>
        rowToActivity(activityRow).pipe(Effect.mapError(failWith("Stored activity is invalid."))),
      );
      return { detail: { item, description: row.description, activity } };
    },
  );

  const listDeleted: WorkItemService["Service"]["listDeleted"] = Effect.fn(
    "WorkItemService.listDeleted",
  )(function* (spaceId) {
    yield* requireSpace(spaceId);
    return { items: yield* loadItems(spaceId, true) };
  });

  const createSpace: WorkItemService["Service"]["createSpace"] = Effect.fn(
    "WorkItemService.createSpace",
  )(function* (input) {
    return yield* write(
      Effect.gen(function* () {
        const existing = yield* query(
          sql<{
            readonly space_id: string;
          }>`SELECT space_id FROM work_item_spaces WHERE key = ${input.key}`,
          "Could not check the space key.",
        );
        if (existing.length > 0)
          return yield* fail(`A space with key ${input.key} already exists.`);
        const projectIds = dedupe(input.projectIds);
        yield* validateProjectIds(projectIds);
        const id = WorkItemSpaceId.make(yield* newId("work-item-space"));
        const at = yield* now;
        yield* query(
          sql`
            INSERT INTO work_item_spaces
              (space_id, key, name, description, next_number, archived_at, created_at, updated_at)
            VALUES (${id}, ${input.key}, ${input.name}, ${input.description ?? ""}, 1, NULL, ${at}, ${at})
          `,
          "Could not create the space.",
        );
        yield* Effect.forEach(
          projectIds,
          (projectId, position) =>
            query(
              sql`INSERT INTO work_item_space_projects (space_id, project_id, position)
                  VALUES (${id}, ${projectId}, ${position})`,
              "Could not add a repo to the space.",
            ),
          { discard: true },
        );
        const space = yield* requireSpace(id);
        return { result: { space }, spacesChanged: true };
      }),
    );
  });

  const updateSpace: WorkItemService["Service"]["updateSpace"] = Effect.fn(
    "WorkItemService.updateSpace",
  )(function* (input) {
    return yield* write(
      Effect.gen(function* () {
        const before = yield* requireSpace(input.id);
        const at = yield* now;
        if (input.projectIds !== undefined) {
          const projectIds = dedupe(input.projectIds);
          const removed = before.projectIds.filter((id) => !projectIds.includes(id));
          const added = projectIds.filter((id) => !before.projectIds.includes(id));
          yield* validateProjectIds(added);
          if (removed.length > 0) {
            const blocking = yield* query(
              sql<{ readonly project_id: string; readonly count: number }>`
                SELECT project_id, COUNT(*) AS count FROM work_items
                WHERE space_id = ${input.id} AND deleted_at IS NULL
                  AND status NOT IN ('done', 'canceled')
                  AND ${sql.in("project_id", removed)}
                GROUP BY project_id
              `,
              "Could not check open work items.",
            );
            if (blocking.length > 0) {
              const detail = blocking.map((row) => `${row.project_id} (${row.count})`).join(", ");
              return yield* fail(
                `These repos still have open work items: ${detail}. Close or move them first.`,
              );
            }
          }
          yield* query(
            sql`DELETE FROM work_item_space_projects WHERE space_id = ${input.id}`,
            "Could not update the space repos.",
          );
          yield* Effect.forEach(
            projectIds,
            (projectId, position) =>
              query(
                sql`INSERT INTO work_item_space_projects (space_id, project_id, position)
                    VALUES (${input.id}, ${projectId}, ${position})`,
                "Could not add a repo to the space.",
              ),
            { discard: true },
          );
        }
        yield* query(
          sql`
            UPDATE work_item_spaces SET
              name = ${input.name ?? before.name},
              description = ${input.description ?? before.description},
              updated_at = ${at}
            WHERE space_id = ${input.id}
          `,
          "Could not update the space.",
        );
        const space = yield* requireSpace(input.id);
        return {
          result: { space },
          spaceId: space.id,
          events: [{ type: "spaceUpdated", space }],
          spacesChanged: true,
        };
      }),
    );
  });

  const setSpaceArchived: WorkItemService["Service"]["setSpaceArchived"] = Effect.fn(
    "WorkItemService.setSpaceArchived",
  )(function* (input) {
    return yield* write(
      Effect.gen(function* () {
        const before = yield* requireSpace(input.id);
        const at = yield* now;
        const archivedAt = input.archived ? (before.archivedAt ?? at) : null;
        yield* query(
          sql`UPDATE work_item_spaces SET archived_at = ${archivedAt}, updated_at = ${at}
              WHERE space_id = ${input.id}`,
          "Could not archive the space.",
        );
        const space = yield* requireSpace(input.id);
        return {
          result: { space },
          spaceId: space.id,
          events: [{ type: "spaceUpdated", space }],
          spacesChanged: true,
        };
      }),
    );
  });

  const create: WorkItemService["Service"]["create"] = Effect.fn("WorkItemService.create")(
    function* (input, actor) {
      return yield* write(
        Effect.gen(function* () {
          const space = yield* requireWritableSpace(input.spaceId);
          const projectId = input.projectId ?? null;
          const parentId = input.parentId ?? null;
          yield* validateRepo(space, input.type, projectId);
          yield* validateParent({ itemId: null, spaceId: space.id, type: input.type, parentId });
          const id = WorkItemId.make(yield* newId("work-item"));
          const status = input.status ?? "backlog";
          const at = yield* now;
          const rank = yield* endRank(space.id, status, id);
          const numbers = yield* query(
            sql<{ readonly next_number: number }>`
              UPDATE work_item_spaces SET next_number = next_number + 1
              WHERE space_id = ${space.id}
              RETURNING next_number - 1 AS next_number
            `,
            "Could not number the work item.",
          );
          const number = numbers[0]?.next_number ?? 1;
          yield* query(
            sql`
              INSERT INTO work_items (
                work_item_id, space_id, number, type, status, priority, title, description,
                project_id, parent_id, assignee, labels_json, size, thread_ids_json, rank,
                created_by_json, created_at, updated_at, completed_at, deleted_at
              ) VALUES (
                ${id}, ${space.id}, ${number}, ${input.type}, ${status}, ${input.priority ?? "none"},
                ${input.title}, ${input.description ?? ""}, ${projectId}, ${parentId},
                ${input.assignee ?? null}, ${encodeStringListJson(dedupe(input.labels ?? []))},
                ${input.size ?? null}, ${encodeStringListJson([])}, ${rank},
                ${encodeActorJson(actor)}, ${at}, ${at},
                ${isClosedStatus(status) ? at : null}, NULL
              )
            `,
            "Could not create the work item.",
          );
          yield* insertActivity({ workItemId: id, actor, kind: "created", at });
          const { item } = yield* requireItem(id);
          return {
            result: { item },
            spaceId: space.id,
            events: [{ type: "itemUpserted", item }],
          };
        }),
      );
    },
  );

  const applyChange = Effect.fn("WorkItemService.applyChange")(function* (input: {
    readonly id: WorkItemId;
    readonly actor: WorkItemActor;
    readonly patch: WorkItemUpdateInput;
    readonly placement?: { readonly afterId: WorkItemId | null | undefined };
  }) {
    const { row, item: before } = yield* requireItem(input.id);
    const space = yield* requireWritableSpace(before.spaceId);
    const { patch } = input;
    const type = patch.type ?? before.type;
    const projectId = patch.projectId === undefined ? before.projectId : patch.projectId;
    const parentId = patch.parentId === undefined ? before.parentId : patch.parentId;
    const status = patch.status ?? before.status;
    if (type !== before.type || projectId !== before.projectId) {
      yield* validateRepo(space, type, projectId);
    }
    if (parentId !== before.parentId || type !== before.type) {
      yield* validateParent({ itemId: before.id, spaceId: space.id, type, parentId });
    }
    const at = yield* now;
    let rank = before.rank;
    let respaced: ReadonlyArray<WorkItemId> = [];
    if (input.placement !== undefined && input.placement.afterId !== undefined) {
      const placed = yield* rankAfter(space.id, status, before.id, input.placement.afterId);
      rank = placed.rank;
      respaced = placed.respaced;
    } else if (status !== before.status) {
      rank = yield* endRank(space.id, status, before.id);
    }
    const completedAt = isClosedStatus(status)
      ? isClosedStatus(before.status)
        ? before.completedAt
        : at
      : null;
    const after: WorkItem = {
      ...before,
      type,
      status,
      priority: patch.priority ?? before.priority,
      title: patch.title ?? before.title,
      projectId,
      parentId,
      assignee: patch.assignee === undefined ? before.assignee : patch.assignee,
      labels: patch.labels === undefined ? before.labels : dedupe(patch.labels),
      size: patch.size === undefined ? before.size : patch.size,
      threadIds: patch.threadIds === undefined ? before.threadIds : dedupe(patch.threadIds),
      rank,
      completedAt,
      updatedAt: at,
    };
    const description = patch.description ?? row.description;
    const changes = diffItems(before, after, description !== row.description);
    if (changes.length === 0 && rank === before.rank) {
      return { result: { item: before }, spaceId: space.id, events: [] };
    }
    yield* writeItem(after, description);
    if (changes.length > 0) {
      yield* insertActivity({
        workItemId: before.id,
        actor: input.actor,
        kind: "updated",
        changes,
        at,
      });
    }
    const respacedItems = yield* reloadItems(respaced.filter((id) => id !== before.id));
    const { item } = yield* requireItem(before.id);
    return {
      result: { item },
      spaceId: space.id,
      events: [item, ...respacedItems].map((changed): WorkItemSpaceEvent => ({
        type: "itemUpserted",
        item: changed,
      })),
    };
  });

  const update: WorkItemService["Service"]["update"] = Effect.fn("WorkItemService.update")(
    function* (input, actor) {
      return yield* write(applyChange({ id: input.id, actor, patch: input }));
    },
  );

  const move: WorkItemService["Service"]["move"] = Effect.fn("WorkItemService.move")(
    function* (input, actor) {
      return yield* write(
        applyChange({
          id: input.id,
          actor,
          patch: { id: input.id, status: input.status },
          placement: { afterId: input.afterId },
        }),
      );
    },
  );

  const reachesViaBlocks = Effect.fn("WorkItemService.reachesViaBlocks")(function* (
    from: WorkItemId,
    to: WorkItemId,
  ) {
    const rows = yield* query(
      sql<{ readonly id: string }>`
        WITH RECURSIVE reach(id) AS (
          SELECT ${from}
          UNION
          SELECT work_item_links.target_id FROM work_item_links
          JOIN reach ON work_item_links.source_id = reach.id
          WHERE work_item_links.kind = 'blocks'
        )
        SELECT id FROM reach WHERE id = ${to}
      `,
      "Could not check the blocking chain.",
    );
    return rows.length > 0;
  });

  const setLink: WorkItemService["Service"]["setLink"] = Effect.fn("WorkItemService.setLink")(
    function* (input, actor) {
      return yield* write(
        Effect.gen(function* () {
          if (input.sourceId === input.targetId) {
            return yield* fail("An item cannot link to itself.");
          }
          const { item: source } = yield* requireItem(input.sourceId);
          const { item: target } = yield* requireItem(input.targetId);
          if (source.spaceId !== target.spaceId) {
            return yield* fail("Both items must be in the same space.");
          }
          yield* requireWritableSpace(source.spaceId);
          // `relates` has no direction; store it once, lower id first.
          const [sourceId, targetId] =
            input.kind === "relates" && input.targetId < input.sourceId
              ? [input.targetId, input.sourceId]
              : [input.sourceId, input.targetId];
          const kind: WorkItemLinkKind = input.kind;
          const at = yield* now;
          const existing = yield* query(
            sql<LinkRow>`SELECT * FROM work_item_links
                WHERE source_id = ${sourceId} AND target_id = ${targetId} AND kind = ${kind}`,
            "Could not read the link.",
          );
          const events: Array<WorkItemSpaceEvent> = [];
          if (input.linked && existing.length === 0) {
            if (kind === "blocks" && (yield* reachesViaBlocks(targetId, sourceId))) {
              return yield* fail(
                "That would make a blocking loop: the target already blocks this item.",
              );
            }
            yield* query(
              sql`INSERT INTO work_item_links (space_id, source_id, target_id, kind, created_at)
                  VALUES (${source.spaceId}, ${sourceId}, ${targetId}, ${kind}, ${at})`,
              "Could not add the link.",
            );
            const change = { field: kind, from: null, to: null };
            yield* insertActivity({
              workItemId: sourceId,
              actor,
              kind: "linked",
              changes: [{ ...change, to: targetId }],
              at,
            });
            yield* insertActivity({
              workItemId: targetId,
              actor,
              kind: "linked",
              changes: [{ ...change, from: sourceId }],
              at,
            });
            events.push({ type: "linkAdded", link: { sourceId, targetId, kind, createdAt: at } });
          } else if (!input.linked && existing.length > 0) {
            yield* query(
              sql`DELETE FROM work_item_links
                  WHERE source_id = ${sourceId} AND target_id = ${targetId} AND kind = ${kind}`,
              "Could not remove the link.",
            );
            const change = { field: kind, from: null, to: null };
            yield* insertActivity({
              workItemId: sourceId,
              actor,
              kind: "unlinked",
              changes: [{ ...change, from: targetId }],
              at,
            });
            yield* insertActivity({
              workItemId: targetId,
              actor,
              kind: "unlinked",
              changes: [{ ...change, from: sourceId }],
              at,
            });
            events.push({ type: "linkRemoved", sourceId, targetId, kind });
          }
          const links = yield* loadLinks(source.spaceId);
          return {
            result: {
              links: links.filter(
                (link) => link.sourceId === input.sourceId || link.targetId === input.sourceId,
              ),
            },
            spaceId: source.spaceId,
            events,
          };
        }),
      );
    },
  );

  const comment: WorkItemService["Service"]["comment"] = Effect.fn("WorkItemService.comment")(
    function* (input, actor) {
      yield* write(
        Effect.gen(function* () {
          const { item } = yield* requireItem(input.id);
          yield* requireWritableSpace(item.spaceId);
          const at = yield* now;
          yield* insertActivity({
            workItemId: item.id,
            actor,
            kind: "commented",
            body: input.body,
            at,
          });
          return { result: undefined };
        }),
      );
      return yield* read(input.id);
    },
  );

  const setDeleted: WorkItemService["Service"]["setDeleted"] = Effect.fn(
    "WorkItemService.setDeleted",
  )(function* (input, actor) {
    return yield* write(
      Effect.gen(function* () {
        const { row, item: before } = yield* requireItem(input.id, { includeDeleted: true });
        yield* requireWritableSpace(before.spaceId);
        const deleted = before.deletedAt !== null;
        if (deleted === input.deleted) return { result: { item: before } };
        const at = yield* now;
        if (input.deleted) {
          const children = yield* query(
            sql<{ readonly count: number }>`
              SELECT COUNT(*) AS count FROM work_items
              WHERE parent_id = ${before.id} AND deleted_at IS NULL
            `,
            "Could not check child items.",
          );
          if ((children[0]?.count ?? 0) > 0) {
            return yield* fail("This item has child items. Delete or move them first.");
          }
        }
        let parentId = before.parentId;
        if (!input.deleted && parentId !== null) {
          const parent = yield* findItemRow(parentId);
          if (parent === undefined || parent.deleted_at !== null) parentId = null;
        }
        const rank = input.deleted
          ? before.rank
          : yield* endRank(before.spaceId, before.status, before.id);
        const after: WorkItem = {
          ...before,
          parentId,
          rank,
          deletedAt: input.deleted ? at : null,
          updatedAt: at,
        };
        yield* writeItem(after, row.description);
        yield* insertActivity({
          workItemId: before.id,
          actor,
          kind: input.deleted ? "deleted" : "restored",
          at,
        });
        const item = (yield* requireItem(before.id, { includeDeleted: true })).item;
        return {
          result: { item },
          spaceId: before.spaceId,
          events: [
            input.deleted ? { type: "itemRemoved", id: before.id } : { type: "itemUpserted", item },
          ],
        };
      }),
    );
  });

  return WorkItemService.of({
    listSpaces,
    subscribeSpaces,
    snapshot,
    subscribeSpace,
    spacesForProject,
    read,
    listDeleted,
    createSpace,
    updateSpace,
    setSpaceArchived,
    create,
    update,
    move,
    setLink,
    comment,
    setDeleted,
  });
});

export const layer = Layer.effect(WorkItemService, make);

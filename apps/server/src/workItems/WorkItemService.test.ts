import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
import {
  EventId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type WorkItemId,
  type WorkItemSpaceEvent,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";

import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as WorkItemService from "./WorkItemService.ts";
import { WORK_ITEM_MIGRATIONS_TABLE } from "./WorkItemMigrations.ts";

const WEB = ProjectId.make("project-web");
const API = ProjectId.make("project-api");
const OTHER = ProjectId.make("project-other");
const user = WorkItemService.USER_ACTOR;
const agent = { kind: "agent", threadId: ThreadId.make("thread-agent") } as const;

const layer = WorkItemService.layer.pipe(
  Layer.provideMerge(ProjectStore.layer),
  Layer.provideMerge(Layer.merge(SqlitePersistence.layerMemory, NodeCrypto.layer)),
);

const seedProjects = Effect.gen(function* () {
  const projects = yield* ProjectStore.ProjectStoreV2;
  for (const [index, projectId] of [WEB, API, OTHER].entries()) {
    yield* projects.apply({
      sequence: index + 1,
      eventId: EventId.make(`event-${projectId}`),
      aggregateKind: "project",
      aggregateId: projectId,
      occurredAt: "2026-11-01T00:00:00.000Z",
      commandId: null,
      causationEventId: null,
      correlationId: null,
      metadata: {},
      type: "project.created",
      payload: {
        projectId,
        title: projectId,
        workspaceRoot: `/tmp/${projectId}`,
        defaultModelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
        scripts: [],
        createdAt: "2026-11-01T00:00:00.000Z",
        updatedAt: "2026-11-01T00:00:00.000Z",
      },
    });
  }
});

const setup = Effect.gen(function* () {
  yield* seedProjects;
  const service = yield* WorkItemService.WorkItemService;
  const { space } = yield* service.createSpace({
    key: "SHOP",
    name: "Shop",
    projectIds: [WEB, API],
  });
  const task = (title: string, extra: Partial<Parameters<typeof service.create>[0]> = {}) =>
    service
      .create({ spaceId: space.id, type: "task", title, projectId: WEB, ...extra }, user)
      .pipe(Effect.map(({ item }) => item));
  return { service, space, task };
});

const failureMessage = <A, E extends { readonly message: string }>(exit: Exit.Exit<A, E>) =>
  Exit.isFailure(exit) && exit.cause.reasons[0]?._tag === "Fail"
    ? exit.cause.reasons[0].error.message
    : "no failure";

it.effect(
  "numbers items per space, requires a member repo for leaf items, and tracks its own migrations",
  () =>
    Effect.gen(function* () {
      const { service, space, task } = yield* setup;
      const epic = yield* service.create(
        { spaceId: space.id, type: "epic", title: "Checkout" },
        user,
      );
      const first = yield* task("Endpoint", { projectId: API, parentId: epic.item.id });
      const second = yield* task("Screen");
      assert.deepStrictEqual([epic.item.number, first.number, second.number], [1, 2, 3]);
      assert.strictEqual(first.parentId, epic.item.id);
      assert.deepStrictEqual(
        [
          (yield* service.resolveItem("shop-2")).id,
          (yield* service.resolveItem(second.id)).id,
          (yield* service.resolveSpace("shop")).id,
        ],
        [first.id, second.id, space.id],
      );
      assert.include(
        failureMessage(yield* service.resolveItem("SHOP-99").pipe(Effect.exit)),
        "does not exist",
      );

      const noRepo = yield* service
        .create({ spaceId: space.id, type: "bug", title: "Crash" }, user)
        .pipe(Effect.exit);
      assert.include(failureMessage(noRepo), "needs a repo");
      const outsider = yield* task("Infra", { projectId: OTHER }).pipe(Effect.exit);
      assert.include(failureMessage(outsider), "is not a repo in space SHOP");

      const sql = yield* SqlClient.SqlClient;
      const own = yield* sql<{
        readonly name: string;
      }>`SELECT name FROM ${sql(WORK_ITEM_MIGRATIONS_TABLE)}`;
      const main = yield* sql<{ readonly name: string }>`
      SELECT name FROM effect_sql_migrations WHERE name = 'WorkItems'`;
      assert.deepStrictEqual([own.map((row) => row.name), main.length], [["WorkItems"], 0]);
    }).pipe(Effect.provide(layer)),
);

it.effect("rejects parent loops, epic parents, and blocking loops", () =>
  Effect.gen(function* () {
    const { service, space, task } = yield* setup;
    const parent = yield* task("Parent");
    const child = yield* task("Child", { parentId: parent.id });
    const grandchild = yield* task("Grandchild", { parentId: child.id });

    const loop = yield* service
      .update({ id: parent.id, parentId: grandchild.id }, user)
      .pipe(Effect.exit);
    assert.include(failureMessage(loop), "loop");

    const epic = yield* service.create({ spaceId: space.id, type: "epic", title: "Epic" }, user);
    const nestedEpic = yield* service
      .update({ id: epic.item.id, parentId: parent.id }, user)
      .pipe(Effect.exit);
    assert.include(failureMessage(nestedEpic), "epic cannot have a parent");

    yield* service.setLink(
      { sourceId: parent.id, targetId: child.id, kind: "blocks", linked: true },
      user,
    );
    yield* service.setLink(
      { sourceId: child.id, targetId: grandchild.id, kind: "blocks", linked: true },
      user,
    );
    const blockingLoop = yield* service
      .setLink({ sourceId: grandchild.id, targetId: parent.id, kind: "blocks", linked: true }, user)
      .pipe(Effect.exit);
    assert.include(failureMessage(blockingLoop), "blocking loop");

    // `relates` has no direction, so linking either way stores one row.
    yield* service.setLink(
      { sourceId: grandchild.id, targetId: parent.id, kind: "relates", linked: true },
      user,
    );
    yield* service.setLink(
      { sourceId: parent.id, targetId: grandchild.id, kind: "relates", linked: true },
      user,
    );
    const { links } = yield* service.snapshot(space.id);
    assert.strictEqual(links.filter((link) => link.kind === "relates").length, 1);
  }).pipe(Effect.provide(layer)),
);

it.effect("orders a column by move placement and records who changed what", () =>
  Effect.gen(function* () {
    const { service, space, task } = yield* setup;
    const a = yield* task("A", { status: "todo" });
    const b = yield* task("B", { status: "todo" });
    const c = yield* task("C");

    yield* service.move({ id: c.id, status: "todo", afterId: a.id }, agent);
    yield* service.move({ id: b.id, status: "todo", afterId: null }, user);
    const order = (yield* service.snapshot(space.id)).items
      .filter((item) => item.status === "todo")
      .toSorted((left, right) => left.rank - right.rank)
      .map((item) => item.title);
    assert.deepStrictEqual(order, ["B", "A", "C"]);

    const { detail } = yield* service.read(c.id);
    const moved = detail.activity.find((entry) => entry.kind === "updated");
    assert.deepStrictEqual(moved?.actor, agent);
    assert.deepStrictEqual(moved?.changes, [{ field: "status", from: "backlog", to: "todo" }]);

    const done = yield* service.update({ id: a.id, status: "done" }, user);
    assert.isNotNull(done.item.completedAt);
    const reopened = yield* service.update({ id: a.id, status: "todo" }, user);
    assert.isNull(reopened.item.completedAt);
  }).pipe(Effect.provide(layer)),
);

it.effect(
  "keeps repos with open items, deletes only leaf items, and makes archived spaces read-only",
  () =>
    Effect.gen(function* () {
      const { service, space, task } = yield* setup;
      const parent = yield* task("Parent", { projectId: API });
      const child = yield* task("Child", { parentId: parent.id });

      const removeRepo = yield* service
        .updateSpace({ id: space.id, projectIds: [WEB] })
        .pipe(Effect.exit);
      assert.include(failureMessage(removeRepo), "still have open work items");
      yield* service.update({ id: parent.id, status: "canceled" }, user);
      yield* service.updateSpace({ id: space.id, projectIds: [WEB] });

      const deleteParent = yield* service
        .setDeleted({ id: parent.id, deleted: true }, user)
        .pipe(Effect.exit);
      assert.include(failureMessage(deleteParent), "has child items");
      yield* service.setDeleted({ id: child.id, deleted: true }, user);
      assert.deepStrictEqual(
        (yield* service.listDeleted(space.id)).items.map((item) => item.id),
        [child.id],
      );
      yield* service.setDeleted({ id: child.id, deleted: false }, user);
      assert.deepStrictEqual((yield* service.listDeleted(space.id)).items, []);

      yield* service.setSpaceArchived({ id: space.id, archived: true });
      const archivedEdit = yield* service
        .update({ id: child.id, title: "Renamed" }, user)
        .pipe(Effect.exit);
      assert.include(failureMessage(archivedEdit), "archived");
      yield* service.setSpaceArchived({ id: space.id, archived: false });
      yield* service.update({ id: child.id, title: "Renamed" }, user);
    }).pipe(Effect.provide(layer)),
);

it.effect("streams a snapshot, then deltas for its own space only", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { service, space, task } = yield* setup;
      const existing = yield* task("Existing");
      const other = yield* service.createSpace({
        key: "PLAT",
        name: "Platform",
        projectIds: [OTHER],
      });

      const pull = yield* Stream.toPull(service.subscribeSpace(space.id));
      const [first] = yield* pull;
      assert.strictEqual(first.type, "snapshot");
      assert.deepStrictEqual(first.type === "snapshot" ? first.items.map((item) => item.id) : [], [
        existing.id,
      ]);

      yield* service.create(
        { spaceId: other.space.id, type: "task", title: "Elsewhere", projectId: OTHER },
        user,
      );
      const added = yield* task("Added");
      yield* service.setDeleted({ id: existing.id, deleted: true }, user);

      const events: Array<WorkItemSpaceEvent> = [];
      while (events.length < 2) events.push(...(yield* pull));
      assert.deepStrictEqual(
        events.map((event) =>
          event.type === "itemUpserted"
            ? `upsert:${event.item.id}`
            : event.type === "itemRemoved"
              ? `remove:${event.id}`
              : event.type,
        ),
        [`upsert:${added.id}`, `remove:${existing.id satisfies WorkItemId}`],
      );
    }),
  ).pipe(Effect.provide(layer)),
);

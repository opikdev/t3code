import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  EventId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as ProjectStore from "../../../orchestration-v2/ProjectStore.ts";
import * as SqlitePersistence from "../../../persistence/Sqlite.ts";
import * as WorkItemService from "../../../workItems/WorkItemService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { liveThreadsLayer } from "../../McpToolAccess.testkit.ts";
import * as WorkItemHandlers from "./handlers.ts";
import { WorkItemToolkit } from "./tools.ts";

// liveThreadShell puts every calling thread in this project.
const CALLER_REPO = ProjectId.make("project:mcp-test");
const OTHER_REPO = ProjectId.make("project:other");
const threadId = ThreadId.make("thread:agent");

const dependencies = Layer.mergeAll(
  liveThreadsLayer,
  Layer.succeed(McpInvocationContext.McpInvocationContext, {
    environmentId: EnvironmentId.make("environment"),
    requestNamespace: `thread:${threadId}`,
    thread: {
      threadId,
      providerSessionId: "session",
      providerInstanceId: ProviderInstanceId.make("codex"),
    },
    client: undefined,
    issuedAt: 0,
    capabilities: new Set(["orchestration" as const]),
  }),
).pipe(
  Layer.provideMerge(WorkItemService.layer),
  Layer.provideMerge(ProjectStore.layer),
  Layer.provideMerge(Layer.merge(SqlitePersistence.layerMemory, NodeCrypto.layer)),
);

const seedProject = (projectId: ProjectId, sequence: number) =>
  Effect.gen(function* () {
    const projects = yield* ProjectStore.ProjectStoreV2;
    yield* projects.apply({
      sequence,
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
  });

it.effect("an agent works in the space holding its thread's repo without naming it", () =>
  Effect.gen(function* () {
    yield* seedProject(CALLER_REPO, 1);
    yield* seedProject(OTHER_REPO, 2);
    const service = yield* WorkItemService.WorkItemService;
    yield* service.createSpace({
      key: "SHOP",
      name: "Shop",
      projectIds: [CALLER_REPO, OTHER_REPO],
    });
    yield* service.createSpace({ key: "PLAT", name: "Platform", projectIds: [OTHER_REPO] });

    const toolkit = yield* WorkItemToolkit.pipe(
      Effect.provide(McpToolAccess.HandlersLayer.layer(WorkItemHandlers.layer)),
    );
    const call = <Name extends keyof typeof WorkItemToolkit.tools>(
      name: Name,
      params: Parameters<typeof toolkit.handle<Name>>[1],
    ) =>
      toolkit.handle(name, params).pipe(
        Stream.unwrap,
        Stream.runCollect,
        Effect.map((results) => results.at(-1)?.result),
      );

    const created = yield* call("work_item_save", {
      type: "bug",
      title: "Checkout crashes",
      status: "in_progress",
      priority: "high",
    });
    expect(created).toMatchObject({
      item: { key: "SHOP-1", projectId: CALLER_REPO, status: "in_progress" },
    });
    yield* call("work_item_save", { type: "task", title: "Next up", status: "todo" });

    const stored = yield* service.resolveItem("SHOP-1");
    expect(stored.threadIds).toEqual([threadId]);
    const { detail } = yield* service.read(stored.id);
    expect(detail.activity[0]?.actor).toEqual({ kind: "agent", threadId });

    const ready = yield* call("work_item_list", { ready: true });
    expect(ready).toMatchObject({ space: { key: "SHOP" }, items: [{ key: "SHOP-2" }] });

    const read = yield* call("work_item_read", { item: "shop-1" });
    expect(read).toMatchObject({ guidance: expect.stringContaining("failing test first") });
  }).pipe(Effect.provide(dependencies)),
);

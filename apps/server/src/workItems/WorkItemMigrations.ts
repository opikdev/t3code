import * as Effect from "effect/Effect";
import * as Migrator from "effect/sql/Migrator";
import * as SqlClient from "effect/sql/SqlClient";

// Own migrations table: the main migrator skips every id below its highest recorded one, so
// fork-only schema sharing its id sequence would hide future upstream migrations.
export const WORK_ITEM_MIGRATIONS_TABLE = "work_item_migrations";

const Migration0001 = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS work_item_spaces (
      space_id TEXT PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      next_number INTEGER NOT NULL,
      archived_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS work_item_space_projects (
      space_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      PRIMARY KEY (space_id, project_id)
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_work_item_space_projects_project
    ON work_item_space_projects(project_id)
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS work_items (
      work_item_id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL,
      number INTEGER NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      priority TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      project_id TEXT,
      parent_id TEXT,
      assignee TEXT,
      labels_json TEXT NOT NULL,
      size TEXT,
      thread_ids_json TEXT NOT NULL,
      rank REAL NOT NULL,
      created_by_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      deleted_at TEXT,
      UNIQUE (space_id, number)
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_work_items_space_status
    ON work_items(space_id, status, rank)
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_work_items_parent ON work_items(parent_id)
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS work_item_links (
      space_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (source_id, target_id, kind)
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_work_item_links_space ON work_item_links(space_id)
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_work_item_links_target ON work_item_links(target_id)
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS work_item_activity (
      activity_id TEXT PRIMARY KEY,
      work_item_id TEXT NOT NULL,
      actor_json TEXT NOT NULL,
      kind TEXT NOT NULL,
      body TEXT,
      changes_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_work_item_activity_item
    ON work_item_activity(work_item_id, created_at)
  `;
});

const run = Migrator.make({});

export const runWorkItemMigrations = Effect.fn("WorkItemMigrations.run")(function* () {
  return yield* run({
    loader: Migrator.fromRecord({ "1_WorkItems": Migration0001 }),
    table: WORK_ITEM_MIGRATIONS_TABLE,
  });
});

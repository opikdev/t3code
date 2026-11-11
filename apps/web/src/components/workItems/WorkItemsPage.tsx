import { useAtomValue } from "@effect/atom-react";
import { workItemKey } from "@t3tools/client-runtime/state/work-items";
import type {
  EnvironmentId,
  WorkItem,
  WorkItemId,
  WorkItemSpaceId,
  WorkItemStatus,
  WorkItemType,
} from "@t3tools/contracts";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { PlusIcon, SettingsIcon } from "lucide-react";
import { useState } from "react";

import { isElectron } from "~/env";
import { workspaceAreaProps } from "~/lib/workspaceFocus";
import { useProjects } from "~/state/entities";
import {
  useConnectedEnvironmentIds,
  useEnvironments,
  usePrimaryEnvironmentId,
} from "~/state/environments";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { workItems } from "~/state/workItems";

import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "../WorkspaceBreadcrumb";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { Button } from "../ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SidebarInset } from "../ui/sidebar";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { WorkItemBoardView } from "./WorkItemBoardView";
import { WorkItemDetailPanel } from "./WorkItemDetailPanel";
import { WorkItemListView } from "./WorkItemListView";
import { WorkItemSpaceDialog } from "./WorkItemSpaceDialog";
import { WorkItemTableView } from "./WorkItemTableView";
import { settledOrToast } from "./workItemFeedback";
import {
  blockedWorkItemIds,
  EMPTY_WORK_ITEM_FILTERS,
  filterWorkItems,
  optionLabel,
  WORK_ITEM_PRIORITY_OPTIONS,
  WORK_ITEM_TYPE_OPTIONS,
  type WorkItemFilterState,
  type WorkItemPlacement,
  type WorkItemView,
} from "./workItems.logic";

export interface WorkItemsSearch {
  readonly environment?: EnvironmentId;
  readonly space?: WorkItemSpaceId;
  readonly view?: WorkItemView;
  readonly item?: WorkItemId;
}

const ALL = "__all";

export function WorkItemsPage() {
  const search = useSearch({ from: "/_chat/work-items" });
  const navigate = useNavigate({ from: "/work-items" });
  const connectedIds = useConnectedEnvironmentIds();
  const primaryId = usePrimaryEnvironmentId();
  const { environments } = useEnvironments();
  const environmentId =
    search.environment ??
    (primaryId !== null && connectedIds.includes(primaryId) ? primaryId : connectedIds[0]) ??
    null;
  const view = search.view ?? "board";
  const [filters, setFilters] = useState<WorkItemFilterState>(EMPTY_WORK_ITEM_FILTERS);
  const [showDeleted, setShowDeleted] = useState(false);
  const [spaceDialog, setSpaceDialog] = useState<"new" | "edit" | null>(null);
  const [newTitle, setNewTitle] = useState("");

  const spacesQuery = useEnvironmentQuery(
    environmentId === null ? null : workItems.spacesLive({ environmentId, input: {} }),
  );
  const spaces = spacesQuery.data?.spaces ?? [];
  const space =
    spaces.find((candidate) => candidate.id === search.space) ??
    spaces.find((candidate) => candidate.archivedAt === null) ??
    null;
  const boardQuery = useEnvironmentQuery(
    environmentId === null || space === null
      ? null
      : workItems.boardLive({ environmentId, input: { spaceId: space.id } }),
  );
  const board =
    boardQuery.data !== null && boardQuery.data.space.id === space?.id ? boardQuery.data : null;
  const canEdit =
    useAtomValue(workItems.update.permissionAtom(environmentId ?? ("" as EnvironmentId))) &&
    space?.archivedAt === null;
  const projects = useProjects();
  const create = useAtomCommand(workItems.create, { reportFailure: false });
  const move = useAtomCommand(workItems.move, { reportFailure: false });

  const repoNames = new Map(
    projects
      .filter((project) => project.environmentId === environmentId)
      .map((project) => [project.id as string, project.title]),
  );
  const repoName = (item: WorkItem) =>
    item.projectId === null ? null : (repoNames.get(item.projectId) ?? null);
  const repoOptions = (space?.projectIds ?? []).map((id) => ({
    value: id as string,
    label: repoNames.get(id) ?? id,
  }));
  const keyOf = (item: WorkItem) => (space === null ? `#${item.number}` : workItemKey(space, item));
  const blocked = blockedWorkItemIds(board?.items ?? [], board?.links ?? []);
  const shown = filterWorkItems(board?.items ?? [], blocked, filters, keyOf);
  const selected = board?.items.find((item) => item.id === search.item) ?? null;

  const setSearch = (patch: {
    readonly [Key in keyof WorkItemsSearch]?: WorkItemsSearch[Key] | undefined;
  }) =>
    void navigate({
      search: (current): WorkItemsSearch => {
        const merged = { ...current, ...patch };
        return {
          ...(merged.environment === undefined ? {} : { environment: merged.environment }),
          ...(merged.space === undefined ? {} : { space: merged.space }),
          ...(merged.view === undefined ? {} : { view: merged.view }),
          ...(merged.item === undefined ? {} : { item: merged.item }),
        };
      },
      replace: true,
    });
  const openItem = (id: WorkItemId) => setSearch({ item: id });

  const createItem = async (status: WorkItemStatus, title: string) => {
    if (environmentId === null || space === null) return;
    const created = settledOrToast(
      await create({
        environmentId,
        input: {
          spaceId: space.id,
          type: "task",
          title,
          status,
          projectId: space.projectIds[0] ?? null,
        },
      }),
      "Could not create the work item",
    );
    if (created !== null) openItem(created.item.id);
  };

  const moveItem = async (id: WorkItemId, placement: WorkItemPlacement) => {
    if (environmentId === null) return;
    settledOrToast(
      await move({
        environmentId,
        input: {
          id,
          status: placement.status,
          ...(placement.afterId === undefined ? {} : { afterId: placement.afterId }),
        },
      }),
      "Could not move the work item",
    );
  };

  const viewProps = {
    items: shown,
    blocked,
    keyOf,
    repoName,
    selectedId: selected?.id ?? null,
    onOpen: openItem,
    canEdit,
  };

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div
        {...workspaceAreaProps("work-items", 1, "Work items")}
        className="flex min-h-0 min-w-0 flex-1 flex-col bg-background"
      >
        <WorkspacePageHeader electron={isElectron} className="relative bg-background">
          <WorkspaceBreadcrumb ariaLabel="Work items breadcrumb">
            <WorkspaceBreadcrumbItem current>
              <h1 className="truncate">Work items</h1>
            </WorkspaceBreadcrumbItem>
          </WorkspaceBreadcrumb>
          {connectedIds.length > 1 && environmentId !== null && (
            <Select
              value={environmentId}
              onValueChange={(next) =>
                typeof next === "string" &&
                setSearch({ environment: next as EnvironmentId, space: undefined, item: undefined })
              }
            >
              <SelectTrigger size="xs" className="w-auto" aria-label="Environment">
                <SelectValue>
                  {environments.find((entry) => entry.environmentId === environmentId)?.label ??
                    "Environment"}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup alignItemWithTrigger={false}>
                {connectedIds.map((id) => (
                  <SelectItem key={id} value={id}>
                    {environments.find((entry) => entry.environmentId === id)?.label ?? id}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          )}
          {spaces.length > 0 && space !== null && (
            <Select
              value={space.id}
              onValueChange={(next) =>
                typeof next === "string" &&
                setSearch({ space: next as WorkItemSpaceId, item: undefined })
              }
            >
              <SelectTrigger size="xs" className="w-auto" aria-label="Space">
                <SelectValue>
                  {space.name}
                  {space.archivedAt !== null && " (archived)"}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup alignItemWithTrigger={false}>
                {spaces.map((entry) => (
                  <SelectItem key={entry.id} value={entry.id}>
                    {entry.name} · {entry.key}
                    {entry.archivedAt !== null && " (archived)"}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          )}
          <div className="min-w-0 flex-1" />
          {space !== null && (
            <Button
              size="icon-xs"
              variant="ghost-muted"
              aria-label="Space settings"
              onClick={() => setSpaceDialog("edit")}
            >
              <SettingsIcon />
            </Button>
          )}
          {environmentId !== null && (
            <Button size="xs" variant="outline" onClick={() => setSpaceDialog("new")}>
              <PlusIcon />
              New space
            </Button>
          )}
        </WorkspacePageHeader>

        {environmentId === null ? (
          <Empty className="flex-1">
            <EmptyHeader>
              <EmptyTitle>No environment connected</EmptyTitle>
              <EmptyDescription>Connect to a T3 Code server to manage work items.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : space === null ? (
          <Empty className="flex-1">
            <EmptyHeader>
              <EmptyTitle>
                {spacesQuery.error !== null
                  ? "Could not load spaces"
                  : spacesQuery.data === null
                    ? "Loading spaces"
                    : "No spaces yet"}
              </EmptyTitle>
              <EmptyDescription>
                A space tracks work items for one or more repos. People and agents both work from
                it.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={() => setSpaceDialog("new")}>Create a space</Button>
            </EmptyContent>
          </Empty>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 px-3 pt-2">
              <ToggleGroup
                aria-label="View"
                value={[view]}
                onValueChange={(next) => {
                  const value = next[0];
                  if (value === "board" || value === "list" || value === "table") {
                    setSearch({ view: value });
                  }
                }}
              >
                <Toggle value="board">Board</Toggle>
                <Toggle value="list">List</Toggle>
                <Toggle value="table">Table</Toggle>
              </ToggleGroup>
              <Input
                size="sm"
                className="w-48"
                placeholder="Filter by title or key"
                aria-label="Filter"
                value={filters.query}
                onChange={(event) => setFilters({ ...filters, query: event.target.value })}
              />
              <FilterSelect
                label="Type"
                allLabel="All types"
                value={filters.types[0] ?? null}
                options={WORK_ITEM_TYPE_OPTIONS}
                onChange={(type: WorkItemType | null) =>
                  setFilters({ ...filters, types: type === null ? [] : [type] })
                }
              />
              <FilterSelect
                label="Priority"
                allLabel="All priorities"
                value={filters.priorities[0] ?? null}
                options={WORK_ITEM_PRIORITY_OPTIONS}
                onChange={(priority) =>
                  setFilters({ ...filters, priorities: priority === null ? [] : [priority] })
                }
              />
              <Button
                size="xs"
                variant={filters.blockedOnly ? "secondary" : "ghost-muted"}
                aria-pressed={filters.blockedOnly}
                onClick={() => setFilters({ ...filters, blockedOnly: !filters.blockedOnly })}
              >
                Blocked
              </Button>
              <Button
                size="xs"
                variant={showDeleted ? "secondary" : "ghost-muted"}
                aria-pressed={showDeleted}
                onClick={() => setShowDeleted(!showDeleted)}
              >
                Deleted
              </Button>
              {canEdit && view !== "board" && (
                <Input
                  size="sm"
                  className="ml-auto w-56"
                  placeholder="New item title, then Enter"
                  aria-label="New work item"
                  value={newTitle}
                  onChange={(event) => setNewTitle(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" || newTitle.trim() === "") return;
                    const title = newTitle.trim();
                    setNewTitle("");
                    void createItem("backlog", title);
                  }}
                />
              )}
            </div>
            <div className="flex min-h-0 flex-1">
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                {showDeleted ? (
                  <DeletedItems
                    environmentId={environmentId}
                    spaceId={space.id}
                    keyOf={keyOf}
                    canEdit={canEdit}
                  />
                ) : view === "board" ? (
                  <WorkItemBoardView {...viewProps} onMove={moveItem} onQuickAdd={createItem} />
                ) : view === "list" ? (
                  <WorkItemListView {...viewProps} />
                ) : (
                  <WorkItemTableView {...viewProps} />
                )}
              </div>
              {selected !== null && board !== null && (
                <WorkItemDetailPanel
                  key={selected.id}
                  environmentId={environmentId}
                  board={board}
                  item={selected}
                  keyOf={keyOf}
                  repoOptions={repoOptions}
                  canEdit={canEdit}
                  onClose={() => setSearch({ item: undefined })}
                  onOpen={openItem}
                />
              )}
            </div>
          </>
        )}
      </div>
      {environmentId !== null && spaceDialog !== null && (
        <WorkItemSpaceDialog
          environmentId={environmentId}
          space={spaceDialog === "edit" ? space : null}
          open
          onOpenChange={(open) => {
            if (!open) setSpaceDialog(null);
          }}
          onSaved={(saved) => setSearch({ space: saved.id, item: undefined })}
        />
      )}
    </SidebarInset>
  );
}

function FilterSelect<V extends string>(props: {
  readonly label: string;
  readonly allLabel: string;
  readonly value: V | null;
  readonly options: ReadonlyArray<{ readonly value: V; readonly label: string }>;
  readonly onChange: (value: V | null) => void;
}) {
  return (
    <Select
      value={props.value ?? ALL}
      onValueChange={(next) =>
        typeof next === "string" && props.onChange(next === ALL ? null : (next as V))
      }
    >
      <SelectTrigger size="xs" className="w-auto" aria-label={props.label}>
        <SelectValue>
          {props.value === null ? props.allLabel : optionLabel(props.options, props.value)}
        </SelectValue>
      </SelectTrigger>
      <SelectPopup alignItemWithTrigger={false}>
        <SelectItem value={ALL}>{props.allLabel}</SelectItem>
        {props.options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

function DeletedItems(props: {
  readonly environmentId: EnvironmentId;
  readonly spaceId: WorkItemSpaceId;
  readonly keyOf: (item: WorkItem) => string;
  readonly canEdit: boolean;
}) {
  const deleted = useEnvironmentQuery(
    workItems.deleted({ environmentId: props.environmentId, input: { spaceId: props.spaceId } }),
  );
  const setDeleted = useAtomCommand(workItems.setDeleted, { reportFailure: false });
  const items = deleted.data?.items ?? [];
  if (items.length === 0) {
    return (
      <Empty className="flex-1">
        <EmptyHeader>
          <EmptyTitle>No deleted items</EmptyTitle>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <ul className="mx-3 mt-4 divide-y rounded-lg border">
      {items.map((item) => (
        <li key={item.id} className="flex items-center gap-2 px-2 py-1.5 text-sm">
          <span className="w-16 shrink-0 font-mono text-xs text-muted-foreground">
            {props.keyOf(item)}
          </span>
          <span className="min-w-0 flex-1 truncate">{item.title}</span>
          {props.canEdit && (
            <Button
              size="xs"
              variant="outline"
              onClick={async () => {
                const result = await setDeleted({
                  environmentId: props.environmentId,
                  input: { id: item.id, deleted: false },
                });
                if (settledOrToast(result, "Could not restore the work item") !== null) {
                  deleted.refresh();
                }
              }}
            >
              Restore
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

import { useAtomValue } from "@effect/atom-react";
import { StackActions, useNavigation } from "@react-navigation/native";
import { workItemColumns, workItemKey } from "@t3tools/client-runtime/state/work-items";
import { WORK_ITEM_STATUS_OPTIONS, workItemTree } from "@t3tools/client-runtime/work-items";
import {
  blockedWorkItemIds,
  type EnvironmentId,
  type WorkItem,
  type WorkItemId,
  type WorkItemSpaceId,
} from "@t3tools/contracts";
import { useState } from "react";
import { ScrollView as HorizontalScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/ui/AppText";
import * as Dialog from "../../components/ui/Dialog";
import { EmptyState } from "../../components/ui/EmptyState";
import { ListSection } from "../../components/ui/ListSection";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { useBarOverlap } from "../../components/ui/useBarInset";
import { useProjects } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { workItems } from "../../state/workItems";
import { SettingsScreen } from "../settings/components/SettingsScreen";
import { settledOrAlert } from "./workItemFeedback";
import { WorkItemRow } from "./WorkItemRows";

const VIEW_OPTIONS = [
  { value: "list", label: "List" },
  { value: "board", label: "Board" },
] as const;

export function WorkItemsScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const barOverlap = useBarOverlap();
  const { environments } = useEnvironments();
  const connected = environments.filter(
    (entry) => entry.connection.phase === "connected" && entry.serverConfig !== null,
  );
  const [environmentChoice, setEnvironmentChoice] = useState<EnvironmentId | null>(null);
  const [spaceChoice, setSpaceChoice] = useState<WorkItemSpaceId | null>(null);
  const [view, setView] = useState<"list" | "board">("list");
  const [pageWidth, setPageWidth] = useState(0);
  const environmentId =
    connected.find((entry) => entry.environmentId === environmentChoice)?.environmentId ??
    connected[0]?.environmentId ??
    null;

  const spacesQuery = useEnvironmentQuery(
    environmentId === null ? null : workItems.spacesLive({ environmentId, input: {} }),
  );
  const spaces = spacesQuery.data?.spaces ?? [];
  const space =
    spaces.find((candidate) => candidate.id === spaceChoice) ??
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
    useAtomValue(workItems.create.permissionAtom(environmentId ?? ("" as EnvironmentId))) &&
    space?.archivedAt === null;
  const create = useAtomCommand(workItems.create, { reportFailure: false });
  const projects = useProjects();

  const repoNames = new Map(
    projects
      .filter((project) => project.environmentId === environmentId)
      .map((project) => [project.id as string, project.title]),
  );
  const repoName = (item: WorkItem) =>
    item.projectId === null ? null : (repoNames.get(item.projectId) ?? null);
  const keyOf = (item: WorkItem) => (space === null ? `#${item.number}` : workItemKey(space, item));
  const items = board?.items ?? [];
  const blocked = blockedWorkItemIds(items, board?.links ?? []);
  const columns = workItemColumns(items);

  const open = (id: WorkItemId) => {
    if (environmentId === null || space === null) return;
    navigation.dispatch(
      StackActions.push("WorkItem", { environmentId, spaceId: space.id, itemId: id }),
    );
  };

  const newItem = () => {
    if (environmentId === null || space === null) return;
    Dialog.prompt({
      title: "New work item",
      message: `Adds a task to the ${space.name} backlog. Change its type and details next.`,
      placeholder: "Title",
      initialValue: "",
      confirmText: "Add",
      onConfirm: async (value) => {
        const title = value.trim();
        if (title === "") return;
        const created = settledOrAlert(
          await create({
            environmentId,
            input: {
              spaceId: space.id,
              type: "task",
              title,
              projectId: space.projectIds[0] ?? null,
            },
          }),
          "Could not add the work item",
        );
        if (created !== null) open(created.item.id);
      },
    });
  };

  const environmentMenu = {
    title: "Environment",
    icon: "desktopcomputer" as const,
    items: connected.map((entry) => ({
      id: entry.environmentId,
      title: entry.label,
      selected: entry.environmentId === environmentId,
      onPress: () => {
        setEnvironmentChoice(entry.environmentId);
        setSpaceChoice(null);
      },
    })),
  };
  const spaceMenu = {
    title: "Space",
    icon: "rectangle.split.3x1" as const,
    items: spaces.map((entry) => ({
      id: entry.id,
      title: entry.name,
      subtitle: entry.archivedAt === null ? entry.key : `${entry.key}, archived`,
      selected: entry.id === space?.id,
      onPress: () => setSpaceChoice(entry.id),
    })),
  };

  const rowProps = (item: WorkItem) => ({
    item,
    itemKey: keyOf(item),
    blocked: blocked.has(item.id),
    repoName: repoName(item),
    onPress: () => open(item.id),
  });

  return (
    <SettingsScreen
      title={space?.name ?? "Work items"}
      workspaceRoot
      menus={[
        ...(connected.length > 1 ? [environmentMenu] : []),
        ...(spaces.length > 1 ? [spaceMenu] : []),
      ]}
      actions={
        space === null
          ? undefined
          : [
              {
                accessibilityLabel: "New work item",
                icon: "plus",
                disabled: !canEdit,
                onPress: newItem,
              },
            ]
      }
    >
      {environmentId === null ? (
        <EmptyState
          variant="plain"
          title="No environment connected"
          detail="Connect to a T3 Code server to see its work items."
        />
      ) : space === null ? (
        <EmptyState
          variant="plain"
          title={
            spacesQuery.error !== null
              ? "Could not load spaces"
              : spacesQuery.data === null
                ? "Loading spaces"
                : "No spaces yet"
          }
          detail="Create a space on desktop or web. It tracks work items for one or more repos."
        />
      ) : view === "list" ? (
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          className="flex-1"
          contentContainerClassName="gap-5 px-4 pt-3"
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
        >
          <SegmentedControl
            variant="standalone"
            options={VIEW_OPTIONS}
            selected={view}
            onSelect={setView}
          />
          {board !== null && items.length === 0 ? (
            <EmptyState
              variant="plain"
              title="No work items"
              detail="Add one with the plus button, or ask an agent to plan the work."
            />
          ) : null}
          {WORK_ITEM_STATUS_OPTIONS.map((status) => {
            const rows = workItemTree(columns.get(status.value) ?? []);
            if (rows.length === 0) return null;
            return (
              <ListSection key={status.value} title={`${status.label} · ${rows.length}`}>
                {rows.map(({ item, depth }, index) => (
                  <WorkItemRow
                    key={item.id}
                    {...rowProps(item)}
                    depth={depth}
                    borderTop={index > 0}
                  />
                ))}
              </ListSection>
            );
          })}
        </ScrollView>
      ) : (
        <View className="flex-1 gap-3" style={{ paddingTop: barOverlap + 12 }}>
          <View className="px-4">
            <SegmentedControl
              variant="standalone"
              options={VIEW_OPTIONS}
              selected={view}
              onSelect={setView}
            />
          </View>
          <HorizontalScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            className="flex-1"
            onLayout={(event) => setPageWidth(event.nativeEvent.layout.width)}
          >
            {WORK_ITEM_STATUS_OPTIONS.map((status) => {
              const column = columns.get(status.value) ?? [];
              return (
                <View key={status.value} style={{ width: pageWidth }} className="px-4">
                  <Text textRole="headline" className="pb-2 text-foreground">
                    {status.label} · {column.length}
                  </Text>
                  <ScrollView
                    className="flex-1"
                    contentContainerClassName="gap-2"
                    contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
                  >
                    {column.length === 0 ? (
                      <Text textRole="footnote" className="text-foreground-muted">
                        Nothing here.
                      </Text>
                    ) : null}
                    {column.map((item) => (
                      <View key={item.id} className="rounded-xl bg-card">
                        <WorkItemRow {...rowProps(item)} />
                      </View>
                    ))}
                  </ScrollView>
                </View>
              );
            })}
          </HorizontalScrollView>
        </View>
      )}
    </SettingsScreen>
  );
}

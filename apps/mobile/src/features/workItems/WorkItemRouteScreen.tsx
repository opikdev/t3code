import { useAtomValue } from "@effect/atom-react";
import type { MenuAction } from "@react-native-menu/menu";
import { StackActions, useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { workItemKey } from "@t3tools/client-runtime/state/work-items";
import {
  WORK_ITEM_ASSIGNEE_OPTIONS,
  WORK_ITEM_PRIORITY_OPTIONS,
  WORK_ITEM_SIZE_OPTIONS,
  WORK_ITEM_STATUS_OPTIONS,
  WORK_ITEM_TYPE_OPTIONS,
} from "@t3tools/client-runtime/work-items";
import {
  blockedWorkItemIds,
  type EnvironmentId,
  type ProjectId,
  type WorkItem,
  type WorkItemId,
  type WorkItemSpaceId,
  type WorkItemUpdateInput,
} from "@t3tools/contracts";
import { useState } from "react";
import { Platform, Pressable, TextInput as RNTextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/ui/AppText";
import { SymbolView } from "../../components/ui/AppSymbol";
import { Button } from "../../components/ui/Button";
import * as Dialog from "../../components/ui/Dialog";
import { EmptyState } from "../../components/ui/EmptyState";
import { ListSection } from "../../components/ui/ListSection";
import { Menu } from "../../components/ui/Menu";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { useProjects } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { workItems } from "../../state/workItems";
import { SettingsScreen } from "../settings/components/SettingsScreen";
import { settledOrAlert } from "./workItemFeedback";
import { WorkItemMeta, WorkItemRow } from "./WorkItemRows";

const NONE = "__none";

interface Option {
  readonly value: string;
  readonly label: string;
}

function FieldRow(props: {
  readonly label: string;
  readonly value: string | null;
  readonly options: ReadonlyArray<Option>;
  readonly noneLabel?: string;
  readonly disabled: boolean;
  readonly borderTop?: boolean;
  readonly onSelect: (value: string | null) => void;
}) {
  const shown =
    props.value === null
      ? (props.noneLabel ?? "None")
      : (props.options.find((option) => option.value === props.value)?.label ?? props.value);
  const actions: MenuAction[] = [
    ...(props.noneLabel === undefined
      ? []
      : [
          { id: NONE, title: props.noneLabel, state: props.value === null ? "on" : "off" } as const,
        ]),
    ...props.options.map((option): MenuAction => ({
      id: option.value,
      title: option.label,
      state: option.value === props.value ? "on" : "off",
    })),
  ];
  const row = (
    <View
      className={`min-h-12 flex-row items-center gap-3 px-4 py-3 ${props.borderTop ? "border-t border-border-subtle" : ""}`}
    >
      <Text textRole="body" className="text-foreground">
        {props.label}
      </Text>
      <Text textRole="body" className="flex-1 text-right text-foreground-muted" numberOfLines={1}>
        {shown}
      </Text>
      {props.disabled ? null : (
        <SymbolView
          name="chevron.down"
          size={14}
          tintColorClassName="accent-chevron"
          type="monochrome"
        />
      )}
    </View>
  );
  if (props.disabled) return row;
  return (
    <Menu
      actions={actions}
      onPressAction={({ nativeEvent }) =>
        props.onSelect(nativeEvent.event === NONE ? null : nativeEvent.event)
      }
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${props.label}, ${shown}`}
        className="active:opacity-70"
      >
        {row}
      </Pressable>
    </Menu>
  );
}

export function WorkItemRouteScreen({
  route,
}: StaticScreenProps<{
  readonly environmentId: EnvironmentId;
  readonly spaceId: WorkItemSpaceId;
  readonly itemId: WorkItemId;
}>) {
  const { environmentId, spaceId, itemId } = route.params;
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const boardQuery = useEnvironmentQuery(
    workItems.boardLive({ environmentId, input: { spaceId } }),
  );
  const detail = useEnvironmentQuery(workItems.detail({ environmentId, input: { id: itemId } }));
  const canEdit = useAtomValue(workItems.update.permissionAtom(environmentId));
  const update = useAtomCommand(workItems.update, { reportFailure: false });
  const comment = useAtomCommand(workItems.comment, { reportFailure: false });
  const setDeleted = useAtomCommand(workItems.setDeleted, { reportFailure: false });
  const projects = useProjects();
  const [description, setDescription] = useState<string | null>(null);
  const [commentText, setCommentText] = useState("");

  const board = boardQuery.data;
  const item = board?.items.find((candidate) => candidate.id === itemId) ?? null;
  if (board === null || item === null) {
    return (
      <SettingsScreen title="Work item">
        <EmptyState
          variant="plain"
          title={board === null ? "Loading" : "Work item not found"}
          detail={board === null ? "Connecting to the environment." : "It may have been deleted."}
        />
      </SettingsScreen>
    );
  }

  const editable = canEdit && board.space.archivedAt === null;
  const keyOf = (entry: WorkItem) => workItemKey(board.space, entry);
  const blocked = blockedWorkItemIds(board.items, board.links);
  const byId = new Map(board.items.map((entry) => [entry.id, entry]));
  const repoNames = new Map(
    projects
      .filter((project) => project.environmentId === environmentId)
      .map((project) => [project.id as string, project.title]),
  );
  const repoName = (entry: WorkItem) =>
    entry.projectId === null ? null : (repoNames.get(entry.projectId) ?? null);
  const savedDescription = detail.data?.detail.description ?? "";
  const children = board.items.filter((entry) => entry.parentId === item.id);
  const relations = board.links.flatMap((link) => {
    const outgoing = link.sourceId === item.id;
    if (!outgoing && link.targetId !== item.id) return [];
    const other = byId.get(outgoing ? link.targetId : link.sourceId);
    if (other === undefined) return [];
    const label =
      link.kind === "relates"
        ? "Relates to"
        : link.kind === "blocks"
          ? outgoing
            ? "Blocks"
            : "Blocked by"
          : outgoing
            ? "Duplicates"
            : "Duplicate of";
    return [{ key: `${link.sourceId}:${link.targetId}:${link.kind}`, label, other }];
  });

  const save = async (patch: Omit<WorkItemUpdateInput, "id">) => {
    const result = await update({ environmentId, input: { id: item.id, ...patch } });
    if (settledOrAlert(result, "Could not save the work item") !== null) detail.refresh();
  };
  const open = (id: WorkItemId) =>
    navigation.dispatch(StackActions.push("WorkItem", { environmentId, spaceId, itemId: id }));

  const rename = () =>
    Dialog.prompt({
      title: "Rename work item",
      initialValue: item.title,
      confirmText: "Save",
      onConfirm: (value) => {
        const title = value.trim();
        if (title !== "" && title !== item.title) void save({ title });
      },
    });

  const remove = () =>
    Dialog.confirm({
      title: `Delete ${keyOf(item)}?`,
      message: "You can restore it from Deleted on desktop or web.",
      confirmText: "Delete",
      destructive: true,
      onConfirm: async () => {
        const result = await setDeleted({ environmentId, input: { id: item.id, deleted: true } });
        if (settledOrAlert(result, "Could not delete the work item") !== null) navigation.goBack();
      },
    });

  const parentOptions = board.items
    .filter((entry) => entry.id !== item.id)
    .map((entry) => ({ value: entry.id as string, label: `${keyOf(entry)} ${entry.title}` }));
  const repoOptions = board.space.projectIds.map((id) => ({
    value: id as string,
    label: repoNames.get(id) ?? id,
  }));

  return (
    <SettingsScreen
      title={keyOf(item)}
      actions={
        editable
          ? [{ accessibilityLabel: "Delete work item", icon: "trash", onPress: remove }]
          : undefined
      }
    >
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        automaticallyAdjustKeyboardInsets={Platform.OS === "ios"}
        className="flex-1"
        contentContainerClassName="gap-5 px-4 pt-3"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Title, ${item.title}`}
          disabled={!editable}
          onPress={rename}
          className="gap-1 active:opacity-70"
        >
          <Text textRole="title" className="text-foreground">
            {item.title}
          </Text>
          <WorkItemMeta item={item} blocked={blocked.has(item.id)} repoName={repoName(item)} />
        </Pressable>

        <ListSection>
          <FieldRow
            label="Status"
            value={item.status}
            options={WORK_ITEM_STATUS_OPTIONS}
            disabled={!editable}
            onSelect={(value) => {
              const status = WORK_ITEM_STATUS_OPTIONS.find((option) => option.value === value);
              if (status) void save({ status: status.value });
            }}
          />
          <FieldRow
            label="Priority"
            value={item.priority}
            options={WORK_ITEM_PRIORITY_OPTIONS}
            disabled={!editable}
            borderTop
            onSelect={(value) => {
              const priority = WORK_ITEM_PRIORITY_OPTIONS.find((option) => option.value === value);
              if (priority) void save({ priority: priority.value });
            }}
          />
          <FieldRow
            label="Type"
            value={item.type}
            options={WORK_ITEM_TYPE_OPTIONS}
            disabled={!editable}
            borderTop
            onSelect={(value) => {
              const type = WORK_ITEM_TYPE_OPTIONS.find((option) => option.value === value);
              if (type) void save({ type: type.value });
            }}
          />
          <FieldRow
            label="Repo"
            value={item.projectId}
            options={repoOptions}
            noneLabel={item.type === "epic" ? "No repo" : undefined}
            disabled={!editable}
            borderTop
            onSelect={(value) => void save({ projectId: value as ProjectId | null })}
          />
          {item.type === "epic" ? null : (
            <FieldRow
              label="Parent"
              value={item.parentId}
              options={parentOptions}
              noneLabel="No parent"
              disabled={!editable}
              borderTop
              onSelect={(value) => void save({ parentId: value as WorkItemId | null })}
            />
          )}
          <FieldRow
            label="Assignee"
            value={item.assignee}
            options={WORK_ITEM_ASSIGNEE_OPTIONS}
            noneLabel="Unassigned"
            disabled={!editable}
            borderTop
            onSelect={(value) => {
              const assignee = WORK_ITEM_ASSIGNEE_OPTIONS.find((option) => option.value === value);
              void save({ assignee: assignee?.value ?? null });
            }}
          />
          <FieldRow
            label="Size"
            value={item.size}
            options={WORK_ITEM_SIZE_OPTIONS}
            noneLabel="No size"
            disabled={!editable}
            borderTop
            onSelect={(value) => {
              const size = WORK_ITEM_SIZE_OPTIONS.find((option) => option.value === value);
              void save({ size: size?.value ?? null });
            }}
          />
        </ListSection>

        <ListSection title="Description">
          <View className="gap-2 px-4 py-3">
            <RNTextInput
              multiline
              editable={editable && detail.data !== null}
              value={description ?? savedDescription}
              onChangeText={setDescription}
              placeholder="What and why. Add acceptance criteria as a checklist."
              placeholderTextColorClassName="accent-foreground-muted"
              className="min-h-20 font-sans text-base text-foreground"
            />
            {description !== null && description !== savedDescription ? (
              <View className="flex-row justify-end gap-2">
                <Button tone="text" label="Discard" onPress={() => setDescription(null)} />
                <Button
                  tone="primary"
                  label="Save"
                  onPress={async () => {
                    await save({ description });
                    setDescription(null);
                  }}
                />
              </View>
            ) : null}
          </View>
        </ListSection>

        {children.length > 0 ? (
          <ListSection title="Children">
            {children.map((child, index) => (
              <WorkItemRow
                key={child.id}
                item={child}
                itemKey={keyOf(child)}
                blocked={blocked.has(child.id)}
                repoName={repoName(child)}
                borderTop={index > 0}
                onPress={() => open(child.id)}
              />
            ))}
          </ListSection>
        ) : null}

        {relations.length > 0 ? (
          <ListSection title="Relations">
            {relations.map((relation, index) => (
              <Pressable
                key={relation.key}
                accessibilityRole="button"
                onPress={() => open(relation.other.id)}
                className={`gap-0.5 px-4 py-3 active:opacity-70 ${index > 0 ? "border-t border-border-subtle" : ""}`}
              >
                <Text textRole="footnote" className="text-foreground-muted">
                  {relation.label} {keyOf(relation.other)}
                </Text>
                <Text textRole="body" className="text-foreground" numberOfLines={2}>
                  {relation.other.title}
                </Text>
              </Pressable>
            ))}
          </ListSection>
        ) : null}

        <ListSection title="Activity">
          {(detail.data?.detail.activity ?? []).map((entry, index) => (
            <View
              key={entry.id}
              className={`gap-0.5 px-4 py-3 ${index > 0 ? "border-t border-border-subtle" : ""}`}
            >
              <Text textRole="footnote" className="text-foreground-muted">
                {entry.actor.kind === "agent" ? "Agent" : "You"} {entry.kind} ·{" "}
                {new Date(entry.createdAt).toLocaleString()}
              </Text>
              {entry.body !== null ? (
                <Text textRole="body" className="text-foreground">
                  {entry.body}
                </Text>
              ) : null}
              {entry.changes.map((change) => (
                <Text key={change.field} textRole="footnote" className="text-foreground-muted">
                  {change.field}
                  {change.from !== null || change.to !== null
                    ? `: ${change.from ?? "none"} → ${change.to ?? "none"}`
                    : " changed"}
                </Text>
              ))}
            </View>
          ))}
          {editable ? (
            <View className="gap-2 border-t border-border-subtle px-4 py-3">
              <RNTextInput
                multiline
                value={commentText}
                onChangeText={setCommentText}
                placeholder="Add a comment"
                placeholderTextColorClassName="accent-foreground-muted"
                className="min-h-12 font-sans text-base text-foreground"
              />
              <View className="flex-row justify-end">
                <Button
                  tone="primary"
                  label="Comment"
                  disabled={commentText.trim() === ""}
                  onPress={async () => {
                    const result = await comment({
                      environmentId,
                      input: { id: item.id, body: commentText.trim() },
                    });
                    if (settledOrAlert(result, "Could not post the comment") !== null) {
                      setCommentText("");
                      detail.refresh();
                    }
                  }}
                />
              </View>
            </View>
          ) : null}
        </ListSection>
      </ScrollView>
    </SettingsScreen>
  );
}

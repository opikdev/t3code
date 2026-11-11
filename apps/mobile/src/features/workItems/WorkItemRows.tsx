import {
  optionLabel,
  WORK_ITEM_PRIORITY_OPTIONS,
  WORK_ITEM_TYPE_OPTIONS,
} from "@t3tools/client-runtime/work-items";
import type { WorkItem } from "@t3tools/contracts";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";

export function WorkItemMeta(props: {
  readonly item: WorkItem;
  readonly blocked: boolean;
  readonly repoName: string | null;
}) {
  const parts = [
    optionLabel(WORK_ITEM_TYPE_OPTIONS, props.item.type),
    props.item.priority === "none"
      ? null
      : optionLabel(WORK_ITEM_PRIORITY_OPTIONS, props.item.priority),
    props.repoName,
  ].filter((part) => part !== null);
  return (
    <View className="flex-row flex-wrap items-center gap-x-2">
      <Text textRole="footnote" className="text-foreground-muted">
        {parts.join(" · ")}
      </Text>
      {props.blocked ? (
        <Text textRole="footnote" className="font-t3-medium text-warning-foreground">
          Blocked
        </Text>
      ) : null}
    </View>
  );
}

/** One work item as a tappable row: key, title, then type, priority, repo and blocked state. */
export function WorkItemRow(props: {
  readonly item: WorkItem;
  readonly itemKey: string;
  readonly blocked: boolean;
  readonly repoName: string | null;
  readonly depth?: number;
  readonly borderTop?: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${props.itemKey}, ${props.item.title}${props.blocked ? ", blocked" : ""}`}
      onPress={props.onPress}
      className={`gap-1 px-4 py-3 active:opacity-70 ${props.borderTop ? "border-t border-border-subtle" : ""}`}
      style={props.depth ? { paddingLeft: 16 + props.depth * 16 } : undefined}
    >
      <View className="flex-row items-baseline gap-2">
        <Text textRole="footnote" className="font-mono text-foreground-muted">
          {props.itemKey}
        </Text>
        <Text textRole="body" className="flex-1 text-foreground" numberOfLines={2}>
          {props.item.title}
        </Text>
      </View>
      <WorkItemMeta item={props.item} blocked={props.blocked} repoName={props.repoName} />
    </Pressable>
  );
}

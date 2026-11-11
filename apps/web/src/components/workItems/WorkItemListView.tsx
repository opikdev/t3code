import type { WorkItem } from "@t3tools/contracts";
import { workItemColumns } from "@t3tools/client-runtime/state/work-items";

import { cn } from "~/lib/utils";

import { Badge } from "../ui/badge";
import type { WorkItemViewProps } from "./WorkItemBoardView";
import { WorkItemAssigneeIcon, WorkItemBlockedBadge, WorkItemTypeBadge } from "./WorkItemCard";
import {
  optionLabel,
  WORK_ITEM_PRIORITY_OPTIONS,
  WORK_ITEM_STATUS_OPTIONS,
  workItemTree,
} from "./workItems.logic";

export function WorkItemListView(props: WorkItemViewProps) {
  const columns = workItemColumns(props.items);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6">
      {WORK_ITEM_STATUS_OPTIONS.map((status) => {
        const rows = workItemTree(columns.get(status.value) ?? []);
        if (rows.length === 0) return null;
        return (
          <section key={status.value} aria-label={status.label} className="pt-4">
            <h3 className="flex items-center gap-2 px-2 pb-1 text-sm font-medium">
              {status.label}
              <span className="text-xs text-muted-foreground">{rows.length}</span>
            </h3>
            <ul className="divide-y rounded-lg border">
              {rows.map(({ item, depth }) => (
                <li key={item.id}>
                  <WorkItemRow item={item} depth={depth} {...props} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function WorkItemRow(
  props: WorkItemViewProps & { readonly item: WorkItem; readonly depth: number },
) {
  const { item } = props;
  const repo = props.repoName(item);
  return (
    <button
      type="button"
      onClick={() => props.onOpen(item.id)}
      aria-current={props.selectedId === item.id ? "true" : undefined}
      className={cn(
        "flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm outline-none hover:bg-accent/50 focus-visible:bg-accent",
        props.selectedId === item.id && "bg-accent",
      )}
    >
      <span className="w-16 shrink-0 font-mono text-xs text-muted-foreground">
        {props.keyOf(item)}
      </span>
      <span className="shrink-0" style={{ width: `${props.depth * 1.25}rem` }} />
      <WorkItemTypeBadge type={item.type} />
      <span className="min-w-0 flex-1 truncate">{item.title}</span>
      {props.blocked.has(item.id) && <WorkItemBlockedBadge />}
      {item.priority !== "none" && (
        <Badge size="sm" variant={item.priority === "urgent" ? "error" : "outline"}>
          {optionLabel(WORK_ITEM_PRIORITY_OPTIONS, item.priority)}
        </Badge>
      )}
      {repo !== null && (
        <span className="hidden w-28 shrink-0 truncate text-xs text-muted-foreground sm:block">
          {repo}
        </span>
      )}
      <span className="w-4 shrink-0">
        <WorkItemAssigneeIcon assignee={item.assignee} />
      </span>
    </button>
  );
}

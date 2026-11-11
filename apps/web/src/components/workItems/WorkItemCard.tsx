import type { WorkItem } from "@t3tools/contracts";
import { BotIcon, CircleAlertIcon, UserIcon } from "lucide-react";
import type { ComponentProps } from "react";

import { cn } from "~/lib/utils";

import { Badge } from "../ui/badge";
import {
  optionLabel,
  WORK_ITEM_PRIORITY_OPTIONS,
  WORK_ITEM_SIZE_OPTIONS,
  WORK_ITEM_TYPE_OPTIONS,
} from "@t3tools/client-runtime/work-items";

const TYPE_BADGE = {
  epic: "info",
  feature: "success",
  task: "secondary",
  bug: "error",
  chore: "outline",
  spike: "warning",
} as const;

export function WorkItemTypeBadge({ type }: { readonly type: WorkItem["type"] }) {
  return (
    <Badge size="sm" variant={TYPE_BADGE[type]}>
      {optionLabel(WORK_ITEM_TYPE_OPTIONS, type)}
    </Badge>
  );
}

export function WorkItemBlockedBadge() {
  return (
    <Badge size="sm" variant="warning">
      <CircleAlertIcon />
      Blocked
    </Badge>
  );
}

export function WorkItemAssigneeIcon({ assignee }: { readonly assignee: WorkItem["assignee"] }) {
  if (assignee === null) return null;
  const Icon = assignee === "agent" ? BotIcon : UserIcon;
  return (
    <Icon
      aria-label={assignee === "agent" ? "Agent" : "Me"}
      className="size-3.5 text-muted-foreground"
    />
  );
}

export function WorkItemCard({
  item,
  itemKey,
  blocked,
  repoName,
  className,
  ...props
}: ComponentProps<"button"> & {
  readonly item: WorkItem;
  readonly itemKey: string;
  readonly blocked: boolean;
  readonly repoName: string | null;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex w-full flex-col gap-1.5 rounded-lg border bg-card p-2.5 text-left text-sm shadow-xs/5 outline-none hover:border-ring/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        className,
      )}
      {...props}
    >
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="font-mono">{itemKey}</span>
        {repoName !== null && <span className="truncate">· {repoName}</span>}
        <span className="ml-auto">
          <WorkItemAssigneeIcon assignee={item.assignee} />
        </span>
      </span>
      <span className="line-clamp-3 font-medium">{item.title}</span>
      <span className="flex flex-wrap items-center gap-1">
        <WorkItemTypeBadge type={item.type} />
        {item.priority !== "none" && (
          <Badge size="sm" variant={item.priority === "urgent" ? "error" : "outline"}>
            {optionLabel(WORK_ITEM_PRIORITY_OPTIONS, item.priority)}
          </Badge>
        )}
        {item.size !== null && (
          <Badge size="sm" variant="outline">
            {optionLabel(WORK_ITEM_SIZE_OPTIONS, item.size)}
          </Badge>
        )}
        {blocked && <WorkItemBlockedBadge />}
      </span>
    </button>
  );
}

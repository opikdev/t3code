import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";
import { useState } from "react";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import type { WorkItemViewProps } from "./WorkItemBoardView";
import { WorkItemAssigneeIcon, WorkItemBlockedBadge, WorkItemTypeBadge } from "./WorkItemCard";
import {
  optionLabel,
  sortWorkItems,
  WORK_ITEM_PRIORITY_OPTIONS,
  WORK_ITEM_SIZE_OPTIONS,
  WORK_ITEM_STATUS_OPTIONS,
  type WorkItemSortKey,
} from "@t3tools/client-runtime/work-items";

const COLUMNS: ReadonlyArray<{ readonly key: WorkItemSortKey; readonly label: string }> = [
  { key: "key", label: "Key" },
  { key: "type", label: "Type" },
  { key: "title", label: "Title" },
  { key: "status", label: "Status" },
  { key: "priority", label: "Priority" },
  { key: "updated", label: "Updated" },
];

export function WorkItemTableView(props: WorkItemViewProps) {
  const [sort, setSort] = useState<{ readonly key: WorkItemSortKey; readonly descending: boolean }>(
    { key: "key", descending: true },
  );
  const rows = sortWorkItems(props.items, sort.key, sort.descending);
  return (
    <div className="min-h-0 flex-1 overflow-auto px-3 pb-6">
      <Table>
        <TableHeader>
          <TableRow>
            {COLUMNS.map((column) => (
              <TableHead
                key={column.key}
                aria-sort={
                  sort.key === column.key ? (sort.descending ? "descending" : "ascending") : "none"
                }
              >
                <button
                  type="button"
                  className="inline-flex items-center gap-1 outline-none focus-visible:underline"
                  onClick={() =>
                    setSort((current) => ({
                      key: column.key,
                      descending: current.key === column.key ? !current.descending : false,
                    }))
                  }
                >
                  {column.label}
                  {sort.key === column.key &&
                    (sort.descending ? (
                      <ArrowDownIcon className="size-3" />
                    ) : (
                      <ArrowUpIcon className="size-3" />
                    ))}
                </button>
              </TableHead>
            ))}
            <TableHead>Repo</TableHead>
            <TableHead>Size</TableHead>
            <TableHead>Labels</TableHead>
            <TableHead>
              <span className="sr-only">Assignee</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((item) => (
            <TableRow
              key={item.id}
              tabIndex={0}
              aria-selected={props.selectedId === item.id}
              data-state={props.selectedId === item.id ? "selected" : undefined}
              className="cursor-pointer"
              onClick={() => props.onOpen(item.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter") props.onOpen(item.id);
              }}
            >
              <TableCell>
                <span className="font-mono text-xs text-muted-foreground">{props.keyOf(item)}</span>
              </TableCell>
              <TableCell>
                <WorkItemTypeBadge type={item.type} />
              </TableCell>
              <TableCell className="max-w-96">
                <span className="flex items-center gap-1.5">
                  <span className="truncate">{item.title}</span>
                  {props.blocked.has(item.id) && <WorkItemBlockedBadge />}
                </span>
              </TableCell>
              <TableCell>{optionLabel(WORK_ITEM_STATUS_OPTIONS, item.status)}</TableCell>
              <TableCell>{optionLabel(WORK_ITEM_PRIORITY_OPTIONS, item.priority)}</TableCell>
              <TableCell>
                <span className="text-xs text-muted-foreground">
                  {new Date(item.updatedAt).toLocaleDateString()}
                </span>
              </TableCell>
              <TableCell className="max-w-32">
                <span className="block truncate text-xs text-muted-foreground">
                  {props.repoName(item) ?? ""}
                </span>
              </TableCell>
              <TableCell>{optionLabel(WORK_ITEM_SIZE_OPTIONS, item.size, "")}</TableCell>
              <TableCell className="max-w-40">
                <span className="block truncate text-xs text-muted-foreground">
                  {item.labels.join(", ")}
                </span>
              </TableCell>
              <TableCell>
                <WorkItemAssigneeIcon assignee={item.assignee} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  type CollisionDetection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { WorkItem, WorkItemId, WorkItemStatus } from "@t3tools/contracts";
import { workItemColumns } from "@t3tools/client-runtime/state/work-items";
import { PlusIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "~/lib/utils";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { WorkItemCard } from "./WorkItemCard";
import { WORK_ITEM_STATUS_OPTIONS } from "@t3tools/client-runtime/work-items";
import { dropPlacement, placementRank, type WorkItemPlacement } from "./workItems.logic";

export interface WorkItemViewProps {
  readonly items: ReadonlyArray<WorkItem>;
  readonly blocked: ReadonlySet<WorkItemId>;
  readonly keyOf: (item: WorkItem) => string;
  readonly repoName: (item: WorkItem) => string | null;
  readonly selectedId: WorkItemId | null;
  readonly onOpen: (id: WorkItemId) => void;
  readonly canEdit: boolean;
}

const collision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length > 0 ? hits : rectIntersection(args);
};

const parseDropId = (id: string) =>
  id.startsWith("column:")
    ? ({ kind: "column", status: id.slice("column:".length) as WorkItemStatus } as const)
    : ({ kind: "item", id: id.slice("item:".length) as WorkItemId } as const);

export function WorkItemBoardView(
  props: WorkItemViewProps & {
    readonly onMove: (id: WorkItemId, placement: WorkItemPlacement) => Promise<unknown>;
    readonly onQuickAdd: (status: WorkItemStatus, title: string) => Promise<unknown>;
  },
) {
  const [activeId, setActiveId] = useState<WorkItemId | null>(null);
  // Keeps a dropped card in place until the server's update for the move arrives.
  const [pending, setPending] = useState<{
    readonly id: WorkItemId;
    readonly status: WorkItemStatus;
    readonly rank: number;
  } | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );
  const shown =
    pending === null
      ? props.items
      : props.items.map((item) =>
          item.id === pending.id ? { ...item, status: pending.status, rank: pending.rank } : item,
        );
  const columns = workItemColumns(shown);
  const active = activeId === null ? null : shown.find((item) => item.id === activeId);

  const handleDragStart = (event: DragStartEvent) => {
    const dragged = parseDropId(String(event.active.id));
    setActiveId(dragged.kind === "item" ? dragged.id : null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveId(null);
    if (event.over === null) return;
    const moving = parseDropId(String(event.active.id));
    if (moving.kind !== "item") return;
    const placement = dropPlacement(columns, moving.id, parseDropId(String(event.over.id)));
    if (placement === null) return;
    const column = columns.get(placement.status) ?? [];
    setPending({
      id: moving.id,
      status: placement.status,
      rank: placementRank(column, moving.id, placement.afterId),
    });
    await props.onMove(moving.id, placement);
    setPending(null);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-3">
        {WORK_ITEM_STATUS_OPTIONS.map((status) => (
          <BoardColumn
            key={status.value}
            {...props}
            status={status.value}
            label={status.label}
            items={columns.get(status.value) ?? []}
          />
        ))}
      </div>
      <DragOverlay dropAnimation={null}>
        {active ? (
          <WorkItemCard
            item={active}
            itemKey={props.keyOf(active)}
            blocked={props.blocked.has(active.id)}
            repoName={props.repoName(active)}
            className="w-72 cursor-grabbing shadow-lg"
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function BoardColumn(
  props: WorkItemViewProps & {
    readonly status: WorkItemStatus;
    readonly label: string;
    readonly items: ReadonlyArray<WorkItem>;
    readonly onQuickAdd: (status: WorkItemStatus, title: string) => Promise<unknown>;
  },
) {
  const { setNodeRef, isOver } = useDroppable({ id: `column:${props.status}` });
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");

  const submit = async () => {
    const trimmed = title.trim();
    if (trimmed === "") return;
    setTitle("");
    await props.onQuickAdd(props.status, trimmed);
  };

  return (
    <section
      ref={setNodeRef}
      aria-label={props.label}
      className={cn(
        "flex w-72 shrink-0 flex-col rounded-xl bg-muted/40 p-2",
        isOver && "ring-2 ring-ring/40",
      )}
    >
      <header className="flex items-center gap-2 px-1 pb-2 text-sm font-medium">
        {props.label}
        <span className="text-xs text-muted-foreground">{props.items.length}</span>
        {props.canEdit && (
          <Button
            variant="ghost-muted"
            size="icon-xs"
            className="ml-auto"
            aria-label={`Add to ${props.label}`}
            onClick={() => setAdding(true)}
          >
            <PlusIcon />
          </Button>
        )}
      </header>
      <div className="flex min-h-12 flex-col gap-2 overflow-y-auto">
        {props.items.map((item) => (
          <DraggableCard key={item.id} item={item} {...props} />
        ))}
        {adding && (
          <Input
            autoFocus
            size="sm"
            placeholder="Title, then Enter"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={() => {
              if (title.trim() === "") setAdding(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") void submit();
              if (event.key === "Escape") {
                setTitle("");
                setAdding(false);
              }
            }}
          />
        )}
      </div>
    </section>
  );
}

function DraggableCard(props: WorkItemViewProps & { readonly item: WorkItem }) {
  const { item } = props;
  const draggable = useDraggable({ id: `item:${item.id}`, disabled: !props.canEdit });
  const droppable = useDroppable({ id: `item:${item.id}` });
  return (
    <div
      ref={(node) => {
        draggable.setNodeRef(node);
        droppable.setNodeRef(node);
      }}
      className={cn(
        draggable.isDragging && "opacity-40",
        droppable.isOver && !draggable.isDragging && "rounded-lg ring-2 ring-ring/40",
      )}
    >
      <WorkItemCard
        {...draggable.attributes}
        {...draggable.listeners}
        item={item}
        itemKey={props.keyOf(item)}
        blocked={props.blocked.has(item.id)}
        repoName={props.repoName(item)}
        aria-current={props.selectedId === item.id ? "true" : undefined}
        className={cn(props.selectedId === item.id && "border-ring")}
        onClick={() => props.onOpen(item.id)}
      />
    </div>
  );
}

import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { WorkItemBoard } from "@t3tools/client-runtime/state/work-items";
import {
  type EnvironmentId,
  type WorkItem,
  type WorkItemId,
  type WorkItemLinkKind,
  type WorkItemUpdateInput,
} from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { BotIcon, Trash2Icon, XIcon } from "lucide-react";
import { useState } from "react";

import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { workItems } from "~/state/workItems";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { settledOrToast } from "./workItemFeedback";
import {
  optionLabel,
  startAgentPrompt,
  WORK_ITEM_ASSIGNEE_OPTIONS,
  WORK_ITEM_PRIORITY_OPTIONS,
  WORK_ITEM_SIZE_OPTIONS,
  WORK_ITEM_STATUS_OPTIONS,
  WORK_ITEM_TYPE_OPTIONS,
} from "@t3tools/client-runtime/work-items";

const NONE = "__none";

interface Option<V extends string> {
  readonly value: V;
  readonly label: string;
}

function FieldSelect<V extends string>(props: {
  readonly label: string;
  readonly value: V | null;
  readonly options: ReadonlyArray<Option<V>>;
  readonly noneLabel?: string | undefined;
  readonly disabled?: boolean;
  readonly onChange: (value: V | null) => void;
}) {
  return (
    <label className="grid grid-cols-[6rem_1fr] items-center gap-2 text-sm">
      <span className="text-muted-foreground">{props.label}</span>
      <Select
        value={props.value ?? NONE}
        disabled={props.disabled}
        onValueChange={(next) => {
          if (typeof next !== "string") return;
          props.onChange(next === NONE ? null : (next as V));
        }}
      >
        <SelectTrigger size="sm" aria-label={props.label}>
          <SelectValue>
            {props.value === null
              ? (props.noneLabel ?? "None")
              : optionLabel(props.options, props.value)}
          </SelectValue>
        </SelectTrigger>
        <SelectPopup alignItemWithTrigger={false}>
          {props.noneLabel !== undefined && <SelectItem value={NONE}>{props.noneLabel}</SelectItem>}
          {props.options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    </label>
  );
}

const RELATION_OPTIONS = [
  { value: "blocks", label: "Blocks" },
  { value: "blocked_by", label: "Blocked by" },
  { value: "relates", label: "Relates to" },
  { value: "duplicates", label: "Duplicates" },
] as const;
type RelationChoice = (typeof RELATION_OPTIONS)[number]["value"];

export function WorkItemDetailPanel(props: {
  readonly environmentId: EnvironmentId;
  readonly board: WorkItemBoard;
  readonly item: WorkItem;
  readonly keyOf: (item: WorkItem) => string;
  readonly repoOptions: ReadonlyArray<Option<string>>;
  readonly canEdit: boolean;
  readonly onClose: () => void;
  readonly onOpen: (id: WorkItemId) => void;
}) {
  const { item, board, environmentId } = props;
  const detail = useEnvironmentQuery(workItems.detail({ environmentId, input: { id: item.id } }));
  const update = useAtomCommand(workItems.update, { reportFailure: false });
  const setLink = useAtomCommand(workItems.setLink, { reportFailure: false });
  const comment = useAtomCommand(workItems.comment, { reportFailure: false });
  const setDeleted = useAtomCommand(workItems.setDeleted, { reportFailure: false });
  const handleNewThread = useNewThreadHandler();
  const [title, setTitle] = useState(item.title);
  const [labels, setLabels] = useState(item.labels.join(", "));
  const savedDescription = detail.data?.detail.description ?? "";
  const [description, setDescription] = useState<string | null>(null);
  const [commentText, setCommentText] = useState("");
  const [relation, setRelation] = useState<RelationChoice>("blocks");
  const [relationTarget, setRelationTarget] = useState<WorkItemId | null>(null);

  const save = async (patch: Omit<WorkItemUpdateInput, "id">) => {
    const result = await update({ environmentId, input: { id: item.id, ...patch } });
    if (settledOrToast(result, "Could not save the work item") !== null) detail.refresh();
  };

  const byId = new Map(board.items.map((entry) => [entry.id, entry]));
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
    return [{ link, other, label }];
  });
  const children = board.items.filter((entry) => entry.parentId === item.id);
  const parentOptions = board.items
    .filter((entry) => entry.id !== item.id)
    .map((entry) => ({ value: entry.id, label: `${props.keyOf(entry)} ${entry.title}` }));

  const addRelation = async () => {
    if (relationTarget === null) return;
    const kind: WorkItemLinkKind = relation === "blocked_by" ? "blocks" : relation;
    const [sourceId, targetId] =
      relation === "blocked_by" ? [relationTarget, item.id] : [item.id, relationTarget];
    const result = await setLink({
      environmentId,
      input: { sourceId, targetId, kind, linked: true },
    });
    if (settledOrToast(result, "Could not link the work items") !== null) setRelationTarget(null);
  };

  const startAgent = async () => {
    if (item.projectId === null) return;
    await handleNewThread(scopeProjectRef(environmentId, item.projectId), {
      prompt: startAgentPrompt(props.keyOf(item), item.title),
    });
  };

  return (
    <aside
      aria-label={`${props.keyOf(item)} details`}
      className="flex w-full shrink-0 flex-col border-l bg-background md:w-[26rem]"
    >
      <header className="flex items-center gap-2 border-b px-3 py-2">
        <span className="font-mono text-xs text-muted-foreground">{props.keyOf(item)}</span>
        <div className="flex-1" />
        <Button
          size="xs"
          variant="outline"
          disabled={!props.canEdit || item.projectId === null}
          title={item.projectId === null ? "Pick a repo first" : undefined}
          onClick={() => void startAgent()}
        >
          <BotIcon />
          Start agent
        </Button>
        <Button
          size="icon-xs"
          variant="ghost-destructive"
          aria-label="Delete"
          disabled={!props.canEdit}
          onClick={async () => {
            const result = await setDeleted({
              environmentId,
              input: { id: item.id, deleted: true },
            });
            if (settledOrToast(result, "Could not delete the work item") !== null) props.onClose();
          }}
        >
          <Trash2Icon />
        </Button>
        <Button size="icon-xs" variant="ghost-muted" aria-label="Close" onClick={props.onClose}>
          <XIcon />
        </Button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3">
        <Input
          aria-label="Title"
          value={title}
          disabled={!props.canEdit}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={() => {
            if (title.trim() !== "" && title.trim() !== item.title)
              void save({ title: title.trim() });
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
        <div className="flex flex-col gap-2">
          <FieldSelect
            label="Status"
            value={item.status}
            options={WORK_ITEM_STATUS_OPTIONS}
            disabled={!props.canEdit}
            onChange={(status) => status !== null && void save({ status })}
          />
          <FieldSelect
            label="Type"
            value={item.type}
            options={WORK_ITEM_TYPE_OPTIONS}
            disabled={!props.canEdit}
            onChange={(type) => type !== null && void save({ type })}
          />
          <FieldSelect
            label="Priority"
            value={item.priority}
            options={WORK_ITEM_PRIORITY_OPTIONS}
            disabled={!props.canEdit}
            onChange={(priority) => priority !== null && void save({ priority })}
          />
          <FieldSelect
            label="Repo"
            value={item.projectId}
            options={props.repoOptions}
            noneLabel={item.type === "epic" ? "No repo" : undefined}
            disabled={!props.canEdit}
            onChange={(projectId) =>
              void save({
                projectId: projectId === null ? null : (projectId as WorkItem["projectId"]),
              })
            }
          />
          {item.type !== "epic" && (
            <FieldSelect
              label="Parent"
              value={item.parentId}
              options={parentOptions}
              noneLabel="No parent"
              disabled={!props.canEdit}
              onChange={(parentId) => void save({ parentId })}
            />
          )}
          <FieldSelect
            label="Assignee"
            value={item.assignee}
            options={WORK_ITEM_ASSIGNEE_OPTIONS}
            noneLabel="Unassigned"
            disabled={!props.canEdit}
            onChange={(assignee) => void save({ assignee })}
          />
          <FieldSelect
            label="Size"
            value={item.size}
            options={WORK_ITEM_SIZE_OPTIONS}
            noneLabel="No size"
            disabled={!props.canEdit}
            onChange={(size) => void save({ size })}
          />
          <label className="grid grid-cols-[6rem_1fr] items-center gap-2 text-sm">
            <span className="text-muted-foreground">Labels</span>
            <Input
              size="sm"
              value={labels}
              placeholder="api, ui"
              disabled={!props.canEdit}
              onChange={(event) => setLabels(event.target.value)}
              onBlur={() => {
                const next = labels
                  .split(",")
                  .map((label) => label.trim())
                  .filter((label) => label !== "");
                if (next.join(",") !== item.labels.join(",")) void save({ labels: next });
              }}
            />
          </label>
        </div>

        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Description</h3>
          <Textarea
            aria-label="Description"
            placeholder="What and why. Add acceptance criteria as a checklist."
            value={description ?? savedDescription}
            disabled={!props.canEdit || detail.data === null}
            onChange={(event) => setDescription(event.target.value)}
          />
          {description !== null && description !== savedDescription && (
            <div className="flex justify-end gap-2">
              <Button size="xs" variant="ghost" onClick={() => setDescription(null)}>
                Discard
              </Button>
              <Button
                size="xs"
                onClick={async () => {
                  await save({ description });
                  setDescription(null);
                }}
              >
                Save
              </Button>
            </div>
          )}
        </section>

        {children.length > 0 && (
          <section className="flex flex-col gap-1">
            <h3 className="text-sm font-medium">Children</h3>
            {children.map((child) => (
              <button
                key={child.id}
                type="button"
                className="flex items-center gap-2 rounded px-1 py-0.5 text-left text-sm hover:bg-accent"
                onClick={() => props.onOpen(child.id)}
              >
                <span className="font-mono text-xs text-muted-foreground">
                  {props.keyOf(child)}
                </span>
                <span className="truncate">{child.title}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {optionLabel(WORK_ITEM_STATUS_OPTIONS, child.status)}
                </span>
              </button>
            ))}
          </section>
        )}

        <section className="flex flex-col gap-1">
          <h3 className="text-sm font-medium">Relations</h3>
          {relations.map(({ link, other, label }) => (
            <div
              key={`${link.sourceId}:${link.targetId}:${link.kind}`}
              className="flex items-center gap-2 text-sm"
            >
              <span className="w-24 shrink-0 text-xs text-muted-foreground">{label}</span>
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left hover:underline"
                onClick={() => props.onOpen(other.id)}
              >
                <span className="font-mono text-xs text-muted-foreground">
                  {props.keyOf(other)}
                </span>{" "}
                {other.title}
              </button>
              {props.canEdit && (
                <Button
                  size="icon-micro"
                  variant="ghost-muted"
                  aria-label="Remove relation"
                  onClick={async () =>
                    settledOrToast(
                      await setLink({
                        environmentId,
                        input: {
                          sourceId: link.sourceId,
                          targetId: link.targetId,
                          kind: link.kind,
                          linked: false,
                        },
                      }),
                      "Could not remove the relation",
                    )
                  }
                >
                  <XIcon />
                </Button>
              )}
            </div>
          ))}
          {props.canEdit && (
            <div className="flex items-center gap-2">
              <Select
                value={relation}
                onValueChange={(next) =>
                  typeof next === "string" && setRelation(next as RelationChoice)
                }
              >
                <SelectTrigger size="xs" className="w-28 min-w-0" aria-label="Relation">
                  <SelectValue>{optionLabel(RELATION_OPTIONS, relation)}</SelectValue>
                </SelectTrigger>
                <SelectPopup alignItemWithTrigger={false}>
                  {RELATION_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
              <Select
                value={relationTarget ?? NONE}
                onValueChange={(next) =>
                  typeof next === "string" &&
                  setRelationTarget(next === NONE ? null : (next as WorkItemId))
                }
              >
                <SelectTrigger size="xs" className="min-w-0 flex-1" aria-label="Related item">
                  <SelectValue>
                    {relationTarget === null
                      ? "Pick an item"
                      : optionLabel(parentOptions, relationTarget)}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup alignItemWithTrigger={false}>
                  {parentOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
              <Button
                size="xs"
                variant="outline"
                disabled={relationTarget === null}
                onClick={() => void addRelation()}
              >
                Add
              </Button>
            </div>
          )}
        </section>

        {item.threadIds.length > 0 && (
          <section className="flex flex-col gap-1">
            <h3 className="text-sm font-medium">Threads</h3>
            {item.threadIds.map((threadId) => (
              <Link
                key={threadId}
                to="/$environmentId/$threadId"
                params={{ environmentId, threadId }}
                className="truncate text-sm hover:underline"
              >
                {threadId}
              </Link>
            ))}
          </section>
        )}

        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Activity</h3>
          <ol className="flex flex-col gap-2 text-sm">
            {(detail.data?.detail.activity ?? []).map((entry) => (
              <li key={entry.id} className="flex flex-col gap-0.5">
                <span className="text-xs text-muted-foreground">
                  {entry.actor.kind === "agent" ? "Agent" : "You"} {entry.kind} ·{" "}
                  {new Date(entry.createdAt).toLocaleString()}
                </span>
                {entry.body !== null && <p className="whitespace-pre-wrap">{entry.body}</p>}
                {entry.changes.map((change) => (
                  <span key={change.field} className="text-xs text-muted-foreground">
                    {change.field}
                    {change.from !== null || change.to !== null
                      ? `: ${change.from ?? "none"} → ${change.to ?? "none"}`
                      : " changed"}
                  </span>
                ))}
              </li>
            ))}
          </ol>
          {props.canEdit && (
            <div className="flex flex-col gap-2">
              <Textarea
                aria-label="Comment"
                placeholder="Add a comment"
                value={commentText}
                onChange={(event) => setCommentText(event.target.value)}
              />
              <Button
                size="xs"
                className="self-end"
                disabled={commentText.trim() === ""}
                onClick={async () => {
                  const result = await comment({
                    environmentId,
                    input: { id: item.id, body: commentText.trim() },
                  });
                  if (settledOrToast(result, "Could not post the comment") !== null) {
                    setCommentText("");
                    detail.refresh();
                  }
                }}
              >
                Comment
              </Button>
            </div>
          )}
        </section>
      </div>
    </aside>
  );
}

import type { EnvironmentId, ProjectId, WorkItemSpace } from "@t3tools/contracts";
import { useState } from "react";

import { useProjects } from "~/state/entities";
import { useAtomCommand } from "~/state/use-atom-command";
import { workItems } from "~/state/workItems";

import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { settledOrToast } from "./workItemFeedback";

const KEY_PATTERN = /^[A-Z][A-Z0-9]{1,5}$/;

export function WorkItemSpaceDialog(props: {
  readonly environmentId: EnvironmentId;
  /** Null creates a space. */
  readonly space: WorkItemSpace | null;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSaved: (space: WorkItemSpace) => void;
}) {
  const { space, environmentId } = props;
  const projects = useProjects().filter(
    (project) =>
      project.environmentId === environmentId &&
      project.isScratch !== true &&
      (project.archivedAt == null || space?.projectIds.includes(project.id) === true),
  );
  const createSpace = useAtomCommand(workItems.createSpace, { reportFailure: false });
  const updateSpace = useAtomCommand(workItems.updateSpace, { reportFailure: false });
  const setArchived = useAtomCommand(workItems.setSpaceArchived, { reportFailure: false });
  const [name, setName] = useState(space?.name ?? "");
  const [key, setKey] = useState(space?.key ?? "");
  const [description, setDescription] = useState(space?.description ?? "");
  const [projectIds, setProjectIds] = useState<ReadonlyArray<ProjectId>>(space?.projectIds ?? []);
  const [saving, setSaving] = useState(false);
  const keyValid = KEY_PATTERN.test(key);

  const submit = async () => {
    setSaving(true);
    const saved =
      space === null
        ? settledOrToast(
            await createSpace({
              environmentId,
              input: { key, name: name.trim(), description, projectIds },
            }),
            "Could not create the space",
          )
        : settledOrToast(
            await updateSpace({
              environmentId,
              input: { id: space.id, name: name.trim(), description, projectIds },
            }),
            "Could not save the space",
          );
    setSaving(false);
    if (saved === null) return;
    props.onSaved(saved.space);
    props.onOpenChange(false);
  };

  const toggleArchived = async () => {
    if (space === null) return;
    const saved = settledOrToast(
      await setArchived({
        environmentId,
        input: { id: space.id, archived: space.archivedAt === null },
      }),
      space.archivedAt === null ? "Could not archive the space" : "Could not restore the space",
    );
    if (saved !== null) {
      props.onSaved(saved.space);
      props.onOpenChange(false);
    }
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{space === null ? "New space" : `Edit ${space.name}`}</DialogTitle>
          <DialogDescription>
            A space holds work items for one or more repos on this environment.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="grid grid-cols-[1fr_7rem] gap-3">
            <label className="flex flex-col gap-1 text-sm">
              Name
              <Input
                value={name}
                placeholder="Shop"
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Key
              <Input
                value={key}
                placeholder="SHOP"
                disabled={space !== null}
                aria-invalid={key !== "" && !keyValid}
                onChange={(event) => setKey(event.target.value.toUpperCase().slice(0, 6))}
              />
            </label>
          </div>
          {space === null && (
            <p className="-mt-2 text-xs text-muted-foreground">
              Items are numbered from the key, like {keyValid ? key : "SHOP"}-12. It cannot change
              later.
            </p>
          )}
          <label className="flex flex-col gap-1 text-sm">
            Description
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <fieldset className="flex flex-col gap-1.5 text-sm">
            <legend className="pb-1">Repos</legend>
            {projects.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Add a project to this environment first.
              </p>
            )}
            {projects.map((project) => (
              <label key={project.id} className="flex items-center gap-2">
                <Checkbox
                  checked={projectIds.includes(project.id)}
                  onCheckedChange={(checked) =>
                    setProjectIds((current) =>
                      checked
                        ? [...current, project.id]
                        : current.filter((id) => id !== project.id),
                    )
                  }
                />
                <span className="truncate">{project.title}</span>
              </label>
            ))}
          </fieldset>
        </DialogPanel>
        <DialogFooter>
          {space !== null && (
            <Button variant="ghost" className="mr-auto" onClick={() => void toggleArchived()}>
              {space.archivedAt === null ? "Archive space" : "Restore space"}
            </Button>
          )}
          <Button variant="ghost" onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={saving || name.trim() === "" || (space === null && !keyValid)}
            onClick={() => void submit()}
          >
            {space === null ? "Create space" : "Save"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

import type { EnvironmentId, WorkItemId, WorkItemSpaceId } from "@t3tools/contracts";
import { createFileRoute } from "@tanstack/react-router";

import { WorkItemsPage, type WorkItemsSearch } from "../components/workItems/WorkItemsPage";

const text = (value: unknown) =>
  typeof value === "string" && value.length > 0 && value.length <= 200 ? value : undefined;

export const Route = createFileRoute("/_chat/work-items")({
  validateSearch: (raw: Record<string, unknown>): WorkItemsSearch => {
    const environment = text(raw.environment);
    const space = text(raw.space);
    const item = text(raw.item);
    return {
      ...(environment === undefined ? {} : { environment: environment as EnvironmentId }),
      ...(space === undefined ? {} : { space: space as WorkItemSpaceId }),
      ...(raw.view === "board" || raw.view === "list" || raw.view === "table"
        ? { view: raw.view }
        : {}),
      ...(item === undefined ? {} : { item: item as WorkItemId }),
    };
  },
  component: WorkItemsPage,
});

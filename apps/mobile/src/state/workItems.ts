import { createWorkItemAtoms } from "@t3tools/client-runtime/state/work-items";

import { connectionAtomRuntime } from "../connection/runtime";

export const workItems = createWorkItemAtoms(connectionAtomRuntime);

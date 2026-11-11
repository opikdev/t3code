import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";

import * as Dialog from "../../components/ui/Dialog";

/** The command's value, or null after telling the user why it failed. */
export function settledOrAlert<A, E>(result: AtomCommandResult<A, E>, title: string): A | null {
  if (result._tag === "Success") return result.value;
  if (!isAtomCommandInterrupted(result)) {
    const error = squashAtomCommandFailure(result);
    Dialog.alert(title, error instanceof Error ? error.message : "The environment request failed.");
  }
  return null;
}

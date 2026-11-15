import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommand,
} from "@t3tools/client-runtime/state/runtime";

import { useAtomCommand } from "../../state/use-atom-command";
import { toastManager } from "../ui/toast";
import { orchestryErrorMessage } from "./orchestryPresentation";

/** `useAtomCommand` that tells the user why ORCH refused, which the default only logs. */
export function useOrchestryCommand<A, E, W>(command: AtomCommand<W, A, E>, label: string) {
  const run = useAtomCommand(command, { label });
  return async (value: W) => {
    const result = await run(value);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      toastManager.add({
        type: "error",
        title: `${label} failed`,
        description: orchestryErrorMessage(squashAtomCommandFailure(result)),
      });
    }
    return result;
  };
}

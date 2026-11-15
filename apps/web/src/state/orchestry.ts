import { createOrchestryEnvironmentAtoms } from "@t3tools/client-runtime/state/orchestry";

import { connectionAtomRuntime } from "../connection/runtime";

export const orchestryEnvironment = createOrchestryEnvironmentAtoms(connectionAtomRuntime);

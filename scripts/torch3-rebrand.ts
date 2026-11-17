// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - A one-shot text rewrite run by hand.
// Renames the product in user-visible client and CLI text from "T3 Code" to "Torch3".
// After an upstream merge, take upstream's side of a conflict on such a line and rerun:
//   vp run torch3:rebrand
// Provider and MCP text the models read is left to upstream; evals and replay fixtures cover it.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

const root = NodePath.resolve(import.meta.dirname, "..");
const PATHS = [
  "apps/web/src",
  "apps/web/vite.config.ts",
  "apps/desktop/src",
  "apps/server/src/cli",
  "apps/server/src/cloud/selfUpdate.test.ts",
  "apps/server/src/persistence/DatabaseMaintenance.ts",
  "apps/server/src/binCli.ts",
  "apps/server/src/serverOwnership.ts",
  "apps/server/src/serverRuntimeStartup.ts",
  "apps/server/src/serviceLauncher.ts",
  "apps/server/src/startupAccess.ts",
  "apps/server/src/orchestration-v2/Orchestrator.ts",
  "apps/server/src/orchestration-v2/ProviderTurnStartService.ts",
  "apps/server/src/orchestration-v2/ProviderTurnStartService.test.ts",
  "apps/server/src/orchestration-v2/RestartContinuation.ts",
  "apps/server/src/orchestration-v2/UserFacingErrors.ts",
  "apps/server/src/orchestration-v2/runtimeLayer.test.ts",
  "packages/client-runtime/src",
  "packages/contracts/src/managedPolicy.ts",
];
// Lines naming upstream itself, install paths and fixture device labels keep their text.
const KEEP = /pingdotgg|t3\.codes|T3 Code Nightly|upstream|\/opt\/|Mobile/i;

const walk = (target: string): string[] =>
  NodeFS.statSync(target).isFile()
    ? [target]
    : NodeFS.readdirSync(target, { withFileTypes: true }).flatMap((entry) => {
        const full = NodePath.join(target, entry.name);
        if (entry.isDirectory()) return entry.name === "node_modules" ? [] : walk(full);
        return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
      });

let changed = 0;
for (const file of PATHS.flatMap((target) => walk(NodePath.join(root, target)))) {
  const before = NodeFS.readFileSync(file, "utf8");
  const after = before
    .split("\n")
    .map((line) =>
      KEEP.test(line)
        ? line
        : line.replaceAll("T3 Code", "Torch3").replaceAll("T3%20Code", "Torch3"),
    )
    .join("\n");
  if (after !== before) {
    NodeFS.writeFileSync(file, after);
    changed += 1;
  }
}
console.log(`torch3-rebrand: updated ${changed} files`);

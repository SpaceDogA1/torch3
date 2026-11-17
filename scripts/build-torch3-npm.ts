#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - A linear, synchronous release step run once in CI.
// Packs the built server (apps/server/dist, web client included) as the `@torch3/cli` npm package.
// npm refuses the bare name `torch3` as too close to `touch`; the command it installs is still `torch3`.
// Unlike upstream's `t3` launcher, which downloads a single-file executable that cannot run ORCH,
// this package runs on the host Node, so Orchestry works under `npx @torch3/cli`.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeOS from "node:os";
import * as NodeUtil from "node:util";

import { fromYaml } from "@t3tools/shared/schemaYaml";
import * as Schema from "effect/Schema";

import { selectCliRuntimeExternalDependencies } from "./lib/cli-external-packages.ts";
import { resolveCatalogDependencies } from "./lib/resolve-catalog.ts";

const ORCH = "@oxgeneral/orch";
const repoRoot = NodePath.resolve(import.meta.dirname, "..");
const { values } = NodeUtil.parseArgs({
  options: { version: { type: "string" }, "output-dir": { type: "string" } },
});
const outputDir = NodePath.resolve(
  values["output-dir"] ?? NodePath.join(repoRoot, "release", "npm"),
);

const serverPackage = JSON.parse(
  NodeFS.readFileSync(NodePath.join(repoRoot, "apps/server/package.json"), "utf8"),
);
const version = values.version ?? serverPackage.version;
const distDir = NodePath.join(repoRoot, "apps/server/dist");
if (!NodeFS.existsSync(NodePath.join(distDir, "bin.mjs"))) {
  throw new Error("apps/server/dist/bin.mjs is missing. Run `vp run --filter t3 build` first.");
}

const workspace = Schema.decodeSync(
  fromYaml(
    Schema.Struct({ catalog: Schema.optional(Schema.Record(Schema.String, Schema.String)) }),
  ),
)(NodeFS.readFileSync(NodePath.join(repoRoot, "pnpm-workspace.yaml"), "utf8"));
const dependencies = selectCliRuntimeExternalDependencies(
  resolveCatalogDependencies(serverPackage.dependencies, workspace.catalog ?? {}, "apps/server"),
);
const orchVersion = dependencies[ORCH];
if (orchVersion === undefined) throw new Error(`${ORCH} is not an apps/server dependency.`);

// npm is npm.cmd on Windows, which execFile can only start through a shell; the arguments are constants.
const run = (command: string, args: string[], cwd: string) =>
  NodeChildProcess.execFileSync(command, args, {
    cwd,
    stdio: "inherit",
    // oxlint-disable-next-line t3code/no-global-process-runtime -- standalone build script, not Effect code
    shell: NodeOS.platform() === "win32",
  });

NodeFS.rmSync(outputDir, { recursive: true, force: true });
const stageDir = NodePath.join(outputDir, "package");
NodeFS.mkdirSync(stageDir, { recursive: true });
// Source maps double the unpacked size and are not needed to run.
NodeFS.cpSync(distDir, NodePath.join(stageDir, "dist"), {
  recursive: true,
  filter: (source) => !source.endsWith(".map"),
});

NodeFS.writeFileSync(
  NodePath.join(stageDir, "package.json"),
  `${JSON.stringify(
    {
      name: "@torch3/cli",
      version,
      description:
        "Torch3: the open-source control plane for coding agents, with ORCH multi-agent orchestration built in.",
      license: serverPackage.license,
      repository: { type: "git", url: "https://github.com/SpaceDogA1/torch3" },
      homepage: "https://github.com/SpaceDogA1/torch3#readme",
      keywords: ["coding-agents", "claude-code", "codex", "orchestration", "orch"],
      type: "module",
      bin: { torch3: "./dist/bin.mjs" },
      files: ["dist"],
      engines: serverPackage.engines,
      dependencies,
      // ORCH ships pre-patched (no self-update) and without its install script.
      bundleDependencies: [ORCH],
    },
    null,
    2,
  )}\n`,
);
NodeFS.copyFileSync(NodePath.join(repoRoot, "LICENSE"), NodePath.join(stageDir, "LICENSE"));
NodeFS.writeFileSync(
  NodePath.join(stageDir, "README.md"),
  [
    "# Torch3",
    "",
    "Torch3 is [T3 Code](https://t3.codes) with [ORCH](https://github.com/oxgeneral/ORCH)",
    "multi-agent orchestration built in.",
    "",
    "```sh",
    "npx @torch3/cli",
    "```",
    "",
    "Starts the Torch3 server and opens the web app. Install it with `npm install --global @torch3/cli` to",
    "run it later as `torch3`. Data lives in `~/.torch3`, separate from T3 Code.",
    "Requires Node.js 22.16 or newer and at least one coding agent CLI signed in.",
    "",
    "Docs: https://github.com/SpaceDogA1/torch3#readme",
    "",
  ].join("\n"),
);

// Install ORCH alone, without scripts, then apply the repository's patch to the copy we ship.
const orchInstallDir = NodePath.join(outputDir, "orch-install");
NodeFS.mkdirSync(orchInstallDir, { recursive: true });
NodeFS.writeFileSync(
  NodePath.join(orchInstallDir, "package.json"),
  JSON.stringify({ private: true, dependencies: { [ORCH]: orchVersion } }),
);
run(
  "npm",
  ["install", "--ignore-scripts", "--omit=dev", "--no-audit", "--no-fund", "--no-package-lock"],
  orchInstallDir,
);
NodeFS.renameSync(
  NodePath.join(orchInstallDir, "node_modules"),
  NodePath.join(stageDir, "node_modules"),
);
NodeFS.rmSync(orchInstallDir, { recursive: true, force: true });

// Copy the files the pnpm patch changes from the workspace's patched install.
const orchDir = NodePath.join(stageDir, "node_modules", ORCH);
const patchedOrchDir = NodeFS.realpathSync(
  NodePath.join(repoRoot, "apps/server/node_modules", ORCH),
);
const patchFile = NodePath.join(
  repoRoot,
  "patches",
  `${ORCH.replace("/", "__")}@${orchVersion}.patch`,
);
const patchedFiles = [...NodeFS.readFileSync(patchFile, "utf8").matchAll(/^\+\+\+ b\/(.+)$/gm)].map(
  (match) => match[1]!,
);
if (patchedFiles.length === 0) throw new Error(`${patchFile} names no files.`);
for (const file of patchedFiles) {
  NodeFS.copyFileSync(NodePath.join(patchedOrchDir, file), NodePath.join(orchDir, file));
}
const orchManifestPath = NodePath.join(orchDir, "package.json");
const orchManifest = JSON.parse(NodeFS.readFileSync(orchManifestPath, "utf8"));
delete orchManifest.scripts?.postinstall;
NodeFS.writeFileSync(orchManifestPath, `${JSON.stringify(orchManifest, null, 2)}\n`);

run("npm", ["pack", "--pack-destination", outputDir], stageDir);
console.log(`[torch3-npm] packed @torch3/cli@${version} into ${outputDir}`);

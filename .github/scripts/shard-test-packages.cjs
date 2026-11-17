#!/usr/bin/env node
// Prints the workspace packages one CI `Test` shard runs, space separated.
// Usage: node shard-test-packages.cjs <shard> <total>   (shard is 1-based)
// TEST_PACKAGES, when set, limits the pool to those packages (what `changes` found affected).
// apps/server (`t3`) and apps/web have their own sharded jobs and never appear here.
const fs = require("node:fs");
const path = require("node:path");

const [shard, total] = process.argv.slice(2).map(Number);
if (!Number.isInteger(shard) || !Number.isInteger(total) || shard < 1 || shard > total) {
  console.error("usage: shard-test-packages.cjs <shard> <total>");
  process.exit(2);
}

const root = path.resolve(__dirname, "..", "..");
const EXCLUDED = new Set(["t3", "@t3tools/monorepo", "@t3tools/web"]);
// Rough relative cost from CI timings. Unlisted packages weigh 1. Only balance depends on this.
const WEIGHTS = {
  "infra/relay": 8,
  "packages/ssh": 6,
  "packages/provider-muse": 6,
  "apps/desktop": 4,
  "packages/shared": 3,
  "packages/provider-acp-registry": 3,
  "apps/mobile": 3,
  evals: 3,
  "packages/effect-acp": 2,
  "packages/provider-opencode": 2,
  "packages/client-runtime": 2,
  "packages/secret-provider-onepassword": 2,
};

const dirsOf = (parent) => {
  const full = path.join(root, parent);
  return fs.existsSync(full)
    ? fs
        .readdirSync(full, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => `${parent}/${entry.name}`)
    : [];
};
const candidates = [
  ...dirsOf("apps"),
  "evals",
  ...dirsOf("infra"),
  "oxlint-plugin-t3code",
  ...dirsOf("packages"),
  "scripts",
];

const requested = new Set((process.env.TEST_PACKAGES ?? "").split(/\s+/).filter(Boolean));
const packages = [];
for (const dir of candidates) {
  const manifestPath = path.join(root, dir, "package.json");
  if (!fs.existsSync(manifestPath)) continue;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (!manifest.scripts?.test || EXCLUDED.has(manifest.name)) continue;
  if (requested.size > 0 && !requested.has(manifest.name)) continue;
  packages.push({ name: manifest.name, weight: WEIGHTS[dir] ?? 1 });
}

// Heaviest first onto the lightest shard keeps shard totals close.
packages.sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name));
const shards = Array.from({ length: total }, () => ({ weight: 0, names: [] }));
for (const pkg of packages) {
  const lightest = shards.reduce((best, next) => (next.weight < best.weight ? next : best));
  lightest.weight += pkg.weight;
  lightest.names.push(pkg.name);
}
console.log(shards[shard - 1].names.join(" "));

#!/usr/bin/env node
/**
 * The hatch verify gate (task T003).
 *
 * `pnpm verify` runs every gate in one command. The gate stops at the first
 * failure and exits non-zero. A clean run exits 0.
 *
 * Steps, in order:
 *   1. prepare    - a clean build of every package into `dist/`
 *   2. typecheck  - one strict pass over `src/` and `test/`
 *   3. unit tests - the Vitest suite of every package
 *   4. visual     - the Playwright golden-image suite, headless (T024)
 *   5. editor     - the Playwright smoke suite of the editor, headless (T026)
 *   6. determinism - a second clean build; every file must match the first
 *
 * The build runs first because cross-package imports resolve through the
 * built `dist/` directories, not through `src/`.
 *
 * Rule for later rounds: extend this gate, never weaken it. Add a check to
 * the matching list below. Do not remove, skip, or relax an existing check.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packagesDir = path.join(rootDir, "packages");

/** Print a message prefixed with the tool name, then exit non-zero. */
function fail(message) {
  console.error(`verify: ${message}`);
  process.exit(1);
}

/** Run one command in the workspace root. Stream its output. Return true on exit 0. */
function runCommand(command, args, label) {
  console.log(`verify: run ${label}`);
  const result = spawnSync(command, args, { cwd: rootDir, stdio: "inherit" });
  if (result.error) {
    console.error(`verify: could not start ${command}: ${result.error.message}`);
    return false;
  }
  return result.status === 0;
}

/** List every workspace package directory that holds a package.json. */
function workspacePackageDirs() {
  return readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(packagesDir, entry.name))
    .filter((dir) => existsSync(path.join(dir, "package.json")));
}

/** Remove the build output of every package. `dist/` and `*.tsbuildinfo` are generated files. */
function cleanBuildOutput() {
  for (const packageDir of workspacePackageDirs()) {
    rmSync(path.join(packageDir, "dist"), { recursive: true, force: true });
    for (const entry of readdirSync(packageDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".tsbuildinfo")) {
        rmSync(path.join(packageDir, entry.name), { force: true });
      }
    }
  }
}

/** Collect file paths below `dir`, relative to `dir`, in a stable order. */
function collectFiles(dir, prefix, out) {
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : 1,
  );
  for (const entry of entries) {
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(absolute, relative, out);
    } else if (entry.isFile()) {
      out.push(relative);
    }
  }
}

/**
 * Describe the build output of every package as `package/path sha256` entries.
 * The same source must always produce the same manifest.
 */
function buildManifest() {
  const entries = [];
  for (const packageDir of workspacePackageDirs()) {
    const distDir = path.join(packageDir, "dist");
    if (!existsSync(distDir)) continue;
    const files = [];
    collectFiles(distDir, "", files);
    const packageName = path.basename(packageDir);
    for (const file of files) {
      const digest = createHash("sha256")
        .update(readFileSync(path.join(distDir, file)))
        .digest("hex");
      entries.push({ key: `${packageName}/${file}`, digest });
    }
  }
  return entries;
}

/** Report the first differences between two manifests. Return true when they match. */
function manifestsMatch(first, second) {
  const firstMap = new Map(first.map((entry) => [entry.key, entry.digest]));
  const secondMap = new Map(second.map((entry) => [entry.key, entry.digest]));
  const differences = [];
  for (const [key, digest] of firstMap) {
    if (!secondMap.has(key)) {
      differences.push(`${key}: present in the first build only`);
    } else if (secondMap.get(key) !== digest) {
      differences.push(`${key}: content differs between builds`);
    }
  }
  for (const key of secondMap.keys()) {
    if (!firstMap.has(key)) {
      differences.push(`${key}: present in the second build only`);
    }
  }
  if (differences.length === 0) return true;

  for (const difference of differences.slice(0, 10)) {
    console.error(`verify: determinism: ${difference}`);
  }
  if (differences.length > 10) {
    console.error(`verify: determinism: ${differences.length - 10} more differences`);
  }
  return false;
}

/**
 * Determinism check: identical source must give identical build output.
 *
 * Specification section 10: identical version, seed, preset, and spec must
 * give identical output. Today the compiler emits no scenes yet, so the
 * build output is the artifact under test. Later rounds add scene-render
 * byte identity to this list.
 */
function rebuildIsByteIdentical() {
  const first = buildManifest();
  if (first.length === 0) {
    console.error("verify: determinism: the first build produced no output");
    return false;
  }

  cleanBuildOutput();
  if (!runCommand("pnpm", ["build"], "pnpm build (second pass)")) {
    console.error("verify: determinism: the second build failed");
    return false;
  }

  const second = buildManifest();
  if (second.length === 0) {
    console.error("verify: determinism: the second build produced no output");
    return false;
  }

  if (!manifestsMatch(first, second)) {
    console.error(
      `verify: determinism: ${first.length} files in the first build, ` +
        `${second.length} in the second`,
    );
    return false;
  }

  console.log(`verify: determinism: ${second.length} files are byte-identical across two clean builds`);
  return true;
}

/** Every determinism check. Later rounds append here. */
const determinismChecks = [
  { name: "rebuild byte identity", check: rebuildIsByteIdentical },
];

/** Every ordered step of the gate. Later rounds append here. */
const steps = [
  {
    label: "prepare build",
    run: () => {
      cleanBuildOutput();
      return runCommand("pnpm", ["build"], "pnpm build");
    },
  },
  { label: "typecheck", run: () => runCommand("pnpm", ["typecheck"], "pnpm typecheck") },
  { label: "unit tests", run: () => runCommand("pnpm", ["test"], "pnpm test") },
  {
    // The visual regression suite of task T024, specification sections 20
    // and 24: golden images over the PNG output, compared in headless
    // Chromium. The browser binary is a prerequisite of this step, not of
    // `pnpm install`; a missing binary fails here with the install command
    // named in the error.
    label: "visual regression",
    run: () =>
      runCommand(
        "pnpm",
        ["--filter", "@hatch/gate", "run", "test:visual"],
        "pnpm --filter @hatch/gate run test:visual",
      ),
  },
  {
    // The editor smoke suite of task T026, specification sections 11 and
    // 23: the built editor page loads a spec, edits it through the edit
    // operations, re-renders, and exports SVG and PNG, in headless
    // Chromium over `vite preview` of the production build. The script
    // rebuilds the app itself, so the step runs on fresh bytes. It shares
    // the browser binary prerequisite of the visual suite.
    label: "editor smoke",
    run: () =>
      runCommand(
        "pnpm",
        ["--filter", "@hatch/ui", "run", "test:smoke"],
        "pnpm --filter @hatch/ui run test:smoke",
      ),
  },
  {
    label: "determinism",
    run: () =>
      determinismChecks.every((entry) => {
        console.log(`verify: determinism check: ${entry.name}`);
        return entry.check();
      }),
  },
];

if (!existsSync(path.join(rootDir, "node_modules"))) {
  fail("node_modules is missing. Run `pnpm install` first.");
}

for (const step of steps) {
  console.log(`\nverify: gate: ${step.label}`);
  if (!step.run()) {
    fail(`FAILED at gate: ${step.label}`);
  }
}

console.log("\nverify: all gates passed");

/**
 * The per-test timeout budget gate (task T050).
 *
 * The unit-test step of `pnpm verify` runs the Vitest suite of every
 * workspace project, and pnpm starts up to four of them beside each
 * other. On the shared machine (8 cores, load average 13 to 20 from
 * other sessions) the compute-heavy suites - seeded parameter sweeps,
 * input guards that walk what they refuse, and full-compiler renders -
 * hold single tests of 5 to 16 s inside that step while the same tests
 * pass in well under a second to six seconds alone. The Vitest default
 * of 5000 ms fails those tests on machine load, not on their
 * assertions, so each of them states its own budget in its
 * `vitest.config.ts`: one minute per test, a failure limit that no
 * assertion depends on.
 *
 * A static gate cannot measure wall clock, so it pins the two facts it
 * can check. First, every suite measured above the default states a
 * budget of at least 30 s. Second, the workspace holds no Vitest suite
 * outside the two recorded classes, so a new suite, or a fast one that
 * grows a heavy test, cannot inherit the hidden 5 s default by
 * accident: the classification fails here and names the decision. The
 * classes record measurements taken beside the other suites, never
 * alone - a suite joins the slow class on the loaded measurement, and
 * the slow list is the only place a budget is raised.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The suites whose slowest test, measured beside the other suites, holds
 * past the 5 s runner default. Each one owns a `vitest.config.ts` with a
 * raised `testTimeout`.
 */
const SLOW_SUITES = [
  "packages/hatching",
  "packages/objects",
  "packages/renderer-svg",
  "packages/ui",
  "tests",
] as const;

/**
 * The suites whose slowest test stays below the default even beside the
 * heaviest suites: measured at 0.1 to 3.0 s with the objects,
 * renderer-svg, and hatching suites running at the same time. They carry
 * no `vitest.config.ts`, so the 5 s default stays their failure limit and
 * a hung test still fails fast. `@hatch/export` sits closest to the
 * line; a suite joins the slow class when its loaded measurement passes
 * it.
 */
const FAST_SUITES = [
  "packages/agent",
  "packages/core",
  "packages/export",
  "packages/geometry",
  "packages/styles",
] as const;

/** The smallest budget this gate accepts for a slow suite, in milliseconds. */
const MINIMUM_BUDGET_MS = 30_000;

/** The Vitest default per-test timeout, in milliseconds. */
const RUNNER_DEFAULT_MS = 5_000;

/** One workspace project that runs Vitest, by directory and config state. */
interface VitestProject {
  directory: string;
  statesItsOwnConfig: boolean;
}

/** Every workspace project whose test script runs Vitest. */
function vitestProjects(): VitestProject[] {
  const projects: VitestProject[] = [];
  // The workspace root holds its projects under `packages/` and beside it
  // (`tests/`), so both levels are walked: a project added at either level
  // meets the classification, not the hidden default.
  const bases = [rootDir, path.join(rootDir, "packages")];
  for (const base of bases) {
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "node_modules") {
        continue;
      }
      const projectDir = path.join(base, entry.name);
      const packageJson = path.join(projectDir, "package.json");
      if (!existsSync(packageJson)) continue;
      const scripts = JSON.parse(readFileSync(packageJson, "utf8")).scripts as Record<
        string,
        string | undefined
      >;
      if (scripts.test !== "vitest run") continue;
      projects.push({
        directory: path.relative(rootDir, projectDir),
        statesItsOwnConfig: existsSync(path.join(projectDir, "vitest.config.ts")),
      });
    }
  }
  return projects.sort((a, b) => (a.directory < b.directory ? -1 : 1));
}

/** The per-test timeout one project states, or the runner default when it states none. */
async function statedTimeoutMs(directory: string): Promise<number> {
  const configFile = path.join(rootDir, directory, "vitest.config.ts");
  if (!existsSync(configFile)) return RUNNER_DEFAULT_MS;
  const loaded = (await import(pathToFileURL(configFile).href)) as {
    default?: { test?: { testTimeout?: number } };
  };
  return loaded.default?.test?.testTimeout ?? RUNNER_DEFAULT_MS;
}

describe("the per-test timeout budget of the workspace (task T050)", () => {
  for (const directory of SLOW_SUITES) {
    it(`states a budget above the 5 s default in ${directory}`, async () => {
      expect(await statedTimeoutMs(directory)).toBeGreaterThanOrEqual(MINIMUM_BUDGET_MS);
    });
  }

  it("classifies every Vitest suite as slow or fast, with none left to the hidden default", () => {
    const projects = vitestProjects();
    const withConfig = projects
      .filter((project) => project.statesItsOwnConfig)
      .map((project) => project.directory);
    const withoutConfig = projects
      .filter((project) => !project.statesItsOwnConfig)
      .map((project) => project.directory);

    expect(withConfig).toEqual([...SLOW_SUITES].sort());
    expect(withoutConfig).toEqual([...FAST_SUITES].sort());
  });
});

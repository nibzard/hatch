/**
 * The Vitest configuration of @hatch/ui.
 *
 * The unit suite here covers the editor model: the state that maps every
 * panel to one spec patch or one edit operation, and the pixel math of the
 * PNG export. It runs in Node and needs no browser. The page itself - the
 * panels, the render loop, the downloads - is covered by the Playwright
 * smoke suite under `e2e/`, which `exclude` keeps out of this runner the
 * same way `tests/` keeps its Playwright suite out of Vitest.
 *
 * The starter-scene test renders every starter through the real V1
 * engine, and the edit property tests re-render after every operation.
 * One such render costs seconds, and the workspace test step runs up to
 * four packages beside each other, so the parallel files share the
 * cores. The runner default of five seconds leaves no headroom at that
 * load: the starter sweep measured 1.7 s alone and 7.9 s beside the
 * other suites, over the limit while its assertions held. So this
 * package states its own bound: one minute per test, the same order the
 * other render suites state. The bound stays a failure limit, never a
 * performance target - no assertion changes with it.
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", "e2e/**"],
    testTimeout: 60_000,
  },
});

/**
 * The Vitest configuration of @hatch/renderer-svg.
 *
 * Every scene test renders through the real compiler - planning, geometry
 * synthesis, hatching, and the SVG writer - and the byte-identity tests
 * render the same scene twice or thrice. One render of a rich scene costs
 * seconds, and the workspace test step runs up to four packages beside
 * each other, so the parallel files share the cores. The runner default
 * of five seconds leaves no headroom at that load, so this package states
 * its own bound: one minute per test, the same order the edit property
 * suite already states for itself. The bound stays a failure limit, never
 * a performance target - no assertion changes with it.
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 60_000,
  },
});

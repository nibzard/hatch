/**
 * The Vitest configuration of @hatch/objects.
 *
 * The generator contracts run seeded parameter sweeps: every sample builds
 * a full geometry, and the heaviest generators offset spline silhouettes
 * through the boolean engine on every draw. One sweep of the bowl, the
 * heaviest of them, costs seconds, and the workspace test step runs up to
 * four packages beside each other, so the parallel files share the cores.
 * The runner default of five seconds leaves no headroom at that load, so
 * this package states its own bound: one minute per test, an order of
 * magnitude over the heaviest measured sweep. The bound stays a failure
 * limit, never a performance target - no assertion changes with it.
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 60_000,
  },
});

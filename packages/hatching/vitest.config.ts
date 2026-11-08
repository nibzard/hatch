/**
 * The Vitest configuration of @hatch/hatching.
 *
 * The input guards of the hatch engine prove their refusal on the work
 * they refuse: the near-infinite field guard walks the spacing it is
 * about to reject, which costs seconds before the error lands. The
 * workspace test step runs up to four packages beside each other, so the
 * parallel files share the cores, and the runner default of five seconds
 * leaves no headroom at that load. This package states its own bound:
 * one minute per test. The bound stays a failure limit, never a
 * performance target - no assertion changes with it.
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 60_000,
  },
});

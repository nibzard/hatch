/**
 * Vitest configuration of the repository gates (task T024).
 *
 * `pnpm test` runs the Vitest suite of this package over the release gates.
 * The visual regression suite under `visual/` is a Playwright suite, not a
 * Vitest one: `pnpm verify` runs it through its own gate step, headless
 * (see `visual/playwright.config.ts`). Keeping the two runners apart means
 * one file name convention serves both, and a Playwright spec never runs
 * under Vitest by accident.
 *
 * The byte-identity gate renders every example scene twice and exports
 * each render to PNG and PDF, which costs seconds per test. The workspace
 * test step runs up to four packages beside each other, so the parallel
 * files share the cores, and the runner default of five seconds leaves no
 * headroom at that load. This package states its own bound: one minute
 * per test. The bound stays a failure limit, never a performance target -
 * no assertion changes with it.
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", "visual/**"],
    testTimeout: 60_000,
  },
});

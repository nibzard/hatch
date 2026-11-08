/**
 * The Playwright smoke configuration of the editor (task T026,
 * specification sections 11, 23, and 24).
 *
 * One test walks the acceptance of the task: the page loads a spec, edits
 * it through the edit operations of specification section 21, re-renders,
 * and exports SVG and PNG. The suite serves the production build through
 * `vite preview`, so what runs under test is the bundle a release ships.
 *
 * The server binds one free port that this config picks before the first
 * launch, so two suites or two runs never fight over one number, and the
 * whole editor pipeline runs inside the page: no backend stands behind
 * the canvas.
 *
 * The browser binary is a prerequisite of this suite, not of
 * `pnpm install`, the same prerequisite the golden-image suite under
 * `tests/visual/` carries. One install serves both:
 *
 * ```sh
 * pnpm --filter @hatch/gate exec playwright install chromium
 * ```
 */

import { readdirSync, statSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { defineConfig } from "@playwright/test";

/** This package directory: `<repo>/packages/ui`. */
const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

/** The repository root: `<repo>`. */
const repoDir = path.join(packageDir, "..", "..");

/**
 * One free TCP port the preview server can bind.
 *
 * The instruction for this task is to bind servers to free ports. Asking
 * the kernel for an unused number and handing it to `vite preview
 * --strictPort` comes closest: Playwright's own port picking cannot be
 * used here because `webServer.url` needs the concrete number to poll.
 * The window between the probe and the launch is short, and a lost race
 * still fails loudly through `--strictPort` instead of silently.
 */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address !== null
        ? address.port
        : undefined;
      probe.close(() =>
        port === undefined ? reject(new Error("no free port")) : resolve(port),
      );
    });
  });
}

/**
 * True when a directory holds a downloaded Chromium.
 *
 * Mirrors the helper of `tests/visual/playwright.config.ts`: a relative
 * `PLAYWRIGHT_BROWSERS_PATH` names one directory per working directory,
 * and this config runs from `packages/ui` while the documented install
 * command runs from `tests/`. The first candidate that holds a browser
 * wins, so both commands agree on one cache.
 */
function holdsChromium(dir: string): boolean {
  const stat = statSync(dir, { throwIfNoEntry: false });
  if (stat === undefined || !stat.isDirectory()) {
    return false;
  }
  return readdirSync(dir, { withFileTypes: true }).some(
    (entry) => entry.isDirectory() && entry.name.startsWith("chromium"),
  );
}

/**
 * Point a relative `PLAYWRIGHT_BROWSERS_PATH` at one absolute directory.
 * See {@link holdsChromium} for why the value must not stay relative.
 */
function resolveBrowsersPath(): void {
  const configured = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (
    configured === undefined ||
    configured === "" ||
    path.isAbsolute(configured)
  ) {
    return;
  }
  const found = [
    path.resolve(packageDir, configured),
    path.resolve(repoDir, "tests", configured),
    path.resolve(repoDir, configured),
    path.resolve(configured),
  ].find(holdsChromium);
  if (found !== undefined) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = found;
  }
}

resolveBrowsersPath();

/**
 * The port of the preview server, picked once per run.
 *
 * Playwright evaluates this module more than once under its loader, and
 * two evaluations of a top-level probe pick two different ports - the
 * `webServer` then listens on one while `baseURL` names the other, and
 * every navigation is refused. Memoizing the pick in the environment
 * holds one number across the evaluations of one run, and a run that
 * names its port keeps it.
 */
const port = Number(
  process.env.HATCH_UI_SMOKE_PORT ??
    (process.env.HATCH_UI_SMOKE_PORT = String(await freePort())),
);
const baseUrl = `http://127.0.0.1:${port}/`;

export default defineConfig({
  // One browser, one project: the smoke suite exercises the editor page,
  // not a browser matrix.
  projects: [{ name: "chromium" }],

  testDir: "e2e",
  outputDir: "test-results",

  // A gate never retries a failure away.
  retries: 0,
  reporter: [["list"]],

  use: {
    browserName: "chromium",
    headless: true,
    baseURL: baseUrl,
    // The export panel hands files to the browser; the suite reads them
    // back and checks their bytes.
    acceptDownloads: true,
    viewport: { width: 1440, height: 1000 },
  },

  webServer: {
    // The smoke script builds first (`test:smoke`); the preview server
    // serves exactly those bytes.
    command: `pnpm exec vite preview --host 127.0.0.1 --port ${port} --strictPort`,
    url: baseUrl,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: "ignore",
  },
});

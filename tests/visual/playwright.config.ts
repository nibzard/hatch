/**
 * Playwright configuration of the visual regression suite (task T024,
 * specification sections 20 and 24).
 *
 * The suite is browser-platform validation over the PNG export: it puts the
 * raster of one scene into a headless Chromium page and compares the pixels
 * the browser shows against a committed baseline. Round 1 stayed free of
 * the browser platform on purpose; this suite is the round 2 addition.
 *
 * The browser comparison is one of two comparisons the suite runs over each
 * baseline. The other one, a byte comparison of the exported PNG against
 * the same file, runs outside `toHaveScreenshot` and tolerates no drift at
 * all. It exists because this comparison has a blind spot: its comparator
 * is pixelmatch with the antialiasing detection Playwright exposes no
 * switch for, and that detection drops a lone differing pixel whose 3x3
 * neighbourhood looks like an antialiased edge. `maxDiffPixels: 0` with
 * `threshold: 0` accepts no differing pixel that survives that detection.
 *
 * `updateSnapshots: "none"` keeps the gate honest. A missing or mismatched
 * baseline is a failure, never an implicit write. Regenerate the baselines
 * only through the documented command after a deliberate render change. It
 * rewrites them with the exporter's own PNG bytes, because a Playwright
 * `--update-snapshots` run would write a Chromium screenshot instead, which
 * the byte comparison rejects:
 *
 * ```sh
 * pnpm --filter @hatch/gate run test:visual:update
 * ```
 *
 * The browser binary is a prerequisite of this suite, not of
 * `pnpm install`:
 *
 * ```sh
 * pnpm --filter @hatch/gate exec playwright install chromium
 * ```
 *
 * A relative `PLAYWRIGHT_BROWSERS_PATH` names two directories here: the
 * install command above runs through pnpm in `tests/`, while a launch
 * under `pnpm verify` resolves the value against the repository root.
 * {@link resolveBrowsersPath} below turns the value absolute before the
 * first launch, so both commands agree on one directory.
 */

import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { defineConfig } from "@playwright/test";

/** This directory: `<repo>/tests/visual`. */
const visualDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

/** The gate package: `<repo>/tests`. The install command runs here. */
const gateDir = path.join(visualDir, "..");

/** The repository root: `<repo>`. The verify gate runs here. */
const repoDir = path.join(gateDir, "..");

/**
 * True when a directory holds a downloaded Chromium.
 *
 * Playwright names its downloads after the browser, for example
 * `chromium-1254` and `chromium_headless_shell-1254`. A directory that
 * holds none cannot serve the launch, whatever created it.
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
 * Point a relative `PLAYWRIGHT_BROWSERS_PATH` at the directory that holds
 * the browser, as an absolute path.
 *
 * Playwright resolves a relative value against the working directory of
 * the process that launches, and that process is not the one that
 * installed: `pnpm --filter @hatch/gate exec playwright install chromium`
 * downloads into `<repo>/tests/<value>`, while the launch under
 * `pnpm verify` looks in `<repo>/<value>`. One relative value then names
 * two directories, and a launch reports a missing binary the install just
 * wrote. An absolute path names one directory in every process, so this
 * picks the first candidate below that holds a Chromium download and
 * exports it as the setting.
 *
 * Nothing changes when the value is already absolute, or when no
 * candidate holds a browser. The first case needs no help. The second is
 * a missing prerequisite, and Playwright's own error, the one that names
 * the install command, is the failure that belongs there.
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
    path.resolve(gateDir, configured),
    path.resolve(configured),
    path.resolve(repoDir, configured),
  ].find(holdsChromium);
  if (found !== undefined) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = found;
  }
}

resolveBrowsersPath();

export default defineConfig({
  // One browser, one project: the suite validates the raster of the PNG
  // export, not a browser matrix. The pixels under test come from resvg;
  // the browser only shows them.
  projects: [{ name: "chromium" }],

  // The suite lives in this directory; so do its baselines.
  testDir: ".",

  // A failing comparison writes its actual and diff images here. Git
  // ignores `test-results/`.
  outputDir: "test-results",

  // The committed baselines: one PNG per case, named after the case. The
  // snapshot name names the `.png`, so `{arg}` holds the case id and
  // `{ext}` the extension.
  snapshotDir: "baselines",
  snapshotPathTemplate: "{snapshotDir}/{arg}{ext}",

  // A gate never writes its own goldens.
  updateSnapshots: "none",

  // A drift must fail the run. A retry must not mask it.
  retries: 0,

  reporter: [["list"]],

  use: {
    browserName: "chromium",
    // The acceptance names a headless run.
    headless: true,
    // One image pixel is one device pixel, so the screenshot holds the
    // raster the exporter wrote.
    deviceScaleFactor: 1,
    // The viewport follows the image in every test; this is the largest
    // scene in the set.
    viewport: { width: 480, height: 360 },
  },

  expect: {
    toHaveScreenshot: {
      // No differing pixel that the comparator counts is acceptable, and a
      // differing pixel is any pixel whose color moved. The byte
      // comparison of the suite covers the pixels this comparator's
      // antialiasing detection drops; see the header comment.
      maxDiffPixels: 0,
      threshold: 0,
    },
  },
});

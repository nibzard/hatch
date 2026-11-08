#!/usr/bin/env node
/**
 * Rewrite the committed baselines of the visual regression suite (task
 * T024, specification sections 20 and 24).
 *
 * Every baseline is the PNG bytes the exporter itself writes for its case,
 * not a screenshot of them. Two reasons:
 *
 * 1. The byte comparison of the suite demands it. That comparison is the
 *    zero-tolerance gate - PNG encoding is lossless, so one drifted pixel
 *    always changes the bytes - and it can only compare against the
 *    exporter's own output.
 * 2. Regeneration then needs no browser. The render is deterministic, so
 *    this script writes the same bytes on every machine that builds the
 *    same tree. A Playwright `--update-snapshots` run would instead write
 *    a Chromium screenshot, which the byte comparison rejects.
 *
 * Run it after a deliberate render change, then review and commit the
 * rewritten files together with the change, the same way
 * `node examples/render.mjs --golden` maintains the SVG fixtures:
 *
 * ```sh
 * pnpm --filter @hatch/gate run test:visual:update
 * ```
 *
 * The script needs the built packages, so run `pnpm build` first. A new
 * scene under `examples/scenes/` joins the suite here.
 */

import { mkdirSync, writeFileSync } from "node:fs";

import {
  baselineFile,
  baselinesDir,
  renderedCase,
  visualCases,
} from "./scenes.ts";

mkdirSync(baselinesDir, { recursive: true });

for (const sceneCase of visualCases()) {
  const file = baselineFile(sceneCase.id);
  const { png } = renderedCase(sceneCase);
  writeFileSync(file, png);
  console.log(`baseline: wrote ${file} (${png.length} bytes)`);
}

console.log(
  "baseline: review the diff of the PNG files, then commit them with the " +
    "render change",
);

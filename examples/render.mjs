#!/usr/bin/env node
/**
 * Render the example scenes (task T019, specification section 24).
 *
 * The script is the human entry into the V1 examples. It reads every scene
 * spec under `scenes/`, compiles each one through the V1 engine, and writes
 * the artifacts of specification section 24 into `output/`:
 *
 * - `<id>.svg`: the canonical document,
 * - `<id>.png`: one raster preview of the same bytes,
 * - `<id>.pdf`: one vector print document of the same strokes,
 * - `<id>.trace.json`: the compilation trace.
 *
 * `output/` stays ignored by Git. The golden fixtures under `golden/` are the
 * tracked reference of the same SVG bytes; pass `--golden` to rewrite them
 * after a deliberate compiler change:
 *
 * ```sh
 * node examples/render.mjs            # render into examples/output/
 * node examples/render.mjs --golden   # also rewrite examples/golden/
 * ```
 *
 * The script imports the built packages from their `dist` directories, so
 * run `pnpm build` first. It writes the same artwork bytes on every run:
 * the same spec, seed, preset, and compiler version give the same output
 * (specification section 10). The trace files carry the export timing of
 * section 9E, one wall-clock measurement, so two runs differ in that
 * number alone.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const examplesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const scenesDir = path.join(examplesDir, "scenes");
const outputDir = path.join(examplesDir, "output");
const goldenDir = path.join(examplesDir, "golden");

/** The renderer and the exporters, imported relative to this script. */
const rendererEntry = path.join(examplesDir, "..", "packages", "renderer-svg", "dist", "index.js");
const exportEntry = path.join(examplesDir, "..", "packages", "export", "dist", "index.js");

/** The pixel width of every PNG preview. The height follows the scene. */
const PNG_WIDTH = 480;

/** The page width of every PDF export, in points. The height follows the scene. */
const PDF_WIDTH = 480;

/** Fail with one message that names the fix. */
function fail(message) {
  console.error(`examples/render: ${message}`);
  process.exit(1);
}

for (const [label, entry] of [
  ["@hatch/renderer-svg", rendererEntry],
  ["@hatch/export", exportEntry],
]) {
  if (!existsSync(entry)) {
    fail(`${label} is not built at ${entry}. Run 'pnpm build' first.`);
  }
}

const { createV1Engine } = await import(`file://${rendererEntry}`);
const { svgToPng, svgToPdf } = await import(`file://${exportEntry}`);

/** Every scene spec on disk, in stable file order. */
function sceneFiles() {
  return readdirSync(scenesDir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => path.join(scenesDir, name));
}

/** The SHA-256 of one buffer, for the per-run report. */
function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 16);
}

const files = sceneFiles();
if (files.length === 0) {
  fail(`no scene spec found under ${scenesDir}`);
}

mkdirSync(outputDir, { recursive: true });
if (process.argv.includes("--golden")) {
  mkdirSync(goldenDir, { recursive: true });
}

const engine = createV1Engine();
const updateGolden = process.argv.includes("--golden");

for (const file of files) {
  const spec = JSON.parse(readFileSync(file, "utf8"));
  const id = spec.meta?.id ?? path.basename(file, ".json");
  const result = engine.renderScene(spec);
  const png = svgToPng(result.svg, { fit: { mode: "width", value: PNG_WIDTH } });
  const pdf = svgToPdf(result.svg, { fit: { mode: "width", value: PDF_WIDTH } });

  const svgFile = path.join(outputDir, `${id}.svg`);
  const pngFile = path.join(outputDir, `${id}.png`);
  const pdfFile = path.join(outputDir, `${id}.pdf`);
  const traceFile = path.join(outputDir, `${id}.trace.json`);
  writeFileSync(svgFile, result.svg);
  writeFileSync(pngFile, png.png);
  writeFileSync(pdfFile, pdf.pdf);
  writeFileSync(
    traceFile,
    `${JSON.stringify(result.trace, null, 2)}\n`,
  );
  if (updateGolden) {
    writeFileSync(path.join(goldenDir, `${id}.svg`), result.svg);
  }

  const metrics = result.trace.metrics ?? {};
  console.log(
    `${id}: ${metrics.svgSizeBytes} byte(s) of SVG, ` +
      `${metrics.strokeCount} stroke(s) in ${metrics.regionCount} region(s), ` +
      `density ${metrics.visualDensityScore?.toFixed(4)}, ` +
      `export ${metrics.exportDurationMs?.toFixed(1)} ms; ` +
      `png ${png.width}x${png.height} (${png.png.length} byte(s)); ` +
      `pdf ${pdf.width}x${pdf.height} (${pdf.pdf.length} byte(s)); ` +
      `svg sha256 ${sha256(Buffer.from(result.svg))}`,
  );
}

console.log(
  updateGolden
    ? `wrote ${files.length} scene(s) into ${outputDir} and rewrote ${goldenDir}`
    : `wrote ${files.length} scene(s) into ${outputDir}`,
);

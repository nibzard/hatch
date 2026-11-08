/**
 * The golden-image cases of the visual regression suite (task T024,
 * specification sections 20 and 24).
 *
 * Every case is one scene spec plus a pixel width. The suite compiles the
 * spec through the real engine, rasterizes the document with the same
 * exporter a caller uses, and hands the PNG bytes to the browser page that
 * the golden comparison runs on.
 *
 * The committed baseline of a case is the PNG bytes that export writes, not
 * a screenshot of them. The suite compares those bytes as they are, which
 * is the zero-tolerance half of its gate, so `update-baselines.mjs` is the
 * only writer of the directory.
 *
 * The cases come from the committed example scenes, so the suite grows with
 * them: a new scene under `examples/scenes/` joins the suite on the next
 * baseline regeneration. Two derived cases add the round 2 features the V2
 * checklist names - the new presets and the debug overlays - without
 * touching the V1 examples the release gate pins to `pastoral-v1`.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { svgToPng } from "@hatch/export";
import { createV1Engine } from "@hatch/renderer-svg";

/** This directory: `<repo>/tests/visual`. */
const visualDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

/** The directory of the committed baselines. */
export const baselinesDir = path.join(visualDir, "baselines");

/** The directory of the example scenes. */
const scenesDir = path.resolve(visualDir, "..", "..", "examples", "scenes");

/**
 * The pixel width of every golden PNG. The height follows the aspect ratio
 * of the scene, so one number serves both ratios of the example set. It
 * matches the width the example renderer and the release gate name.
 */
export const PNG_WIDTH = 480;

/** One golden image the suite holds. */
export interface VisualCase {
  /** The base name of the baseline file, without extension. */
  readonly id: string;
  /** What the case covers, in one sentence. */
  readonly note: string;
  /** The engine input, exactly what a caller hands `renderScene`. */
  readonly spec: unknown;
}

/** One rendered case: the PNG bytes and their pixel size. */
export interface RenderedCase {
  /** The PNG file bytes of the export. */
  readonly png: Uint8Array;
  /** The pixel width of the raster. */
  readonly width: number;
  /** The pixel height of the raster. */
  readonly height: number;
}

/** Every example scene on disk, as a golden-image case of its own. */
function exampleCases(): VisualCase[] {
  return readdirSync(scenesDir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => {
      const spec: unknown = JSON.parse(readFileSync(path.join(scenesDir, name), "utf8"));
      return {
        id: idOfSpec(spec, name),
        note: `the example scene of ${name}, at ${PNG_WIDTH} pixels of width`,
        spec,
      };
    });
}

/** The baseline id of one spec: its `meta.id`, or the file base name. */
function idOfSpec(spec: unknown, file: string): string {
  const meta = (spec as { meta?: { id?: unknown } } | null)?.meta;
  return typeof meta?.id === "string" && meta.id.length > 0
    ? meta.id
    : path.basename(file, ".json");
}

/** Every case of the suite, example scenes first, derived cases after. */
export function visualCases(): VisualCase[] {
  const examples = exampleCases();
  const base = examples[0];
  if (base === undefined) {
    throw new Error(`the visual suite found no scene spec under ${scenesDir}`);
  }
  return [
    ...examples,
    {
      id: `${base.id}-urban-v1`,
      note: `the first example under a round 2 preset, paired as a custom environment, so the tuned families of urban-v1 reach the browser platform`,
      spec: withStylePreset(base.spec, "urban-v1"),
    },
    {
      id: `${base.id}-debug-overlays`,
      note: `the first example with every debug overlay on, so the round 2 overlay layers reach the browser platform`,
      spec: withAllDebugFlags(base.spec),
    },
  ];
}

/**
 * One spec with its preset replaced, and its environment type paired with
 * the new preset.
 *
 * The intent stage checks the family the preset draws against the type the
 * spec names, so a swap that left the type behind would not render. The
 * example scenes draw rural worlds, so a round 2 preset is a cross-pairing
 * and the type says `custom`: the one value that names no family and pairs
 * with every preset.
 */
function withStylePreset(spec: unknown, stylePreset: string): unknown {
  const record = spec as {
    meta?: Record<string, unknown>;
    environment?: Record<string, unknown>;
  } | null;
  return {
    ...(record as Record<string, unknown>),
    meta: { ...(record?.meta ?? {}), stylePreset },
    environment: { ...(record?.environment ?? {}), type: "custom" },
  };
}

/** One spec with all seven debug flags switched on. */
function withAllDebugFlags(spec: unknown): unknown {
  const record = spec as Record<string, unknown> | null;
  return {
    ...(record ?? {}),
    debug: {
      showContourOnly: true,
      showRegions: true,
      showDepthMap: true,
      showHatchDirections: true,
      showNegativeSpace: true,
      showAnchors: true,
      showConstructionLines: true,
    },
  };
}

/** The renders of this worker process, keyed by case id. */
const renderedCases = new Map<string, RenderedCase>();

/**
 * Render one case to PNG bytes, once per process.
 *
 * The engine and the exporter are the ones a caller uses, so a golden image
 * covers the whole path: spec, plan, geometry, style, SVG, and raster.
 */
export function renderedCase(sceneCase: VisualCase): RenderedCase {
  const cached = renderedCases.get(sceneCase.id);
  if (cached !== undefined) {
    return cached;
  }
  const engine = createV1Engine();
  const { svg } = engine.renderScene(sceneCase.spec);
  const rendered = svgToPng(svg, { fit: { mode: "width", value: PNG_WIDTH } });
  renderedCases.set(sceneCase.id, rendered);
  return rendered;
}

/** The baseline file of one case id. */
export function baselineFile(id: string): string {
  return path.join(baselinesDir, `${id}.png`);
}

/**
 * One example scene per round 2 preset (task T021, specification sections
 * 11 and 24).
 *
 * The acceptance asks that one example scene renders in each of
 * `coastal-v1`, `urban-v1`, and `skatepark-v1`. The skatepark and urban
 * scenes are the round 2 library scenes of `scenes-round2.test.ts`; this
 * file adds the coastal scene and runs all three through the whole
 * compiler under the preset each one names, so a render proves the preset
 * end to end: the registry resolves it, the planner reads its composition
 * grammar, the style stage fills from its tuned families, and the renderer
 * paints its palette.
 */

import { describe, expect, it } from "vitest";

import { TRACE_STAGES, type SceneSpec } from "@hatch/core";

import { createV1Engine } from "../src/index.js";

import {
  skateparkSceneSpec,
  urbanStreetSceneSpec,
} from "./scenes-round2.test.js";
import { assertWellFormedXml } from "./xml-check.js";

/**
 * The coastal scene: a sea band under a wide sky, one headland that runs
 * into it, a dune with a cottage, and one tree on the far side.
 */
export function coastalHeadlandSceneSpec(): SceneSpec {
  return {
    meta: {
      id: "coastal-headland-0001",
      seed: 20261107,
      stylePreset: "coastal-v1",
      aspectRatio: "4:3",
      version: "1.0.0",
    },
    camera: {
      framing: "wide",
      lens: "wide",
      horizonY: 0.7,
    },
    composition: {
      focalPoints: ["headland-1"],
      balance: "right",
      negativeSpace: 0.4,
      depthLayers: 3,
    },
    environment: {
      type: "coastal",
      sky: { cloudCount: 3 },
    },
    objects: [
      {
        id: "headland-1",
        kind: "mountain",
        role: "focal",
        position: { x: 0.92, y: 0.76 },
        scale: 1.3,
        params: {
          width: 900,
          height: 190,
          peakPosition: 0.55,
          secondaryPeaks: 1,
          ruggedness: 0.55,
          snowCap: 0,
        },
      },
      {
        id: "sea-1",
        kind: "water",
        role: "midground",
        position: { x: 0.5, y: 0.74 },
        scale: 1.9,
        params: {
          width: 1100,
          depth: 150,
          waveLines: 7,
          waveAmplitude: 12,
          shoreIrregularity: 0.4,
        },
      },
      {
        id: "dune-1",
        kind: "hill",
        role: "midground",
        position: { x: 0.22, y: 0.82 },
        scale: 1.6,
        params: { width: 640, height: 120, crestIrregularity: 0.5, strips: 2 },
      },
      {
        id: "cottage-1",
        kind: "house",
        role: "foreground",
        position: { x: 0.16, y: 0.92 },
        scale: 1.2,
        params: { width: 150, wallHeight: 90, windows: 2 },
      },
      {
        id: "tree-1",
        kind: "tree",
        role: "midground",
        position: { x: 0.32, y: 0.88 },
        scale: 1.1,
        params: {
          trunkHeight: 90,
          canopyRadius: 55,
          canopyIrregularity: 0.35,
        },
      },
    ],
  } as SceneSpec;
}

/** One example scene with the facts its preset must put into the render. */
interface PresetScene {
  /** The scene, with `meta.stylePreset` naming its preset. */
  readonly spec: SceneSpec;
  /** One line on what the scene is. */
  readonly label: string;
  /** The paper color of the preset, the color the background paints. */
  readonly paper: string;
  /** The hatch ink of the preset. */
  readonly hatchInk: string;
  /** The contour ink of the preset. */
  readonly contourInk: string;
  /** Every hatch family the scene fills, and no other. */
  readonly families: readonly string[];
}

/** The example scene of every round 2 preset. */
const PRESET_SCENES: readonly PresetScene[] = [
  {
    spec: coastalHeadlandSceneSpec(),
    label: "the coastal scene",
    paper: "#f4f1ea",
    hatchInk: "#38332d",
    contourInk: "#232019",
    families: ["cliff", "field", "foliage", "mountain", "sky", "water"],
  },
  {
    spec: urbanStreetSceneSpec(),
    label: "the urban scene",
    paper: "#f2f0ea",
    hatchInk: "#33302b",
    contourInk: "#211f1a",
    families: ["cliff", "field", "mountain", "sky", "water"],
  },
  {
    spec: skateparkSceneSpec(),
    label: "the skatepark scene",
    paper: "#f3f2ee",
    hatchInk: "#34312e",
    contourInk: "#22201e",
    families: ["cliff", "field", "foliage", "mountain", "none", "sky"],
  },
];

describe("acceptance: one example scene renders in each round 2 preset", () => {
  const engine = createV1Engine();

  for (const scene of PRESET_SCENES) {
    const { spec, label } = scene;
    const preset = spec.meta.stylePreset;

    it(`${label} renders one well-formed SVG document under ${preset}`, () => {
      const result = engine.renderScene(spec);
      expect(result.svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(
        true,
      );
      assertWellFormedXml(result.svg);
      expect(result.svg.length).toBeGreaterThan(1000);
      expect(result.trace.metrics?.strokeCount ?? 0).toBeGreaterThan(100);
      expect(result.trace.events.map((event) => event.stage)).toEqual(
        TRACE_STAGES,
      );
    });

    it(`${label} resolves ${preset} and paints its palette`, () => {
      const result = engine.renderScene(spec);
      expect(engine.hasPreset(preset)).toBe(true);
      expect(result.ir.style.preset).toBe(preset);
      expect(result.trace.preset).toBe(preset);
      // The paper of the preset is the paper the background paints.
      const paper = result.svg.match(
        /<rect[^>]*data-layer="paper"[^>]*>/,
      )?.[0];
      expect(paper).toBeDefined();
      expect(paper).toContain(`fill="${scene.paper}"`);
    });

    it(`${label} draws every stroke in the two inks of ${preset}`, () => {
      const result = engine.renderScene(spec);
      const inks = new Set(
        [...result.svg.matchAll(/stroke="([^"]+)"/g)].map((match) => match[1]),
      );
      expect(inks).toEqual(new Set([scene.hatchInk, scene.contourInk]));
    });

    it(`${label} fills exactly the families its preset resolves`, () => {
      const result = engine.renderScene(spec);
      const styleEvent = result.trace.events.find(
        (event) => event.stage === "style",
      );
      const data = (styleEvent?.data ?? {}) as {
        regions?: Array<{ role: string; family: string }>;
      };
      const regions = data.regions ?? [];
      expect(regions.length).toBeGreaterThan(0);
      expect([...new Set(regions.map((entry) => entry.family))].sort()).toEqual(
        [...scene.families].sort(),
      );
    });

    it(`${label} re-renders byte-identical SVG under ${preset}`, () => {
      const first = engine.renderScene(spec);
      const second = createV1Engine().renderScene(spec);
      const third = createV1Engine().renderScene(spec);
      expect(second.svg).toBe(first.svg);
      expect(third.svg).toBe(first.svg);
      expect(JSON.stringify(second.ir.regions)).toBe(
        JSON.stringify(first.ir.regions),
      );
    });

    it(`${label} draws a different document under the pastoral preset`, () => {
      // The preset is one of the four identity inputs (specification
      // section 10), so the same scene under another preset is another
      // render, not a re-derivation of the first. The environment type
      // moves to "custom" with it, because the intent stage checks the
      // family of the preset against the type of the scene, and a coastal
      // scene under a pastoral preset is exactly that cross-pairing.
      const other = engine.renderScene({
        ...spec,
        meta: { ...spec.meta, stylePreset: "pastoral-v1" },
        environment: { ...spec.environment, type: "custom" },
      });
      const result = engine.renderScene(spec);
      expect(other.svg).not.toBe(result.svg);
      expect(other.ir.style.palette.paper).not.toBe(result.ir.style.palette.paper);
      expect(other.svg).toContain('fill="#f6f1e7"');
    });
  }
});

/**
 * End-to-end render test for the coastal object kinds (task T046).
 *
 * Section 14 names a mode 1 example the compiler could not draw until now:
 * "coastal scene with lighthouse, dramatic cliff, wide sky". This file
 * proves that scene renders through the whole compiler - planning, geometry
 * synthesis, style application, and render - under the `coastal-v1`
 * preset. The lighthouse, the cliff, and the rocks bring their own zone
 * roles (`signal`, `rock`), and the preset styles them through the shared
 * role vocabulary with no zone override of its own, which this file also
 * pins.
 */

import { describe, expect, it } from "vitest";

import {
  negativeSpaceSpacingMultiplier,
  openFillStyle,
  TRACE_STAGES,
  type FillStyle,
  type SceneSpec,
  type StyleSpec,
} from "@hatch/core";
import { getStylePreset } from "@hatch/styles";

import { createV1Engine } from "../src/index.js";

import { assertWellFormedXml } from "./xml-check.js";

/**
 * The fill one hatch family of a preset resolves to, the same way the
 * style application stage builds it: a `hatch` family from its single
 * system, a `crosshatch` family from its two, and `none` as paper.
 */
function fillOfFamily(preset: StyleSpec, family: string): FillStyle {
  if (family === "none") {
    return { type: "none" };
  }
  const spec = preset.hatchFamilies[family as keyof StyleSpec["hatchFamilies"]];
  return "angleA" in spec
    ? {
        type: "crosshatch",
        angleA: spec.angleA,
        angleB: spec.angleB,
        spacingA: spec.spacingA,
        spacingB: spec.spacingB,
        stroke: spec.stroke,
        weight: spec.weight,
        jitter: spec.jitter,
      }
    : {
        type: "hatch",
        angle: spec.angle,
        spacing: spec.spacing,
        stroke: spec.stroke,
        weight: spec.weight,
        jitter: spec.jitter,
      };
}

/**
 * The coastal scene of specification section 14: a lighthouse on the
 * plateau of a headland, the sea running out to the horizon, two rocks in
 * the water, and the wide sky above it all.
 */
export function coastalLighthouseSceneSpec(): SceneSpec {
  return {
    meta: {
      id: "coastal-lighthouse-0003",
      seed: 20261107,
      stylePreset: "coastal-v1",
      aspectRatio: "16:9",
      version: "1.0.0",
    },
    camera: {
      framing: "wide",
      lens: "wide",
      horizonY: 0.72,
    },
    composition: {
      focalPoints: ["lighthouse-1"],
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
        id: "cliff-1",
        kind: "cliff",
        role: "background",
        position: { x: 0.8, y: 0.8 },
        scale: 1.1,
        params: {
          width: 560,
          height: 190,
          topShare: 0.5,
          faceBatter: 0.3,
          ruggedness: 0.5,
          strata: 3,
        },
      },
      {
        id: "lighthouse-1",
        kind: "lighthouse",
        role: "focal",
        position: { x: 0.68, y: 0.57 },
        scale: 1,
        params: {
          height: 170,
          baseWidth: 64,
          taper: 0.5,
          band: true,
          bandPosition: 0.6,
          lanternSize: 40,
          door: true,
        },
      },
      {
        id: "sea-1",
        kind: "water",
        role: "midground",
        position: { x: 0.35, y: 0.78 },
        scale: 1.5,
        params: {
          width: 1400,
          depth: 130,
          waveLines: 7,
          waveAmplitude: 8,
          shoreIrregularity: 0.4,
        },
      },
      {
        id: "rock-1",
        kind: "rock",
        role: "midground",
        position: { x: 0.52, y: 0.88 },
        scale: 1.1,
        params: { width: 130, height: 70, lobes: 8, cracks: 1 },
      },
      {
        id: "rock-2",
        kind: "rock",
        role: "foreground",
        position: { x: 0.26, y: 0.94 },
        scale: 1.5,
        params: { width: 180, height: 84, lobes: 9, cracks: 2 },
      },
    ],
  } as SceneSpec;
}

/** The coastal object kinds the scene must place, by scene id. */
const SCENE_KINDS: Readonly<Record<string, string[]>> = {
  "coastal-lighthouse-0003": ["cliff", "lighthouse", "rock"],
};

/** The coastal zone roles the scene must fill, by scene id. */
const SCENE_ROLES: Readonly<Record<string, string[]>> = {
  "coastal-lighthouse-0003": [
    "mountain",
    "rock",
    "architecture",
    "signal",
    "metal",
    "glass",
  ],
};

/**
 * Every hatch family the scene draws, and no other, by scene id.
 *
 * The list is the shared zone table read through the roles the objects
 * emit: the environment regions add `sky` and `ground`, then every object
 * zone resolves through `STYLE_ZONE_ROLES`.
 */
const SCENE_FAMILIES: Readonly<Record<string, string[]>> = {
  "coastal-lighthouse-0003": ["cliff", "field", "mountain", "sky", "water"],
};

/**
 * The coastal zone roles the scene must fill from the shared family table,
 * because the preset carries no zone override of its own.
 */
const SCENE_TUNED_ROLES: Readonly<
  Record<string, Array<{ role: string; family: string }>>
> = {
  "coastal-lighthouse-0003": [
    { role: "mountain", family: "mountain" },
    { role: "rock", family: "cliff" },
    { role: "architecture", family: "field" },
    { role: "signal", family: "mountain" },
    { role: "metal", family: "cliff" },
    { role: "glass", family: "water" },
  ],
};

describe("acceptance: the coastal scene renders without errors", () => {
  const engine = createV1Engine();
  const scenes = [
    { spec: coastalLighthouseSceneSpec(), label: "the coastal scene" },
  ];

  for (const { spec, label } of scenes) {
    it(`${label} renders one well-formed SVG document`, () => {
      const result = engine.renderScene(spec);
      expect(result.svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(
        true,
      );
      assertWellFormedXml(result.svg);
      expect(result.svg).toContain("<svg");
      expect(result.svg.length).toBeGreaterThan(1000);
    });

    it(`${label} places every coastal kind and records it in the trace`, () => {
      const result = engine.renderScene(spec);
      const geometryEvent = result.trace.events.find(
        (event) => event.stage === "geometry",
      );
      expect(geometryEvent).toBeDefined();
      const data = (geometryEvent?.data ?? {}) as {
        objects?: Array<{ id: string; kind: string }>;
      };
      const placed = data.objects ?? [];
      expect(placed.length).toBe(spec.objects.length);
      const kinds = new Set(placed.map((entry) => entry.kind));
      for (const kind of SCENE_KINDS[spec.meta.id] ?? []) {
        expect(kinds.has(kind), `${spec.meta.id}: kind ${kind}`).toBe(true);
      }
      expect(result.trace.events.map((event) => event.stage)).toEqual(
        TRACE_STAGES,
      );
    });

    it(`${label} fills its regions and draws its contour strokes`, () => {
      const result = engine.renderScene(spec);
      const styleEvent = result.trace.events.find(
        (event) => event.stage === "style",
      );
      const data = (styleEvent?.data ?? {}) as {
        regionCount?: number;
        contourCount?: number;
      };
      expect(data.regionCount ?? 0).toBeGreaterThan(spec.objects.length);
      expect(data.contourCount ?? 0).toBeGreaterThan(spec.objects.length);
      // The renderer drew hatch strokes, not only contours.
      expect(result.trace.metrics?.strokeCount ?? 0).toBeGreaterThan(100);
      expect(result.trace.metrics?.svgSizeBytes ?? 0).toBeGreaterThan(5000);
    });

    it(`${label} re-renders byte-identical SVG from the same spec`, () => {
      const first = engine.renderScene(spec);
      const second = engine.renderScene(spec);
      expect(second.svg).toBe(first.svg);
      expect(JSON.stringify(second.ir.regions)).toBe(
        JSON.stringify(first.ir.regions),
      );
    });

    it(`${label} resolves every coastal zone role to a hatch family`, () => {
      const result = engine.renderScene(spec);
      const styleEvent = result.trace.events.find(
        (event) => event.stage === "style",
      );
      const data = (styleEvent?.data ?? {}) as {
        regions?: Array<{ role: string; family: string }>;
      };
      const regions = data.regions ?? [];
      expect(regions.length).toBeGreaterThan(0);
      // The scene draws exactly the families the shared zone table
      // resolves for the roles its objects emit: the lighthouse brings
      // the signal band, the cliff and the rocks bring wave-cut rock.
      expect([...new Set(regions.map((entry) => entry.family))].sort()).toEqual(
        SCENE_FAMILIES[spec.meta.id],
      );
      const roles = new Set(regions.map((entry) => entry.role));
      for (const role of SCENE_ROLES[spec.meta.id] ?? []) {
        expect(roles.has(role), `${spec.meta.id}: role ${role}`).toBe(true);
      }
    });

    it(`${label} fills its coastal roles from the tuned tables of its preset`, () => {
      const result = engine.renderScene(spec);
      const preset = getStylePreset(spec.meta.stylePreset);
      const styleEvent = result.trace.events.find(
        (event) => event.stage === "style",
      );
      const data = (styleEvent?.data ?? {}) as {
        regions?: Array<{
          role: string;
          family: string;
          fill: FillStyle;
        }>;
      };
      const regions = data.regions ?? [];
      for (const { role, family } of SCENE_TUNED_ROLES[spec.meta.id] ?? []) {
        const filled = regions.filter((entry) => entry.role === role);
        expect(filled.length, `${spec.meta.id}: role ${role}`).toBeGreaterThan(
          0,
        );
        for (const entry of filled) {
          expect(entry.family, `${spec.meta.id}: ${role} family`).toBe(family);
          // The fill is the tuned family of this preset, not the shared
          // family shape: the signal band of the lighthouse draws with the
          // headland hatch, denser than the tower wall beside it. The
          // family opens by the negative space this scene asks for over
          // the floor of the preset, the way the style application stage
          // opens it.
          expect(entry.fill, `${spec.meta.id}: ${role} fill`).toEqual(
            openFillStyle(
              fillOfFamily(preset, family),
              negativeSpaceSpacingMultiplier(
                spec.composition.negativeSpace,
                preset.compositionGrammar.minEmptyAreaRatio,
              ),
            ),
          );
        }
      }
    });
  }
});

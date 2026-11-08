/**
 * End-to-end render tests for the round 2 object library (task T020).
 *
 * The acceptance asks for one skatepark scene and one urban scene that use
 * the new object kinds and render without errors. Both scenes run through
 * the whole compiler - planning, geometry synthesis, style application, and
 * render - over the real collaborators, under the round 2 presets of task
 * T021: the skatepark scene under `skatepark-v1`, the urban scene under
 * `urban-v1`. The object geometry the presets style is what this file
 * proves, together with the tuned family tables the presets carry.
 */

import { describe, expect, it } from "vitest";

import {
  detailBudgetOf,
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
 * The skatepark scene: a bowl and a quarter pipe in front of a fence and a
 * bench, one skater riding the coping, and a handrail down the bank.
 */
export function skateparkSceneSpec(): SceneSpec {
  return {
    meta: {
      id: "skatepark-bowl-0001",
      seed: 20261107,
      stylePreset: "skatepark-v1",
      aspectRatio: "4:3",
      version: "1.0.0",
    },
    camera: {
      framing: "wide",
      lens: "wide",
      horizonY: 0.62,
    },
    composition: {
      focalPoints: ["skater-1"],
      balance: "left",
      negativeSpace: 0.4,
      depthLayers: 3,
    },
    environment: {
      type: "skatepark",
      sky: { cloudCount: 2 },
    },
    objects: [
      {
        id: "fence-1",
        kind: "fence",
        role: "background",
        position: { x: 0.5, y: 0.63 },
        scale: 1.8,
        params: { width: 420, height: 74, posts: 6, rails: 2, pickets: 9 },
      },
      {
        id: "bowl-1",
        kind: "bowl",
        role: "midground",
        position: { x: 0.34, y: 0.74 },
        scale: 1.4,
        params: { width: 340, depth: 96, curvature: 0.5, deckWidth: 44 },
      },
      {
        id: "quarter-pipe-1",
        kind: "quarter-pipe",
        role: "midground",
        position: { x: 0.78, y: 0.86 },
        scale: 1.3,
        params: { width: 230, height: 140, curvature: 0.6, platform: 36 },
      },
      {
        id: "handrail-1",
        kind: "handrail",
        role: "midground",
        position: { x: 0.86, y: 0.7 },
        scale: 1.2,
        rotation: -4,
        params: { width: 190, height: 96, drop: 0.5, posts: 3 },
      },
      {
        id: "bench-1",
        kind: "bench",
        role: "foreground",
        position: { x: 0.12, y: 0.9 },
        scale: 1.1,
        params: { width: 150, seatHeight: 40, backHeight: 38, slats: 3 },
      },
      {
        id: "skater-1",
        kind: "skater",
        role: "focal",
        position: { x: 0.42, y: 0.86 },
        scale: 1.15,
        params: { height: 150, crouch: 0.4, lean: 0.3, boardLength: 58 },
      },
    ],
  } as SceneSpec;
}

/**
 * The urban scene: a street with a tram, two building blocks, parked cars,
 * a road band, and the two eras of street lighting.
 */
export function urbanStreetSceneSpec(): SceneSpec {
  return {
    meta: {
      id: "urban-tram-street-0001",
      seed: 20261107,
      stylePreset: "urban-v1",
      aspectRatio: "4:3",
      version: "1.0.0",
    },
    camera: {
      framing: "wide",
      lens: "normal",
      horizonY: 0.66,
    },
    composition: {
      focalPoints: ["tram-1"],
      balance: "center",
      negativeSpace: 0.3,
      depthLayers: 4,
    },
    environment: {
      type: "urban",
      sky: { cloudCount: 1 },
    },
    objects: [
      {
        id: "block-1",
        kind: "building-block",
        role: "background",
        position: { x: 0.18, y: 0.66 },
        scale: 1.6,
        params: { width: 220, height: 420, floors: 8, columns: 4, setback: 0.4 },
      },
      {
        id: "block-2",
        kind: "building-block",
        role: "background",
        position: { x: 0.82, y: 0.66 },
        scale: 1.6,
        params: { width: 260, height: 300, floors: 6, columns: 5, setback: 0 },
      },
      {
        id: "lamp-post-1",
        kind: "lamp-post",
        role: "midground",
        position: { x: 0.08, y: 0.74 },
        scale: 1.1,
        params: { height: 170, lanternSize: 36, panes: 2 },
      },
      {
        id: "road-1",
        kind: "road",
        role: "midground",
        position: { x: 0.5, y: 0.72 },
        scale: 1.4,
        params: { width: 760, depth: 120, lanes: 2, markings: true },
      },
      {
        id: "tram-1",
        kind: "tram",
        role: "focal",
        position: { x: 0.46, y: 0.86 },
        scale: 1.2,
        params: { length: 430, bodyHeight: 140, windows: 5, doors: 2 },
      },
      {
        id: "car-1",
        kind: "car",
        role: "foreground",
        position: { x: 0.83, y: 0.92 },
        scale: 1.1,
        params: { length: 200, bodyHeight: 54, windows: 2 },
      },
      {
        id: "streetlight-1",
        kind: "streetlight",
        role: "foreground",
        position: { x: 0.62, y: 0.95 },
        scale: 1.1,
        params: { height: 190, armLength: 0.4, headLength: 52 },
      },
    ],
  } as SceneSpec;
}

/** The object kinds each scene must place, by scene id. */
const SCENE_KINDS: Readonly<Record<string, string[]>> = {
  "skatepark-bowl-0001": [
    "fence",
    "bowl",
    "quarter-pipe",
    "handrail",
    "bench",
    "skater",
  ],
  "urban-tram-street-0001": [
    "building-block",
    "lamp-post",
    "road",
    "tram",
    "car",
    "streetlight",
  ],
};

/** The round 2 zone roles each scene must fill, by scene id. */
const SCENE_ROLES: Readonly<Record<string, string[]>> = {
  "skatepark-bowl-0001": ["concrete", "pavement", "metal", "figure", "shadow"],
  "urban-tram-street-0001": ["pavement", "metal", "glass", "architecture", "roof"],
};

/**
 * Every hatch family each scene draws, and no other, by scene id.
 *
 * The list is the tuned zone table of the scene preset read through the
 * roles its objects emit: the environment regions add `sky` and `ground`,
 * then every object zone resolves through `STYLE_ZONE_ROLES`.
 */
const SCENE_FAMILIES: Readonly<Record<string, string[]>> = {
  "skatepark-bowl-0001": [
    "cliff",
    "field",
    "foliage",
    "mountain",
    "none",
    "sky",
  ],
  "urban-tram-street-0001": ["cliff", "field", "mountain", "sky", "water"],
};

/** The round 2 zone roles each scene must fill with the tuned family. */
const SCENE_TUNED_ROLES: Readonly<
  Record<string, Array<{ role: string; family: string }>>
> = {
  "skatepark-bowl-0001": [
    { role: "concrete", family: "mountain" },
    { role: "pavement", family: "field" },
    { role: "metal", family: "cliff" },
    { role: "figure", family: "none" },
    { role: "shadow", family: "foliage" },
  ],
  "urban-tram-street-0001": [
    { role: "pavement", family: "field" },
    { role: "metal", family: "cliff" },
    { role: "glass", family: "water" },
    { role: "architecture", family: "field" },
    { role: "roof", family: "mountain" },
  ],
};

describe("acceptance: the round 2 scenes render without errors", () => {
  const engine = createV1Engine();
  const scenes = [
    { spec: skateparkSceneSpec(), label: "the skatepark scene" },
    { spec: urbanStreetSceneSpec(), label: "the urban scene" },
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

    it(`${label} places every round 2 kind and records it in the trace`, () => {
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

    it(`${label} resolves every round 2 zone role to a hatch family`, () => {
      const result = engine.renderScene(spec);
      const styleEvent = result.trace.events.find(
        (event) => event.stage === "style",
      );
      const data = (styleEvent?.data ?? {}) as {
        regions?: Array<{ role: string; family: string }>;
      };
      const regions = data.regions ?? [];
      expect(regions.length).toBeGreaterThan(0);
      // The scene draws exactly the families its tuned table resolves,
      // which is the whole family set of the grammar minus the zones this
      // scene never fills: no water in the park, no shadow on the street.
      expect([...new Set(regions.map((entry) => entry.family))].sort()).toEqual(
        SCENE_FAMILIES[spec.meta.id],
      );
      const roles = new Set(regions.map((entry) => entry.role));
      for (const role of SCENE_ROLES[spec.meta.id] ?? []) {
        expect(roles.has(role), `${spec.meta.id}: role ${role}`).toBe(true);
      }
    });

    it(`${label} fills its round 2 roles from the tuned tables of its preset`, () => {
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
          // family shape: skatepark concrete and pastoral mountain draw
          // different lines under the same family name. The family opens
          // by the negative space this scene asks for over the floor of
          // the preset, the way the style application stage opens it.
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

/**
 * The per-object omission record of the geometry trace (specification
 * section 9B): what the object grammar of the preset dropped.
 *
 * The urban scene is the scene of the finding: its two building blocks emit
 * more window and floor marks than the `urban-v1` budget of four keeps, so
 * a trace that named only the kept count hid what the style simplified
 * away. These tests pin the record the trace now states, on the real
 * generators through the whole engine.
 */
describe("the geometry trace records what the object grammar omitted", () => {
  const engine = createV1Engine();
  const spec = urbanStreetSceneSpec();
  const budget = detailBudgetOf(getStylePreset("urban-v1").objectGrammar);

  /** The geometry event of one render, as the record under test. */
  function omissionRecord() {
    const event = engine.renderScene(spec).trace.events.find(
      (candidate) => candidate.stage === "geometry",
    );
    const data = (event?.data ?? {}) as {
      omittedInternalBoundaries?: number;
      objects?: Array<{
        id: string;
        internalBoundaries: number;
        emittedInternalBoundaries?: number;
        keptInternalBoundaries?: number;
        droppedInternalBoundaries?: number;
        detailBudget?: number;
      }>;
    };
    return { message: event?.message ?? "", data };
  }

  it("states the emitted, kept, and dropped counts of every object", () => {
    const { data } = omissionRecord();
    const entries = data.objects ?? [];
    expect(entries).toHaveLength(spec.objects.length);
    for (const entry of entries) {
      expect(entry.emittedInternalBoundaries).toBeDefined();
      expect(entry.keptInternalBoundaries).toBe(entry.internalBoundaries);
      expect(entry.droppedInternalBoundaries).toBe(
        entry.emittedInternalBoundaries! - entry.keptInternalBoundaries!,
      );
      expect(entry.detailBudget).toBe(budget);
    }
  });

  it("reports the omissions of the budget-limited building blocks", () => {
    const { data } = omissionRecord();
    const blocks = (data.objects ?? []).filter(
      (entry) => entry.id.startsWith("block"),
    );
    expect(blocks).toHaveLength(2);
    for (const block of blocks) {
      // Both façades emit past the budget: the grammar drops their marks.
      expect(block.emittedInternalBoundaries!).toBeGreaterThan(budget);
      expect(block.keptInternalBoundaries).toBe(budget);
      expect(block.droppedInternalBoundaries!).toBeGreaterThan(0);
    }
  });

  it("sums the omissions into one count and one message", () => {
    const { message, data } = omissionRecord();
    const dropped = (data.objects ?? []).reduce(
      (total, entry) => total + (entry.droppedInternalBoundaries ?? 0),
      0,
    );
    expect(dropped).toBeGreaterThan(0);
    expect(data.omittedInternalBoundaries).toBe(dropped);
    expect(message).toContain(
      `${dropped} internal boundary(ies) dropped by the object grammar`,
    );
  });
});

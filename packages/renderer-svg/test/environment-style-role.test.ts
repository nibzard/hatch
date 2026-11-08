/**
 * Acceptance tests for the environment and style role fields (tasks T045
 * and T049).
 *
 * The scene schema accepts four environment fields, `sky.cloudCount`,
 * `ground.strips`, `atmosphere.fog`, and `atmosphere.rain`, beside the
 * `styleRole` of an object, and the compiler must honor each one. A field
 * that only changes the spec hash changes the seeded stream, so the bytes
 * drift while the picture stays the same. These tests pin the structure
 * each field produces - the regions, the fill styles, and the contour
 * counts of the intermediate representation - so a field that goes inert
 * fails on an exact number, not on byte noise.
 */

import { describe, expect, it } from "vitest";

import {
  fogInkShare,
  RAIN_ANGLE_DEGREES,
  RAIN_JITTER,
  RAIN_REGION_ID,
  RAIN_WEIGHT_SHARE,
  rainFillStyle,
  rainZoneZIndex,
  type Region,
  type RenderIR,
  type SceneSpec,
} from "@hatch/core";

import { createV1Engine } from "../src/index.js";
import { assertWellFormedXml } from "./xml-check.js";

/** What one test renders: the document, the intermediate representation. */
function render(spec: SceneSpec): { svg: string; ir: RenderIR } {
  const result = createV1Engine().renderScene(spec);
  assertWellFormedXml(result.svg);
  return { svg: result.svg, ir: result.ir };
}

/**
 * One scene over three draw planes: a hill behind, a pond at the neutral
 * plane, a cottage in front as the focal point. The environment starts
 * clear, so every field moves the render away from one known baseline.
 */
function environmentScene(
  patches: {
    environment?: Record<string, unknown>;
    objects?: SceneSpec["objects"];
    composition?: Partial<SceneSpec["composition"]>;
  } = {},
): SceneSpec {
  return {
    meta: {
      id: "environment-style-role-0001",
      seed: 20261107,
      stylePreset: "pastoral-v1",
      aspectRatio: "4:3",
      version: "1.0.0",
    },
    camera: { framing: "medium", lens: "normal", horizonY: 0.68 },
    composition: {
      focalPoints: ["cottage-1"],
      balance: "center",
      negativeSpace: 0.35,
      depthLayers: 3,
      ...patches.composition,
    },
    environment: {
      type: "rural",
      sky: { cloudCount: 2 },
      ...(patches.environment ?? {}),
    },
    objects: patches.objects ?? [
      {
        id: "hill-1",
        kind: "hill",
        role: "background",
        position: { x: 0.3, y: 0.7 },
        scale: 2,
        params: { width: 300, height: 80 },
      },
      {
        id: "pond-1",
        kind: "water",
        role: "midground",
        position: { x: 0.45, y: 0.78 },
        scale: 1.5,
        params: { width: 360, depth: 90 },
      },
      {
        id: "cottage-1",
        kind: "house",
        role: "focal",
        position: { x: 0.62, y: 0.8 },
        scale: 1.5,
        params: { width: 150, wallHeight: 80, windows: 2, chimney: true },
      },
    ],
  } as SceneSpec;
}

/** The first region of one render whose id starts with the given prefix. */
function regionOf(regions: readonly Region[], id: string): Region {
  const region = regions.find((entry) => entry.id === id);
  if (region === undefined) {
    throw new Error(`test expected a region "${id}"`);
  }
  return region;
}

/** Every region of one render whose id carries an object id prefix. */
function objectRegions(regions: readonly Region[], objectId: string): Region[] {
  return regions.filter((region) => region.id.startsWith(`${objectId}:z`));
}

/** One number of a hatch fill, or -1 when the fill is not a hatch. */
function weightOf(region: Region): number {
  return region.fillStyle.type === "none" ? -1 : region.fillStyle.weight;
}

describe("the environment and the style roles drive the render", () => {
  const baseline = render(environmentScene());

  it("gives the baseline a clear atmosphere and no ground strips", () => {
    expect(
      baseline.ir.regions.some((region) => region.id === RAIN_REGION_ID),
    ).toBe(false);
    expect(baseline.ir.contours.filter((c) => c.role === "contour")).not.toHaveLength(0);
    // A clear atmosphere keeps every fill at the full ink of its family.
    for (const region of objectRegions(baseline.ir.regions, "hill-1")) {
      expect(weightOf(region)).toBeGreaterThan(0);
    }
  });

  it("environment.ground.strips draws one contour per strip on the ground", () => {
    // An empty scene keeps every other contour source out, so the strip
    // contours are the only contours the render carries.
    const empty = { objects: [] as SceneSpec["objects"], composition: { focalPoints: [] } };
    const clear = render(environmentScene(empty));
    expect(clear.ir.contours).toHaveLength(0);
    const mown = render(
      environmentScene({ ...empty, environment: { ground: { strips: 4 } } }),
    );
    expect(mown.ir.contours).toHaveLength(4);
    // Every strip runs across the ground plane, below the horizon.
    const horizonY = mown.ir.horizonY ?? mown.ir.canvas.height;
    for (const contour of mown.ir.contours) {
      expect(contour.role).toBe("contour");
      for (const command of contour.path.commands) {
        if (command.command === "close") {
          continue;
        }
        expect(command.to.y).toBeGreaterThan(horizonY);
        expect(command.to.y).toBeLessThanOrEqual(mown.ir.canvas.height);
      }
    }
  });

  it("environment.ground.strips stops at the objects that stand on the ground", () => {
    const mown = render(
      environmentScene({ environment: { ground: { strips: 4 } } }),
    );
    // The baseline already carries the contours of every object, so the
    // strips add at least one contour each, split into pieces where an
    // object stands over them.
    expect(mown.ir.contours.length).toBeGreaterThanOrEqual(
      baseline.ir.contours.length + 4,
    );
  });

  it("environment.atmosphere.fog fades each object by its draw depth", () => {
    const foggy = render(
      environmentScene({ environment: { atmosphere: { fog: 1 } } }),
    );
    // The hill on the background plane keeps the faded share of its ink,
    // in its fills and in its contour weight; the focal cottage keeps all.
    for (const [index, plain] of objectRegions(
      baseline.ir.regions,
      "hill-1",
    ).entries()) {
      const faded = objectRegions(foggy.ir.regions, "hill-1")[index]!;
      expect(weightOf(faded)).toBeCloseTo(weightOf(plain) * fogInkShare(1, 0), 9);
      if (faded.fillStyle.type === "hatch" && plain.fillStyle.type === "hatch") {
        expect(faded.fillStyle.spacing).toBeCloseTo(
          plain.fillStyle.spacing / fogInkShare(1, 0),
          9,
        );
      }
    }
    expect(objectRegions(foggy.ir.regions, "cottage-1").map(weightOf)).toEqual(
      objectRegions(baseline.ir.regions, "cottage-1").map(weightOf),
    );
    // The same share thins the contour weight: the hill draws the lightest
    // line of the scene, the cottage the full one.
    const weights = foggy.ir.contours.map((contour) => contour.weight);
    expect(Math.min(...weights)).toBeCloseTo(
      foggy.ir.style.contours.weight * fogInkShare(1, 0),
      9,
    );
    expect(Math.max(...weights)).toBe(foggy.ir.style.contours.weight);
  });

  it("environment.atmosphere.rain adds one region over the whole scene", () => {
    const raining = render(
      environmentScene({ environment: { atmosphere: { rain: 60 } } }),
    );
    const rain = regionOf(raining.ir.regions, RAIN_REGION_ID);
    // The rain draws in one band above every object zone, so no authored
    // zone layer of any generator can paint over it.
    expect(rain.zIndex).toBe(rainZoneZIndex(environmentScene().objects.length));
    expect(
      raining.ir.regions
        .filter((region) => region.id !== RAIN_REGION_ID)
        .every((region) => region.zIndex < rain.zIndex),
    ).toBe(true);
    expect(rain.fillStyle).toEqual(
      rainFillStyle(raining.ir.style, raining.ir.canvas, 60),
    );
    expect(rain.fillStyle.type).toBe("hatch");
    if (rain.fillStyle.type === "hatch") {
      // The rain strokes run off the vertical, spread over the canvas width,
      // and stay lighter than the contour ink of the style.
      expect(rain.fillStyle.angle).toBe(RAIN_ANGLE_DEGREES);
      expect(rain.fillStyle.spacing).toBeCloseTo(raining.ir.canvas.width / 60, 9);
      expect(rain.fillStyle.weight).toBeCloseTo(
        raining.ir.style.contours.weight * RAIN_WEIGHT_SHARE,
        9,
      );
      expect(rain.fillStyle.jitter).toBe(RAIN_JITTER);
    }
    // The rain region covers the whole canvas and its strokes draw.
    expect(rain.path.commands).toHaveLength(5);
    expect(raining.ir.trace.metrics?.strokeCount ?? 0).toBeGreaterThan(
      baseline.ir.trace.metrics?.strokeCount ?? 0,
    );
  });

  it("SceneObject.styleRole refills every zone of the object", () => {
    const objects = environmentScene().objects.map((object) =>
      object.id === "cottage-1" ? { ...object, styleRole: "sky hatch" } : object,
    );
    const skyFilled = render(environmentScene({ objects }));
    const skyHatch = regionOf(skyFilled.ir.regions, "sky").fillStyle;
    const plainHatch = regionOf(baseline.ir.regions, "sky").fillStyle;
    // The override moves the cottage off the families its zones carry: the
    // baseline fills differ, the override fills every zone like the sky.
    expect(
      objectRegions(baseline.ir.regions, "cottage-1").map((r) => r.fillStyle),
    ).not.toEqual(
      objectRegions(skyFilled.ir.regions, "cottage-1").map((r) => r.fillStyle),
    );
    for (const region of objectRegions(skyFilled.ir.regions, "cottage-1")) {
      expect(region.fillStyle).toEqual(skyHatch);
    }
    // The paper role leaves the object as negative space.
    const paperObjects = environmentScene().objects.map((object) =>
      object.id === "cottage-1" ? { ...object, styleRole: "paper" } : object,
    );
    const paper = render(environmentScene({ objects: paperObjects }));
    for (const region of objectRegions(paper.ir.regions, "cottage-1")) {
      expect(region.fillStyle.type).toBe("none");
    }
    // The baseline sky is what the sky hatch role resolves to, so the plain
    // hatch pins that the comparison above compares two live fills.
    expect(plainHatch.type).toBe("hatch");
  });

  it("rejects a styleRole that names no fill of the style", () => {
    const objects = environmentScene().objects.map((object) =>
      object.id === "cottage-1" ? { ...object, styleRole: "contour" } : object,
    );
    expect(() =>
      createV1Engine().renderScene(environmentScene({ objects })),
    ).toThrow(/styleRole must name a fill role of specification section 16D/);
  });

  it("rejects an environment key the compiler does not read", () => {
    expect(() =>
      createV1Engine().renderScene(
        environmentScene({ environment: { ground: { furrows: 3 } } }),
      ),
    ).toThrow(/environment\.ground\.furrows is not read by the compiler/);
    expect(() =>
      createV1Engine().renderScene(
        environmentScene({ environment: { atmosphere: { haze: 0.4 } } }),
      ),
    ).toThrow(/environment\.atmosphere\.haze is not read by the compiler/);
  });

  it("rejects a sky key the compiler does not read", () => {
    // The probe of the finding: `storminess` and `cloudShape` beside a read
    // `cloudCount` used to pass, and the render came out with the same
    // regions and the same clouds - only the seeded bytes moved.
    expect(() =>
      createV1Engine().renderScene(
        environmentScene({
          environment: { sky: { cloudCount: 3, storminess: 0.9 } },
        }),
      ),
    ).toThrow(
      /environment\.sky\.storminess is not read by the compiler; environment\.sky accepts cloudCount only/,
    );
    expect(() =>
      createV1Engine().renderScene(
        environmentScene({
          environment: { sky: { cloudCount: 3, cloudShape: "cumulus" } },
        }),
      ),
    ).toThrow(/environment\.sky\.cloudShape is not read by the compiler/);
  });

  it("rejects an environment count outside its range", () => {
    expect(() =>
      createV1Engine().renderScene(
        environmentScene({ environment: { ground: { strips: 9 } } }),
      ),
    ).toThrow(/environment\.ground\.strips must be an integer between 0 and 6/);
    expect(() =>
      createV1Engine().renderScene(
        environmentScene({ environment: { atmosphere: { rain: 1.5 } } }),
      ),
    ).toThrow(/environment\.atmosphere\.rain must be an integer between 0 and 160/);
    expect(() =>
      createV1Engine().renderScene(
        environmentScene({ environment: { sky: { cloudCount: 99 } } }),
      ),
    ).toThrow(
      /environment\.sky\.cloudCount must be an integer between 0 and 12/,
    );
  });

  it("records the environment in the planning trace", () => {
    const { ir } = render(
      environmentScene({
        environment: {
          ground: { strips: 2 },
          atmosphere: { fog: 4, rain: 40 },
        },
      }),
    );
    const planning = ir.trace.events.find((event) => event.stage === "planning");
    expect(planning?.data).toMatchObject({
      environment: {
        type: "rural",
        groundStrips: 2,
        fog: 1,
        fogClamped: true,
        rain: 40,
      },
    });
  });

  it("renders the same document twice for the same environment", () => {
    const spec = environmentScene({
      environment: { ground: { strips: 3 }, atmosphere: { fog: 0.6, rain: 30 } },
    });
    expect(render(spec).svg).toBe(render(spec).svg);
  });
});

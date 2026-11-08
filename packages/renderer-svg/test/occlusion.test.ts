/**
 * Regression tests for the occlusion of object style zones (task T037,
 * specification section 7).
 *
 * The planned scene regions already carry every object silhouette as a
 * cutout, so the hatch of the sky and the ground stops where an object
 * stands. The style zones of the objects themselves need the same
 * treatment between each other: an object that draws later in the depth
 * order stands in front, and the hatch of a zone behind it must stop at
 * that object's silhouette, so no line system crosses an object that
 * covers it.
 *
 * The scene here is the smallest one that shows the difference: one hill
 * behind one house that covers part of it. The test reads the strokes the
 * hatching engine drew for each region - recomputed through the public API
 * under the render stream of the same identity, the way `render.test.ts`
 * proves the cloud cutout - and the silhouettes of the placed objects,
 * rebuilt through the public planning and geometry entries under the same
 * identity, so both describe exactly the render under test.
 *
 * One control render runs without the geometry tools, so its zones pass
 * through uncomposed. Its crest hatch crosses the house, which proves the
 * scene really overlaps and that the assertions of this file can fail.
 */

import { describe, expect, it } from "vitest";

import {
  createStageRng,
  planScene,
  renderIdentityOf,
  synthesizeSceneGeometry,
  type Path,
  type Point,
  type RenderResult,
  type SceneGeometry,
  type SceneSpec,
} from "@hatch/core";
import { pointInPath, samplePathPoints, subpathsOf } from "@hatch/geometry";
import { hatchRegions, type HatchSet } from "@hatch/hatching";
import { generateSceneObject } from "@hatch/objects";
import { resolveStyle } from "@hatch/styles";

import { createRenderRng, createV1Engine } from "../src/index.js";

/** The id of the object that stands behind. */
const BACK_ID = "hill-1";

/** The id of the object that stands in front and covers part of it. */
const FRONT_ID = "house-1";

/**
 * The occlusion scene: one hill in the background, one house in front of
 * it, both on the same spot so the house wall covers the crest hatch.
 */
function occlusionSpec(): SceneSpec {
  return {
    meta: {
      id: "occlusion-0001",
      seed: 7,
      stylePreset: "pastoral-v1",
      aspectRatio: "4:3",
      version: "1.0.0",
    },
    camera: { framing: "wide", lens: "normal", horizonY: 0.68 },
    composition: {
      focalPoints: [],
      balance: "asymmetric",
      negativeSpace: 0.35,
      depthLayers: 3,
    },
    environment: { type: "rural" },
    objects: [
      {
        id: BACK_ID,
        kind: "hill",
        role: "background",
        position: { x: 0.5, y: 0.7 },
        scale: 2.4,
        params: { width: 300, height: 80, crestIrregularity: 0.3, strips: 2 },
      },
      {
        id: FRONT_ID,
        kind: "house",
        role: "midground",
        position: { x: 0.5, y: 0.78 },
        scale: 1.5,
        params: {
          width: 150,
          wallHeight: 80,
          roofPitch: 0.8,
          windows: 3,
          chimney: true,
          door: true,
        },
      },
    ],
  } as SceneSpec;
}

/**
 * The placed geometry of one spec, rebuilt the way the engine built it.
 *
 * Planning and geometry synthesis are pure functions of the spec, the style,
 * and the stage streams, and every one of the three comes from the same
 * public entry the engine calls. The silhouettes this returns are the ones
 * the style stage carved with.
 */
function placedGeometry(spec: SceneSpec): SceneGeometry {
  const identity = renderIdentityOf(spec);
  const style = resolveStyle(spec.meta.stylePreset, spec.styleOverrides);
  const plan = planScene(spec, style, createStageRng(identity, "planning"));
  return synthesizeSceneGeometry(
    plan,
    { generateObject: generateSceneObject },
    createStageRng(identity, "geometry"),
  );
}

/** Every sampled point of every stroke of one set. */
function setPoints(set: HatchSet, spacing = 2): Point[] {
  return set.strokes.flatMap((stroke) =>
    subpathsOf(stroke.path).flatMap((piece) => samplePathPoints(piece, spacing)),
  );
}

/** The stroke sets of one render, keyed by region id. */
function strokeSets(result: RenderResult): Map<string, HatchSet> {
  return new Map(
    hatchRegions(
      result.ir.regions,
      result.ir.style,
      createRenderRng(result.ir),
    ).map((set) => [set.regionId, set]),
  );
}

describe("acceptance: object zones occlude each other", () => {
  const spec = occlusionSpec();
  const composed = createV1Engine().renderScene(spec);
  const sets = strokeSets(composed);
  const objects = placedGeometry(spec);
  const hill = objects.objects.find(
    (entry) => entry.placement.object.id === BACK_ID,
  );
  const house = objects.objects.find(
    (entry) => entry.placement.object.id === FRONT_ID,
  );

  // The scene must be the one this file claims: the house draws after the
  // hill, and its silhouette covers the hill crest, so the carve has real
  // geometry to work on.
  it("draws the house in front of the hill, over its crest", () => {
    expect(composed.trace.events[1]?.data).toMatchObject({
      depthOrder: [BACK_ID, FRONT_ID],
    });
    expect(hill).toBeDefined();
    expect(house).toBeDefined();
    // Without the geometry tools the zones pass through uncomposed, and the
    // crest hatch runs straight through the house: the overlap is real, and
    // the assertions below can fail.
    const raw = strokeSets(
      createV1Engine({ tools: {} }).renderScene(spec),
    ).get(`${BACK_ID}:z0`);
    expect(raw).toBeDefined();
    expect(
      setPoints(raw!).filter((point) =>
        pointInPath(house!.geometry.silhouette, point),
      ).length,
    ).toBeGreaterThan(0);
  });

  it("stops the lower zone's hatch at the front object's silhouette", () => {
    const crest = setPoints(sets.get(`${BACK_ID}:z0`)!);
    const silhouette: Path = house!.geometry.silhouette;
    expect(crest.filter((point) => pointInPath(silhouette, point))).toEqual([]);
    // The zone still hatches, so the carve trimmed the field instead of
    // erasing the hill.
    expect(crest.length).toBeGreaterThan(0);
  });

  it("keeps the sky and ground carve the scene regions already had", () => {
    for (const id of ["sky", "ground"]) {
      const points = setPoints(sets.get(id)!);
      expect(points.length).toBeGreaterThan(0);
      expect(
        points.filter((point) => pointInPath(house!.geometry.silhouette, point)),
      ).toEqual([]);
    }
  });

  it("keeps the front object's own hatch inside its silhouette", () => {
    const zones = [...sets.keys()].filter((id) =>
      id.startsWith(`${FRONT_ID}:z`),
    );
    expect(zones.length).toBeGreaterThan(0);
    for (const id of zones) {
      const points = setPoints(sets.get(id)!);
      // The house hatches its own zones - its silhouette never carves them
      // away - and every stroke sits inside it.
      expect(points.length).toBeGreaterThan(0);
      expect(
        points.filter(
          (point) => !pointInPath(house!.geometry.silhouette, point),
        ),
      ).toEqual([]);
    }
  });
});

/**
 * Regression tests for the paint order of object style zones (task T047,
 * specification section 7).
 *
 * The occlusion carve of T037 follows the depth order of the plan, while
 * the renderer stacks regions by the zIndex each zone carries. The two
 * agree only if the zIndex the style stage hands the renderer is the depth
 * order plus the layer the generator authored inside its own object. Before
 * T047 the authored layer decided both, so a foreground road that authored
 * 6 painted under a midground wall that authored 10 while the same carve
 * treated the road as the object in front.
 *
 * The scene here is the one that shows the difference: one house in the
 * midground, one road in the foreground that covers the lower part of its
 * wall. The house authored the higher layer, so the depth order and the
 * authored order contradict each other, which is what the fix must resolve
 * in favour of the depth order.
 */

import { describe, expect, it } from "vitest";

import {
  createStageRng,
  DEFAULT_OBJECT_ZONE_Z_INDEX,
  objectZoneZIndex,
  planScene,
  renderIdentityOf,
  synthesizeSceneGeometry,
  type Point,
  type RenderResult,
  type SceneGeometry,
  type SceneSpec,
} from "@hatch/core";
import { pointInPath, samplePathPoints, subpathsOf } from "@hatch/geometry";
import { generateSceneObject } from "@hatch/objects";
import { resolveStyle } from "@hatch/styles";

import { createV1Engine } from "../src/index.js";

/** The id of the object that stands behind. */
const BACK_ID = "house-1";

/** The id of the object that stands in front and covers part of it. */
const FRONT_ID = "road-1";

/**
 * The contradiction scene: a midground house whose wall authored zIndex 10,
 * and a foreground road over its base whose pavement authored zIndex 6. The
 * depth order puts the road in front; the authored layers put it behind.
 */
function zoneStackSpec(): SceneSpec {
  return {
    meta: {
      id: "zone-stack-0001",
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
      {
        id: FRONT_ID,
        kind: "road",
        role: "foreground",
        position: { x: 0.5, y: 0.7 },
        scale: 1.6,
        params: { width: 420, depth: 120, lanes: 2, markings: true, wander: 0.2 },
      },
    ],
  } as SceneSpec;
}

/**
 * The placed geometry of one spec, rebuilt the way the engine built it, so
 * the authored layers and the silhouettes below describe exactly the render
 * under test.
 */
function placedGeometry(spec: SceneSpec): SceneGeometry {
  const identity = renderIdentityOf(spec);
  const style = resolveStyle(spec.meta.stylePreset);
  const plan = planScene(spec, style, createStageRng(identity, "planning"));
  return synthesizeSceneGeometry(
    plan,
    { generateObject: generateSceneObject },
    createStageRng(identity, "geometry"),
  );
}

/** The zIndexes one object authored for its zones, in emission order. */
function authoredLayers(geometry: SceneGeometry, objectId: string): number[] {
  const entry = geometry.objects.find(
    (candidate) => candidate.placement.object.id === objectId,
  );
  expect(entry).toBeDefined();
  return entry!.geometry.styleZones.map(
    (zone) => zone.zIndex ?? DEFAULT_OBJECT_ZONE_Z_INDEX,
  );
}

/** The region ids of one object, in the draw order of the render. */
function zoneRegionIds(result: RenderResult, objectId: string): string[] {
  return result.ir.regions
    .map((region) => region.id)
    .filter((id) => id.startsWith(`${objectId}:z`));
}

/** Every region id, in the order the document draws the regions. */
function documentRegionIds(result: RenderResult): string[] {
  return [...result.svg.matchAll(/data-region-id="([^"]+)"/g)].map(
    (match) => match[1]!,
  );
}

describe("acceptance: the zone stack follows the depth order", () => {
  const spec = zoneStackSpec();
  const composed = createV1Engine().renderScene(spec);
  const objects = placedGeometry(spec);

  it("holds a scene whose authored layers contradict the depth order", () => {
    // The road stands in front of the house, and its pavement authored the
    // lower layer: the two orders disagree, so this scene is the one the
    // stack must resolve by the depth order alone.
    expect(composed.trace.events[1]?.data).toMatchObject({
      depthOrder: [BACK_ID, FRONT_ID],
    });
    expect(Math.min(...authoredLayers(objects, BACK_ID))).toBeGreaterThan(
      Math.max(...authoredLayers(objects, FRONT_ID)),
    );
    // The overlap is real: the road silhouette covers the wall band, so the
    // stacking of the two objects decides which ink draws over which.
    const house = objects.objects.find(
      (entry) => entry.placement.object.id === BACK_ID,
    )!;
    const road = objects.objects.find(
      (entry) => entry.placement.object.id === FRONT_ID,
    )!;
    const wall = house.geometry.styleZones[0]!;
    const points = subpathsOf(wall.path).flatMap((piece) =>
      samplePathPoints(piece, 6),
    );
    const covered = points.filter((point: Point) =>
      pointInPath(road.geometry.silhouette, point),
    );
    expect(covered.length).toBeGreaterThan(points.length / 4);
  });

  it("paints every zone of the object in front above every zone behind it", () => {
    const houseZones = zoneRegionIds(composed, BACK_ID);
    const roadZones = zoneRegionIds(composed, FRONT_ID);
    expect(houseZones.length).toBeGreaterThan(0);
    expect(roadZones.length).toBeGreaterThan(0);
    const zIndexes = new Map(
      composed.ir.regions.map((region) => [region.id, region.zIndex]),
    );
    for (const behind of houseZones) {
      for (const front of roadZones) {
        expect(zIndexes.get(front)!).toBeGreaterThan(zIndexes.get(behind)!);
      }
    }
    // The document draws the same order the intermediate representation
    // states, because the renderer stacks its region layer by zIndex.
    const drawn = documentRegionIds(composed);
    for (const behind of houseZones) {
      for (const front of roadZones) {
        expect(drawn.indexOf(front)).toBeGreaterThan(drawn.indexOf(behind));
      }
    }
  });

  it("keeps the authored layer ordering the zones of one object", () => {
    // The house authored wall 10, roof 12, and chimney 14. Each zone paints
    // at the band of its object plus the layer its generator authored, so
    // the band moves all three by one constant and the stated layering keeps
    // ordering the zones inside the object.
    const entry = objects.objects.find(
      (candidate) => candidate.placement.object.id === BACK_ID,
    )!;
    const depthIndex = entry.placement.depthIndex;
    const layers = authoredLayers(objects, BACK_ID);
    const ids = zoneRegionIds(composed, BACK_ID);
    expect(
      ids.map(
        (id) => composed.ir.regions.find((region) => region.id === id)!.zIndex,
      ),
    ).toEqual(
      layers.map((layer) => objectZoneZIndex(depthIndex, layer)),
    );
  });
});

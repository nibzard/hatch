/**
 * Regression tests for the occlusion of object contour strokes (task T052,
 * specification section 7).
 *
 * `occlusion.test.ts` holds the fill half of the rule: the hatch of a
 * background object stops at the silhouette of the object in front of it.
 * This file holds the line half: the contour strokes and the internal
 * boundaries of a background object stop at the same silhouette, so no
 * content line draws through an object that covers it.
 *
 * The scene is the smallest one that shows the difference: one sea behind
 * one rock that stands over its wave lines. The wave lines are internal
 * boundaries of the sea, drawn in the contour layer that sits above every
 * region, so before the carve they ran straight through the rock while the
 * sea's own hatch already stopped at it.
 *
 * The tests read the contour strokes the intermediate representation
 * carries, which name the object each stroke belongs to, and the
 * silhouettes of the placed objects, rebuilt through the public planning
 * and geometry entries under the render identity, so both describe exactly
 * the render under test. One control render runs with every geometry tool
 * the engine wires except the carve, so its lines pass through whole. Its
 * wave lines cross the rock, which proves the scene really overlaps and
 * that the assertions of this file can fail.
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
import {
  clipStroke,
  composeRegion,
  pointInPath,
  samplePathPoints,
  simplifyPath,
  subpathsOf,
} from "@hatch/geometry";
import { generateSceneObject } from "@hatch/objects";
import { resolveStyle } from "@hatch/styles";

import { createV1Engine } from "../src/index.js";

/** The id of the object that stands behind: the sea. */
const BACK_ID = "sea-1";

/** The id of the object that stands in front and covers part of it. */
const FRONT_ID = "rock-1";

/**
 * How far the sampled points of a stroke sit apart, in user units. The
 * wave lines of the sea run level across the band, so this step resolves
 * every crossing of them.
 */
const STROKE_SAMPLING = 2;

/**
 * The step the silhouette outline is sampled at, for the depth measure of
 * this file, in user units.
 */
const OUTLINE_SAMPLING = 0.25;

/**
 * How deep a point may sit inside the front silhouette before it counts as
 * a crossing, in user units.
 *
 * A carve endpoint lands on the silhouette itself, and the outline samples
 * every quarter unit, so a point that stops at the silhouette reads up to
 * half that step deep. A point that crosses reads many units deep - the
 * rock spans 170 by 80 - so the two never meet.
 */
const BOUNDARY_TOLERANCE = 1;

/**
 * The occlusion scene: one sea in the midground, one rock in the foreground
 * over its wave lines, so the rock covers the middle of the band.
 */
function contourOcclusionSpec(): SceneSpec {
  return {
    meta: {
      id: "contour-occlusion-0001",
      seed: 7,
      stylePreset: "coastal-v1",
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
    environment: { type: "coastal" },
    objects: [
      {
        id: BACK_ID,
        kind: "water",
        role: "midground",
        position: { x: 0.5, y: 0.78 },
        scale: 1.5,
        params: {
          width: 1200,
          depth: 130,
          waveLines: 9,
          waveAmplitude: 6,
          shoreIrregularity: 0.3,
        },
      },
      {
        id: FRONT_ID,
        kind: "rock",
        role: "foreground",
        position: { x: 0.5, y: 0.9 },
        scale: 1.4,
        params: { width: 170, height: 80, lobes: 9, cracks: 1 },
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

/** Every sampled point of the contour strokes one object owns. */
function objectContourPoints(
  result: RenderResult,
  objectId: string,
): Point[] {
  return result.ir.contours
    .filter((stroke) => stroke.objectId === objectId)
    .flatMap((stroke) =>
      subpathsOf(stroke.path).flatMap((piece) =>
        samplePathPoints(piece, STROKE_SAMPLING),
      ),
    );
}

/** The sampled outline of a silhouette, for the depth measure below. */
function outlineOf(silhouette: Path): Point[] {
  return subpathsOf(silhouette).flatMap((piece) =>
    samplePathPoints(piece, OUTLINE_SAMPLING),
  );
}

/**
 * How deep one point sits inside a silhouette, in user units.
 *
 * A point outside reads 0. A point inside reads its distance to the nearest
 * sampled anchor of the outline, which overstates the true depth by at most
 * half the sampling step.
 */
function depthInside(
  point: Point,
  silhouette: Path,
  outline: readonly Point[],
): number {
  if (!pointInPath(silhouette, point)) {
    return 0;
  }
  let depth = Number.POSITIVE_INFINITY;
  for (const anchor of outline) {
    depth = Math.min(depth, Math.hypot(anchor.x - point.x, anchor.y - point.y));
  }
  return depth;
}

/** Every point of one object's strokes that crosses the given silhouette. */
function crossingPoints(
  points: readonly Point[],
  silhouette: Path,
  outline: readonly Point[],
): Point[] {
  return points.filter(
    (point) => depthInside(point, silhouette, outline) > BOUNDARY_TOLERANCE,
  );
}

describe("acceptance: object contours occlude each other", () => {
  const spec = contourOcclusionSpec();
  const composed = createV1Engine().renderScene(spec);
  // The control renders with every geometry tool the engine wires except
  // the carve, so the one difference against it is the contour carve this
  // file covers. Its wave lines cross the rock, which proves the scene
  // really overlaps and that the assertions below can fail.
  const uncarved = createV1Engine({
    tools: {
      composeRegion,
      simplifyContour: simplifyPath,
      clipContour: clipStroke,
    },
  }).renderScene(spec);
  const objects = placedGeometry(spec);
  const sea = objects.objects.find(
    (entry) => entry.placement.object.id === BACK_ID,
  );
  const rock = objects.objects.find(
    (entry) => entry.placement.object.id === FRONT_ID,
  );

  // The scene must be the one this file claims: the rock draws after the
  // sea, its silhouette covers the sea's wave lines, and the sea owns
  // contour strokes that reach under it.
  it("draws the rock in front of the sea, over its wave lines", () => {
    expect(composed.trace.events[1]?.data).toMatchObject({
      depthOrder: [BACK_ID, FRONT_ID],
    });
    expect(sea).toBeDefined();
    expect(rock).toBeDefined();
    const silhouette: Path = rock!.geometry.silhouette;
    const outline = outlineOf(silhouette);
    // Without the carve the lines pass through whole, and the wave lines
    // run straight through the rock: the overlap is real, and the
    // assertions below can fail.
    expect(objectContourPoints(uncarved, BACK_ID).length).toBeGreaterThan(0);
    expect(
      crossingPoints(objectContourPoints(uncarved, BACK_ID), silhouette, outline)
        .length,
    ).toBeGreaterThan(0);
  });

  it("names the object each contour stroke belongs to", () => {
    // Every stroke of this scene belongs to one of its two objects; the
    // environment drew no scene-level line.
    const owners = new Set(
      composed.ir.contours.map((stroke) => stroke.objectId),
    );
    expect(owners).toEqual(new Set([BACK_ID, FRONT_ID]));
  });

  it("stops the sea's contour strokes at the rock silhouette", () => {
    const silhouette: Path = rock!.geometry.silhouette;
    const outline = outlineOf(silhouette);
    const points = objectContourPoints(composed, BACK_ID);
    // The sea still draws its shoreline, its waterline, and its wave lines:
    // the carve trimmed the lines instead of erasing the sea.
    expect(points.length).toBeGreaterThan(0);
    expect(
      crossingPoints(points, silhouette, outline),
      "no contour point of the sea may cross the rock",
    ).toEqual([]);
  });

  it("keeps the front object's own contour strokes whole", () => {
    // Nothing stands in front of the rock, so its crest, its echo, its
    // wash line, and its crack draw exactly as they drew uncarved: one
    // stroke per line, no piece of one dropped.
    const lines = rock!.geometry.contours.length +
      rock!.geometry.internalBoundaries.length;
    const front = composed.ir.contours.filter(
      (stroke) => stroke.objectId === FRONT_ID,
    );
    const frontUncarved = uncarved.ir.contours.filter(
      (stroke) => stroke.objectId === FRONT_ID,
    );
    expect(lines).toBeGreaterThan(0);
    expect(front).toHaveLength(lines);
    expect(front).toEqual(frontUncarved);
  });
});

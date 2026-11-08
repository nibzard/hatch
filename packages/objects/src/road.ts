/**
 * The road generator (specification sections 6, 11, and 24).
 *
 * A road is a ground band, the same shape the water band uses: one far
 * kerb, one near kerb, and lane markings between them. The markings are
 * dashes, so one lane divider stays one boundary even when it holds dozens
 * of dashes.
 *
 * Local frame: the far kerb sits on `y = 0`, the road is centered on
 * `x = 0`, and the surface reaches towards the viewer to `y = depth`, the
 * frame the water generator documents.
 *
 * The kerbs wander a little from the seeded stream (specification section
 * 17), far less than a shoreline, because a road hatches straight.
 */

import { z } from "zod";

import type { Geometry, Path, Point, SeededRng, StyleZone } from "@hatch/core";
import { splineThroughPoints } from "@hatch/geometry";

import type { GenerateOptions, ObjectGenerator } from "./generator.js";
import {
  booleanField,
  integerField,
  numberField,
  parseParametersWith,
  spaceDefaults,
  type ParameterSpace,
} from "./parameters.js";
import { PAVEMENT_ROLE } from "./roles.js";
import {
  clamp,
  continuePath,
  dashedPolylinePath,
  polylinePath,
  withClose,
} from "./shapes.js";

/** Anchors along each kerb, from the left edge to the right. */
const EDGE_ANCHORS = 5;

/** Anchors along one lane marking. */
const MARK_ANCHORS = 7;

/** The semantic parameters of a road (specification section 6). */
export const roadParameterSchema = z.object({
  /** Width of the band. */
  width: z.number().finite().min(120).max(2400),
  /** Distance from the far kerb to the near kerb. */
  depth: z.number().finite().min(30).max(500),
  /** Traffic lanes the surface carries. */
  lanes: z.number().int().min(1).max(4),
  /** Draw the dashed lane markings. */
  markings: z.boolean(),
  /** How much the kerbs wander across the width. */
  wander: z.number().finite().min(0).max(1),
});

/** The road parameters. */
export type RoadParameters = z.infer<typeof roadParameterSchema>;

/** The range and the default of every road parameter. */
export const roadParameterSpace: ParameterSpace = {
  width: numberField(120, 2400, 900),
  depth: numberField(30, 500, 130),
  lanes: integerField(1, 4, 2),
  markings: booleanField(true),
  wander: numberField(0, 1, 0.2),
};

/** The default road parameters. */
export const defaultRoadParameters: RoadParameters =
  roadParameterSchema.parse(spaceDefaults(roadParameterSpace));

/** Anchor positions across the band, 0 at the left edge to 1 at the right. */
function anchorX(position: number, halfWidth: number): number {
  return -halfWidth + position * halfWidth * 2;
}

/**
 * The anchors of one kerb: five draws from the stream, one per interior
 * anchor, so the same stream lays the identical kerb.
 */
function kerbAnchors(
  y: number,
  halfWidth: number,
  wander: number,
  rng: SeededRng,
): Point[] {
  const anchors: Point[] = [];
  for (let index = 0; index < EDGE_ANCHORS; index += 1) {
    anchors.push({
      x: anchorX(index / (EDGE_ANCHORS - 1), halfWidth),
      y: y + rng.float(-wander, wander),
    });
  }
  return anchors;
}

/**
 * One dashed lane marking at a share of the depth, following a gentle wave
 * so the marking tracks the kerbs.
 */
function laneMarking(
  y: number,
  halfWidth: number,
  amplitude: number,
  phase: number,
  dash: number,
  gap: number,
): Path | null {
  const anchors: Point[] = [];
  for (let index = 0; index < MARK_ANCHORS; index += 1) {
    const position = index / (MARK_ANCHORS - 1);
    anchors.push({
      x: anchorX(position, halfWidth),
      y: y + Math.sin(phase + position * Math.PI) * amplitude,
    });
  }
  return dashedPolylinePath(anchors, dash, gap);
}

/**
 * Build the geometry of one road band.
 *
 * Draw order of the stream: one draw per interior anchor of the far kerb,
 * then one draw per interior anchor of the near kerb, then the phase of
 * each lane marking in order.
 */
export function generateRoad(
  parameters: RoadParameters,
  options: GenerateOptions,
): Geometry {
  const kerbStream = options.rng.fork("road:kerbs");
  const markStream = options.rng.fork("road:markings");
  const halfWidth = parameters.width / 2;
  const drift = parameters.depth * 0.05 * parameters.wander;

  const farAnchors = kerbAnchors(0, halfWidth, drift, kerbStream);
  const nearAnchors = kerbAnchors(
    parameters.depth,
    halfWidth,
    drift,
    kerbStream,
  );
  const farKerb = splineThroughPoints(farAnchors);
  const nearKerb = splineThroughPoints(nearAnchors);
  const nearKerbBack = splineThroughPoints([...nearAnchors].reverse());

  // One closed contour: far kerb left to right, down the right edge, near
  // kerb right to left, and the close back up the left edge.
  const farEnd = farAnchors[farAnchors.length - 1];
  const nearStart = nearAnchors[nearAnchors.length - 1];
  if (farEnd === undefined || nearStart === undefined) {
    throw new Error("the road generator could not place its kerbs");
  }
  const silhouette = withClose(
    continuePath(
      continuePath(farKerb, polylinePath([farEnd, nearStart])),
      nearKerbBack,
    ),
  );

  const contours: Path[] = [farKerb, nearKerb];

  // One centre line per lane boundary, dashed the way road markings read.
  // The dash length follows the depth, so a shallow band keeps short marks.
  const boundaries: Path[] = [];
  if (parameters.markings) {
    const dash = clamp(parameters.depth * 0.16, 6, 26);
    const gap = dash * 1.4;
    for (let index = 1; index < parameters.lanes; index += 1) {
      const share = index / parameters.lanes;
      const marking = laneMarking(
        parameters.depth * share,
        halfWidth,
        drift * 0.4,
        markStream.float(0, Math.PI),
        dash,
        gap,
      );
      if (marking !== null) {
        boundaries.push(marking);
      }
    }
    // A single-lane road still carries one edge marking inside the near
    // kerb, so the zone keeps its boundary whatever the lane count.
    if (parameters.lanes === 1) {
      const edge = laneMarking(
        parameters.depth * 0.82,
        halfWidth * 0.96,
        drift * 0.3,
        markStream.float(0, Math.PI),
        dash,
        gap,
      );
      if (edge !== null) {
        boundaries.push(edge);
      }
    }
  }
  if (boundaries.length === 0) {
    // A road without markings still keeps one interior line: the crown of
    // the surface, where the camber breaks.
    boundaries.push(
      polylinePath([
        { x: -halfWidth, y: parameters.depth * 0.5 },
        { x: halfWidth, y: parameters.depth * 0.5 },
      ]),
    );
  }

  const styleZones: StyleZone[] = [
    { role: PAVEMENT_ROLE.role, path: silhouette, zIndex: 6 },
  ];

  return { silhouette, contours, internalBoundaries: boundaries, styleZones };
}

/** The road generator of the round 2 object registry. */
export const roadGenerator: ObjectGenerator = {
  kind: "road",
  title: "A road band: two kerbs, dashed lane markings, one camber line.",
  zoneRoles: [PAVEMENT_ROLE],
  parameterSpace: roadParameterSpace,
  defaultParameters: spaceDefaults(roadParameterSpace),
  parseParameters: (raw) =>
    parseParametersWith("road", roadParameterSchema, roadParameterSpace, raw),
  generate: (parameters, options: GenerateOptions) =>
    generateRoad(roadParameterSchema.parse(parameters), options),
};

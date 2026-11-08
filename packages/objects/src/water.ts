/**
 * The water generator (specification sections 6 and 24).
 *
 * Water is a band of the scene: a slightly wandering far shoreline, a near
 * waterline, and wave lines between them that spread apart towards the
 * viewer the way a calm surface reads (specification section 3B). The
 * whole band is one style zone of the water family, and the wave lines are
 * its internal boundaries.
 *
 * Local frame: the shoreline sits on `y = 0`, centered on `x = 0`, and the
 * water reaches towards the viewer to `y = depth`.
 *
 * The shoreline, the waterline, and the wave phases vary from the seeded
 * stream (specification section 17). The wander stays small against the
 * depth, because water hatches read calm.
 */

import { z } from "zod";

import type { Geometry, Path, Point, SeededRng, StyleZone } from "@hatch/core";
import { clipStroke, splineThroughPoints } from "@hatch/geometry";

import type { GenerateOptions, ObjectGenerator } from "./generator.js";
import {
  integerField,
  numberField,
  parseParametersWith,
  spaceDefaults,
  type ParameterSpace,
} from "./parameters.js";
import { WATER_ROLE } from "./roles.js";
import { compoundPath, continuePath, polylinePath, withClose } from "./shapes.js";

/** Anchors along the shoreline and each wave line. */
const EDGE_ANCHORS = 5;

/** The semantic parameters of a water band. */
export const waterParameterSchema = z.object({
  /** Width of the band. */
  width: z.number().finite().min(60).max(2400),
  /** Distance from the shoreline to the near waterline. */
  depth: z.number().finite().min(20).max(800),
  /** Wave lines across the surface. */
  waveLines: z.number().int().min(1).max(12),
  /** Wave height in user units. */
  waveAmplitude: z.number().finite().min(0).max(40),
  /** How much the shoreline and the waterline wander. */
  shoreIrregularity: z.number().finite().min(0).max(1),
  /** The band near the shore that stays flat, as a fraction of the depth. */
  calmBand: z.number().finite().min(0).max(0.9),
});

/** The water parameters. */
export type WaterParameters = z.infer<typeof waterParameterSchema>;

/** The range and the default of every water parameter. */
export const waterParameterSpace: ParameterSpace = {
  width: numberField(60, 2400, 420),
  depth: numberField(20, 800, 110),
  waveLines: integerField(1, 12, 5),
  waveAmplitude: numberField(0, 40, 4),
  shoreIrregularity: numberField(0, 1, 0.15),
  calmBand: numberField(0, 0.9, 0.25),
};

/** The default water parameters. */
export const defaultWaterParameters: WaterParameters =
  waterParameterSchema.parse(spaceDefaults(waterParameterSpace));

/** Anchor positions across the band, 0 at the left edge to 1 at the right. */
function anchorX(position: number, halfWidth: number): number {
  return -halfWidth + position * halfWidth * 2;
}

/** One wave line across the band, clipped to the water area. */
function waveBoundary(
  y: number,
  amplitude: number,
  halfWidth: number,
  water: Path,
  rng: SeededRng,
): Path | null {
  const frequency = rng.float(1.2, 2.4);
  const phase = rng.float(0, Math.PI * 2);
  const anchors: Point[] = [];
  for (let index = 0; index < EDGE_ANCHORS; index += 1) {
    const position = index / (EDGE_ANCHORS - 1);
    anchors.push({
      x: anchorX(position, halfWidth),
      y: y + Math.sin(phase + position * Math.PI * frequency) * amplitude,
    });
  }
  // The pieces the clipper keeps stay together in one compound path, so a
  // wave that leaves and re-enters the band still counts as one line.
  return compoundPath(clipStroke(splineThroughPoints(anchors), water));
}

/**
 * Build the geometry of one water band.
 *
 * Draw order of the stream: per anchor index the shoreline draw then the
 * waterline draw, then per wave line its frequency and phase.
 */
export function generateWater(
  parameters: WaterParameters,
  options: GenerateOptions,
): Geometry {
  const edgeStream = options.rng.fork("water:edges");
  const waveStream = options.rng.fork("water:waves");
  const halfWidth = parameters.width / 2;
  const wander = parameters.depth * 0.08 * parameters.shoreIrregularity;

  const shoreAnchors: Point[] = [];
  const nearAnchors: Point[] = [];
  for (let index = 0; index < EDGE_ANCHORS; index += 1) {
    const position = index / (EDGE_ANCHORS - 1);
    shoreAnchors.push({
      x: anchorX(position, halfWidth),
      y: wander * edgeStream.float(-1, 1),
    });
    nearAnchors.push({
      x: anchorX(position, halfWidth),
      y: parameters.depth + wander * 0.6 * edgeStream.float(-1, 1),
    });
  }

  const shoreline = splineThroughPoints(shoreAnchors);
  const waterline = splineThroughPoints(nearAnchors);
  const waterlineBack = splineThroughPoints([...nearAnchors].reverse());

  // One closed contour: shoreline left to right, down the right edge,
  // waterline right to left, and the close back up the left edge.
  const shoreEnd = shoreAnchors[shoreAnchors.length - 1];
  const nearStart = nearAnchors[nearAnchors.length - 1];
  if (shoreEnd === undefined || nearStart === undefined) {
    throw new Error("the water generator could not place its edges");
  }
  const silhouette = withClose(
    continuePath(
      continuePath(shoreline, polylinePath([shoreEnd, nearStart])),
      waterlineBack,
    ),
  );

  const contours: Path[] = [shoreline, waterline];

  const boundaries: Path[] = [];
  for (let index = 1; index <= parameters.waveLines; index += 1) {
    const share = index / (parameters.waveLines + 1);
    const y = parameters.depth *
      (parameters.calmBand + (1 - parameters.calmBand) * Math.pow(share, 1.3));
    // Waves grow towards the viewer, where the surface reads larger.
    const amplitude = parameters.waveAmplitude * (0.35 + 0.65 * (y / parameters.depth));
    const wave = waveBoundary(y, amplitude, halfWidth, silhouette, waveStream);
    if (wave !== null) {
      boundaries.push(wave);
    }
  }

  const styleZones: StyleZone[] = [
    { role: WATER_ROLE.role, path: silhouette, zIndex: 6 },
  ];

  return { silhouette, contours, internalBoundaries: boundaries, styleZones };
}

/** The water generator of the V1 object registry. */
export const waterGenerator: ObjectGenerator = {
  kind: "water",
  title: "A water band: wandering shoreline, near waterline, and wave lines.",
  zoneRoles: [WATER_ROLE],
  parameterSpace: waterParameterSpace,
  defaultParameters: spaceDefaults(waterParameterSpace),
  parseParameters: (raw) =>
    parseParametersWith("water", waterParameterSchema, waterParameterSpace, raw),
  generate: (parameters, options: GenerateOptions) =>
    generateWater(waterParameterSchema.parse(parameters), options),
};

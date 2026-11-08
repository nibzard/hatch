/**
 * The cliff generator (specification sections 5, 6, 14, and 16).
 *
 * A cliff is a headland in profile: one back slope that rises from inland,
 * a plateau that runs level, and one wave-cut face that drops to the shore
 * (specification sections 5 and 16B name the kind, and section 14 asks for
 * a "dramatic cliff" beside the lighthouse). The headland keeps the
 * mountain zone of a sunlit face, and the wave-cut front carries the rock
 * zone, so the two hatch families the coastal preset tunes for a headland
 * both fill from one object.
 *
 * Local frame: the cliff stands on the line `y = 0`, centered on `x = 0`,
 * and rises towards negative y. The face looks towards positive x unless
 * `faceLeft` mirrors the mass.
 *
 * The slope anchors, the plateau anchors, and the strata vary from the
 * seeded stream (specification section 17).
 */

import { z } from "zod";

import type { Geometry, Path, Point, SeededRng, StyleZone } from "@hatch/core";
import { booleanClip, clipStroke, splineThroughPoints, subtractMasks } from "@hatch/geometry";

import type { GenerateOptions, ObjectGenerator } from "./generator.js";
import {
  booleanField,
  integerField,
  numberField,
  parseParametersWith,
  spaceDefaults,
  type ParameterSpace,
} from "./parameters.js";
import { MOUNTAIN_ROLE, ROCK_ROLE } from "./roles.js";
import { clamp, compoundPath, continuePath, lerp, polylinePath, rectanglePath, withClose } from "./shapes.js";

/** Anchors along the back slope, the plateau, and the face. */
const EDGE_ANCHORS = 5;

/** The semantic parameters of a cliff. */
export const cliffParameterSchema = z.object({
  /** Width of the mass at the base. */
  width: z.number().finite().min(100).max(2400),
  /** Height of the plateau above the base line. */
  height: z.number().finite().min(40).max(900),
  /** The share of the span the plateau runs level for. */
  topShare: z.number().finite().min(0.15).max(0.9),
  /** How far the lip of the face sits inland of its foot, as a share of the height. */
  faceBatter: z.number().finite().min(0).max(0.45),
  /** How jagged the slopes, the plateau, and the face are. */
  ruggedness: z.number().finite().min(0).max(1),
  /** Strata lines across the wave-cut face. */
  strata: z.number().int().min(0).max(5),
  /** Mirror the mass, so the face looks towards negative x. */
  faceLeft: z.boolean(),
});

/** The cliff parameters. */
export type CliffParameters = z.infer<typeof cliffParameterSchema>;

/** The range and the default of every cliff parameter. */
export const cliffParameterSpace: ParameterSpace = {
  width: numberField(100, 2400, 620),
  height: numberField(40, 900, 280),
  topShare: numberField(0.15, 0.9, 0.45),
  faceBatter: numberField(0, 0.45, 0.18),
  ruggedness: numberField(0, 1, 0.4),
  strata: integerField(0, 5, 3),
  faceLeft: booleanField(false),
};

/** The default cliff parameters. */
export const defaultCliffParameters: CliffParameters =
  cliffParameterSchema.parse(spaceDefaults(cliffParameterSpace));

/** Every station of the skyline, in walk order from the back foot. */
interface CliffStations {
  /** The back slope, from the back foot up to the plateau. */
  readonly slope: Point[];
  /** The plateau, level, from the slope top to the lip. */
  readonly plateau: Point[];
  /** The face, from the lip down to the shore foot. */
  readonly face: Point[];
  /** The lip station, where the plateau hands over to the face. */
  readonly lip: Point;
  /** Where the headland zone ends and the face zone starts. */
  readonly splitX: number;
}

/**
 * The stations of one cliff, all inside the frame.
 *
 * The lip sits inland of the foot by the batter, so the face slopes back
 * the way a weathered cliff reads, and the batter never eats the plateau:
 * the setback clamps to a share of the face run.
 */
export function cliffStations(
  parameters: CliffParameters,
  mirror: number,
): CliffStations {
  const halfWidth = parameters.width / 2;
  const span = parameters.width - batterSetback(parameters);
  const slopeRun = span * (1 - parameters.topShare) * 0.35;
  const plateauRun = span * parameters.topShare;
  const plateauLeft = -halfWidth + slopeRun;
  const lipX = -halfWidth + slopeRun + plateauRun;
  return {
    slope: [
      { x: -halfWidth * mirror, y: 0 },
      { x: plateauLeft * mirror, y: -parameters.height },
    ],
    plateau: [
      { x: plateauLeft * mirror, y: -parameters.height },
      { x: lerp(plateauLeft, lipX, 0.5) * mirror, y: -parameters.height },
      { x: lipX * mirror, y: -parameters.height },
    ],
    face: [
      { x: lipX * mirror, y: -parameters.height },
      { x: (lipX + (halfWidth - lipX) * 0.4) * mirror, y: -parameters.height * 0.55 },
      { x: halfWidth * mirror, y: 0 },
    ],
    lip: { x: lipX * mirror, y: -parameters.height },
    splitX: lerp(plateauLeft, lipX, 0.7) * mirror,
  };
}

/** How far the lip sits inland of the foot, after the clamp. */
function batterSetback(parameters: CliffParameters): number {
  return Math.min(parameters.faceBatter * parameters.height, parameters.width * 0.25);
}

/**
 * One jagged run between two stations: every interior vertex displaced
 * sideways by the seeded stream, clamped into the frame of the mass.
 *
 * The displacement runs along the left normal of the segment, so it reads
 * as sideways on the back slope and as up and down on the face.
 */
function jaggedRun(
  from: Point,
  to: Point,
  steps: number,
  amplitude: number,
  bounds: { halfWidth: number; height: number },
  rng: SeededRng,
): Point[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  const normalX = length === 0 ? 0 : -dy / length;
  const normalY = length === 0 ? 0 : dx / length;
  const points: Point[] = [from];
  for (let step = 1; step < steps; step += 1) {
    const share = step / steps;
    const offset = amplitude * (rng.next() * 2 - 1);
    const base = {
      x: lerp(from.x, to.x, share),
      y: lerp(from.y, to.y, share),
    };
    points.push({
      x: clamp(base.x + normalX * offset, -bounds.halfWidth, bounds.halfWidth),
      y: clamp(base.y + normalY * offset, -bounds.height, 0),
    });
  }
  points.push(to);
  return points;
}

/**
 * Build the geometry of one cliff.
 *
 * Draw order of the stream: the slope anchors, the plateau anchors, and the
 * face anchors in walk order, then five wave draws per stratum line.
 */
export function generateCliff(
  parameters: CliffParameters,
  options: GenerateOptions,
): Geometry {
  const edgeStream = options.rng.fork("cliff:edges");
  const stratumStream = options.rng.fork("cliff:strata");
  const mirror = parameters.faceLeft ? -1 : 1;
  const halfWidth = parameters.width / 2;
  const bounds = { halfWidth, height: parameters.height };
  const stations = cliffStations(parameters, mirror);

  const steps = 2 + Math.round(parameters.ruggedness * 4);

  /** Walk one edge station list, jagging between consecutive stations. */
  const walk = (stops: readonly Point[], amplitude: number): Point[] => {
    const first = stops[0];
    if (first === undefined) {
      throw new Error("the cliff generator could not place its edges");
    }
    const points: Point[] = [first];
    for (let index = 1; index < stops.length; index += 1) {
      const from = stops[index - 1];
      const to = stops[index];
      if (from === undefined || to === undefined) {
        continue;
      }
      points.push(
        ...jaggedRun(from, to, steps, amplitude, bounds, edgeStream).slice(1),
      );
    }
    return points;
  };

  // The plateau reads level, so its jitter runs far below the slope and the
  // face, the two lines the weather works.
  const slope = walk(stations.slope, parameters.ruggedness * parameters.height * 0.06);
  const plateau = walk(
    stations.plateau,
    parameters.ruggedness * parameters.height * 0.03,
  );
  const face = walk(stations.face, parameters.ruggedness * parameters.height * 0.04);

  // The skyline runs slope and plateau as one line; the face is its own
  // line, the front the waves cut. The silhouette closes both over the base.
  const skylinePoints = [...slope, ...plateau.slice(1)];
  const skyline = splineThroughPoints(skylinePoints);
  const faceLine = splineThroughPoints(face);
  const silhouette = withClose(continuePath(skyline, faceLine));

  // One cut across the mass divides the headland from the wave-cut front,
  // the same boolean cut the mountain generator takes for its snow cap. The
  // cut reaches past both edges of the mass, so the intersection is whole.
  const faceEdgeX = mirror * halfWidth;
  const faceRect = rectanglePath(
    Math.min(stations.splitX, faceEdgeX),
    -parameters.height * 1.1,
    Math.max(stations.splitX, faceEdgeX),
    parameters.height * 0.1,
  );
  const faceZone = booleanClip(faceRect, silhouette, "intersect");
  const headland =
    faceZone === null ? silhouette : subtractMasks(silhouette, [faceZone]);

  // Strata run across the wave-cut front, near level, the bedding of the
  // rock the sea undercuts.
  const boundaries: Path[] = [];
  if (faceZone !== null) {
    for (let index = 1; index <= parameters.strata; index += 1) {
      const share = index / (parameters.strata + 1);
      const y = -parameters.height * (0.12 + 0.76 * share);
      const anchors: Point[] = [];
      for (let anchor = 0; anchor < EDGE_ANCHORS; anchor += 1) {
        const position = anchor / (EDGE_ANCHORS - 1);
        anchors.push({
          x: lerp(-halfWidth, halfWidth, position),
          y: y + stratumStream.float(-1, 1) * parameters.height * 0.02,
        });
      }
      const stratum = compoundPath(
        clipStroke(splineThroughPoints(anchors), faceZone),
      );
      if (stratum !== null) {
        boundaries.push(stratum);
      }
    }
  }

  const styleZones: StyleZone[] = [
    { role: MOUNTAIN_ROLE.role, path: headland ?? silhouette, zIndex: 8 },
  ];
  if (faceZone !== null) {
    styleZones.push({ role: ROCK_ROLE.role, path: faceZone, zIndex: 9 });
  }

  const contours: Path[] = [skyline, faceLine];
  const split = compoundPath(
    clipStroke(
      polylinePath([
        { x: stations.splitX, y: -parameters.height * 1.1 },
        { x: stations.splitX, y: parameters.height * 0.1 },
      ]),
      silhouette,
    ),
  );
  if (split !== null) {
    // The cut separates the two zones and reads as the drawn edge of the
    // headland over the face, the same double duty the ridge of a mountain
    // draws.
    boundaries.unshift(split);
    contours.push(split);
  }

  return { silhouette, contours, internalBoundaries: boundaries, styleZones };
}

/** The cliff generator of the coastal object registry. */
export const cliffGenerator: ObjectGenerator = {
  kind: "cliff",
  title: "A cliff: back slope, level plateau, and one wave-cut face.",
  zoneRoles: [MOUNTAIN_ROLE, ROCK_ROLE],
  parameterSpace: cliffParameterSpace,
  defaultParameters: spaceDefaults(cliffParameterSpace),
  parseParameters: (raw) =>
    parseParametersWith("cliff", cliffParameterSchema, cliffParameterSpace, raw),
  generate: (parameters, options: GenerateOptions) =>
    generateCliff(cliffParameterSchema.parse(parameters), options),
};

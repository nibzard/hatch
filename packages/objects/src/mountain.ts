/**
 * The mountain generator (specification sections 6 and 24).
 *
 * A mountain is a distant mass (specification section 3A): one skyline of
 * jagged slopes over a flat base, split by a ridge line into a sunlit face
 * and a shaded face, with an optional snow cap left as paper. The hatch
 * families differ per face, so the ridge is the boundary that carries the
 * style (specification section 3B).
 *
 * Local frame: the mountain stands on the line `y = 0`, centered on
 * `x = 0`, and rises towards negative y. The peak is exact, and every
 * jagged vertex stays inside the width and the height, so the bounds of
 * the geometry follow the parameters exactly.
 *
 * The skyline and the ridge vary from the seeded stream (specification
 * section 17): the shoulder heights first, then one displacement per
 * jagged vertex, walked from the left base to the right, then the ridge
 * descent.
 */

import { z } from "zod";

import type { Geometry, Path, Point, SeededRng, StyleZone } from "@hatch/core";
import { booleanClip, clipStroke, subtractMasks } from "@hatch/geometry";

import type { GenerateOptions, ObjectGenerator } from "./generator.js";
import {
  integerField,
  numberField,
  parseParametersWith,
  spaceDefaults,
  type ParameterSpace,
} from "./parameters.js";
import { MOUNTAIN_ROLE, ROCK_ROLE, SNOW_ROLE } from "./roles.js";
import { clamp, compoundPath, polygonPath, polylinePath, rectanglePath } from "./shapes.js";

/** The semantic parameters of a mountain. */
export const mountainParameterSchema = z.object({
  /** Mountain width at the base. */
  width: z.number().finite().min(60).max(2400),
  /** Peak height above the base line. */
  height: z.number().finite().min(40).max(1200),
  /** Where the peak sits on the width: -0.8 leans left, 0.8 leans right. */
  peakPosition: z.number().finite().min(-0.8).max(0.8),
  /** Lower peaks on the shoulders, up to two. */
  secondaryPeaks: z.number().int().min(0).max(2),
  /** How jagged the slopes and the ridge are. */
  ruggedness: z.number().finite().min(0).max(1),
  /** Where the ridge reaches the base, to the right of the peak. */
  ridgeExit: z.number().finite().min(-1).max(1),
  /** Snow cap as a fraction of the height. 0 draws no cap. */
  snowCap: z.number().finite().min(0).max(0.8),
});

/** The mountain parameters. */
export type MountainParameters = z.infer<typeof mountainParameterSchema>;

/** The range and the default of every mountain parameter. */
export const mountainParameterSpace: ParameterSpace = {
  width: numberField(60, 2400, 300),
  height: numberField(40, 1200, 210),
  peakPosition: numberField(-0.8, 0.8, 0),
  secondaryPeaks: integerField(0, 2, 1),
  ruggedness: numberField(0, 1, 0.3),
  ridgeExit: numberField(-1, 1, 0.45),
  snowCap: numberField(0, 0.8, 0),
};

/** The default mountain parameters. */
export const defaultMountainParameters: MountainParameters =
  mountainParameterSchema.parse(spaceDefaults(mountainParameterSpace));

/** Linear interpolation between two points. */
function lerpPoint(from: Point, to: Point, t: number): Point {
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}

/**
 * The jagged run from one station to the next: every interior vertex of
 * the segment displaced sideways by the seeded stream.
 *
 * The run starts at the `from` station, so the caller slices it off when
 * it already holds that station. Vertices stay inside the width and the
 * height of the mountain.
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
  // The left normal of the segment, so the displacement reads as sideways.
  const normalX = length === 0 ? 0 : -dy / length;
  const normalY = length === 0 ? 0 : dx / length;
  const points: Point[] = [from];
  for (let step = 1; step < steps; step += 1) {
    const base = lerpPoint(from, to, step / steps);
    const offset = amplitude * (rng.next() * 2 - 1);
    points.push({
      x: clamp(base.x + normalX * offset, -bounds.halfWidth, bounds.halfWidth),
      y: clamp(base.y + normalY * offset, -bounds.height, 0),
    });
  }
  points.push(to);
  return points;
}

/** The skyline of the mountain: every vertex plus the index of the peak. */
interface Skyline {
  /** Every skyline vertex, left base first, right base last. */
  readonly points: Point[];
  /** The index of the peak in {@link points}. */
  readonly peakIndex: number;
}

/** Build the skyline of stations and jagged runs, left to right. */
function skylineOf(
  parameters: MountainParameters,
  peak: Point,
  rng: SeededRng,
): Skyline {
  const halfWidth = parameters.width / 2;
  const steps = 2 + Math.round(parameters.ruggedness * 4);
  const amplitude = parameters.ruggedness * parameters.height * 0.05;
  const bounds = { halfWidth, height: parameters.height };

  const stations: Point[] = [{ x: -halfWidth, y: 0 }];
  if (parameters.secondaryPeaks >= 2) {
    stations.push({
      x: -halfWidth + (peak.x + halfWidth) * 0.5,
      y: -parameters.height * rng.float(0.3, 0.5),
    });
  }
  // The peak station index, before the peak enters the list.
  const peakStation = stations.length;
  stations.push(peak);
  if (parameters.secondaryPeaks >= 1) {
    stations.push({
      x: peak.x + (halfWidth - peak.x) * 0.5,
      y: -parameters.height * rng.float(0.35, 0.55),
    });
  }
  stations.push({ x: halfWidth, y: 0 });

  const leftBase = stations[0] ?? peak;
  const points: Point[] = [leftBase];
  let peakIndex = 0;
  for (let index = 0; index < stations.length - 1; index += 1) {
    const from = stations[index];
    const to = stations[index + 1];
    if (from === undefined || to === undefined) {
      continue;
    }
    points.push(...jaggedRun(from, to, steps, amplitude, bounds, rng).slice(1));
    if (index + 1 === peakStation) {
      peakIndex = points.length - 1;
    }
  }
  return { points, peakIndex };
}

/** The ridge line from the peak down to the base, as a vertex list. */
function ridgeOf(
  parameters: MountainParameters,
  peak: Point,
  rng: SeededRng,
): Point[] {
  const halfWidth = parameters.width / 2;
  const exit = {
    // The ridge always leaves the base to the right of the peak, so the
    // two faces stay simple areas.
    x: Math.min(
      halfWidth,
      Math.max(parameters.ridgeExit * halfWidth, peak.x + 2),
    ),
    y: 0,
  };
  const shoulder =
    parameters.secondaryPeaks >= 1
      ? { x: peak.x + (halfWidth - peak.x) * 0.5, y: -parameters.height * 0.45 }
      : undefined;

  const points: Point[] = [peak];
  if (shoulder !== undefined) {
    // The saddle sits below both peaks, then the ridge climbs the shoulder.
    points.push(
      {
        x: (peak.x + shoulder.x) / 2,
        y: Math.max(peak.y, shoulder.y) + parameters.height * 0.12,
      },
      shoulder,
    );
  }
  const steps = 2 + Math.round(parameters.ruggedness * 4);
  const amplitude = parameters.ruggedness * parameters.height * 0.025;
  const last = points[points.length - 1] ?? peak;
  const descent = jaggedRun(last, exit, steps, amplitude, {
    halfWidth,
    height: parameters.height,
  }, rng);
  points.push(...descent.slice(1));
  return points;
}

/**
 * Build the geometry of one mountain.
 *
 * The ridge is both an internal boundary and a contour: it separates the
 * two faces, and it reads as a drawn line in this style. The snow line is
 * a boundary only, because the paper edge of the cap reads by contrast.
 */
export function generateMountain(
  parameters: MountainParameters,
  options: GenerateOptions,
): Geometry {
  const stream = options.rng.fork("mountain:skyline");
  const halfWidth = parameters.width / 2;
  const peak: Point = {
    x: parameters.peakPosition * halfWidth,
    y: -parameters.height,
  };

  const skyline = skylineOf(parameters, peak, stream);
  const skylinePoints = skyline.points;
  const peakIndex = skyline.peakIndex;
  const leftSkyline = skylinePoints.slice(0, peakIndex + 1);
  const rightSkyline = [...skylinePoints.slice(peakIndex)].reverse();

  const silhouette = polygonPath(skylinePoints);
  const ridgePoints = ridgeOf(parameters, peak, stream);
  const ridge = polylinePath(ridgePoints);

  // The left face runs the skyline up to the peak and the ridge back down;
  // the closing edge is the base line. The right face mirrors it.
  let leftFace = polygonPath([...leftSkyline, ...ridgePoints.slice(1)]);
  let rightFace = polygonPath([peak, ...ridgePoints.slice(1), ...rightSkyline.slice(0, -1)]);

  const boundaries: Path[] = [ridge];
  const styleZones: StyleZone[] = [];

  if (parameters.snowCap > 0) {
    const snowLineY = -parameters.height * (1 - parameters.snowCap);
    const snowArea = booleanClip(
      rectanglePath(-halfWidth, -parameters.height, halfWidth, snowLineY),
      silhouette,
      "intersect",
    );
    if (snowArea !== null) {
      // The cap stays paper (specification section 3: clouds and snow read
      // as negative space), so it leaves both faces as a cutout.
      const leftUnderSnow = subtractMasks(leftFace, [snowArea]);
      const rightUnderSnow = subtractMasks(rightFace, [snowArea]);
      if (leftUnderSnow !== null) {
        leftFace = leftUnderSnow;
      }
      if (rightUnderSnow !== null) {
        rightFace = rightUnderSnow;
      }
      styleZones.push({ role: SNOW_ROLE.role, path: snowArea, zIndex: 10 });
      const snowLine = compoundPath(
        clipStroke(
          polylinePath([
            { x: -halfWidth, y: snowLineY },
            { x: halfWidth, y: snowLineY },
          ]),
          silhouette,
        ),
      );
      if (snowLine !== null) {
        boundaries.push(snowLine);
      }
    }
  }

  styleZones.unshift(
    { role: MOUNTAIN_ROLE.role, path: leftFace, zIndex: 8 },
    { role: ROCK_ROLE.role, path: rightFace, zIndex: 9 },
  );

  const contours: Path[] = [
    polylinePath(leftSkyline),
    polylinePath(rightSkyline),
    ridge,
  ];

  return { silhouette, contours, internalBoundaries: boundaries, styleZones };
}

/** The mountain generator of the V1 object registry. */
export const mountainGenerator: ObjectGenerator = {
  kind: "mountain",
  title: "A mountain: jagged skyline, ridge line, two faces, and a snow cap.",
  zoneRoles: [MOUNTAIN_ROLE, ROCK_ROLE, SNOW_ROLE],
  parameterSpace: mountainParameterSpace,
  defaultParameters: spaceDefaults(mountainParameterSpace),
  parseParameters: (raw) =>
    parseParametersWith(
      "mountain",
      mountainParameterSchema,
      mountainParameterSpace,
      raw,
    ),
  generate: (parameters, options: GenerateOptions) =>
    generateMountain(mountainParameterSchema.parse(parameters), options),
};

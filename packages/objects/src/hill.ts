/**
 * The hill generator (specification sections 6 and 24).
 *
 * A hill is open ground: one smooth crest above a flat base line, hatched
 * as a striped field (specification section 3A). The semantic parameters
 * map onto a crest spline, an echo contour inside the crest, and strip
 * boundaries that divide the slope the way a mown field reads.
 *
 * Local frame: the hill stands on the line `y = 0`, centered on `x = 0`,
 * and rises towards negative y. The crest always meets the base line at
 * both ends, so the hill is one closed area.
 *
 * The crest height of every interior anchor varies from the seeded stream
 * (specification section 17). The strip lines sit at fractions of the
 * highest anchor, so every strip crosses the hill whatever the jitter
 * drew.
 */

import { z } from "zod";

import type { Geometry, Path, Point, SeededRng, StyleZone } from "@hatch/core";
import { clipStroke, offsetPath, splineThroughPoints } from "@hatch/geometry";

import type { GenerateOptions, ObjectGenerator } from "./generator.js";
import {
  integerField,
  numberField,
  parseParametersWith,
  spaceDefaults,
  type ParameterSpace,
} from "./parameters.js";
import { FIELD_ROLE } from "./roles.js";
import { clamp, compoundPath, withClose } from "./shapes.js";

/** Anchors along one strip line, from the left edge to the right. */
const STRIP_ANCHORS = 5;

/** The semantic parameters of a hill. */
export const hillParameterSchema = z.object({
  /** Hill width at the base. */
  width: z.number().finite().min(40).max(2000),
  /** Crest height above the base line. */
  height: z.number().finite().min(10).max(600),
  /** Anchors along the crest, including both ends. */
  crestAnchors: z.number().int().min(3).max(12),
  /** How much the crest anchors vary in height. */
  crestIrregularity: z.number().finite().min(0).max(1),
  /** Where the crest peaks: -1 leans left, 0 centers, 1 leans right. */
  lean: z.number().finite().min(-1).max(1),
  /** Strip boundaries drawn across the slope. */
  strips: z.number().int().min(1).max(4),
});

/** The hill parameters. */
export type HillParameters = z.infer<typeof hillParameterSchema>;

/** The range and the default of every hill parameter. */
export const hillParameterSpace: ParameterSpace = {
  width: numberField(40, 2000, 320),
  height: numberField(10, 600, 70),
  crestAnchors: integerField(3, 12, 5),
  crestIrregularity: numberField(0, 1, 0.25),
  lean: numberField(-1, 1, 0),
  strips: integerField(1, 4, 2),
};

/** The default hill parameters. */
export const defaultHillParameters: HillParameters = hillParameterSchema.parse(
  spaceDefaults(hillParameterSpace),
);

/**
 * The crest height at one position, as a fraction of the highest crest.
 *
 * `position` runs from 0 at the left end to 1 at the right end. The bump
 * rises to 1 at the lean position and falls to 0 at both ends, so the
 * crest always meets the base line.
 */
function bumpAt(position: number, peakPosition: number): number {
  if (position <= peakPosition) {
    return Math.pow(position / peakPosition, 1.6);
  }
  return Math.pow((1 - position) / (1 - peakPosition), 1.6);
}

/** The crest anchors, one spline-ready list from the left end to the right. */
function crestAnchorsOf(
  parameters: HillParameters,
  rng: SeededRng,
): { anchors: Point[]; crestHeight: number } {
  const halfWidth = parameters.width / 2;
  const last = parameters.crestAnchors - 1;
  const peakPosition = clamp(0.5 + parameters.lean * 0.35, 0.15, 0.85);
  const anchors: Point[] = [];
  let crestHeight = 0;
  for (let index = 0; index < parameters.crestAnchors; index += 1) {
    const position = index / last;
    const x = -halfWidth + position * parameters.width;
    // Both ends sit on the base line whatever the lean and the jitter.
    if (index === 0 || index === last) {
      anchors.push({ x, y: 0 });
      continue;
    }
    const height =
      parameters.height *
      bumpAt(position, peakPosition) *
      (1 - parameters.crestIrregularity * rng.next());
    crestHeight = Math.max(crestHeight, height);
    anchors.push({ x, y: -height });
  }
  return { anchors, crestHeight };
}

/**
 * One strip boundary: a slightly wavy line across the slope, clipped to
 * the hill area.
 *
 * The pieces the clipper keeps stay together in one compound path, so a
 * strip that leaves and re-enters the hill on its way across still counts
 * as one boundary.
 */
function stripBoundary(
  y: number,
  halfWidth: number,
  waviness: number,
  hill: Path,
  rng: SeededRng,
): Path | null {
  const anchors: Point[] = [];
  for (let index = 0; index < STRIP_ANCHORS; index += 1) {
    const position = index / (STRIP_ANCHORS - 1);
    anchors.push({
      x: -halfWidth + position * halfWidth * 2,
      y: y + rng.float(-waviness, waviness),
    });
  }
  const wave = splineThroughPoints(anchors);
  return compoundPath(clipStroke(wave, hill));
}

/**
 * Build the geometry of one hill.
 *
 * Draw order of the stream: one height draw per interior crest anchor,
 * then five wave draws per strip.
 */
export function generateHill(
  parameters: HillParameters,
  options: GenerateOptions,
): Geometry {
  const crestStream = options.rng.fork("hill:crest");
  const stripStream = options.rng.fork("hill:strips");
  const halfWidth = parameters.width / 2;
  const { anchors, crestHeight } = crestAnchorsOf(parameters, crestStream);

  const crest = splineThroughPoints(anchors);
  const silhouette = withClose(crest);

  const contours: Path[] = [crest];
  const echo = offsetPath(silhouette, -Math.max(2, parameters.height * 0.25));
  if (echo !== null) {
    contours.push(echo);
  }

  const waviness = Math.min(2, parameters.height * 0.04);
  const boundaries: Path[] = [];
  for (let index = 1; index <= parameters.strips; index += 1) {
    // The strips divide the slope by the height the crest actually
    // reached, so every strip crosses the hill whatever the jitter drew.
    const y = -crestHeight * (index / (parameters.strips + 1)) * 0.9;
    const strip = stripBoundary(y, halfWidth, waviness, silhouette, stripStream);
    if (strip !== null) {
      boundaries.push(strip);
    }
  }

  const styleZones: StyleZone[] = [
    { role: FIELD_ROLE.role, path: silhouette, zIndex: 5 },
  ];

  return { silhouette, contours, internalBoundaries: boundaries, styleZones };
}

/** The hill generator of the V1 object registry. */
export const hillGenerator: ObjectGenerator = {
  kind: "hill",
  title: "A hill: smooth crest over a flat base, divided into strips.",
  zoneRoles: [FIELD_ROLE],
  parameterSpace: hillParameterSpace,
  defaultParameters: spaceDefaults(hillParameterSpace),
  parseParameters: (raw) =>
    parseParametersWith("hill", hillParameterSchema, hillParameterSpace, raw),
  generate: (parameters, options: GenerateOptions) =>
    generateHill(hillParameterSchema.parse(parameters), options),
};

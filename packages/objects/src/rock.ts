/**
 * The rock generator (specification sections 5, 6, and 16).
 *
 * A rock is one sea-worn mass: a lobed crest over a flat base line, split
 * by the cracks the weather opened (specification sections 5 and 16C name
 * the kind, and section 1 sits it under the lighthouse). The whole mass
 * keeps the rock zone, the hardest hatch of the style, so a boulder reads
 * denser than the ground it sits on.
 *
 * Local frame: the rock stands on the line `y = 0`, centered on `x = 0`,
 * and the mass grows towards negative y. The base stays level, so the rock
 * reads as settled on the ground.
 *
 * The lobe anchors, the wash line, and the cracks vary from the seeded
 * stream (specification section 17).
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
import { ROCK_ROLE } from "./roles.js";
import { clamp, compoundPath, lerp, polylinePath, withClose } from "./shapes.js";

/** The semantic parameters of a rock. */
export const rockParameterSchema = z.object({
  /** Widest span of the mass. */
  width: z.number().finite().min(20).max(420),
  /** Crest height above the base line. */
  height: z.number().finite().min(14).max(320),
  /** Lobes around the crest, including both ends. */
  lobes: z.number().int().min(5).max(12),
  /** How much the lobes vary in reach. */
  irregularity: z.number().finite().min(0).max(0.7),
  /** Cracks drawn from the crest towards the base. */
  cracks: z.number().int().min(0).max(3),
});

/** The rock parameters. */
export type RockParameters = z.infer<typeof rockParameterSchema>;

/** The range and the default of every rock parameter. */
export const rockParameterSpace: ParameterSpace = {
  width: numberField(20, 420, 120),
  height: numberField(14, 320, 70),
  lobes: integerField(5, 12, 8),
  irregularity: numberField(0, 0.7, 0.3),
  cracks: integerField(0, 3, 1),
};

/** The default rock parameters. */
export const defaultRockParameters: RockParameters =
  rockParameterSchema.parse(spaceDefaults(rockParameterSpace));

/**
 * The crest anchors, one half ellipse from the left base corner over the
 * top to the right base corner, each lobed by the seeded stream.
 */
function crestAnchorsOf(
  parameters: RockParameters,
  rng: SeededRng,
): Point[] {
  const halfWidth = parameters.width / 2;
  const last = parameters.lobes - 1;
  const anchors: Point[] = [];
  for (let index = 0; index < parameters.lobes; index += 1) {
    const angle = Math.PI * (1 - index / last);
    // Both ends sit on the base line whatever the lobes drew, so the mass
    // stays grounded and the base closes level.
    if (index === 0 || index === last) {
      anchors.push({ x: index === 0 ? -halfWidth : halfWidth, y: 0 });
      continue;
    }
    const wobble = 1 + parameters.irregularity * (rng.next() * 2 - 1);
    anchors.push({
      x: clamp(Math.cos(angle) * halfWidth * wobble, -halfWidth, halfWidth),
      y: clamp(-Math.sin(angle) * parameters.height * wobble, -parameters.height, 0),
    });
  }
  return anchors;
}

/**
 * One crack: a kinked line from high on the mass down towards the base,
 * clipped to the silhouette so it never leaves the rock.
 */
function crackBoundary(
  parameters: RockParameters,
  rock: Path,
  rng: SeededRng,
): Path | null {
  const halfWidth = parameters.width / 2;
  const startX = lerp(-halfWidth * 0.7, halfWidth * 0.7, rng.next());
  const drift = rng.float(-0.25, 0.25) * halfWidth;
  const jog = rng.float(-0.12, 0.12) * halfWidth;
  return compoundPath(
    clipStroke(
      polylinePath([
        { x: startX, y: -parameters.height * 0.85 },
        { x: startX + drift / 2 + jog, y: -parameters.height * 0.45 },
        { x: startX + drift, y: 0 },
      ]),
      rock,
    ),
  );
}

/**
 * The wash line: the level mark the tide leaves near the foot of the mass,
 * the one boundary every sea rock carries. Clipped to the silhouette, so it
 * spans only the rock.
 */
function washBoundary(
  parameters: RockParameters,
  rock: Path,
  rng: SeededRng,
): Path | null {
  const halfWidth = parameters.width / 2;
  const y = -parameters.height * 0.2;
  const anchors: Point[] = [];
  for (let index = 0; index < 5; index += 1) {
    const position = index / 4;
    anchors.push({
      x: lerp(-halfWidth, halfWidth, position),
      y: y + rng.float(-1, 1) * parameters.height * 0.02,
    });
  }
  return compoundPath(clipStroke(splineThroughPoints(anchors), rock));
}

/**
 * Build the geometry of one rock.
 *
 * Draw order of the stream: one wobble per crest anchor in angle order,
 * then the wash line, then one share, drift, and jog draw per crack.
 */
export function generateRock(
  parameters: RockParameters,
  options: GenerateOptions,
): Geometry {
  const lobeStream = options.rng.fork("rock:lobes");
  const washStream = options.rng.fork("rock:wash");
  const crackStream = options.rng.fork("rock:cracks");
  const anchors = crestAnchorsOf(parameters, lobeStream);

  const crest = splineThroughPoints(anchors);
  const silhouette = withClose(crest);

  // One echo inside the mass gives the rounded form its reading line, the
  // same echo the hill generator draws.
  const contours: Path[] = [crest];
  const echo = offsetPath(silhouette, -Math.max(2, parameters.height * 0.25));
  if (echo !== null) {
    contours.push(echo);
  }

  const boundaries: Path[] = [];
  const wash = washBoundary(parameters, silhouette, washStream);
  if (wash !== null) {
    boundaries.push(wash);
  }
  for (let index = 0; index < parameters.cracks; index += 1) {
    const crack = crackBoundary(parameters, silhouette, crackStream);
    if (crack !== null) {
      boundaries.push(crack);
    }
  }

  const styleZones: StyleZone[] = [
    { role: ROCK_ROLE.role, path: silhouette, zIndex: 7 },
  ];

  return { silhouette, contours, internalBoundaries: boundaries, styleZones };
}

/** The rock generator of the coastal object registry. */
export const rockGenerator: ObjectGenerator = {
  kind: "rock",
  title: "A rock: lobed crest over a level base, split by cracks.",
  zoneRoles: [ROCK_ROLE],
  parameterSpace: rockParameterSpace,
  defaultParameters: spaceDefaults(rockParameterSpace),
  parseParameters: (raw) =>
    parseParametersWith("rock", rockParameterSchema, rockParameterSpace, raw),
  generate: (parameters, options: GenerateOptions) =>
    generateRock(rockParameterSchema.parse(parameters), options),
};

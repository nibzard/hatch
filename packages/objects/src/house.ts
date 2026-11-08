/**
 * The house generator (specification sections 6 and 24).
 *
 * A house is "geometric primitives with minimal detail" (specification
 * section 3C): one wall block, one gabled roof, an optional chimney, a
 * door, and a row of windows. The semantic parameters of section 6 - roof
 * pitch, width and height, windows, chimney, door - map onto a silhouette,
 * contour lines, internal boundaries, and style zones (section 6).
 *
 * Local frame: the ground line is `y = 0`, the house stands on it centered
 * on `x = 0`, and the mass grows towards negative y.
 *
 * Buildings stay controlled (specification section 17), so this generator
 * draws no random number: two houses with the same parameters are
 * identical, and the variety of a scene comes from parameters and
 * placement.
 */

import { z } from "zod";

import type { Geometry, Path, Point, StyleZone } from "@hatch/core";
import { booleanClip, subtractMasks, unitePaths } from "@hatch/geometry";

import type { GenerateOptions, ObjectGenerator } from "./generator.js";
import {
  booleanField,
  integerField,
  numberField,
  parseParametersWith,
  spaceDefaults,
  type ParameterSpace,
} from "./parameters.js";
import { ARCHITECTURE_ROLE, ROOF_ROLE } from "./roles.js";
import { clamp, polygonPath, polylinePath, rectanglePath } from "./shapes.js";

/** One axis-aligned rectangle, for cutouts and frames. */
interface Rect {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/** True when two rectangles share area. */
function rectsOverlap(left: Rect, right: Rect): boolean {
  return (
    left.minX < right.maxX &&
    right.minX < left.maxX &&
    left.minY < right.maxY &&
    right.minY < left.maxY
  );
}

/** One closed rectangle path. */
function rectPath(rect: Rect): Path {
  return rectanglePath(rect.minX, rect.minY, rect.maxX, rect.maxY);
}

/**
 * The window slots of the front wall, ordered from the middle outwards.
 *
 * The fractions sit on the half width, so the door in the middle keeps its
 * clearance on both sides.
 */
const WINDOW_SLOTS = [-0.45, 0.45, -0.68, 0.68, -0.88, 0.88] as const;

/** The semantic parameters of a house (specification section 6). */
export const houseParameterSchema = z.object({
  /** Wall width in user units. */
  width: z.number().finite().min(20).max(600),
  /** Wall height from the ground to the eaves. */
  wallHeight: z.number().finite().min(12).max(400),
  /** Roof rise over run: the apex rises by width / 2 times the pitch. */
  roofPitch: z.number().finite().min(0.15).max(3),
  /** Eave overhang past the walls, as a fraction of the width. */
  overhang: z.number().finite().min(0).max(0.25),
  /** Draw a chimney on the right roof plane. */
  chimney: z.boolean(),
  /** Draw a door in the middle of the wall. */
  door: z.boolean(),
  /** Windows on the front wall, up to six. */
  windows: z.number().int().min(0).max(6),
});

/** The house parameters. */
export type HouseParameters = z.infer<typeof houseParameterSchema>;

/** The range and the default of every house parameter. */
export const houseParameterSpace: ParameterSpace = {
  width: numberField(20, 600, 120),
  wallHeight: numberField(12, 400, 72),
  roofPitch: numberField(0.15, 3, 0.65),
  overhang: numberField(0, 0.25, 0.08),
  chimney: booleanField(true),
  door: booleanField(true),
  windows: integerField(0, 6, 2),
};

/** The default house parameters. */
export const defaultHouseParameters: HouseParameters = houseParameterSchema.parse(
  spaceDefaults(houseParameterSpace),
);

/** The gabled roof: one triangle from eave to apex to eave. */
function gableRoof(eave: number, wallTop: number, apex: Point): Path {
  return polygonPath([
    { x: -eave, y: wallTop },
    apex,
    { x: eave, y: wallTop },
  ]);
}

/** The chimney block and the style zone above the roof surface. */
interface ChimneyPieces {
  /** The full chimney block, united into the silhouette. */
  readonly block: Path;
  /** The part of the block above the roof, as a style zone. */
  readonly zone?: StyleZone;
  /** Left and right edge of the block. */
  readonly minX: number;
  readonly maxX: number;
  /** The top edge of the block. */
  readonly topY: number;
}

/**
 * Place the chimney on the right roof plane.
 *
 * The block reaches into the roof, so the silhouette union has no gap. The
 * style zone is the part above the roof surface, cut by a boolean
 * operation. Returns `null` when the parameters leave no room for it.
 */
function chimneyPieces(
  parameters: HouseParameters,
  eave: number,
  wallTop: number,
  apex: Point,
): ChimneyPieces | null {
  if (!parameters.chimney) {
    return null;
  }
  const width = clamp(parameters.width * 0.12, 6, 30);
  const center = Math.min((parameters.width / 2) * 0.45, eave * 0.92 - width / 2);
  if (center - width / 2 <= 0) {
    return null;
  }
  // The roof surface at the chimney center, interpolated along the slope.
  const slopeY = apex.y + (center / eave) * (wallTop - apex.y);
  // The chimney stays a little below the peak, the way a chimney on a
  // roof plane reads, and needs some roof below it to stand on.
  const rise = Math.min(
    clamp(parameters.wallHeight * 0.35, 8, 60),
    slopeY - (apex.y + 4),
  );
  if (rise < 6) {
    return null;
  }
  const topY = slopeY - rise;
  const block = rectanglePath(
    center - width / 2,
    topY,
    center + width / 2,
    slopeY + width * 0.5,
  );
  const aboveRoof = booleanClip(block, gableRoof(eave, wallTop, apex), "subtract");
  const zone: StyleZone | null =
    aboveRoof === null
      ? null
      : { role: ARCHITECTURE_ROLE.role, path: aboveRoof, zIndex: 14 };
  return {
    block,
    ...(zone === null ? {} : { zone }),
    minX: center - width / 2,
    maxX: center + width / 2,
    topY,
  };
}

/**
 * The door and the windows of the front wall.
 *
 * A window keeps its slot only when it fits inside the wall and clears the
 * door and every window placed before it, so a narrow house draws fewer
 * windows than asked for.
 */
function openingsOf(
  parameters: HouseParameters,
  halfWidth: number,
  wallHeight: number,
): Rect[] {
  const placed: Rect[] = [];
  if (parameters.door) {
    const width = clamp(parameters.width * 0.16, 8, 60);
    const height = Math.max(6, Math.min(wallHeight * 0.62, wallHeight - 4));
    placed.push({ minX: -width / 2, minY: -height, maxX: width / 2, maxY: 0 });
  }
  let windowsPlaced = 0;
  if (parameters.windows > 0) {
    const width = clamp(parameters.width * 0.12, 6, 40);
    const height = Math.min(width * 1.25, wallHeight * 0.4);
    const centerY = -wallHeight * 0.5;
    for (const slot of WINDOW_SLOTS) {
      if (windowsPlaced >= parameters.windows) {
        break;
      }
      const center = slot * halfWidth;
      const candidate: Rect = {
        minX: center - width / 2,
        minY: centerY - height / 2,
        maxX: center + width / 2,
        maxY: centerY + height / 2,
      };
      const inside =
        candidate.minX >= -halfWidth + 1 &&
        candidate.maxX <= halfWidth - 1 &&
        candidate.minY >= -wallHeight + 2 &&
        candidate.maxY <= -2;
      if (inside && placed.every((rect) => !rectsOverlap(rect, candidate))) {
        placed.push(candidate);
        windowsPlaced += 1;
      }
    }
  }
  return placed;
}

/**
 * Build the geometry of one house.
 *
 * The options carry the seeded stream every generator receives and the
 * object grammar of the style. The house keeps its lines straight, so it
 * never draws from the stream (specification section 17). It reads one
 * grammar field, `keepNegativeSpace`: the openings are the paper the
 * object keeps, so the grammar decides whether the wall zone hatches
 * across them or leaves them as cutouts (specification section 3C). The
 * opening rectangles draw either way, subject to the detail budget the
 * facade enforces, so a style that fills its windows still draws their
 * frames.
 */
export function generateHouse(
  parameters: HouseParameters,
  options?: GenerateOptions,
): Geometry {
  const halfWidth = parameters.width / 2;
  const eave = halfWidth + parameters.width * parameters.overhang;
  const wallTop = -parameters.wallHeight;
  const apexRise = halfWidth * parameters.roofPitch;
  const apex: Point = { x: 0, y: wallTop - apexRise };

  const wall = rectanglePath(-halfWidth, wallTop, halfWidth, 0);
  const roof = gableRoof(eave, wallTop, apex);
  const chimney = chimneyPieces(parameters, eave, wallTop, apex);

  const silhouette = unitePaths(
    chimney === null ? [wall, roof] : [wall, roof, chimney.block],
  );
  if (silhouette === null) {
    throw new Error("the house generator could not unite its silhouette");
  }

  const openings = openingsOf(parameters, halfWidth, parameters.wallHeight);
  // The grammar decides whether the openings stay paper: `keepNegativeSpace`
  // false fills the wall across them, the one opening decision a generator
  // owns, because the subtraction happens while the zone is built
  // (specification sections 3C and 8).
  const keepNegativeSpace = options?.grammar?.keepNegativeSpace !== false;
  const wallZone = keepNegativeSpace
    ? subtractMasks(wall, openings.map(rectPath))
    : null;

  const contours: Path[] = [
    polylinePath([
      { x: -eave, y: wallTop },
      apex,
    ]),
    polylinePath([
      apex,
      { x: eave, y: wallTop },
    ]),
    polylinePath([
      { x: -halfWidth, y: 0 },
      { x: -halfWidth, y: wallTop },
    ]),
    polylinePath([
      { x: halfWidth, y: wallTop },
      { x: halfWidth, y: 0 },
    ]),
    polylinePath([
      { x: -halfWidth, y: 0 },
      { x: halfWidth, y: 0 },
    ]),
  ];
  if (chimney !== null) {
    contours.push(
      polylinePath([
        { x: chimney.minX, y: chimney.topY },
        { x: chimney.maxX, y: chimney.topY },
      ]),
    );
  }

  const boundaries: Path[] = [
    // The eaves line separates the wall zone from the roof zone. It spans
    // the overhang, which reads as the underline of the roof.
    polylinePath([
      { x: -eave, y: wallTop },
      { x: eave, y: wallTop },
    ]),
    ...openings.map(rectPath),
  ];

  const styleZones: StyleZone[] = [
    { role: ARCHITECTURE_ROLE.role, path: wallZone ?? wall, zIndex: 10 },
    { role: ROOF_ROLE.role, path: roof, zIndex: 12 },
  ];
  if (chimney?.zone !== undefined) {
    styleZones.push(chimney.zone);
  }

  return { silhouette, contours, internalBoundaries: boundaries, styleZones };
}

/** The house generator of the V1 object registry. */
export const houseGenerator: ObjectGenerator = {
  kind: "house",
  title: "A cottage: wall block, gabled roof, chimney, door, and windows.",
  zoneRoles: [ARCHITECTURE_ROLE, ROOF_ROLE],
  parameterSpace: houseParameterSpace,
  defaultParameters: spaceDefaults(houseParameterSpace),
  parseParameters: (raw) =>
    parseParametersWith(
      "house",
      houseParameterSchema,
      houseParameterSpace,
      raw,
    ),
  generate: (parameters, options: GenerateOptions) =>
    generateHouse(houseParameterSchema.parse(parameters), options),
};

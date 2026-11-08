/**
 * The bench generator (specification sections 6, 11, and 24).
 *
 * A bench is a seat slab on legs, with a backrest that leans back when the
 * scene asks for one. The seat and the backrest are wood, the legs are
 * metal, so the bench is the one round 2 object that splits its zones
 * between two materials.
 *
 * Local frame: the legs stand on the line `y = 0`, the bench is centered on
 * `x = 0`, the seat faces towards negative x, and the backrest rises at
 * positive x. The mass grows towards negative y.
 *
 * Benches stay controlled (specification section 17), so this generator
 * draws no random number.
 */

import { z } from "zod";

import type { Geometry, Path, StyleZone } from "@hatch/core";
import { unitePaths } from "@hatch/geometry";

import type { ObjectGenerator } from "./generator.js";
import {
  integerField,
  numberField,
  parseParametersWith,
  spaceDefaults,
  type ParameterSpace,
} from "./parameters.js";
import { ARCHITECTURE_ROLE, METAL_ROLE } from "./roles.js";
import {
  clamp,
  limbPolygon,
  polylinePath,
  roundedRectanglePath,
} from "./shapes.js";

/** The semantic parameters of a bench (specification section 6). */
export const benchParameterSchema = z.object({
  /** Seat span from the front edge to the backrest. */
  width: z.number().finite().min(60).max(600),
  /** Seat height above the ground. */
  seatHeight: z.number().finite().min(20).max(120),
  /** Backrest height above the seat. 0 draws a backless bench. */
  backHeight: z.number().finite().min(0).max(150),
  /** Seat slats across the seat, drawn as boundary lines. */
  slats: z.number().int().min(1).max(5),
  /** Leg frames under the seat. */
  legs: z.number().int().min(2).max(4),
});

/** The bench parameters. */
export type BenchParameters = z.infer<typeof benchParameterSchema>;

/** The range and the default of every bench parameter. */
export const benchParameterSpace: ParameterSpace = {
  width: numberField(60, 600, 180),
  seatHeight: numberField(20, 120, 44),
  backHeight: numberField(0, 150, 46),
  slats: integerField(1, 5, 3),
  legs: integerField(2, 4, 2),
};

/** The default bench parameters. */
export const defaultBenchParameters: BenchParameters =
  benchParameterSchema.parse(spaceDefaults(benchParameterSpace));

/**
 * Build the geometry of one bench.
 *
 * The bench draws no random number: built structures stay controlled
 * (specification section 17).
 */
export function generateBench(parameters: BenchParameters): Geometry {
  const halfWidth = parameters.width / 2;
  const seatThickness = clamp(parameters.width * 0.05, 6, 16);
  const seatTop = -parameters.seatHeight - seatThickness;
  const legWidth = clamp(parameters.width * 0.04, 4, 14);

  const legs: Path[] = [];
  for (let index = 0; index < parameters.legs; index += 1) {
    const share = (index + 0.5) / parameters.legs;
    const x = -halfWidth + share * parameters.width;
    legs.push(
      limbPolygon(
        { x, y: 0 },
        { x, y: -parameters.seatHeight },
        legWidth,
        legWidth * 0.75,
      ),
    );
  }

  const seat = roundedRectanglePath(
    -halfWidth,
    seatTop,
    halfWidth,
    -parameters.seatHeight,
    seatThickness * 0.3,
  );

  const woodParts: Path[] = [seat];
  // The backrest leans back from the rear edge of the seat, the way a park
  // bench reads in profile.
  if (parameters.backHeight > 0) {
    woodParts.push(
      limbPolygon(
        { x: halfWidth - seatThickness / 2, y: -parameters.seatHeight },
        {
          x: halfWidth - seatThickness / 2 + parameters.backHeight * 0.18,
          y: -parameters.seatHeight - parameters.backHeight,
        },
        seatThickness,
        seatThickness * 0.8,
      ),
    );
  }

  const silhouette = unitePaths([...woodParts, ...legs]);
  if (silhouette === null) {
    throw new Error("the bench generator could not unite its silhouette");
  }

  const contours: Path[] = [
    polylinePath([
      { x: -halfWidth, y: seatTop },
      { x: halfWidth, y: seatTop },
    ]),
    polylinePath([
      { x: -halfWidth, y: -parameters.seatHeight },
      { x: -halfWidth, y: 0 },
    ]),
  ];
  if (parameters.backHeight > 0) {
    contours.push(
      polylinePath([
        { x: halfWidth - seatThickness / 2, y: -parameters.seatHeight },
        {
          x: halfWidth - seatThickness / 2 + parameters.backHeight * 0.18,
          y: -parameters.seatHeight - parameters.backHeight,
        },
      ]),
    );
  }

  // The slat lines divide the seat into boards, the read of planed wood.
  const boundaries: Path[] = [];
  for (let index = 1; index <= parameters.slats; index += 1) {
    const share = index / (parameters.slats + 1);
    boundaries.push(
      polylinePath([
        { x: -halfWidth + 2, y: seatTop + seatThickness * share },
        { x: halfWidth - 2, y: seatTop + seatThickness * share },
      ]),
    );
  }
  for (const leg of legs) {
    boundaries.push(leg);
  }

  const styleZones: StyleZone[] = [
    { role: ARCHITECTURE_ROLE.role, path: unitePaths(woodParts) ?? seat, zIndex: 10 },
  ];
  const legZone = unitePaths(legs);
  if (legZone !== null) {
    styleZones.push({ role: METAL_ROLE.role, path: legZone, zIndex: 11 });
  }

  return { silhouette, contours, internalBoundaries: boundaries, styleZones };
}

/** The bench generator of the round 2 object registry. */
export const benchGenerator: ObjectGenerator = {
  kind: "bench",
  title: "A bench: seat slab on metal legs, with a leaning backrest.",
  zoneRoles: [ARCHITECTURE_ROLE, METAL_ROLE],
  parameterSpace: benchParameterSpace,
  defaultParameters: spaceDefaults(benchParameterSpace),
  parseParameters: (raw) =>
    parseParametersWith("bench", benchParameterSchema, benchParameterSpace, raw),
  generate: (parameters) =>
    generateBench(benchParameterSchema.parse(parameters)),
};

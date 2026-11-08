/**
 * The car generator (specification sections 6, 11, and 24).
 *
 * A car in profile is one body slab with a cabin on top, a glazed band
 * split by pillars, and two wheels. The body is built surface, the glazing
 * is glass, and the wheels are metal, the same three roles the tram uses,
 * so a street scene keeps one material vocabulary.
 *
 * Local frame: the wheels rest on the line `y = 0`, the car is centered on
 * `x = 0`, and it faces towards negative x.
 *
 * Vehicles stay controlled (specification section 17), so this generator
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
import { ARCHITECTURE_ROLE, GLASS_ROLE, METAL_ROLE } from "./roles.js";
import {
  clamp,
  compoundPath,
  discPath,
  polygonPath,
  polylinePath,
  roundedRectanglePath,
} from "./shapes.js";

/** The semantic parameters of a car (specification section 6). */
export const carParameterSchema = z.object({
  /** Body length in profile. */
  length: z.number().finite().min(80).max(700),
  /** Body height from the sill to the shoulder line. */
  bodyHeight: z.number().finite().min(30).max(160),
  /** Cabin height above the shoulder line, as a share of the body height. */
  cabin: z.number().finite().min(0).max(1),
  /** Side windows, split by pillars. */
  windows: z.number().int().min(0).max(4),
  /** Wheel radius. */
  wheelRadius: z.number().finite().min(8).max(50),
});

/** The car parameters. */
export type CarParameters = z.infer<typeof carParameterSchema>;

/** The range and the default of every car parameter. */
export const carParameterSpace: ParameterSpace = {
  length: numberField(80, 700, 220),
  bodyHeight: numberField(30, 160, 58),
  cabin: numberField(0, 1, 0.55),
  windows: integerField(0, 4, 2),
  wheelRadius: numberField(8, 50, 22),
};

/** The default car parameters. */
export const defaultCarParameters: CarParameters =
  carParameterSchema.parse(spaceDefaults(carParameterSpace));

/**
 * Build the geometry of one car.
 *
 * The car draws no random number: vehicles stay controlled
 * (specification section 17).
 */
export function generateCar(parameters: CarParameters): Geometry {
  const halfLength = parameters.length / 2;
  const radius = Math.min(
    parameters.wheelRadius,
    parameters.length * 0.12,
    parameters.bodyHeight * 0.6,
  );
  const sill = -radius * 1.3;
  const shoulder = sill - parameters.bodyHeight;
  const cabinHeight = parameters.bodyHeight * parameters.cabin;
  const roof = shoulder - cabinHeight;

  // The wheels sit inside the body length with a margin of their own
  // radius, so a short car rolls on smaller wheels before it drops any.
  const axle = Math.min(halfLength * 0.62, halfLength - radius - 2);
  const wheels = [-axle, axle].map((x) =>
    discPath({ x, y: -radius }, radius),
  );

  // The body runs sill to shoulder with rounded corners, the read of one
  // pressed panel.
  const body = roundedRectanglePath(
    -halfLength,
    shoulder,
    halfLength,
    sill,
    clamp(parameters.bodyHeight * 0.14, 2, 14),
  );

  // The cabin is one trapezoid: the rear glass stands, the windscreen
  // slopes away towards the nose. A cabin share too small to draw leaves a
  // delivery profile instead of a degenerate quad.
  const cabinRoofFront = halfLength * 0.18;
  const cabinRoofRear = -halfLength * 0.42;
  const hasCabin = cabinHeight >= 4;
  const cabin = hasCabin
    ? polygonPath([
        { x: -halfLength * 0.52, y: shoulder },
        { x: cabinRoofRear, y: roof },
        { x: cabinRoofFront, y: roof },
        { x: halfLength * 0.52, y: shoulder },
      ])
    : null;

  const silhouette = unitePaths([
    body,
    ...(cabin === null ? [] : [cabin]),
    ...wheels,
  ]);
  if (silhouette === null) {
    throw new Error("the car generator could not unite its silhouette");
  }

  const contours: Path[] = [
    polylinePath([
      { x: -halfLength, y: shoulder },
      { x: halfLength, y: shoulder },
    ]),
    polylinePath([
      { x: -halfLength, y: sill },
      { x: halfLength, y: sill },
    ]),
    ...wheels,
  ];

  // The axle line joins the wheel hubs, the one interior line every car
  // keeps whatever its glazing.
  const boundaries: Path[] = [
    polylinePath([
      { x: -axle, y: -radius },
      { x: axle, y: -radius },
    ]),
  ];
  const panes: Path[] = [];
  const bandTop = roof + cabinHeight * 0.18;
  const bandBottom = shoulder - cabinHeight * 0.16;
  const slots = Math.max(parameters.windows, 1);
  const span = cabinRoofFront - cabinRoofRear;
  if (hasCabin) {
    for (let index = 0; index < parameters.windows; index += 1) {
      const share = (index + 0.5) / slots;
      const centerX = cabinRoofRear + span * share;
      const cellWidth = (span / slots) * 0.66;
      // The band tapers with the cabin, so the pane follows the roof line in.
      const taper = 1 - ((bandTop - roof) / Math.max(cabinHeight, 1)) * 0.4;
      panes.push(
        polygonPath([
          { x: centerX - cellWidth / 2, y: bandBottom },
          { x: centerX - (cellWidth / 2) * taper, y: bandTop },
          { x: centerX + (cellWidth / 2) * taper, y: bandTop },
          { x: centerX + cellWidth / 2, y: bandBottom },
        ]),
      );
    }
  }
  const frames = compoundPath(panes);
  if (frames !== null) {
    boundaries.push(frames);
  }

  const styleZones: StyleZone[] = [
    {
      role: ARCHITECTURE_ROLE.role,
      path: unitePaths(cabin === null ? [body] : [body, cabin]) ?? body,
      zIndex: 10,
    },
  ];
  if (frames !== null) {
    styleZones.push({ role: GLASS_ROLE.role, path: frames, zIndex: 12 });
  }
  const wheelZone = compoundPath(wheels);
  if (wheelZone !== null) {
    styleZones.push({ role: METAL_ROLE.role, path: wheelZone, zIndex: 12 });
  }

  return { silhouette, contours, internalBoundaries: boundaries, styleZones };
}

/** The car generator of the round 2 object registry. */
export const carGenerator: ObjectGenerator = {
  kind: "car",
  title: "A car: body slab, glazed cabin, and two wheels.",
  zoneRoles: [ARCHITECTURE_ROLE, GLASS_ROLE, METAL_ROLE],
  parameterSpace: carParameterSpace,
  defaultParameters: spaceDefaults(carParameterSpace),
  parseParameters: (raw) =>
    parseParametersWith("car", carParameterSchema, carParameterSpace, raw),
  generate: (parameters) => generateCar(carParameterSchema.parse(parameters)),
};

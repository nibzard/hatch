/**
 * The tram generator (specification sections 6, 11, and 24).
 *
 * A tram in profile is one rounded body over two bogies, a band of windows,
 * doors that reach the floor line, and a pantograph on the roof. The body is
 * built surface, the windows and the door panes are glass, and the wheels
 * are metal, so one vehicle already spans three zone roles.
 *
 * Local frame: the wheels rest on the line `y = 0`, the body is centered on
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
  booleanField,
  integerField,
  numberField,
  parseParametersWith,
  spaceDefaults,
  type ParameterSpace,
} from "./parameters.js";
import { ARCHITECTURE_ROLE, GLASS_ROLE, METAL_ROLE } from "./roles.js";
import { clamp, compoundPath, discPath, polylinePath, roundedRectanglePath } from "./shapes.js";

/** One axis-aligned rectangle, for windows and doors. */
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

/** The semantic parameters of a tram (specification section 6). */
export const tramParameterSchema = z.object({
  /** Body length in profile. */
  length: z.number().finite().min(120).max(1400),
  /** Body height from the floor line to the roof. */
  bodyHeight: z.number().finite().min(60).max(400),
  /** Floor height from the rail to the floor line. */
  floorHeight: z.number().finite().min(20).max(120),
  /** Windows along the side. */
  windows: z.number().int().min(2).max(10),
  /** Doors that reach the floor line. */
  doors: z.number().int().min(0).max(3),
  /** The pantograph on the roof. */
  pantograph: z.boolean(),
});

/** The tram parameters. */
export type TramParameters = z.infer<typeof tramParameterSchema>;

/** The range and the default of every tram parameter. */
export const tramParameterSpace: ParameterSpace = {
  length: numberField(120, 1400, 460),
  bodyHeight: numberField(60, 400, 150),
  floorHeight: numberField(20, 120, 46),
  windows: integerField(2, 10, 5),
  doors: integerField(0, 3, 2),
  pantograph: booleanField(true),
};

/** The default tram parameters. */
export const defaultTramParameters: TramParameters =
  tramParameterSchema.parse(spaceDefaults(tramParameterSpace));

/** One closed rectangle path. */
function rectPath(rect: Rect): Path {
  return roundedRectanglePath(rect.minX, rect.minY, rect.maxX, rect.maxY, 2);
}

/**
 * The door slots of the side, spread over the body length.
 *
 * A door keeps its slot only when it clears the body ends, so a short tram
 * draws fewer doors than asked for.
 */
function doorsOf(parameters: TramParameters, floorTop: number): Rect[] {
  const halfLength = parameters.length / 2;
  const width = clamp(parameters.length * 0.07, 10, 44);
  const top = floorTop - parameters.bodyHeight * 0.55;
  const placed: Rect[] = [];
  for (let index = 0; index < parameters.doors; index += 1) {
    const share = parameters.doors === 1 ? 0.5 : index / (parameters.doors - 1);
    const center = -halfLength * 0.7 + share * halfLength * 1.4;
    const candidate: Rect = {
      minX: center - width / 2,
      minY: top,
      maxX: center + width / 2,
      maxY: floorTop - 2,
    };
    if (
      candidate.minX >= -halfLength + 4 &&
      candidate.maxX <= halfLength - 4 &&
      placed.every((rect) => !rectsOverlap(rect, candidate))
    ) {
      placed.push(candidate);
    }
  }
  return placed;
}

/**
 * The window band of the side.
 *
 * A window keeps its slot only when it clears the body ends and every door,
 * the same rule the house generator applies to its windows.
 */
function windowsOf(parameters: TramParameters, doors: readonly Rect[]): Rect[] {
  const halfLength = parameters.length / 2;
  const floorTop = -parameters.floorHeight;
  const bandTop = floorTop - parameters.bodyHeight * 0.86;
  const bandBottom = floorTop - parameters.bodyHeight * 0.52;
  const width = (parameters.length * 0.84) / parameters.windows;
  const placed: Rect[] = [];
  for (let index = 0; index < parameters.windows; index += 1) {
    const center = -halfLength + parameters.length * 0.08 +
      ((index + 0.5) / parameters.windows) * parameters.length * 0.84;
    const candidate: Rect = {
      minX: center - width * 0.3,
      minY: bandTop,
      maxX: center + width * 0.3,
      maxY: bandBottom,
    };
    if (
      candidate.minX >= -halfLength + 3 &&
      candidate.maxX <= halfLength - 3 &&
      doors.every((rect) => !rectsOverlap(rect, candidate))
    ) {
      placed.push(candidate);
    }
  }
  return placed;
}

/**
 * The wheel discs of the two bogies.
 *
 * The radius fits the body length first, so a short tram rolls on smaller
 * wheels instead of wheels that stick out past its ends.
 */
function wheelsOf(parameters: TramParameters): Path[] {
  const halfLength = parameters.length / 2;
  const radius = clamp(
    Math.min(parameters.floorHeight * 0.55, parameters.length * 0.1),
    5,
    26,
  );
  const wheels: Path[] = [];
  for (const bogie of [-halfLength * 0.28, halfLength * 0.28]) {
    for (const offset of [-radius * 1.1, radius * 1.1]) {
      wheels.push(discPath({ x: bogie + offset, y: -radius }, radius));
    }
  }
  return wheels;
}

/**
 * Build the geometry of one tram.
 *
 * The tram draws no random number: vehicles stay controlled
 * (specification section 17).
 */
export function generateTram(parameters: TramParameters): Geometry {
  const halfLength = parameters.length / 2;
  const floorTop = -parameters.floorHeight;
  const roof = floorTop - parameters.bodyHeight;
  const radius = clamp(Math.min(parameters.bodyHeight * 0.12, 18), 2, 18);

  const body = roundedRectanglePath(
    -halfLength,
    roof,
    halfLength,
    floorTop,
    radius,
  );
  const wheels = wheelsOf(parameters);
  const silhouette = unitePaths([body, ...wheels]);
  if (silhouette === null) {
    throw new Error("the tram generator could not unite its silhouette");
  }

  const doors = doorsOf(parameters, floorTop);
  const windows = windowsOf(parameters, doors);

  const contours: Path[] = [
    polylinePath([
      { x: -halfLength, y: roof },
      { x: halfLength, y: roof },
    ]),
    polylinePath([
      { x: -halfLength, y: floorTop },
      { x: halfLength, y: floorTop },
    ]),
    ...wheels,
  ];
  if (parameters.pantograph) {
    // One zig zag arm and the contact shoe it carries, the read of a roof
    // pantograph in profile.
    const peak = roof - parameters.bodyHeight * 0.24;
    contours.push(
      polylinePath([
        { x: -halfLength * 0.1, y: roof },
        { x: halfLength * 0.12, y: peak },
        { x: halfLength * 0.3, y: roof - parameters.bodyHeight * 0.1 },
      ]),
      polylinePath([
        { x: halfLength * 0.06, y: peak },
        { x: halfLength * 0.3, y: peak },
      ]),
    );
  }

  // The belt line runs under the window band, the one interior line that
  // splits the glazed band from the lower panels.
  const boundaries: Path[] = [
    polylinePath([
      { x: -halfLength + 3, y: floorTop - parameters.bodyHeight * 0.48 },
      { x: halfLength - 3, y: floorTop - parameters.bodyHeight * 0.48 },
    ]),
  ];
  const frames = compoundPath([...doors, ...windows].map(rectPath));
  if (frames !== null) {
    boundaries.push(frames);
  }

  const styleZones: StyleZone[] = [
    { role: ARCHITECTURE_ROLE.role, path: body, zIndex: 10 },
  ];
  const glass = compoundPath([...doors, ...windows].map(rectPath));
  if (glass !== null) {
    styleZones.push({ role: GLASS_ROLE.role, path: glass, zIndex: 12 });
  }
  const wheelZone = compoundPath(wheels);
  if (wheelZone !== null) {
    styleZones.push({ role: METAL_ROLE.role, path: wheelZone, zIndex: 12 });
  }

  return { silhouette, contours, internalBoundaries: boundaries, styleZones };
}

/** The tram generator of the round 2 object registry. */
export const tramGenerator: ObjectGenerator = {
  kind: "tram",
  title: "A tram: rounded body, window band, doors, bogies, and a pantograph.",
  zoneRoles: [ARCHITECTURE_ROLE, GLASS_ROLE, METAL_ROLE],
  parameterSpace: tramParameterSpace,
  defaultParameters: spaceDefaults(tramParameterSpace),
  parseParameters: (raw) =>
    parseParametersWith("tram", tramParameterSchema, tramParameterSpace, raw),
  generate: (parameters) => generateTram(tramParameterSchema.parse(parameters)),
};

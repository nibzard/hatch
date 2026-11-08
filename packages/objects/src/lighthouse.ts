/**
 * The lighthouse generator (specification sections 1, 5, 6, 11, and 14).
 *
 * A lighthouse is the focal mark of a coastal scene: one tapered tower on a
 * plinth, one painted signal band, a gallery deck, and a lamp room under a
 * roof (specification section 14 names it first in its Mode 1 example, and
 * section 11 lists it among the generators of `@hatch/objects`). The tower
 * wall keeps the architecture zone of a cottage wall, the band carries the
 * densest hatch of the tower, and the lamp room reads as glass.
 *
 * Local frame: the plinth stands on the line `y = 0`, the tower rises on
 * `x = 0`, and the lamp room centers on the tower axis.
 *
 * Buildings stay controlled (specification section 17), so this generator
 * draws no random number.
 */

import { z } from "zod";

import type { Geometry, Path, StyleZone } from "@hatch/core";
import { booleanClip, subtractMasks, unitePaths } from "@hatch/geometry";

import type { ObjectGenerator } from "./generator.js";
import {
  booleanField,
  numberField,
  parseParametersWith,
  spaceDefaults,
  type ParameterSpace,
} from "./parameters.js";
import { ARCHITECTURE_ROLE, GLASS_ROLE, METAL_ROLE, SIGNAL_ROLE } from "./roles.js";
import { clamp, lerp, polygonPath, polylinePath, rectanglePath } from "./shapes.js";

/** The semantic parameters of a lighthouse (specification section 6). */
export const lighthouseParameterSchema = z.object({
  /** Tower height from the ground to the gallery deck. */
  height: z.number().finite().min(120).max(900),
  /** Tower width at the foot, above the plinth. */
  baseWidth: z.number().finite().min(28).max(180),
  /** The share of the base width the tower gives up by the gallery. */
  taper: z.number().finite().min(0.2).max(0.85),
  /** Draw the painted signal band. */
  band: z.boolean(),
  /** Band center as a share of the tower height. */
  bandPosition: z.number().finite().min(0.2).max(0.85),
  /** Lamp room height above the gallery deck. */
  lanternSize: z.number().finite().min(14).max(120),
  /** Draw a door at the foot of the tower. */
  door: z.boolean(),
});

/** The lighthouse parameters. */
export type LighthouseParameters = z.infer<typeof lighthouseParameterSchema>;

/** The range and the default of every lighthouse parameter. */
export const lighthouseParameterSpace: ParameterSpace = {
  height: numberField(120, 900, 340),
  baseWidth: numberField(28, 180, 66),
  taper: numberField(0.2, 0.85, 0.6),
  band: booleanField(true),
  bandPosition: numberField(0.2, 0.85, 0.62),
  lanternSize: numberField(14, 120, 44),
  door: booleanField(true),
};

/** The default lighthouse parameters. */
export const defaultLighthouseParameters: LighthouseParameters =
  lighthouseParameterSchema.parse(spaceDefaults(lighthouseParameterSpace));

/** Every measure of the tower, derived from the parameters once. */
interface TowerMeasures {
  /** Half width of the tower at the foot. */
  readonly footHalf: number;
  /** Half width of the tower at the gallery. */
  readonly topHalf: number;
  /** Half width of the plinth at the ground. */
  readonly plinthHalf: number;
  /** Height of the plinth above the ground line. */
  readonly plinthTop: number;
  /** Height of the signal band. */
  readonly bandHeight: number;
  /** Half width of the gallery deck. */
  readonly galleryHalf: number;
  /** Thickness of the gallery deck. */
  readonly galleryThickness: number;
  /** The top of the tower, the underside of the deck. */
  readonly deckY: number;
  /** The top of the deck slab. */
  readonly deckTopY: number;
  /** Half width of the lamp room at its foot. */
  readonly lanternFootHalf: number;
  /** Half width of the lamp room at its head. */
  readonly lanternHeadHalf: number;
  /** The top of the lamp room glass. */
  readonly lanternTopY: number;
  /** The peak of the roof above the lamp room. */
  readonly peakY: number;
}

/** Derive every measure of the tower from the parameters. */
export function lighthouseMeasures(
  parameters: LighthouseParameters,
): TowerMeasures {
  const footHalf = parameters.baseWidth / 2;
  const topHalf = footHalf * (1 - parameters.taper);
  const plinthTop = clamp(parameters.baseWidth * 0.35, 6, 40);
  const galleryThickness = clamp(parameters.height * 0.035, 6, 22);
  const lanternTopY = -parameters.height - galleryThickness -
    parameters.lanternSize;
  return {
    footHalf,
    topHalf,
    // The plinth always covers the foot of the tower.
    plinthHalf: Math.max(footHalf * 1.3, parameters.baseWidth * 0.62),
    plinthTop,
    bandHeight: clamp(parameters.height * 0.085, 8, 44),
    galleryHalf: topHalf * 1.9,
    galleryThickness,
    deckY: -parameters.height,
    deckTopY: -parameters.height - galleryThickness,
    lanternFootHalf: topHalf * 1.15,
    lanternHeadHalf: topHalf * 0.7,
    lanternTopY,
    peakY: lanternTopY - parameters.lanternSize * 0.55,
  };
}

/**
 * Build the geometry of one lighthouse.
 *
 * The lighthouse draws no random number: buildings stay controlled
 * (specification section 17).
 */
export function generateLighthouse(
  parameters: LighthouseParameters,
): Geometry {
  const m = lighthouseMeasures(parameters);

  // The plinth and the tower form one mass, the way the lamp post builds
  // its post and its base.
  const plinth = polygonPath([
    { x: -m.plinthHalf, y: 0 },
    { x: -m.footHalf, y: -m.plinthTop },
    { x: m.footHalf, y: -m.plinthTop },
    { x: m.plinthHalf, y: 0 },
  ]);
  const tower = polygonPath([
    { x: -m.footHalf, y: 0 },
    { x: -m.topHalf, y: m.deckY },
    { x: m.topHalf, y: m.deckY },
    { x: m.footHalf, y: 0 },
  ]);
  const deck = rectanglePath(
    -m.galleryHalf,
    m.deckTopY,
    m.galleryHalf,
    m.deckY,
  );
  const lantern = polygonPath([
    { x: -m.lanternFootHalf, y: m.deckTopY },
    { x: -m.lanternHeadHalf, y: m.lanternTopY },
    { x: m.lanternHeadHalf, y: m.lanternTopY },
    { x: m.lanternFootHalf, y: m.deckTopY },
  ]);
  const roof = polygonPath([
    { x: -m.lanternHeadHalf * 0.95, y: m.lanternTopY },
    { x: 0, y: m.peakY },
    { x: m.lanternHeadHalf * 0.95, y: m.lanternTopY },
  ]);

  const silhouette = unitePaths([plinth, tower, deck, lantern, roof]);
  if (silhouette === null) {
    throw new Error("the lighthouse generator could not unite its silhouette");
  }

  // The tower wall loses the band and the door the way the house wall loses
  // its openings, so one zone carries the wall and the band reads on top.
  const cutouts: Path[] = [];
  let bandZone: Path | null = null;
  if (parameters.band) {
    const center = -parameters.height * parameters.bandPosition;
    bandZone = booleanClip(
      rectanglePath(
        -m.footHalf * 1.05,
        center - m.bandHeight / 2,
        m.footHalf * 1.05,
        center + m.bandHeight / 2,
      ),
      tower,
      "intersect",
    );
    if (bandZone !== null) {
      cutouts.push(bandZone);
    }
  }
  let doorZone: Path | null = null;
  if (parameters.door) {
    const width = clamp(parameters.baseWidth * 0.22, 8, 46);
    const height = clamp(parameters.height * 0.12, 12, 90);
    doorZone = rectanglePath(-width / 2, -m.plinthTop - height, width / 2, -m.plinthTop);
    cutouts.push(doorZone);
  }
  const wall = subtractMasks(tower, cutouts);

  const metal = unitePaths([deck, roof]);

  const styleZones: StyleZone[] = [
    { role: ARCHITECTURE_ROLE.role, path: wall ?? tower, zIndex: 10 },
  ];
  if (bandZone !== null) {
    styleZones.push({ role: SIGNAL_ROLE.role, path: bandZone, zIndex: 11 });
  }
  if (metal !== null) {
    styleZones.push({ role: METAL_ROLE.role, path: metal, zIndex: 12 });
  }
  styleZones.push({ role: GLASS_ROLE.role, path: lantern, zIndex: 13 });

  const contours: Path[] = [
    // The taper of the tower, drawn as the two edges of the mass.
    polylinePath([
      { x: -m.footHalf, y: 0 },
      { x: -m.topHalf, y: m.deckY },
    ]),
    polylinePath([
      { x: m.footHalf, y: 0 },
      { x: m.topHalf, y: m.deckY },
    ]),
    // The gallery deck, its underside across the whole reach.
    polylinePath([
      { x: -m.galleryHalf, y: m.deckY },
      { x: m.galleryHalf, y: m.deckY },
    ]),
    // The roof slopes of the lamp room.
    polylinePath([
      { x: -m.lanternHeadHalf * 0.95, y: m.lanternTopY },
      { x: 0, y: m.peakY },
    ]),
    polylinePath([
      { x: 0, y: m.peakY },
      { x: m.lanternHeadHalf * 0.95, y: m.lanternTopY },
    ]),
  ];

  /** Half width of the tower at one height, following the taper. */
  const halfAt = (y: number): number =>
    lerp(m.footHalf, m.topHalf, Math.min(1, -y / parameters.height));

  const boundaries: Path[] = [
    // Where the plinth meets the tower, across the top face of the plinth.
    polylinePath([
      { x: -m.footHalf, y: -m.plinthTop },
      { x: m.footHalf, y: -m.plinthTop },
    ]),
    // The mullion of the lamp room, the one line that splits the glass.
    polylinePath([
      { x: 0, y: m.deckTopY },
      { x: 0, y: m.lanternTopY },
    ]),
  ];
  if (bandZone !== null) {
    const center = -parameters.height * parameters.bandPosition;
    for (const edge of [center - m.bandHeight / 2, center + m.bandHeight / 2]) {
      const half = halfAt(edge) + 1;
      boundaries.push(
        polylinePath([
          { x: -half, y: edge },
          { x: half, y: edge },
        ]),
      );
    }
  }
  if (doorZone !== null) {
    boundaries.push(doorZone);
  }

  return { silhouette, contours, internalBoundaries: boundaries, styleZones };
}

/** The lighthouse generator of the coastal object registry. */
export const lighthouseGenerator: ObjectGenerator = {
  kind: "lighthouse",
  title:
    "A lighthouse: tapered tower, signal band, gallery deck, and a lamp room.",
  zoneRoles: [ARCHITECTURE_ROLE, SIGNAL_ROLE, METAL_ROLE, GLASS_ROLE],
  parameterSpace: lighthouseParameterSpace,
  defaultParameters: spaceDefaults(lighthouseParameterSpace),
  parseParameters: (raw) =>
    parseParametersWith(
      "lighthouse",
      lighthouseParameterSchema,
      lighthouseParameterSpace,
      raw,
    ),
  generate: (parameters) =>
    generateLighthouse(lighthouseParameterSchema.parse(parameters)),
};

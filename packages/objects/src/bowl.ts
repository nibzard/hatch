/**
 * The bowl generator (specification sections 6, 11, and 24).
 *
 * A skate bowl is one poured transition: a flat bottom that curves up into
 * near-vertical walls under a flat deck, with a metal coping tube at each
 * lip. The semantic parameters of section 6 - width, depth, curvature, deck
 * width, coping line - map onto a basin profile, echo transition lines
 * inside the wall, and the coping stubs at the rims.
 *
 * Local frame: the deck line is `y = 0`, the basin is centered on `x = 0`
 * and descends towards positive y, the way the water band reaches towards
 * the viewer. The deck pads sit on the deck line.
 *
 * Poured concrete stays controlled (specification section 17), so this
 * generator draws no random number: two bowls with the same parameters are
 * identical.
 */

import { z } from "zod";

import type { Geometry, Path, Point, StyleZone } from "@hatch/core";
import { offsetPath, splineThroughPoints } from "@hatch/geometry";

import type { ObjectGenerator } from "./generator.js";
import {
  booleanField,
  integerField,
  numberField,
  parseParametersWith,
  spaceDefaults,
  type ParameterSpace,
} from "./parameters.js";
import { CONCRETE_ROLE, PAVEMENT_ROLE } from "./roles.js";
import { clamp, compoundPath, polylinePath, rectanglePath, withClose } from "./shapes.js";

/** Anchors along the basin profile, from the left rim to the right. */
const PROFILE_ANCHORS = 13;

/** The semantic parameters of a skate bowl (specification section 6). */
export const bowlParameterSchema = z.object({
  /** Rim to rim span of the basin opening. */
  width: z.number().finite().min(60).max(1600),
  /** Depth of the basin below the deck line. */
  depth: z.number().finite().min(20).max(400),
  /**
   * How fast the bottom curves into the wall: 0 is one smooth bowl, 1 is a
   * flat bottom under near-vertical walls.
   */
  curvature: z.number().finite().min(0).max(1),
  /** Flat deck pad on each side of the rim. */
  deckWidth: z.number().finite().min(0).max(200),
  /** The metal coping tube drawn at each lip. */
  coping: z.boolean(),
  /** Echo transition lines inside the basin wall. */
  transitionLines: z.number().int().min(1).max(5),
});

/** The bowl parameters. */
export type BowlParameters = z.infer<typeof bowlParameterSchema>;

/** The range and the default of every bowl parameter. */
export const bowlParameterSpace: ParameterSpace = {
  width: numberField(60, 1600, 380),
  depth: numberField(20, 400, 110),
  curvature: numberField(0, 1, 0.45),
  deckWidth: numberField(0, 200, 46),
  coping: booleanField(true),
  transitionLines: integerField(1, 5, 3),
};

/** The default bowl parameters. */
export const defaultBowlParameters: BowlParameters = bowlParameterSchema.parse(
  spaceDefaults(bowlParameterSpace),
);

/**
 * The basin profile exponent.
 *
 * `depth * (1 - |position|^exponent)` with the exponent above 2 keeps the
 * bottom flat and rolls into the wall, which is how a poured transition
 * reads. An exponent of 1.8 stays one smooth bowl.
 */
function profileExponent(curvature: number): number {
  return 1.8 + curvature * 4.2;
}

/** The basin depth at one position, `-1` at the left rim to `1` at the right. */
function basinDepthAt(position: number, parameters: BowlParameters): number {
  const exponent = profileExponent(parameters.curvature);
  return parameters.depth * (1 - Math.pow(Math.abs(position), exponent));
}

/** The basin profile, one spline through evenly spaced rim to rim anchors. */
function basinProfile(parameters: BowlParameters): Path {
  const halfWidth = parameters.width / 2;
  const anchors: Point[] = [];
  for (let index = 0; index < PROFILE_ANCHORS; index += 1) {
    const share = index / (PROFILE_ANCHORS - 1);
    anchors.push({
      x: -halfWidth + share * parameters.width,
      y: basinDepthAt(share * 2 - 1, parameters),
    });
  }
  return splineThroughPoints(anchors, { tension: 0.5 });
}

/**
 * The coping stub at one lip: a short line that follows the wall just under
 * the rim, the read of a metal tube on the lip.
 */
function copingStub(sign: -1 | 1, parameters: BowlParameters): Path {
  const halfWidth = parameters.width / 2;
  const rim: Point = { x: sign * halfWidth, y: 0 };
  const inner: Point = {
    x: sign * halfWidth * 0.88,
    y: basinDepthAt(sign * 0.88, parameters),
  };
  return polylinePath([rim, inner]);
}

/** The deck pads of the bowl, one compound path, or `null` without a deck. */
function deckPads(parameters: BowlParameters): Path | null {
  if (parameters.deckWidth < 1) {
    return null;
  }
  const halfWidth = parameters.width / 2;
  const thickness = clamp(parameters.deckWidth * 0.35, 4, 30);
  return compoundPath([
    rectanglePath(
      -halfWidth - parameters.deckWidth,
      -thickness,
      -halfWidth,
      0,
    ),
    rectanglePath(halfWidth, -thickness, halfWidth + parameters.deckWidth, 0),
  ]);
}

/**
 * Build the geometry of one skate bowl.
 *
 * The bowl draws no random number: poured concrete stays controlled
 * (specification section 17).
 */
export function generateBowl(parameters: BowlParameters): Geometry {
  const halfWidth = parameters.width / 2;
  const outerHalf = halfWidth + parameters.deckWidth;
  const profile = basinProfile(parameters);
  const silhouette = withClose(profile);

  // The deck line runs across both pads and the opening, the way the flat
  // pad around a bowl reads in a slight top view.
  const contours: Path[] = [
    profile,
    polylinePath([
      { x: -outerHalf, y: 0 },
      { x: outerHalf, y: 0 },
    ]),
  ];

  const boundaries: Path[] = [
    // The rim line spans the opening and separates the deck zone from the
    // basin zone, the way the eaves line separates wall from roof.
    polylinePath([
      { x: -halfWidth, y: 0 },
      { x: halfWidth, y: 0 },
    ]),
  ];
  for (let index = 1; index <= parameters.transitionLines; index += 1) {
    const share = (index / (parameters.transitionLines + 1)) * 0.55;
    const echo = offsetPath(silhouette, -Math.max(2, parameters.depth * share));
    if (echo !== null) {
      boundaries.push(echo);
    }
  }
  if (parameters.coping) {
    boundaries.push(copingStub(-1, parameters), copingStub(1, parameters));
  }

  const styleZones: StyleZone[] = [
    { role: CONCRETE_ROLE.role, path: silhouette, zIndex: 12 },
  ];
  const deck = deckPads(parameters);
  if (deck !== null) {
    styleZones.push({ role: PAVEMENT_ROLE.role, path: deck, zIndex: 11 });
  }

  return { silhouette, contours, internalBoundaries: boundaries, styleZones };
}

/** The bowl generator of the round 2 object registry. */
export const bowlGenerator: ObjectGenerator = {
  kind: "bowl",
  title: "A skate bowl: poured transition under a flat deck, coping on the lips.",
  zoneRoles: [CONCRETE_ROLE, PAVEMENT_ROLE],
  parameterSpace: bowlParameterSpace,
  defaultParameters: spaceDefaults(bowlParameterSpace),
  parseParameters: (raw) =>
    parseParametersWith("bowl", bowlParameterSchema, bowlParameterSpace, raw),
  generate: (parameters) => generateBowl(bowlParameterSchema.parse(parameters)),
};

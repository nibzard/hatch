/**
 * The streetlight generator (specification sections 6, 11, and 24).
 *
 * A streetlight is modern road lighting: one pole on a base, an arm that
 * reaches out over the carriageway, and a head with a lit lens underneath.
 * The classic lamp post with its lantern is a different object, `lamp-post`,
 * so a scene may mix both eras of street furniture.
 *
 * Local frame: the base stands on the line `y = 0`, the pole rises on
 * `x = 0`, and the arm reaches towards positive x.
 *
 * Street furniture stays controlled (specification section 17), so this
 * generator draws no random number.
 */

import { z } from "zod";

import type { Geometry, Path, Point, StyleZone } from "@hatch/core";
import { unitePaths } from "@hatch/geometry";

import type { ObjectGenerator } from "./generator.js";
import {
  numberField,
  parseParametersWith,
  spaceDefaults,
  type ParameterSpace,
} from "./parameters.js";
import { GLASS_ROLE, METAL_ROLE } from "./roles.js";
import {
  clamp,
  limbPolygon,
  polygonPath,
  polylinePath,
  roundedRectanglePath,
} from "./shapes.js";

/** The semantic parameters of a streetlight (specification section 6). */
export const streetlightParameterSchema = z.object({
  /** Pole height from the ground to the arm root. */
  height: z.number().finite().min(80).max(600),
  /** Arm reach over the carriageway, as a share of the pole height. */
  armLength: z.number().finite().min(0).max(1),
  /** Head length along the road. */
  headLength: z.number().finite().min(12).max(120),
  /** Base width at the ground. */
  baseWidth: z.number().finite().min(10).max(80),
});

/** The streetlight parameters. */
export type StreetlightParameters = z.infer<typeof streetlightParameterSchema>;

/** The range and the default of every streetlight parameter. */
export const streetlightParameterSpace: ParameterSpace = {
  height: numberField(80, 600, 230),
  armLength: numberField(0, 1, 0.45),
  headLength: numberField(12, 120, 62),
  baseWidth: numberField(10, 80, 30),
};

/** The default streetlight parameters. */
export const defaultStreetlightParameters: StreetlightParameters =
  streetlightParameterSchema.parse(spaceDefaults(streetlightParameterSpace));

/**
 * Build the geometry of one streetlight.
 *
 * The streetlight draws no random number: street furniture stays controlled
 * (specification section 17).
 */
export function generateStreetlight(
  parameters: StreetlightParameters,
): Geometry {
  const poleWidth = clamp(parameters.height * 0.03, 4, 14);
  const armReach = parameters.armLength * parameters.height;
  const headThickness = clamp(parameters.headLength * 0.24, 6, 30);
  const armEnd: Point = {
    x: armReach,
    y: -parameters.height - parameters.height * 0.02,
  };
  const armElbow: Point = {
    x: armReach * 0.45,
    y: -parameters.height - parameters.height * 0.06,
  };

  // The plinth tapers from a ground width that always covers the pole to a
  // top width it also covers, so the post never sticks out of its own base.
  const plinthTop = poleWidth * 0.75;
  const plinthBase = Math.max(parameters.baseWidth / 2, plinthTop * 1.25);
  const base = polygonPath([
    { x: -plinthBase, y: 0 },
    { x: -plinthTop, y: -parameters.baseWidth * 0.5 },
    { x: plinthTop, y: -parameters.baseWidth * 0.5 },
    { x: plinthBase, y: 0 },
  ]);
  const pole = limbPolygon(
    { x: 0, y: 0 },
    { x: 0, y: -parameters.height },
    poleWidth,
    poleWidth * 0.7,
  );
  const armRoot: Point = { x: 0, y: -parameters.height };
  const arm = limbPolygon(armRoot, armElbow, poleWidth * 0.7, poleWidth * 0.55);
  const armOut = limbPolygon(
    armElbow,
    armEnd,
    poleWidth * 0.55,
    poleWidth * 0.5,
  );
  const head = roundedRectanglePath(
    armEnd.x - parameters.headLength / 2,
    armEnd.y,
    armEnd.x + parameters.headLength / 2,
    armEnd.y + headThickness,
    headThickness * 0.3,
  );

  const parts = [base, pole, arm, armOut, head];
  const silhouette = unitePaths(parts);
  if (silhouette === null) {
    throw new Error("the streetlight generator could not unite its silhouette");
  }

  const contours: Path[] = [
    polylinePath([
      { x: -poleWidth * 0.5, y: -parameters.baseWidth * 0.5 },
      { x: -poleWidth * 0.35, y: -parameters.height },
    ]),
    polylinePath([
      { x: poleWidth * 0.5, y: -parameters.baseWidth * 0.5 },
      { x: poleWidth * 0.35, y: -parameters.height },
    ]),
    polylinePath([armRoot, armElbow, armEnd]),
  ];

  const boundaries: Path[] = [
    // The base line closes the plinth, the one ground line of the object.
    polylinePath([
      { x: -plinthBase, y: 0 },
      { x: plinthBase, y: 0 },
    ]),
  ];

  const styleZones: StyleZone[] = [
    { role: METAL_ROLE.role, path: silhouette, zIndex: 12 },
    {
      role: GLASS_ROLE.role,
      path: roundedRectanglePath(
        armEnd.x - parameters.headLength * 0.38,
        armEnd.y + headThickness,
        armEnd.x + parameters.headLength * 0.38,
        armEnd.y + headThickness * 1.8,
        1,
      ),
      zIndex: 13,
    },
  ];

  return { silhouette, contours, internalBoundaries: boundaries, styleZones };
}

/** The streetlight generator of the round 2 object registry. */
export const streetlightGenerator: ObjectGenerator = {
  kind: "streetlight",
  title: "A streetlight: pole, reaching arm, and a head with a lit lens.",
  zoneRoles: [METAL_ROLE, GLASS_ROLE],
  parameterSpace: streetlightParameterSpace,
  defaultParameters: spaceDefaults(streetlightParameterSpace),
  parseParameters: (raw) =>
    parseParametersWith(
      "streetlight",
      streetlightParameterSchema,
      streetlightParameterSpace,
      raw,
    ),
  generate: (parameters) =>
    generateStreetlight(streetlightParameterSchema.parse(parameters)),
};

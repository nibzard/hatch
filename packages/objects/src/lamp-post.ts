/**
 * The lamp post generator (specification sections 6, 11, and 24).
 *
 * A lamp post is classic street lighting: one tapered post on a plinth, a
 * collar, a lantern of glass panes, and a cap with a finial. Specification
 * section 5 names this object `lamp-post`. The modern pole with a reaching
 * arm is a different object, `streetlight`.
 *
 * Local frame: the plinth stands on the line `y = 0`, the post rises on
 * `x = 0`, and the lantern centers on the post axis.
 *
 * Street furniture stays controlled (specification section 17), so this
 * generator draws no random number.
 */

import { z } from "zod";

import type { Geometry, Path, StyleZone } from "@hatch/core";
import { unitePaths } from "@hatch/geometry";

import type { ObjectGenerator } from "./generator.js";
import {
  booleanField,
  numberField,
  integerField,
  parseParametersWith,
  spaceDefaults,
  type ParameterSpace,
} from "./parameters.js";
import { GLASS_ROLE, METAL_ROLE } from "./roles.js";
import { clamp, polygonPath, polylinePath } from "./shapes.js";

/** The semantic parameters of a lamp post (specification section 6). */
export const lampPostParameterSchema = z.object({
  /** Post height from the ground to the lantern base. */
  height: z.number().finite().min(80).max(600),
  /** Lantern height above the post. */
  lanternSize: z.number().finite().min(12).max(100),
  /** Glass panes the lantern shows in profile. */
  panes: z.number().int().min(1).max(4),
  /** Plinth width at the ground. */
  baseWidth: z.number().finite().min(10).max(80),
  /** The finial spike on top of the cap. */
  finial: z.boolean(),
});

/** The lamp post parameters. */
export type LampPostParameters = z.infer<typeof lampPostParameterSchema>;

/** The range and the default of every lamp post parameter. */
export const lampPostParameterSpace: ParameterSpace = {
  height: numberField(80, 600, 200),
  lanternSize: numberField(12, 100, 42),
  panes: integerField(1, 4, 2),
  baseWidth: numberField(10, 80, 26),
  finial: booleanField(true),
};

/** The default lamp post parameters. */
export const defaultLampPostParameters: LampPostParameters =
  lampPostParameterSchema.parse(spaceDefaults(lampPostParameterSpace));

/**
 * Build the geometry of one lamp post.
 *
 * The lamp post draws no random number: street furniture stays controlled
 * (specification section 17).
 */
export function generateLampPost(parameters: LampPostParameters): Geometry {
  const footWidth = clamp(parameters.height * 0.045, 5, 22);
  const topWidth = clamp(parameters.height * 0.018, 3, 10);
  const collarHeight = clamp(parameters.lanternSize * 0.16, 3, 14);
  const lanternBase = -parameters.height;
  const lanternTop = lanternBase - parameters.lanternSize;
  const lanternFoot = parameters.lanternSize * 0.52;
  const lanternHead = parameters.lanternSize * 0.38;
  const capHeight = parameters.lanternSize * 0.18;

  // The plinth tapers from a ground width that always covers the post to a
  // top width it also covers, so the post never sticks out of its own base.
  const plinthTop = footWidth * 0.62;
  const plinthBase = Math.max(parameters.baseWidth / 2, plinthTop * 1.25);
  // The post tapers from the plinth to the lantern.
  const post = polygonPath([
    { x: -footWidth / 2, y: -parameters.baseWidth * 0.4 },
    { x: -topWidth / 2, y: lanternBase },
    { x: topWidth / 2, y: lanternBase },
    { x: footWidth / 2, y: -parameters.baseWidth * 0.4 },
  ]);
  const plinth = polygonPath([
    { x: -plinthBase, y: 0 },
    { x: -plinthTop, y: -parameters.baseWidth * 0.4 },
    { x: plinthTop, y: -parameters.baseWidth * 0.4 },
    { x: plinthBase, y: 0 },
  ]);
  const collarWidth = topWidth * 1.7;
  const collar = polygonPath([
    { x: -collarWidth / 2, y: lanternBase - collarHeight },
    { x: -topWidth * 0.42, y: lanternBase },
    { x: topWidth * 0.42, y: lanternBase },
    { x: collarWidth / 2, y: lanternBase - collarHeight },
  ]);
  // The lantern tapers from its foot to its head, the profile of a glass
  // lantern in a metal frame.
  const lantern = polygonPath([
    { x: -lanternFoot / 2, y: lanternBase - collarHeight },
    { x: -lanternHead / 2, y: lanternTop },
    { x: lanternHead / 2, y: lanternTop },
    { x: lanternFoot / 2, y: lanternBase - collarHeight },
  ]);
  const cap = polygonPath([
    { x: -lanternHead * 0.62, y: lanternTop },
    { x: 0, y: lanternTop - capHeight },
    { x: lanternHead * 0.62, y: lanternTop },
  ]);

  const metalParts: Path[] = [post, plinth, collar, cap];
  // The silhouette carries the lantern too, so the sky and the ground hatch
  // stop behind the glass. The metal zone stays the frame alone, and the
  // glass zone draws over it at a higher z index.
  const metal = unitePaths(metalParts);
  const silhouette = unitePaths([...metalParts, lantern]);
  if (metal === null || silhouette === null) {
    throw new Error("the lamp post generator could not unite its silhouette");
  }

  const contours: Path[] = [
    polylinePath([
      { x: -footWidth * 0.42, y: -parameters.baseWidth * 0.4 },
      { x: -topWidth * 0.4, y: lanternBase },
    ]),
    polylinePath([
      { x: footWidth * 0.42, y: -parameters.baseWidth * 0.4 },
      { x: topWidth * 0.4, y: lanternBase },
    ]),
  ];

  // The pane lines split the glass into panes, and the plinth line closes
  // the base, the two interior lines the object keeps.
  const boundaries: Path[] = [
    polylinePath([
      { x: -plinthBase, y: 0 },
      { x: plinthBase, y: 0 },
    ]),
    polylinePath([
      { x: -lanternFoot * 0.42, y: lanternBase - collarHeight },
      { x: lanternFoot * 0.42, y: lanternBase - collarHeight },
    ]),
  ];
  for (let index = 1; index < parameters.panes; index += 1) {
    const share = index / parameters.panes;
    boundaries.push(
      polylinePath([
        {
          x: -lanternFoot / 2 + lanternFoot * share,
          y: lanternBase - collarHeight,
        },
        { x: -lanternHead / 2 + lanternHead * share, y: lanternTop },
      ]),
    );
  }
  if (parameters.finial) {
    boundaries.push(
      polylinePath([
        { x: 0, y: lanternTop - capHeight },
        { x: 0, y: lanternTop - capHeight * 1.9 },
      ]),
    );
  }

  const styleZones: StyleZone[] = [
    { role: METAL_ROLE.role, path: metal, zIndex: 12 },
    { role: GLASS_ROLE.role, path: lantern, zIndex: 13 },
  ];

  return { silhouette, contours, internalBoundaries: boundaries, styleZones };
}

/** The lamp post generator of the round 2 object registry. */
export const lampPostGenerator: ObjectGenerator = {
  kind: "lamp-post",
  title: "A lamp post: tapered post, collar, glass lantern, and a cap.",
  zoneRoles: [METAL_ROLE, GLASS_ROLE],
  parameterSpace: lampPostParameterSpace,
  defaultParameters: spaceDefaults(lampPostParameterSpace),
  parseParameters: (raw) =>
    parseParametersWith(
      "lamp-post",
      lampPostParameterSchema,
      lampPostParameterSpace,
      raw,
    ),
  generate: (parameters) =>
    generateLampPost(lampPostParameterSchema.parse(parameters)),
};

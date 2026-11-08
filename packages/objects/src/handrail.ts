/**
 * The handrail generator (specification sections 6, 11, and 24).
 *
 * A handrail runs down a bank or a stair set: one kinked tube on posts, the
 * kink where the slope breaks. Specification section 5 names this object
 * `rail` and section 11 names it `rail`; the registry lists it under the
 * task name `handrail` and resolves `rail` to the same generator.
 *
 * Local frame: the posts stand on the line `y = 0`, the rail is centered on
 * `x = 0`, and the whole rail grows towards negative y. The high end sits
 * at the left, so the rail reads as running down towards the right.
 *
 * Railings stay controlled (specification section 17), so this generator
 * draws no random number.
 */

import { z } from "zod";

import type { Geometry, Path, Point, StyleZone } from "@hatch/core";
import { unitePaths } from "@hatch/geometry";

import type { ObjectGenerator } from "./generator.js";
import {
  integerField,
  numberField,
  parseParametersWith,
  spaceDefaults,
  type ParameterSpace,
} from "./parameters.js";
import { METAL_ROLE } from "./roles.js";
import { clamp, limbPolygon, polylinePath, withClose } from "./shapes.js";

/** The semantic parameters of a handrail (specification section 6). */
export const handrailParameterSchema = z.object({
  /** Horizontal span from the high end to the low end. */
  width: z.number().finite().min(40).max(900),
  /** Rail height at the high end. */
  height: z.number().finite().min(30).max(400),
  /** How far the low end falls, as a share of the height. */
  drop: z.number().finite().min(0).max(0.8),
  /** Tube thickness of the rail. */
  tubeWidth: z.number().finite().min(3).max(24),
  /** The share of the span that runs flat before the slope breaks. */
  kinkShare: z.number().finite().min(0).max(0.8),
  /** Posts under the rail. */
  posts: z.number().int().min(2).max(5),
});

/** The handrail parameters. */
export type HandrailParameters = z.infer<typeof handrailParameterSchema>;

/** The range and the default of every handrail parameter. */
export const handrailParameterSpace: ParameterSpace = {
  width: numberField(40, 900, 220),
  height: numberField(30, 400, 110),
  drop: numberField(0, 0.8, 0.45),
  tubeWidth: numberField(3, 24, 9),
  kinkShare: numberField(0, 0.8, 0.3),
  posts: integerField(2, 5, 3),
};

/** The default handrail parameters. */
export const defaultHandrailParameters: HandrailParameters =
  handrailParameterSchema.parse(spaceDefaults(handrailParameterSpace));

/** The rail height at one x position, following the kinked rail line. */
function railHeightAt(x: number, parameters: HandrailParameters): number {
  const halfWidth = parameters.width / 2;
  const kinkX = -halfWidth + parameters.kinkShare * parameters.width;
  const lowHeight = parameters.height * (1 - parameters.drop);
  if (x <= kinkX) {
    return parameters.height;
  }
  const share = (x - kinkX) / (halfWidth - kinkX);
  return parameters.height + (lowHeight - parameters.height) * share;
}

/** The corners of the kinked rail line, from the high end to the low end. */
function railLine(parameters: HandrailParameters): Point[] {
  const halfWidth = parameters.width / 2;
  const kinkX = -halfWidth + parameters.kinkShare * parameters.width;
  const lowHeight = parameters.height * (1 - parameters.drop);
  const points: Point[] = [
    { x: -halfWidth, y: -parameters.height },
    { x: kinkX, y: -parameters.height },
    { x: halfWidth, y: -lowHeight },
  ];
  // A kink share of 0 leaves a redundant anchor on the line, so drop it.
  if (parameters.kinkShare === 0) {
    return [points[0], points[2]] as [Point, Point];
  }
  return points;
}

/**
 * Build the geometry of one handrail.
 *
 * The handrail draws no random number: railings stay controlled
 * (specification section 17).
 */
export function generateHandrail(parameters: HandrailParameters): Geometry {
  const halfWidth = parameters.width / 2;
  const line = railLine(parameters);
  const postWidth = clamp(parameters.tubeWidth * 0.8, 3, 14);

  const parts: Path[] = [];
  for (let index = 1; index < line.length; index += 1) {
    const from = line[index - 1];
    const to = line[index];
    if (from === undefined || to === undefined) {
      throw new Error("the handrail generator could not build its rail line");
    }
    parts.push(
      limbPolygon(from, to, parameters.tubeWidth, parameters.tubeWidth),
    );
  }
  for (let index = 0; index < parameters.posts; index += 1) {
    const share = parameters.posts === 1 ? 0.5 : index / (parameters.posts - 1);
    const x = -halfWidth + share * parameters.width;
    // The post reaches the underside of the tube, so its outline meets the
    // rail band instead of crossing it.
    const underRail = Math.max(railHeightAt(x, parameters) - parameters.tubeWidth, 4);
    parts.push(
      limbPolygon({ x, y: 0 }, { x, y: -underRail }, postWidth, postWidth * 0.7),
    );
  }
  const silhouette = unitePaths(parts);
  if (silhouette === null) {
    throw new Error("the handrail generator could not unite its silhouette");
  }

  // The rail edges carry the read: the top edge runs the kink, the bottom
  // edge echoes it one tube below.
  const contours: Path[] = [
    polylinePath(line),
    polylinePath(
      line.map((point) => ({ x: point.x, y: point.y + parameters.tubeWidth })),
    ),
  ];

  const boundaries: Path[] = parts
    .slice(parts.length - parameters.posts)
    .map((post) => withClose(post));

  const styleZones: StyleZone[] = [
    { role: METAL_ROLE.role, path: silhouette, zIndex: 12 },
  ];

  return { silhouette, contours, internalBoundaries: boundaries, styleZones };
}

/** The handrail generator of the round 2 object registry. */
export const handrailGenerator: ObjectGenerator = {
  kind: "handrail",
  title: "A handrail: kinked tube on posts, running down a bank.",
  zoneRoles: [METAL_ROLE],
  parameterSpace: handrailParameterSpace,
  defaultParameters: spaceDefaults(handrailParameterSpace),
  parseParameters: (raw) =>
    parseParametersWith(
      "handrail",
      handrailParameterSchema,
      handrailParameterSpace,
      raw,
    ),
  generate: (parameters) =>
    generateHandrail(handrailParameterSchema.parse(parameters)),
};

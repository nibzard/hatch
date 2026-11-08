/**
 * The fence generator (specification sections 6, 11, and 24).
 *
 * A fence is one run of posts with rails between them, and pickets when the
 * run closes a garden. The whole run is one wooden mass, so the silhouette
 * is the union of every piece, and the picket edges read as the boundary
 * lines of the zone.
 *
 * Local frame: the posts stand on the line `y = 0`, the run is centered on
 * `x = 0`, and the mass grows towards negative y.
 *
 * Fences stay controlled (specification section 17), so this generator
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
import { ARCHITECTURE_ROLE } from "./roles.js";
import { clamp, polygonPath, polylinePath, rectanglePath } from "./shapes.js";

/** The semantic parameters of a fence (specification section 6). */
export const fenceParameterSchema = z.object({
  /** Span of the run from the first post to the last. */
  width: z.number().finite().min(60).max(1600),
  /** Height of the posts above the ground. */
  height: z.number().finite().min(30).max(300),
  /** Posts along the run, including both ends. */
  posts: z.number().int().min(2).max(8),
  /** Horizontal rails between the posts. */
  rails: z.number().int().min(0).max(3),
  /** Vertical pickets between the end posts. */
  pickets: z.number().int().min(0).max(24),
  /** Pointed picket tops, the read of a picket fence. */
  pointed: z.boolean(),
});

/** The fence parameters. */
export type FenceParameters = z.infer<typeof fenceParameterSchema>;

/** The range and the default of every fence parameter. */
export const fenceParameterSpace: ParameterSpace = {
  width: numberField(60, 1600, 300),
  height: numberField(30, 300, 84),
  posts: integerField(2, 8, 4),
  rails: integerField(0, 3, 2),
  pickets: integerField(0, 24, 7),
  pointed: booleanField(false),
};

/** The default fence parameters. */
export const defaultFenceParameters: FenceParameters =
  fenceParameterSchema.parse(spaceDefaults(fenceParameterSpace));

/** The post positions of one run, from the left end to the right. */
function postPositions(parameters: FenceParameters): number[] {
  const positions: number[] = [];
  const halfWidth = parameters.width / 2;
  for (let index = 0; index < parameters.posts; index += 1) {
    const share = parameters.posts === 1 ? 0.5 : index / (parameters.posts - 1);
    positions.push(-halfWidth + share * parameters.width);
  }
  return positions;
}

/**
 * One picket between the end posts.
 *
 * A picket keeps its slot only when it clears every post of the run, so a
 * dense run places fewer pickets than asked for rather than overlapping its
 * own posts.
 */
function picketsOf(parameters: FenceParameters, posts: readonly number[]): Path[] {
  if (parameters.pickets <= 0) {
    return [];
  }
  const halfWidth = parameters.width / 2;
  const postWidth = clamp(parameters.height * 0.09, 4, 18);
  const picketWidth = clamp(parameters.height * 0.06, 3, 12);
  const inset = postWidth / 2 + picketWidth;
  const span = parameters.width - inset * 2;
  if (span <= picketWidth) {
    return [];
  }
  const slots = Math.min(parameters.pickets, Math.floor(span / picketWidth));
  const pieces: Path[] = [];
  const top = -parameters.height * 0.92;
  for (let index = 0; index < slots; index += 1) {
    const x = -halfWidth + inset + ((index + 0.5) / slots) * span;
    const clearOfPosts = posts.every(
      (post) => Math.abs(post - x) > postWidth / 2 + picketWidth / 2,
    );
    if (!clearOfPosts) {
      continue;
    }
    if (parameters.pointed) {
      pieces.push(
        polygonPath([
          { x: x - picketWidth / 2, y: 0 },
          { x: x - picketWidth / 2, y: top },
          { x, y: top - picketWidth / 2 },
          { x: x + picketWidth / 2, y: top },
          { x: x + picketWidth / 2, y: 0 },
        ]),
      );
      continue;
    }
    pieces.push(rectanglePath(x - picketWidth / 2, top, x + picketWidth / 2, 0));
  }
  return pieces;
}

/**
 * Build the geometry of one fence run.
 *
 * The fence draws no random number: built structures stay controlled
 * (specification section 17).
 */
export function generateFence(parameters: FenceParameters): Geometry {
  const halfWidth = parameters.width / 2;
  const postWidth = clamp(parameters.height * 0.09, 4, 18);
  const railThickness = clamp(parameters.height * 0.07, 3, 12);

  const posts = postPositions(parameters);
  const parts: Path[] = posts.map((x) =>
    rectanglePath(x - postWidth / 2, -parameters.height, x + postWidth / 2, 0),
  );
  for (let index = 0; index < parameters.rails; index += 1) {
    const share = (index + 1) / (parameters.rails + 1);
    const y = -parameters.height * (0.9 - share * 0.62);
    parts.push(rectanglePath(-halfWidth, y - railThickness, halfWidth, y));
  }
  parts.push(...picketsOf(parameters, posts));

  const silhouette = unitePaths(parts);
  if (silhouette === null) {
    throw new Error("the fence generator could not unite its silhouette");
  }

  // The top rail edge runs the whole span, the one line that carries the
  // read of a fence. Without rails the post tops carry it instead.
  const topRail = -parameters.height *
    (0.9 - (1 / (parameters.rails + 1)) * 0.62) - railThickness;
  const runTop = parameters.rails > 0 ? topRail : -parameters.height;
  const contours: Path[] = [
    polylinePath([
      { x: -halfWidth, y: runTop },
      { x: halfWidth, y: runTop },
    ]),
  ];
  const boundaries: Path[] = [...parts];

  const styleZones: StyleZone[] = [
    { role: ARCHITECTURE_ROLE.role, path: silhouette, zIndex: 10 },
  ];

  return { silhouette, contours, internalBoundaries: boundaries, styleZones };
}

/** The fence generator of the round 2 object registry. */
export const fenceGenerator: ObjectGenerator = {
  kind: "fence",
  title: "A fence run: posts, rails, and optional pickets.",
  zoneRoles: [ARCHITECTURE_ROLE],
  parameterSpace: fenceParameterSpace,
  defaultParameters: spaceDefaults(fenceParameterSpace),
  parseParameters: (raw) =>
    parseParametersWith("fence", fenceParameterSchema, fenceParameterSpace, raw),
  generate: (parameters) =>
    generateFence(fenceParameterSchema.parse(parameters)),
};

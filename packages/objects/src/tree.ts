/**
 * The tree generator (specification sections 6 and 24).
 *
 * A tree is "blob canopy + trunk structure" (specification section 3C).
 * The semantic parameters of section 6 - canopy size, trunk bend, foliage
 * density, age and character - map onto a tapered trunk, a lobed canopy
 * spline, clump boundaries inside the canopy, and branch strokes.
 *
 * Local frame: the trunk foot sits on `y = 0`, centered on `x = 0`, and
 * the tree grows towards negative y. The canopy never hangs below the
 * ground line: when a canopy radius would push it there, the generator
 * clamps the radius.
 *
 * Organic irregularity comes from the seeded stream (specification section
 * 17): one draw per canopy anchor, then three draws per clump arc and per
 * branch, in index order. The same parameters and the same stream always
 * give the same tree (specification section 10).
 */

import { z } from "zod";

import type { Geometry, Path, Point, SeededRng, StyleZone } from "@hatch/core";
import { offsetPath, splineThroughPoints, unitePaths } from "@hatch/geometry";

import type { GenerateOptions, ObjectGenerator } from "./generator.js";
import {
  integerField,
  numberField,
  parseParametersWith,
  spaceDefaults,
  type ParameterSpace,
} from "./parameters.js";
import { FOLIAGE_ROLE } from "./roles.js";
import { polygonPath, polylinePath } from "./shapes.js";

/** The semantic parameters of a tree (specification section 6). */
export const treeParameterSchema = z.object({
  /** Trunk height from the ground to the canopy. */
  trunkHeight: z.number().finite().min(8).max(400),
  /** Trunk width at the foot. */
  trunkWidth: z.number().finite().min(2).max(80),
  /** Lean of the trunk top as a fraction of the trunk height. */
  trunkBend: z.number().finite().min(-1).max(1),
  /** Canopy radius in user units. */
  canopyRadius: z.number().finite().min(6).max(300),
  /** Lobes around the canopy edge. */
  canopyLobes: z.number().int().min(4).max(14),
  /** How much the lobe radii vary. */
  canopyIrregularity: z.number().finite().min(0).max(0.6),
  /** Clump boundaries drawn inside the canopy. */
  clumpLines: z.number().int().min(1).max(6),
  /** Branch strokes fanning from the trunk top into the canopy. */
  branchLines: z.number().int().min(0).max(5),
});

/** The tree parameters. */
export type TreeParameters = z.infer<typeof treeParameterSchema>;

/** The range and the default of every tree parameter. */
export const treeParameterSpace: ParameterSpace = {
  trunkHeight: numberField(8, 400, 70),
  trunkWidth: numberField(2, 80, 12),
  trunkBend: numberField(-1, 1, 0.15),
  canopyRadius: numberField(6, 300, 46),
  canopyLobes: integerField(4, 14, 8),
  canopyIrregularity: numberField(0, 0.6, 0.22),
  clumpLines: integerField(1, 6, 3),
  branchLines: integerField(0, 5, 2),
};

/** The default tree parameters. */
export const defaultTreeParameters: TreeParameters = treeParameterSchema.parse(
  spaceDefaults(treeParameterSpace),
);

/** One point on a circle around a center. */
function radial(center: Point, angle: number, radius: number): Point {
  return {
    x: center.x + Math.cos(angle) * radius,
    y: center.y + Math.sin(angle) * radius,
  };
}

/**
 * The canopy radius the parameters allow.
 *
 * The canopy bottom sits at `center.y + radius * (1 + irregularity)`. A
 * radius that would push it below the ground line is clamped, so the tree
 * always stands on `y = 0`.
 */
function effectiveCanopyRadius(parameters: TreeParameters): number {
  return Math.min(
    parameters.canopyRadius,
    parameters.trunkHeight / (0.65 + parameters.canopyIrregularity),
  );
}

/** The lobed canopy outline, one spline through the lobe anchors. */
function canopyPath(
  parameters: TreeParameters,
  center: Point,
  radius: number,
  rng: SeededRng,
): Path {
  const anchors: Point[] = [];
  for (let index = 0; index < parameters.canopyLobes; index += 1) {
    const angle = (index / parameters.canopyLobes) * Math.PI * 2;
    const wobble =
      1 + parameters.canopyIrregularity * (rng.next() * 2 - 1);
    anchors.push(radial(center, angle, radius * wobble));
  }
  return splineThroughPoints(anchors, { closed: true });
}

/** The clump boundaries: short arcs inside the canopy. */
function clumpBoundaries(
  parameters: TreeParameters,
  center: Point,
  radius: number,
  rng: SeededRng,
): Path[] {
  const arcs: Path[] = [];
  for (let index = 0; index < parameters.clumpLines; index += 1) {
    const angle = rng.float(0, Math.PI * 2);
    const arcRadius = radius * rng.float(0.35, 0.7);
    const span = rng.float(0.5, 1.1);
    const anchors = [-span, 0, span].map((offset) =>
      radial(center, angle + offset, arcRadius),
    );
    arcs.push(splineThroughPoints(anchors));
  }
  return arcs;
}

/** The branch strokes from the trunk top into the canopy. */
function branchContours(
  parameters: TreeParameters,
  center: Point,
  start: Point,
  radius: number,
  rng: SeededRng,
): Path[] {
  const branches: Path[] = [];
  for (let index = 0; index < parameters.branchLines; index += 1) {
    const angle = -Math.PI / 2 + rng.float(-1.1, 1.1);
    const length = radius * rng.float(0.5, 0.85);
    const end = {
      x: start.x + Math.cos(angle) * length,
      y: start.y + Math.sin(angle) * length,
    };
    // Pull the tip back inside the canopy when the branch would leave it.
    const dx = end.x - center.x;
    const dy = end.y - center.y;
    const distance = Math.hypot(dx, dy);
    const limit = radius * 0.92;
    const tip =
      distance > limit && distance > 0
        ? { x: center.x + (dx / distance) * limit, y: center.y + (dy / distance) * limit }
        : end;
    const jog = radius * 0.08;
    const middle = {
      x: (start.x + tip.x) / 2 + rng.float(-jog, jog),
      y: (start.y + tip.y) / 2 + rng.float(-jog, jog),
    };
    branches.push(polylinePath([start, middle, tip]));
  }
  return branches;
}

/**
 * Build the geometry of one tree.
 *
 * Draw order of the stream: one wobble per canopy anchor in angle order,
 * then the branches (angle, length, jog each), then the clump arcs
 * (angle, radius, span each), both in index order.
 */
export function generateTree(
  parameters: TreeParameters,
  options: GenerateOptions,
): Geometry {
  const canopyStream = options.rng.fork("tree:canopy");
  const detailStream = options.rng.fork("tree:detail");
  const radius = effectiveCanopyRadius(parameters);
  const bend = parameters.trunkBend * parameters.trunkHeight;
  const center: Point = {
    x: bend,
    y: -(parameters.trunkHeight + radius * 0.35),
  };
  const trunkTop = -parameters.trunkHeight + radius * 0.15;

  const baseHalf = parameters.trunkWidth / 2;
  const topHalf = baseHalf * 0.55;
  const midHalf = (baseHalf + topHalf) / 2;
  const midX = bend * 0.25;
  const midY = -parameters.trunkHeight * 0.5;
  const trunk = polygonPath([
    { x: -baseHalf, y: 0 },
    { x: -midHalf + midX, y: midY },
    { x: -topHalf + bend, y: trunkTop },
    { x: topHalf + bend, y: trunkTop },
    { x: midHalf + midX, y: midY },
    { x: baseHalf, y: 0 },
  ]);

  const canopy = canopyPath(parameters, center, radius, canopyStream);
  const silhouette = unitePaths([trunk, canopy]);
  if (silhouette === null) {
    throw new Error("the tree generator could not unite its silhouette");
  }

  // The trunk edges are more expressive than wall lines (section 17), so
  // they run through a spline instead of straight segments.
  const contours: Path[] = [
    splineThroughPoints([
      { x: -baseHalf, y: 0 },
      { x: -midHalf + midX, y: midY },
      { x: -topHalf + bend, y: trunkTop },
    ]),
    splineThroughPoints([
      { x: topHalf + bend, y: trunkTop },
      { x: midHalf + midX, y: midY },
      { x: baseHalf, y: 0 },
    ]),
  ];
  const canopyEcho = offsetPath(canopy, -radius * 0.28);
  if (canopyEcho !== null) {
    contours.push(canopyEcho);
  }
  contours.push(
    ...branchContours(
      parameters,
      center,
      { x: bend, y: trunkTop },
      radius,
      detailStream,
    ),
  );

  // The junction arc crosses the canopy where the trunk enters it, and
  // the clump arcs split the canopy mass into foliage clumps.
  const boundaries: Path[] = [
    splineThroughPoints([
      { x: bend - radius * 0.4, y: trunkTop + radius * 0.08 },
      { x: bend, y: trunkTop - radius * 0.06 },
      { x: bend + radius * 0.4, y: trunkTop + radius * 0.08 },
    ]),
    ...clumpBoundaries(parameters, center, radius, detailStream),
  ];

  const styleZones: StyleZone[] = [
    { role: FOLIAGE_ROLE.role, path: canopy, zIndex: 20 },
  ];

  return { silhouette, contours, internalBoundaries: boundaries, styleZones };
}

/** The tree generator of the V1 object registry. */
export const treeGenerator: ObjectGenerator = {
  kind: "tree",
  title: "A tree: tapered trunk, lobed canopy, clumps, and branches.",
  zoneRoles: [FOLIAGE_ROLE],
  parameterSpace: treeParameterSpace,
  defaultParameters: spaceDefaults(treeParameterSpace),
  parseParameters: (raw) =>
    parseParametersWith("tree", treeParameterSchema, treeParameterSpace, raw),
  generate: (parameters, options: GenerateOptions) =>
    generateTree(treeParameterSchema.parse(parameters), options),
};

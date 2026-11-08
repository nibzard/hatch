/**
 * The skater generator (specification sections 6, 11, and 24).
 *
 * Specification section 11 lists a human figure among the object
 * generators. A skater in this style is one simplified contour: a tapered
 * torso, a head disc, two legs in a riding stance, two arms, and a board
 * under the feet. The mass stays unfilled paper (specification section 3C:
 * figures read from their contour), and one cast shadow grounds them.
 *
 * Local frame: the wheels or the feet rest on the line `y = 0`, the figure
 * is centered on `x = 0`, and it rides towards positive x.
 *
 * Figures are organic (specification section 17), so the pose draws a few
 * numbers from the seeded stream: one draw each for the lean, the crouch,
 * and the arm swing, in that order. The same parameters and the same
 * stream give the same pose (specification section 10).
 */

import { z } from "zod";

import type { Geometry, Path, Point, SeededRng, StyleZone } from "@hatch/core";
import { unitePaths } from "@hatch/geometry";

import type { GenerateOptions, ObjectGenerator } from "./generator.js";
import {
  booleanField,
  numberField,
  parseParametersWith,
  spaceDefaults,
  type ParameterSpace,
} from "./parameters.js";
import {
  ARCHITECTURE_ROLE,
  FIGURE_ROLE,
  METAL_ROLE,
  SHADOW_ROLE,
} from "./roles.js";
import {
  clamp,
  compoundPath,
  discPath,
  ellipsePath,
  limbPolygon,
  polygonPath,
  polylinePath,
  roundedRectanglePath,
} from "./shapes.js";

/** The semantic parameters of a skater (specification section 6). */
export const skaterParameterSchema = z.object({
  /** Height of the figure, from the ground to the top of the head. */
  height: z.number().finite().min(60).max(400),
  /** Knee bend: 0 stands tall, 1 crouches over the board. */
  crouch: z.number().finite().min(0).max(1),
  /** Forward lean towards the direction of travel. -1 leans back. */
  lean: z.number().finite().min(-1).max(1),
  /** Draw a skateboard under the feet. */
  board: z.boolean(),
  /** Deck length of the board. */
  boardLength: z.number().finite().min(20).max(200),
  /** How far the arms swing out: 0 hugs the body, 1 balances wide. */
  armSwing: z.number().finite().min(-1).max(1),
});

/** The skater parameters. */
export type SkaterParameters = z.infer<typeof skaterParameterSchema>;

/** The range and the default of every skater parameter. */
export const skaterParameterSpace: ParameterSpace = {
  height: numberField(60, 400, 170),
  crouch: numberField(0, 1, 0.35),
  lean: numberField(-1, 1, 0.25),
  board: booleanField(true),
  boardLength: numberField(20, 200, 66),
  armSwing: numberField(-1, 1, 0.4),
};

/** The default skater parameters. */
export const defaultSkaterParameters: SkaterParameters =
  skaterParameterSchema.parse(spaceDefaults(skaterParameterSpace));

/** The pose after the seeded drift, every value clamped into its range. */
interface Pose {
  readonly crouch: number;
  readonly lean: number;
  readonly armSwing: number;
}

/** Draw the pose drift from the stream: lean, then crouch, then arm swing. */
function poseOf(
  parameters: SkaterParameters,
  rng: SeededRng,
): Pose {
  return {
    lean: clamp(parameters.lean + rng.float(-0.05, 0.05), -1, 1),
    crouch: clamp(parameters.crouch + rng.float(-0.06, 0.06), 0, 1),
    armSwing: clamp(parameters.armSwing + rng.float(-0.1, 0.1), -1, 1),
  };
}

/** One joint of the skeleton. */
interface Skeleton {
  readonly hip: Point;
  readonly shoulder: Point;
  readonly headCenter: Point;
  readonly headRadius: number;
  readonly frontAnkle: Point;
  readonly backAnkle: Point;
  readonly frontKnee: Point;
  readonly backKnee: Point;
  readonly frontHand: Point;
  readonly backHand: Point;
  readonly deckTop: number;
  readonly wheelRadius: number;
  readonly stance: number;
}

/** Place the skeleton of one figure from its parameters and its pose. */
function skeletonOf(parameters: SkaterParameters, pose: Pose): Skeleton {
  const h = parameters.height;
  const wheelRadius = clamp(h * 0.035, 2, 12);
  const deckTop = parameters.board ? -(wheelRadius * 2 + h * 0.024) : 0;
  const stance = Math.max(parameters.boardLength * 0.28, h * 0.07);
  const ankleY = deckTop - h * 0.03;
  const hip: Point = { x: 0, y: -(0.46 - 0.1 * pose.crouch) * h };
  const shoulder: Point = {
    x: pose.lean * 0.1 * h,
    y: -(0.74 - 0.12 * pose.crouch) * h,
  };
  const headRadius = clamp(h * 0.075, 4, 30);
  const headCenter: Point = {
    x: pose.lean * 0.14 * h,
    y: shoulder.y - headRadius - h * 0.03,
  };
  const frontAnkle: Point = { x: stance, y: ankleY };
  const backAnkle: Point = { x: -stance, y: ankleY };
  const frontKnee: Point = {
    x: hip.x + h * (0.06 + 0.1 * pose.crouch),
    y: hip.y + (frontAnkle.y - hip.y) * 0.55,
  };
  const backKnee: Point = {
    x: hip.x + h * (0.04 + 0.07 * pose.crouch),
    y: hip.y + (backAnkle.y - hip.y) * 0.55,
  };
  const frontHand: Point = {
    x: shoulder.x + h * (0.14 + 0.08 * pose.armSwing),
    y: shoulder.y + h * 0.2,
  };
  const backHand: Point = {
    x: shoulder.x - h * (0.1 + 0.06 * pose.armSwing),
    y: shoulder.y + h * 0.18,
  };
  return {
    hip,
    shoulder,
    headCenter,
    headRadius,
    frontAnkle,
    backAnkle,
    frontKnee,
    backKnee,
    frontHand,
    backHand,
    deckTop,
    wheelRadius,
    stance,
  };
}

/**
 * One foot as a wedge that stands on the deck line: the heel lifts a
 * little, the toe stays down, which is how a riding stance reads.
 */
function footPolygon(ankle: Point, deckTop: number, h: number): Path {
  return polygonPath([
    { x: ankle.x - h * 0.028, y: deckTop - h * 0.045 },
    { x: ankle.x + h * 0.07, y: deckTop - h * 0.03 },
    { x: ankle.x + h * 0.075, y: deckTop - h * 0.008 },
    { x: ankle.x - h * 0.024, y: deckTop },
  ]);
}

/** The body mass of one figure: torso, head, legs, and arms, united. */
function bodyPath(parameters: SkaterParameters, skeleton: Skeleton): Path {
  const h = parameters.height;
  const parts: Path[] = [
    // Torso, wider at the hip than at the shoulder.
    limbPolygon(skeleton.hip, skeleton.shoulder, h * 0.13, h * 0.1),
    // Neck and head.
    limbPolygon(
      skeleton.shoulder,
      {
        x: skeleton.headCenter.x,
        y: skeleton.headCenter.y + skeleton.headRadius * 0.5,
      },
      h * 0.05,
      h * 0.06,
    ),
    discPath(skeleton.headCenter, skeleton.headRadius),
  ];
  for (const [knee, ankle] of [
    [skeleton.frontKnee, skeleton.frontAnkle],
    [skeleton.backKnee, skeleton.backAnkle],
  ] as const) {
    parts.push(
      limbPolygon(skeleton.hip, knee, h * 0.085, h * 0.062),
      limbPolygon(knee, ankle, h * 0.058, h * 0.042),
      footPolygon(ankle, skeleton.deckTop, h),
    );
  }
  for (const hand of [skeleton.frontHand, skeleton.backHand] as const) {
    const elbow: Point = {
      x: (skeleton.shoulder.x + hand.x) / 2,
      y: (skeleton.shoulder.y + hand.y) / 2 + h * 0.02,
    };
    parts.push(
      limbPolygon(skeleton.shoulder, elbow, h * 0.05, h * 0.042),
      limbPolygon(elbow, hand, h * 0.04, h * 0.03),
    );
  }
  const united = unitePaths(parts);
  if (united === null) {
    throw new Error("the skater generator could not unite its body mass");
  }
  return united;
}

/**
 * Build the geometry of one skater.
 *
 * Draw order of the stream: the lean draw, then the crouch draw, then the
 * arm swing draw, all inside one `skater:pose` stream.
 */
export function generateSkater(
  parameters: SkaterParameters,
  options: GenerateOptions,
): Geometry {
  const poseStream = options.rng.fork("skater:pose");
  const pose = poseOf(parameters, poseStream);
  const skeleton = skeletonOf(parameters, pose);
  const h = parameters.height;

  const body = bodyPath(parameters, skeleton);
  const styleZones: StyleZone[] = [
    { role: FIGURE_ROLE.role, path: body, zIndex: 14 },
  ];

  const parts: Path[] = [body];
  const contours: Path[] = [body, discPath(skeleton.headCenter, skeleton.headRadius)];
  const boundaries: Path[] = [
    // The hip line splits the torso from the legs, the one interior line a
    // figure in this style keeps.
    polylinePath([
      { x: skeleton.hip.x - h * 0.05, y: skeleton.hip.y },
      { x: skeleton.hip.x + h * 0.05, y: skeleton.hip.y },
    ]),
  ];

  if (parameters.board) {
    const deckThickness = clamp(h * 0.022, 2, 10);
    const deck = roundedRectanglePath(
      -parameters.boardLength / 2,
      skeleton.deckTop - deckThickness,
      parameters.boardLength / 2,
      skeleton.deckTop,
      deckThickness * 0.45,
    );
    const wheels = compoundPath([
      discPath(
        { x: -parameters.boardLength * 0.32, y: -skeleton.wheelRadius },
        skeleton.wheelRadius,
      ),
      discPath(
        { x: parameters.boardLength * 0.32, y: -skeleton.wheelRadius },
        skeleton.wheelRadius,
      ),
    ]);
    if (wheels !== null) {
      parts.push(wheels);
    }
    parts.push(deck);
    contours.push(deck, ...(wheels === null ? [] : [wheels]));
    styleZones.push(
      { role: ARCHITECTURE_ROLE.role, path: deck, zIndex: 13 },
      ...(wheels === null
        ? []
        : [{ role: METAL_ROLE.role, path: wheels, zIndex: 13 }]),
    );
    boundaries.push(
      polylinePath([
        { x: -parameters.boardLength * 0.44, y: skeleton.deckTop },
        { x: parameters.boardLength * 0.44, y: skeleton.deckTop },
      ]),
      ...(wheels === null
        ? []
        : [polylinePath([
            { x: -parameters.boardLength * 0.32, y: -skeleton.wheelRadius },
            { x: parameters.boardLength * 0.32, y: -skeleton.wheelRadius },
          ])]),
    );
  }

  const silhouette = unitePaths(parts);
  if (silhouette === null) {
    throw new Error("the skater generator could not unite its silhouette");
  }

  // One cast shadow grounds the figure. It sits under the mass, never under
  // the whole span, so it reads as light from one side.
  const shadowRadiusY = clamp(h * 0.028, 2, 12);
  const shadowRadiusX = clamp(
    (parameters.board ? parameters.boardLength * 0.62 : h * 0.12) +
      h * 0.05 * pose.lean,
    h * 0.08,
    h * 0.26,
  );
  const shadow = ellipsePath(
    { x: pose.lean * h * 0.06, y: -shadowRadiusY },
    shadowRadiusX,
    shadowRadiusY,
  );
  styleZones.push({ role: SHADOW_ROLE.role, path: shadow, zIndex: 8 });

  return { silhouette, contours, internalBoundaries: boundaries, styleZones };
}

/** The skater generator of the round 2 object registry. */
export const skaterGenerator: ObjectGenerator = {
  kind: "skater",
  title: "A skater: riding stance on a board, grounded by one cast shadow.",
  zoneRoles: [FIGURE_ROLE, ARCHITECTURE_ROLE, METAL_ROLE, SHADOW_ROLE],
  parameterSpace: skaterParameterSpace,
  defaultParameters: spaceDefaults(skaterParameterSpace),
  parseParameters: (raw) =>
    parseParametersWith("skater", skaterParameterSchema, skaterParameterSpace, raw),
  generate: (parameters, options: GenerateOptions) =>
    generateSkater(skaterParameterSchema.parse(parameters), options),
};

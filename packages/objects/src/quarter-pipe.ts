/**
 * The quarter pipe generator (specification sections 6, 11, and 24).
 *
 * A quarter pipe is one transition pulled out of a quarter ellipse: a flat
 * take off at the bottom that rolls up into a vertical wall, with a deck
 * platform on top and a coping tube at the lip. The semantic parameters of
 * section 6 map onto the riding curve, the back wall, echo transition lines
 * inside the ramp body, and the platform.
 *
 * Local frame: the ramp stands on the line `y = 0`, centered on `x = 0`,
 * and its mass grows towards negative y. The take off sits at the left, the
 * vertical wall at the right, so a mirror or a hip comes from the rotation
 * of the placement, not from a parameter.
 *
 * Poured concrete stays controlled (specification section 17), so this
 * generator draws no random number.
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
import {
  clamp,
  continuePath,
  polylinePath,
  rectanglePath,
  withClose,
} from "./shapes.js";

/** Anchors along the riding curve, from the take off to the lip. */
const PROFILE_ANCHORS = 11;

/** The semantic parameters of a quarter pipe (specification section 6). */
export const quarterPipeParameterSchema = z.object({
  /** Horizontal run of the transition. */
  width: z.number().finite().min(60).max(1200),
  /** Vertical rise from the ground to the lip. */
  height: z.number().finite().min(40).max(600),
  /**
   * How round the transition is: 0 rides one long bank, 1 rides the exact
   * quarter ellipse of a poured transition.
   */
  curvature: z.number().finite().min(0).max(1),
  /** Deck platform behind the lip. */
  platform: z.number().finite().min(0).max(200),
  /** The metal coping tube drawn at the lip. */
  coping: z.boolean(),
  /** Echo transition lines inside the ramp body. */
  transitionLines: z.number().int().min(1).max(5),
});

/** The quarter pipe parameters. */
export type QuarterPipeParameters = z.infer<typeof quarterPipeParameterSchema>;

/** The range and the default of every quarter pipe parameter. */
export const quarterPipeParameterSpace: ParameterSpace = {
  width: numberField(60, 1200, 240),
  height: numberField(40, 600, 150),
  curvature: numberField(0, 1, 0.55),
  platform: numberField(0, 200, 34),
  coping: booleanField(true),
  transitionLines: integerField(1, 5, 3),
};

/** The default quarter pipe parameters. */
export const defaultQuarterPipeParameters: QuarterPipeParameters =
  quarterPipeParameterSchema.parse(spaceDefaults(quarterPipeParameterSpace));

/**
 * One point of the riding curve at `share` from the take off to the lip.
 *
 * The quarter ellipse runs flat at the take off and vertical at the lip,
 * which is the shape of a transition. The straight ramp is the chord, and
 * the curve blends towards it as `curvature` falls, so 0 still rides a bank
 * and never a wall.
 */
function ridingPoint(
  share: number,
  parameters: QuarterPipeParameters,
): Point {
  const halfWidth = parameters.width / 2;
  const angle = (share * Math.PI) / 2;
  const ellipseX = Math.sin(angle);
  const ellipseY = 1 - Math.cos(angle);
  const blend = 0.3 + 0.7 * parameters.curvature;
  return {
    x: -halfWidth + (ellipseX * blend + share * (1 - blend)) * parameters.width,
    y: -(ellipseY * blend + share * (1 - blend)) * parameters.height,
  };
}

/** The riding curve, one spline through evenly spaced take off to lip anchors. */
function ridingCurve(parameters: QuarterPipeParameters): Path {
  const anchors: Point[] = [];
  for (let index = 0; index < PROFILE_ANCHORS; index += 1) {
    anchors.push(ridingPoint(index / (PROFILE_ANCHORS - 1), parameters));
  }
  return splineThroughPoints(anchors, { tension: 0.5 });
}

/**
 * Build the geometry of one quarter pipe.
 *
 * The quarter pipe draws no random number: poured concrete stays controlled
 * (specification section 17).
 */
export function generateQuarterPipe(
  parameters: QuarterPipeParameters,
): Geometry {
  const halfWidth = parameters.width / 2;
  const curve = ridingCurve(parameters);
  const lip = ridingPoint(1, parameters);

  // One closed area: the riding curve up, the back wall down, and the close
  // back along the ground line to the take off.
  const silhouette = withClose(
    continuePath(curve, polylinePath([lip, { x: halfWidth, y: 0 }])),
  );

  const contours: Path[] = [
    curve,
    // The back wall carries the ramp, the way a stud wall reads behind a
    // transition.
    polylinePath([lip, { x: halfWidth, y: 0 }]),
    polylinePath([
      { x: -halfWidth, y: 0 },
      { x: halfWidth, y: 0 },
    ]),
  ];

  const boundaries: Path[] = [
    // The lip line spans the platform, the read of the deck on top of a
    // transition.
    polylinePath([lip, { x: halfWidth + parameters.platform, y: lip.y }]),
  ];
  for (let index = 1; index <= parameters.transitionLines; index += 1) {
    const share = (index / (parameters.transitionLines + 1)) * 0.55;
    const echo = offsetPath(silhouette, -Math.max(2, parameters.height * share * 0.6));
    if (echo !== null) {
      boundaries.push(echo);
    }
  }
  if (parameters.coping) {
    boundaries.push(
      polylinePath([ridingPoint(1, parameters), ridingPoint(0.9, parameters)]),
    );
  }

  const styleZones: StyleZone[] = [
    { role: CONCRETE_ROLE.role, path: silhouette, zIndex: 12 },
  ];
  if (parameters.platform >= 1) {
    const thickness = clamp(parameters.platform * 0.3, 4, 24);
    styleZones.push({
      role: PAVEMENT_ROLE.role,
      path: rectanglePath(
        halfWidth,
        lip.y - thickness,
        halfWidth + parameters.platform,
        lip.y,
      ),
      zIndex: 11,
    });
  }

  return { silhouette, contours, internalBoundaries: boundaries, styleZones };
}

/** The quarter pipe generator of the round 2 object registry. */
export const quarterPipeGenerator: ObjectGenerator = {
  kind: "quarter-pipe",
  title: "A quarter pipe: transition wall with a deck platform and coping.",
  zoneRoles: [CONCRETE_ROLE, PAVEMENT_ROLE],
  parameterSpace: quarterPipeParameterSpace,
  defaultParameters: spaceDefaults(quarterPipeParameterSpace),
  parseParameters: (raw) =>
    parseParametersWith(
      "quarter-pipe",
      quarterPipeParameterSchema,
      quarterPipeParameterSpace,
      raw,
    ),
  generate: (parameters) =>
    generateQuarterPipe(quarterPipeParameterSchema.parse(parameters)),
};

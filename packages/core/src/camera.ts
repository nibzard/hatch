/**
 * The camera and composition model (specification sections 4B, 5, and 18).
 *
 * The scene schema accepts seven camera and composition controls the
 * compiler has to honor: `camera.framing`, `camera.lens`, `camera.tilt`,
 * `camera.perspectiveStrength`, `composition.balance`,
 * `composition.depthLayers`, and `composition.focalPoints`. This module is
 * the one place that reads them, so every control has one documented effect
 * and one number the plan and the trace can record. The eighth control of
 * the two blocks, `composition.negativeSpace`, works on ink instead of
 * placement, so negative-space.ts is the one place that reads it.
 *
 * The controls compose into the placement transform of every object:
 *
 * - `framing` scales the subject the frame holds. A close frame draws the
 *   same objects larger than a wide frame.
 * - `lens` sets the base depth exaggeration. A normal lens keeps the depth
 *   stack nearly flat; an ultra-wide lens separates near from far.
 * - `perspectiveStrength` scales the depth exaggeration of the lens, so one
 *   render can flatten the stack the same lens drew deep.
 * - `depthLayers` says how many planes the depth stack spans. One plane is
 *   flat, because every object shares it.
 * - `balance` moves the layout off the vertical center line, or spreads it
 *   away from that line when the balance is asymmetric.
 * - `focalPoints` names the objects the composition emphasizes. Each one
 *   draws larger.
 * - `tilt` rolls the framing, so the horizon and every anchor tilt with it.
 *
 * Every function here is closed-form code and draws no random number, so
 * the same camera block plans the same layout (specification section 10).
 */

import type { Path, Point } from "./path.js";
import type {
  Balance,
  Framing,
  Lens,
  SceneObject,
  SceneSpec,
} from "./scene.js";

/**
 * How much of the frame the subject fills, per framing value. The multiplier
 * applies to every object scale, so `close` draws the same scene larger than
 * `wide` at the same canvas.
 */
export const FRAMING_SUBJECT_SCALE: Readonly<Record<Framing, number>> = {
  wide: 0.85,
  medium: 1,
  close: 1.3,
};

/**
 * The base depth exaggeration of each lens, as a share in [0, 1]. Zero is an
 * orthographic stack: the plane an object sits on does not change its size.
 * One is the strongest separation an ultra-wide lens draws.
 */
export const LENS_PERSPECTIVE: Readonly<Record<Lens, number>> = {
  normal: 0.35,
  wide: 0.7,
  "ultra-wide": 1,
};

/**
 * The `perspectiveStrength` a camera that omits it carries: the lens applies
 * its full base exaggeration.
 */
export const DEFAULT_PERSPECTIVE_STRENGTH = 1;

/** The largest `perspectiveStrength` the planner honors. */
export const MAX_PERSPECTIVE_STRENGTH = 1;

/**
 * The largest camera roll the planner honors, in degrees. A stronger roll
 * would push the horizon past the side edges of a wide canvas, so the value
 * clamps to this band the way the horizon clamps into its preferred band.
 */
export const MAX_CAMERA_TILT_DEGREES = 12;

/**
 * How far the `left` and `right` balances move the layout, as a share of the
 * canvas width. The `center` balance moves nothing.
 */
export const BALANCE_SHIFT: Readonly<Record<Balance, number>> = {
  left: -0.06,
  center: 0,
  right: 0.06,
  asymmetric: 0,
};

/**
 * How much farther the `asymmetric` balance spreads the layout away from the
 * vertical center line. Zero would leave it the same as `center`, so the
 * value is what separates the two.
 */
export const ASYMMETRIC_SPREAD = 0.15;

/**
 * The scale multiplier of an object `composition.focalPoints` names. The
 * emphasis is what a focal point is: the composition asks the viewer to look
 * there, so the object draws larger than its neighbours.
 */
export const FOCAL_EMPHASIS_SCALE = 1.25;

/**
 * How far the depth ramp may stretch one plane, as a share of the object
 * scale. Together with a full-strength perspective this moves the nearest
 * plane to about 1.54 and the farthest plane to about 0.85 of the base size.
 */
export const DEPTH_SCALE_SPAN = 0.35;

/**
 * The largest depth stack the planner lays out. The four draw roles of
 * specification section 5 - background, midground, foreground, focal - span
 * four planes, so a deeper count clamps to this.
 */
export const MAX_DEPTH_LAYERS = 4;

/**
 * The draw role the depth ramp stays neutral at: the midground. Objects in
 * front of it grow, objects behind it shrink, and the midground itself holds
 * the size the framing and the focal emphasis set.
 */
export const NEUTRAL_ROLE_DEPTH = 1;

/**
 * The distance from the neutral role to the nearest role, in role steps.
 * The ramp normalizes every role against this span, so the focal role lands
 * at +1 and the background role at -0.5.
 */
export const ROLE_DEPTH_SPAN = 2;

/** Every decision the camera and the composition blocks drive. */
export interface CameraDecision {
  /** The framing the camera asked for. */
  readonly framing: Framing;
  /** The subject scale multiplier of {@link framing}. */
  readonly framingScale: number;
  /** The lens the camera carries. */
  readonly lens: Lens;
  /**
   * The depth exaggeration in [0, 1] the render applies: the base of the
   * lens scaled by `perspectiveStrength`.
   */
  readonly perspective: number;
  /** The `perspectiveStrength` the camera asked for, after clamping. */
  readonly perspectiveStrength: number;
  /** True when `perspectiveStrength` sat outside [0, 1] and moved. */
  readonly perspectiveStrengthClamped: boolean;
  /** The camera roll in degrees, after clamping into the band above. */
  readonly tiltDegrees: number;
  /** True when `tilt` sat outside the band and moved. */
  readonly tiltClamped: boolean;
  /** The balance the composition asked for. */
  readonly balance: Balance;
  /** The horizontal shift of the balance, as a share of the canvas width. */
  readonly balanceShift: number;
  /** The off-axis spread the balance adds, as a share of the half width. */
  readonly balanceSpread: number;
  /** The plane count of the depth stack, after clamping into [1, 4]. */
  readonly depthLayers: number;
  /** True when `depthLayers` sat outside [1, 4] and moved. */
  readonly depthLayersClamped: boolean;
  /** The object ids `composition.focalPoints` names, in spec order. */
  readonly focalPointIds: readonly string[];
}

/** Clamp one value into a closed range. */
function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

/**
 * Read every camera and composition control of one spec.
 *
 * Three controls clamp instead of failing, the way the horizon clamps into
 * the band the style prefers: `perspectiveStrength` into [0, 1], `tilt` into
 * the roll band, and `depthLayers` into the plane count the four draw roles
 * span. Each clamp is recorded, so the trace can say why the render differs
 * from what the spec wrote.
 *
 * A focal point that names no object of the scene is a dangling reference,
 * so this is where it fails: the message names the id and the fix.
 */
export function cameraDecisionOf(spec: SceneSpec): CameraDecision {
  const { camera, composition } = spec;

  const requestedStrength = camera.perspectiveStrength ??
    DEFAULT_PERSPECTIVE_STRENGTH;
  const perspectiveStrength = clamp(
    requestedStrength,
    0,
    MAX_PERSPECTIVE_STRENGTH,
  );

  const requestedTilt = camera.tilt ?? 0;
  const tiltDegrees = clamp(
    requestedTilt,
    -MAX_CAMERA_TILT_DEGREES,
    MAX_CAMERA_TILT_DEGREES,
  );

  const requestedLayers = composition.depthLayers;
  const depthLayers = clamp(requestedLayers, 1, MAX_DEPTH_LAYERS);

  const focalPointIds = composition.focalPoints;
  const known = new Set(spec.objects.map((object) => object.id));
  const dangling = focalPointIds.filter((id) => !known.has(id));
  if (dangling.length > 0) {
    throw new Error(
      `composition.focalPoints names ${dangling.map((id) => `"${id}"`).join(", ")}, ` +
        `which no object of scene "${spec.meta.id}" carries; ` +
        `remove the id or add the object`,
    );
  }

  return {
    framing: camera.framing,
    framingScale: FRAMING_SUBJECT_SCALE[camera.framing],
    lens: camera.lens,
    perspective: LENS_PERSPECTIVE[camera.lens] * perspectiveStrength,
    perspectiveStrength,
    perspectiveStrengthClamped: perspectiveStrength !== requestedStrength,
    tiltDegrees,
    tiltClamped: tiltDegrees !== requestedTilt,
    balance: composition.balance,
    balanceShift: BALANCE_SHIFT[composition.balance],
    balanceSpread: composition.balance === "asymmetric"
      ? ASYMMETRIC_SPREAD
      : 0,
    depthLayers,
    depthLayersClamped: depthLayers !== requestedLayers,
    focalPointIds,
  };
}

/**
 * How much of the depth ramp the stack of {@link CameraDecision.depthLayers}
 * planes carries, as a share in [0, 1].
 *
 * One plane holds every object at the same distance, so the share is 0 and
 * the lens cannot separate anything. Each further plane adds a third, and
 * four planes - the full span of the four draw roles - carry the whole ramp.
 */
export function depthRampOf(decision: CameraDecision): number {
  return (decision.depthLayers - 1) / (MAX_DEPTH_LAYERS - 1);
}

/**
 * The depth scale multiplier of one draw role under one camera.
 *
 * The multiplier is a reciprocal around the neutral role: the share
 * `perspective x ramp x span` moves a plane in front of the neutral role up
 * and a plane behind it down. A flat stack, a normal share, or a neutral role
 * all return 1, so the depth ramp never moves an object the camera did not
 * separate.
 */
export function depthScaleOf(
  decision: CameraDecision,
  roleDepth: number,
): number {
  const share =
    decision.perspective * depthRampOf(decision) * DEPTH_SCALE_SPAN;
  const offset = (roleDepth - NEUTRAL_ROLE_DEPTH) / ROLE_DEPTH_SPAN;
  return 1 / (1 - share * offset);
}

/** True when the composition names the object as a focal point. */
export function isFocalPoint(
  decision: CameraDecision,
  object: SceneObject,
): boolean {
  return decision.focalPointIds.includes(object.id);
}

/** The placement transform the camera computes for one scene object. */
export interface PlacementCamera {
  /**
   * The complete scale of the placement: the object scale under the framing,
   * the depth plane, and the focal emphasis. The object generator applies it
   * instead of the scale the spec states.
   */
  readonly scale: number;
  /**
   * The complete rotation of the placement in degrees, counter-clockwise as
   * the viewer sees it: the rotation the object states plus the camera roll.
   */
  readonly rotation: number;
}

/** Round one multiplier to a short, stable value. */
function roundScale(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/**
 * The placement transform of one object under one camera.
 *
 * The transform composes the controls in a fixed order - framing, depth
 * plane, focal emphasis - so a reader can predict each one from the number
 * the trace records. The roll the camera carries adds to the rotation of the
 * object, because a rolled framing leans everything it holds.
 */
export function placementCameraOf(
  decision: CameraDecision,
  object: SceneObject,
  roleDepth: number,
): PlacementCamera {
  const emphasis = isFocalPoint(decision, object)
    ? FOCAL_EMPHASIS_SCALE
    : 1;
  return {
    scale: roundScale(
      object.scale *
        decision.framingScale *
        depthScaleOf(decision, roleDepth) *
        emphasis,
    ),
    rotation: (object.rotation ?? 0) + decision.tiltDegrees,
  };
}

/** The horizontal position of one object under the composition balance. */
export function balanceXOf(
  decision: CameraDecision,
  x: number,
): { x: number; clamped: boolean } {
  const centered = 0.5 + (x - 0.5) * (1 + decision.balanceSpread);
  const shifted = centered + decision.balanceShift;
  const clamped = clamp(shifted, 0, 1);
  return { x: clamped, clamped: clamped !== shifted };
}

/** Roll one point about a center, in degrees, the way the viewer sees it. */
export function rollPoint(
  point: Point,
  center: Point,
  degrees: number,
): Point {
  if (degrees === 0) {
    return point;
  }
  const angle = (degrees * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  // The y axis of the canvas points down, so the added sine term turns the
  // point counter-clockwise on screen, the same convention the placement
  // transform of an object uses.
  return {
    x: center.x + dx * cos + dy * sin,
    y: center.y - dx * sin + dy * cos,
  };
}

/** Roll every point of one path about a center, in degrees. */
export function rollPath(path: Path, center: Point, degrees: number): Path {
  if (degrees === 0) {
    return path;
  }
  return {
    commands: path.commands.map((command) => {
      if (command.command === "close") {
        return command;
      }
      if (command.command === "curve") {
        return {
          command: "curve" as const,
          to: rollPoint(command.to, center, degrees),
          control1: rollPoint(command.control1, center, degrees),
          control2: rollPoint(command.control2, center, degrees),
        };
      }
      return {
        command: command.command,
        to: rollPoint(command.to, center, degrees),
      };
    }),
  };
}

/**
 * Where the rolled horizon sits, as scene heights.
 *
 * The roll turns the horizon line about the canvas center. The line keeps its
 * height at the center column and slopes away from it, so the `left` and
 * `right` heights describe the sky and the ground region: the sky is the quad
 * above both, the ground the quad below. A roll inside the band above always
 * crosses the side edges, so every height stays on the canvas.
 */
export function rolledHorizonHeights(
  horizonY: number,
  canvas: { width: number; height: number },
  degrees: number,
): { left: number; right: number; center: number } {
  if (degrees === 0) {
    return { left: horizonY, right: horizonY, center: horizonY };
  }
  const angle = (degrees * Math.PI) / 180;
  const center = { x: canvas.width / 2, y: canvas.height / 2 };
  // The horizon line turns about the canvas center, so its center point is
  // the rolled height of `horizonY` and its slope is the rolled level line.
  const rolled = rollPoint({ x: center.x, y: horizonY }, center, degrees);
  const slope = -Math.tan(angle);
  const heightAt = (x: number): number => rolled.y + slope * (x - rolled.x);
  return {
    left: clamp(heightAt(0), 0, canvas.height),
    right: clamp(heightAt(canvas.width), 0, canvas.height),
    center: clamp(heightAt(canvas.width / 2), 0, canvas.height),
  };
}

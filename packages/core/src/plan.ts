/**
 * The scene planning stage (specification sections 4B, 5, and 18).
 *
 * Planning turns a scene spec into a scene graph before any path exists: it
 * fixes the canvas from the aspect ratio, reads the camera and the
 * composition into one camera decision, places the horizon inside the band
 * the style prefers, lays out the sky and ground regions, assigns every
 * object a depth order and a scene anchor, and carves the cloud cutouts the
 * environment asks for. The style application stage decides later how each
 * planned region is filled, so planning stays pure layout.
 *
 * The planner is style-constrained (specification section 18): it reads the
 * `compositionGrammar` of the resolved style, and it records in the plan why
 * the horizon moved when it moved. Everything here is plain data and
 * closed-form numeric code, and every random value comes from the planning
 * stream the engine passes in, so the same spec under the same style and the
 * same stream always plans the same scene (specification section 10).
 */

import {
  balanceXOf,
  cameraDecisionOf,
  isFocalPoint,
  placementCameraOf,
  rollPath,
  rollPoint,
  rolledHorizonHeights,
  type CameraDecision,
  type PlacementCamera,
} from "./camera.js";
import {
  environmentDecisionOf,
  skyDecisionOf,
  type EnvironmentDecision,
} from "./environment.js";
import type { Canvas } from "./ir.js";
import {
  negativeSpaceDecisionOf,
  type NegativeSpaceDecision,
} from "./negative-space.js";
import type { Path, Point } from "./path.js";
import {
  objectGrammarDecisionOf,
  type ObjectGrammarDecision,
} from "./object-grammar.js";
import type { SeededRng } from "./rng.js";
import type {
  SceneObject,
  SceneObjectRole,
  SceneSpec,
} from "./scene.js";
import type { ResolvedStyleSpec } from "./style.js";

/**
 * The reference width of every output canvas, in SVG user units. The height
 * follows the aspect ratio, so a 4:3 scene renders at 1024 x 768, the scale
 * the pastoral preset documents its distances against.
 */
export const CANVAS_BASE_WIDTH = 1024;

/** The draw depth of each scene object role: higher draws in front. */
export const ROLE_DEPTH: Readonly<Record<SceneObjectRole, number>> = {
  background: 0,
  midground: 1,
  foreground: 2,
  focal: 3,
};

/** The depth an object without a `role` draws at: with the midground. */
export const DEFAULT_ROLE_DEPTH = ROLE_DEPTH.midground;

/** One axis-aligned closed rectangle, the shape of both scene regions. */
export function rectanglePath(
  x: number,
  y: number,
  width: number,
  height: number,
): Path {
  return {
    commands: [
      { command: "move", to: { x, y } },
      { command: "line", to: { x: x + width, y } },
      { command: "line", to: { x: x + width, y: y + height } },
      { command: "line", to: { x, y: y + height } },
      { command: "close" },
    ],
  };
}

/** Clamp one value into the range [0, 1]. */
function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

/** Round one length to whole milli-units, so path numbers stay short. */
function roundLength(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Round one canvas edge to a whole user unit, so the viewBox stays clean. */
function roundEdge(value: number): number {
  return Math.round(value);
}

/** One region skeleton: where it sits and when it draws, before any fill. */
export interface PlannedRegion {
  /** Region id. Unique inside one plan. */
  readonly id: string;
  /** Region role from specification section 16C, for example "sky". */
  readonly role: string;
  /** The region area, in scene units. */
  readonly path: Path;
  /** Draw order. Regions with a lower zIndex draw first. */
  readonly zIndex: number;
}

/** One negative-space mask the planner carves, for example a cloud. */
export interface PlannedMask {
  /** Mask id. Unique inside one plan. */
  readonly id: string;
  /** The area the mask erases, in scene units. */
  readonly path: Path;
}

/**
 * One scene-level contour line the planner lays out, for example a ground
 * strip. It carries no ink of its own: the style application stage strokes
 * it with the contour rules of the style.
 */
export interface PlannedContour {
  /** Contour id. Unique inside one plan. */
  readonly id: string;
  /** The line the style stage strokes, in scene units. */
  readonly path: Path;
}

/** One placed object: its anchor in scene units and its draw depth. */
export interface ObjectPlacement {
  /** The scene object from the spec. */
  readonly object: SceneObject;
  /** Where the local origin of the object lands, in scene units. */
  readonly anchor: Point;
  /** The draw depth of the object role. */
  readonly depth: number;
  /** The index of the object in depth order. */
  readonly depthIndex: number;
  /** True when a position outside the canvas was clamped onto it. */
  readonly positionClamped: boolean;
  /** True when `composition.focalPoints` names the object. */
  readonly focal: boolean;
  /**
   * The placement transform the camera computed for the object: the object
   * scale under the framing, the depth plane, and the focal emphasis, and the
   * object rotation plus the camera roll.
   */
  readonly camera: PlacementCamera;
}

/** The result of the horizon decision, for the plan and its trace event. */
export interface HorizonPlacement {
  /** The horizon the plan uses, as a normalized height in [0, 1]. */
  readonly horizonY: number;
  /** The horizon the camera asked for, before any clamping. */
  readonly requestedHorizonY: number;
  /** The band the style prefers, as [low, high] normalized heights. */
  readonly preferredHorizonBand: readonly [number, number];
  /** True when the requested horizon sat outside the band and moved. */
  readonly wasClamped: boolean;
}

/** The scene graph the geometry and style stages consume. */
export interface ScenePlan {
  /** The output canvas, in SVG user units. */
  readonly canvas: Canvas;
  /** The horizon line, in scene units from the top edge. */
  readonly horizonY: number;
  /** The horizon decision of the planner (specification section 9B). */
  readonly horizon: HorizonPlacement;
  /**
   * The camera and composition decision the layout follows, and the trace
   * records (specification sections 5 and 9B).
   */
  readonly camera: CameraDecision;
  /**
   * The horizon heights of the rolled framing: where the horizon crosses the
   * left and the right canvas edge, and the height it holds at the center
   * column. All three equal {@link horizonY} until the camera rolls.
   */
  readonly horizonHeights: {
    readonly left: number;
    readonly right: number;
    readonly center: number;
  };
  /** The sky and ground region skeletons, in draw order. */
  readonly regions: readonly PlannedRegion[];
  /**
   * The environment decision the plan follows: the ground strips it laid
   * out, and the fog and the rain the style application stage reads back
   * from here (specification section 5).
   */
  readonly environment: EnvironmentDecision;
  /** The ground strip lines the environment asked for, in band order. */
  readonly groundStrips: readonly PlannedContour[];
  /** The cloud cutouts, in placement order. */
  readonly masks: readonly PlannedMask[];
  /**
   * The negative-space decision of the composition: the ask, the floor of
   * the style, and the spacing multiplier the style application stage opens
   * every hatch fill by (specification sections 5 and 18).
   */
  readonly negativeSpace: NegativeSpaceDecision;
  /**
   * The object grammar decision of the style: the detail budget the
   * geometry synthesis stage enforces over every object, the corner
   * rounding share it applies, and whether openings stay paper
   * (specification sections 3C, 8, and 18). The plan carries the decision
   * so both stages that enforce it read one record, the way both read the
   * fog of the environment.
   */
  readonly objectGrammar: ObjectGrammarDecision;
  /** Every object in depth order, with its scene anchor. */
  readonly placements: readonly ObjectPlacement[];
  /** The object ids in depth order, the draw order of the scene. */
  readonly depthOrder: readonly string[];
  /** The ids of the objects whose position was clamped onto the canvas. */
  readonly clampedObjectIds: readonly string[];
  /** How many objects carry the focal role. */
  readonly focalObjectCount: number;
}

/**
 * The canvas of one aspect ratio: the base width, and the height that
 * matches the ratio. "4:3" reads as width 4 to height 3.
 *
 * Throws one readable error for a ratio that does not name two positive
 * numbers. The scene schema already blocks malformed text, so the error is
 * for callers that build a plan by hand.
 */
export function canvasOfAspectRatio(aspectRatio: string): Canvas {
  const match = /^(\d+):(\d+)$/.exec(aspectRatio);
  if (match === null) {
    throw new Error(
      `aspect ratio "${aspectRatio}" must look like "4:3" or "16:9"`,
    );
  }
  const widthPart = Number(match[1]);
  const heightPart = Number(match[2]);
  if (widthPart <= 0 || heightPart <= 0) {
    throw new Error(
      `aspect ratio "${aspectRatio}" needs two positive numbers`,
    );
  }
  return {
    width: CANVAS_BASE_WIDTH,
    height: roundEdge((CANVAS_BASE_WIDTH * heightPart) / widthPart),
  };
}

/**
 * Place the horizon: the camera asks, the style constrains.
 *
 * A horizon inside the preferred band passes through unchanged. One outside
 * moves to the nearer band edge, and the plan records the move, because a
 * reader of the trace must see why the horizon is not where the camera put
 * it (specification sections 9B and 18).
 */
export function horizonOf(
  spec: SceneSpec,
  style: ResolvedStyleSpec,
): HorizonPlacement {
  const requestedHorizonY = spec.camera.horizonY;
  const [low, high] = style.compositionGrammar.preferredHorizonBand;
  const horizonY = Math.min(Math.max(requestedHorizonY, low), high);
  return {
    horizonY,
    requestedHorizonY,
    preferredHorizonBand: [low, high],
    wasClamped: horizonY !== requestedHorizonY,
  };
}

/** The draw depth of one scene object: its role depth, or the default. */
export function depthOfObject(object: SceneObject): number {
  return object.role === undefined ? DEFAULT_ROLE_DEPTH : ROLE_DEPTH[object.role];
}

/**
 * Place every object of a spec: normalized positions become scene anchors,
 * and objects sort into depth order.
 *
 * A position is normalized to the canvas: {x: 0.5, y: 0.68} anchors at the
 * horizontal center, 68 percent down. The composition balance then moves the
 * anchor off the center line, or spreads it away from that line, and the
 * camera roll turns the result about the canvas center. Values outside [0, 1]
 * clamp onto the canvas rather than drawing off it - a spec position outside
 * the canvas, or a balance that pushed a position off it - and the placement
 * records the clamp so the trace can name the objects that moved. The roll is
 * not a clamp: a rolled framing moves content off the canvas on purpose.
 *
 * The placement also carries the transform the camera computed for the
 * object, so the geometry stage sizes and turns it the way the camera looks
 * at it, and a flag for the objects the composition names as focal points.
 */
export function placementsOf(
  spec: SceneSpec,
  canvas: Canvas,
  camera: CameraDecision = cameraDecisionOf(spec),
): ObjectPlacement[] {
  const indexed = spec.objects.map((object, index) => ({
    object,
    index,
    depth: depthOfObject(object),
  }));
  indexed.sort((left, right) => left.depth - right.depth || left.index - right.index);
  const center = { x: canvas.width / 2, y: canvas.height / 2 };
  return indexed.map((entry, depthIndex) => {
    const position = entry.object.position;
    const x = clamp01(position.x);
    const y = clamp01(position.y);
    const balanced = balanceXOf(camera, x);
    const rolled = rollPoint(
      { x: balanced.x * canvas.width, y: y * canvas.height },
      center,
      camera.tiltDegrees,
    );
    return {
      object: entry.object,
      anchor: {
        x: roundLength(rolled.x),
        y: roundLength(rolled.y),
      },
      depth: entry.depth,
      depthIndex,
      positionClamped:
        x !== position.x || y !== position.y || balanced.clamped,
      focal: isFocalPoint(camera, entry.object),
      camera: placementCameraOf(camera, entry.object, entry.depth),
    };
  });
}

/**
 * Read the cloud count of the environment: `environment.sky.cloudCount`.
 *
 * Clouds are cutouts, not objects (specification sections 7 and 24), so they
 * live in the free-form sky block of the environment. The environment model
 * owns that block's vocabulary, so this is the planner's read of its
 * decision: a key the model does not read, or a count outside its range,
 * throws there, named with the field that carries it (specification
 * section 19).
 */
export function cloudCountOf(spec: SceneSpec): number {
  return skyDecisionOf(spec).cloudCount;
}

/**
 * One cloud cutout: a lumpy top over a flat base.
 *
 * The outline walks from the left end of the base over `puffs` lobes to the
 * right end, then closes along the base. Every knob - the height, the lobe
 * count, the lobe depth, the phase - comes from the stream, so the same
 * stream draws the identical cloud.
 *
 * `center` names the base line of the cloud; the mass grows upward from it,
 * which is how a cloud bank reads in a hatched sky.
 */
export function cloudPath(rng: SeededRng, center: Point, width: number): Path {
  const halfWidth = width / 2;
  const height = width * rng.float(0.3, 0.42);
  const puffs = rng.int(3, 5);
  const lobeDepth = rng.float(0.15, 0.3);
  const phase = rng.float(0, Math.PI * 2);
  const steps = 40;

  const commands: Path["commands"] = [
    { command: "move", to: { x: roundLength(center.x - halfWidth), y: roundLength(center.y) } },
  ];
  for (let index = 1; index <= steps; index += 1) {
    const t = (index / steps) * Math.PI;
    const rise =
      height * Math.sin(t) * (1 + lobeDepth * Math.sin(puffs * t + phase));
    commands.push({
      command: "line",
      to: {
        x: roundLength(center.x - halfWidth * Math.cos(t)),
        y: roundLength(center.y - Math.max(rise, 0)),
      },
    });
  }
  commands.push({ command: "close" });
  return { commands };
}

/**
 * The cloud cutouts of one sky, in placement order.
 *
 * Each cloud forks its own stream under its index, so a sky with more clouds
 * leaves the numbers of every other cloud unchanged. The clouds spread over
 * the width and stay on the canvas: the base band starts low enough for the
 * mass above it, and the centers keep one half-width of margin at each side.
 */
export function cloudMasks(
  count: number,
  rng: SeededRng,
  canvas: Canvas,
  horizonY: number,
): PlannedMask[] {
  const masks: PlannedMask[] = [];
  if (count <= 0) {
    return masks;
  }
  const bandTop = canvas.height * 0.14;
  const bandBottom = Math.max(
    bandTop + 1,
    Math.min(canvas.height * 0.5, horizonY * 0.85),
  );
  for (let index = 0; index < count; index += 1) {
    const stream = rng.fork(`cloud:${index}`);
    const slot = (index + 0.5) / count;
    const center = {
      x:
        canvas.width *
        roundLength(
          clamp01(
            Math.min(
              Math.max(stream.float(slot - 0.2, slot + 0.2), 0.15),
              0.85,
            ),
          ),
        ),
      y: roundLength(bandTop + stream.next() * (bandBottom - bandTop)),
    };
    const width = roundLength(canvas.width * stream.float(0.1, 0.22));
    masks.push({
      id: `cloud-${index + 1}`,
      path: cloudPath(stream, center, width),
    });
  }
  return masks;
}

/**
 * One ground strip: a gently waving line across the ground plane.
 *
 * The line runs the full canvas width and follows the horizon the way a
 * mown field does: it sits at `share` of the band between the horizon and
 * the bottom edge, so the strips of one ground divide the band evenly
 * whatever the horizon height or the camera roll. The wave comes from one
 * phase draw of the stream, so the same stream draws the identical strip.
 */
function groundStripPath(
  rng: SeededRng,
  canvas: Canvas,
  heights: { left: number; right: number },
  share: number,
): Path {
  const steps = 24;
  const phase = rng.float(0, Math.PI * 2);
  const amplitude = Math.min(3, canvas.height * 0.004);
  const horizonAt = (x: number): number =>
    heights.left + (heights.right - heights.left) * (x / canvas.width);

  const commands: Path["commands"] = [];
  for (let index = 0; index <= steps; index += 1) {
    const x = (index / steps) * canvas.width;
    const top = horizonAt(x);
    const base = top + share * (canvas.height - top);
    const wave = amplitude * Math.sin((index / steps) * Math.PI * 3 + phase);
    commands.push({
      command: index === 0 ? "move" : "line",
      to: { x: roundLength(x), y: roundLength(base + wave) },
    });
  }
  return { commands };
}

/**
 * The ground strips the environment asks for, in band order from the
 * horizon down.
 *
 * Each strip forks its own stream under its index, the way each cloud
 * does, so a ground with more strips leaves the numbers of every other
 * strip and of every cloud unchanged.
 */
export function groundStrips(
  count: number,
  rng: SeededRng,
  canvas: Canvas,
  heights: { left: number; right: number },
): PlannedContour[] {
  const strips: PlannedContour[] = [];
  for (let index = 1; index <= count; index += 1) {
    strips.push({
      id: `ground-strip-${index}`,
      path: groundStripPath(
        rng.fork(`ground-strip:${index}`),
        canvas,
        heights,
        index / (count + 1),
      ),
    });
  }
  return strips;
}

/**
 * The sky and ground region skeletons under one horizon.
 *
 * The sky is the quad above the horizon and the ground the quad below it. A
 * level horizon gives two rectangles; a rolled horizon gives two quads whose
 * shared edge follows the roll. The command order matches the rectangle
 * builder, so a level horizon plans the identical regions it wrote.
 */
function sceneRegions(
  canvas: Canvas,
  heights: { left: number; right: number },
): PlannedRegion[] {
  const left = roundLength(heights.left);
  const right = roundLength(heights.right);
  return [
    {
      id: "sky",
      role: "sky",
      path: quadPath(canvas.width, 0, 0, left, right),
      zIndex: 0,
    },
    {
      id: "ground",
      role: "ground",
      path: quadPath(canvas.width, left, right, canvas.height, canvas.height),
      zIndex: 1,
    },
  ];
}

/**
 * One quad across the canvas width, between a top edge and a bottom edge.
 *
 * Each edge names its height at the left and the right canvas side, so a
 * rolled horizon slopes the shared edge of the sky and the ground while the
 * outer edges stay on the canvas.
 */
function quadPath(
  width: number,
  topAtLeft: number,
  topAtRight: number,
  bottomAtLeft: number,
  bottomAtRight: number,
): Path {
  return {
    commands: [
      { command: "move", to: { x: 0, y: topAtLeft } },
      { command: "line", to: { x: width, y: topAtRight } },
      { command: "line", to: { x: width, y: bottomAtRight } },
      { command: "line", to: { x: 0, y: bottomAtLeft } },
      { command: "close" },
    ],
  };
}

/**
 * Plan one scene: canvas, camera, horizon, regions, ground strips, masks,
 * and placements.
 *
 * The planning stream drives every draw the planner makes: the cloud
 * cutouts and the ground strip waves. A scene without clouds and strips
 * draws nothing, and the plan still comes out the same. The camera roll
 * turns the cutouts with the sky they sit in, so a rolled framing keeps its
 * clouds level with its horizon, and the strips follow the rolled horizon
 * the same way.
 *
 * The plan also reads every environment block here - the sky, the ground,
 * and the atmosphere - before any stage draws, so a key the compiler does
 * not read fails the render at planning instead of fading into the seeded
 * streams. It reads `composition.negativeSpace` against the floor of the
 * style the same way, and the style application stage opens every hatch
 * fill by the multiplier the decision carries. It reads the object grammar
 * of the style into one decision the same way: the geometry synthesis
 * stage enforces the detail budget and the corner rounding over every
 * object, and the style application stage keeps or drops the cloud cutouts
 * by the negative-space answer (specification section 18).
 */
export function planScene(
  spec: SceneSpec,
  style: ResolvedStyleSpec,
  rng: SeededRng,
): ScenePlan {
  const camera = cameraDecisionOf(spec);
  const canvas = canvasOfAspectRatio(spec.meta.aspectRatio);
  const horizon = horizonOf(spec, style);
  const horizonY = roundLength(horizon.horizonY * canvas.height);
  const heights = rolledHorizonHeights(horizonY, canvas, camera.tiltDegrees);
  const placements = placementsOf(spec, canvas, camera);
  const center = { x: canvas.width / 2, y: canvas.height / 2 };
  const environment = environmentDecisionOf(spec);
  const negativeSpace = negativeSpaceDecisionOf(spec, style);
  const objectGrammar = objectGrammarDecisionOf(style);

  const masks = cloudMasks(environment.sky.cloudCount, rng, canvas, horizonY).map(
    (mask) => ({
      id: mask.id,
      path: rollPath(mask.path, center, camera.tiltDegrees),
    }),
  );

  return {
    canvas,
    horizonY,
    horizon,
    camera,
    horizonHeights: {
      left: roundLength(heights.left),
      right: roundLength(heights.right),
      center: roundLength(heights.center),
    },
    regions: sceneRegions(canvas, heights),
    environment,
    groundStrips: groundStrips(
      environment.ground.strips,
      rng,
      canvas,
      heights,
    ),
    masks,
    negativeSpace,
    objectGrammar,
    placements,
    depthOrder: placements.map((placement) => placement.object.id),
    clampedObjectIds: placements
      .filter((placement) => placement.positionClamped)
      .map((placement) => placement.object.id),
    focalObjectCount: spec.objects.filter((object) => object.role === "focal")
      .length,
  };
}

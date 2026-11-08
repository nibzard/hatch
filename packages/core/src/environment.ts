/**
 * The environment model (specification sections 4B, 4D, and 5).
 *
 * The scene schema carries one environment type and three free-form
 * environment blocks, `sky`, `ground`, and `atmosphere`. A field the
 * compiler only stores is a trap: it enters the spec hash, the hash moves
 * the seeded streams, and the bytes change while the picture stays the
 * same. So this module is the one place that reads the whole environment
 * block, the way camera.ts reads the camera and the composition. Every
 * key the block accepts has one documented effect:
 *
 * - `environment.type` names the environment family the scene draws. The
 *   intent stage checks it against the family of the resolved preset, so
 *   the field owns the pairing of a scene with its style; see
 *   {@link environmentFamilyMatches}.
 * - `environment.sky.cloudCount` draws cloud cutouts over the sky region.
 *   The planning stage carves them, and each one is negative space: the
 *   hatch of the sky passes under it, and the paper shows through.
 * - `environment.ground.strips` draws mown-field lines across the ground
 *   plane. The planning stage lays them out, and the style stage strokes
 *   them like any other contour.
 * - `environment.atmosphere.fog` fades the ink of every object by its draw
 *   depth. The style application stage applies the share to the fills and
 *   the contours of the object.
 * - `environment.atmosphere.rain` draws diagonal rain strokes over the
 *   whole scene. The style application stage adds the region.
 *
 * A key outside this vocabulary is rejected here, by name, so a spec that
 * asks for storminess, haze, or a ground material fails instead of
 * rendering an unchanged composition (specification section 19).
 *
 * Every function here is closed-form code. The one draw the model makes is
 * the strip wave of the planning stage, which comes from the stream the
 * caller passes in (specification section 10).
 */

import { z } from "zod";

import type { FillStyle } from "./fill.js";
import type { Canvas } from "./ir.js";
import type { JsonObject } from "./json.js";
import type { SceneSpec } from "./scene.js";
import type { ResolvedStyleSpec } from "./style.js";

/**
 * Every environment family a scene or a preset can name (specification
 * section 5). `custom` is the escape: it names no family, so it pairs with
 * every preset.
 */
export const ENVIRONMENT_TYPE_NAMES = [
  "rural",
  "coastal",
  "urban",
  "interior",
  "skatepark",
  "custom",
] as const;

/** One environment family of {@link ENVIRONMENT_TYPE_NAMES}. */
export const EnvironmentTypeSchema = z.enum(ENVIRONMENT_TYPE_NAMES);

/** One environment family, the value of `environment.type`. */
export type EnvironmentType = (typeof ENVIRONMENT_TYPE_NAMES)[number];

/** True when `value` names an environment family the compiler reads. */
export function isEnvironmentType(value: string): value is EnvironmentType {
  return (ENVIRONMENT_TYPE_NAMES as readonly string[]).includes(value);
}

/**
 * True when one environment family may render under one preset family.
 *
 * The scene names what it draws in `environment.type`; the preset names
 * what it styles in `StyleSpec.environmentType`. The two agree when they
 * name the same family, and either side can opt out of the check: a scene
 * that says `custom` picks its preset itself, and a preset that declares
 * no family - or declares `custom` - draws every environment.
 *
 * The intent stage calls this for every render and rejects the mismatch,
 * so `environment.type` cannot change the spec hash alone.
 */
export function environmentFamilyMatches(
  asked: EnvironmentType,
  presetFamily: EnvironmentType | undefined,
): boolean {
  if (asked === "custom" || presetFamily === undefined) {
    return true;
  }
  return presetFamily === "custom" || asked === presetFamily;
}

/** How many cloud cutouts one sky draws at most. */
export const MAX_CLOUD_COUNT = 12;

/** How many strip lines the ground plane carries at most. */
export const MAX_GROUND_STRIPS = 6;

/** How many rain strokes one scene draws at most. */
export const MAX_RAIN_STROKES = 160;

/** The strongest fog, on the same 0 to 1 scale `fog` is read on. */
export const MAX_FOG = 1;

/**
 * How much ink the strongest fog takes from the plane furthest back. The
 * share stays above zero, because a hatch weight of zero is no stroke at
 * all: the far plane thins out, it does not disappear.
 */
export const MAX_FOG_FADE = 0.65;

/**
 * The draw depth of the plane fog leaves untouched: the focal role. Fog
 * measures distance in role steps against this plane, the same four-step
 * depth stack the camera model scales, so the two controls read the same
 * scene the same way.
 */
export const FRONT_ROLE_DEPTH = 3;

/** The angle the rain strokes run at, in degrees: 15 off the vertical. */
export const RAIN_ANGLE_DEGREES = 75;

/** The rain stroke weight, as a share of the contour weight of the style. */
export const RAIN_WEIGHT_SHARE = 0.55;

/**
 * The rain jitter. Rain is weather, not terrain, so its lines stay crisper
 * than any hatch family of the style.
 */
export const RAIN_JITTER = 0.2;

/** What the sky block asked the planner for. */
export interface SkyDecision {
  /** How many cloud cutouts the sky carries, 0 to {@link MAX_CLOUD_COUNT}. */
  readonly cloudCount: number;
}

/** What the ground block asked the planner for. */
export interface GroundDecision {
  /** How many strip lines cross the ground plane, 0 to {@link MAX_GROUND_STRIPS}. */
  readonly strips: number;
}

/** What the atmosphere block asked the render for. */
export interface AtmosphereDecision {
  /** The fog strength in [0, 1], after clamping. */
  readonly fog: number;
  /** True when `fog` sat outside [0, 1] and moved. */
  readonly fogClamped: boolean;
  /** How many rain strokes the scene draws, 0 to {@link MAX_RAIN_STROKES}. */
  readonly rain: number;
}

/** Every environment decision one scene carries, sky, ground, and atmosphere. */
export interface EnvironmentDecision {
  /** The sky block, read by the planning stage. */
  readonly sky: SkyDecision;
  /** The ground block, read by the planning stage. */
  readonly ground: GroundDecision;
  /** The atmosphere block, read by the style application stage. */
  readonly atmosphere: AtmosphereDecision;
}

/** Every key of one free-form block, sorted so error messages stay stable. */
function keysOf(block: JsonObject): string[] {
  return Object.keys(block).sort();
}

/**
 * Reject every key of one free-form block the compiler does not read.
 *
 * The message names the key and the keys the block accepts, so the writer
 * of the spec sees what the field can carry instead of a silent no-op.
 */
function rejectUnreadKeys(
  block: string,
  value: JsonObject,
  accepted: readonly string[],
): void {
  for (const key of keysOf(value)) {
    if (!accepted.includes(key)) {
      throw new Error(
        `environment.${block}.${key} is not read by the compiler; ` +
          `environment.${block} accepts ${accepted.join(", ")} only`,
      );
    }
  }
}

/** Read one optional number of a free-form block, or reject its value. */
function readNumber(
  block: string,
  key: string,
  value: JsonObject,
): number | undefined {
  const raw = value[key];
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    throw new Error(
      `environment.${block}.${key} must be a finite number, ` +
        `received ${JSON.stringify(raw)}`,
    );
  }
  return raw;
}

/**
 * Read one optional count of a free-form block, or reject its value.
 *
 * A count is an integer in [0, max], the shape `cloudCount`, `strips`, and
 * `rain` all read.
 */
function readCount(
  block: string,
  key: string,
  value: JsonObject,
  max: number,
): number | undefined {
  const raw = value[key];
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0 || raw > max) {
    throw new Error(
      `environment.${block}.${key} must be an integer between 0 and ${max}, ` +
        `received ${JSON.stringify(raw)}`,
    );
  }
  return raw;
}

/** Read the sky block of one spec. */
export function skyDecisionOf(spec: SceneSpec): SkyDecision {
  const sky = spec.environment.sky;
  if (sky === undefined) {
    return { cloudCount: 0 };
  }
  rejectUnreadKeys("sky", sky, ["cloudCount"]);
  return {
    cloudCount: readCount("sky", "cloudCount", sky, MAX_CLOUD_COUNT) ?? 0,
  };
}

/** Read the ground block of one spec. */
export function groundDecisionOf(spec: SceneSpec): GroundDecision {
  const ground = spec.environment.ground;
  if (ground === undefined) {
    return { strips: 0 };
  }
  rejectUnreadKeys("ground", ground, ["strips"]);
  return { strips: readCount("ground", "strips", ground, MAX_GROUND_STRIPS) ?? 0 };
}

/** Read the atmosphere block of one spec. */
export function atmosphereDecisionOf(spec: SceneSpec): AtmosphereDecision {
  const atmosphere = spec.environment.atmosphere;
  if (atmosphere === undefined) {
    return { fog: 0, fogClamped: false, rain: 0 };
  }
  rejectUnreadKeys("atmosphere", atmosphere, ["fog", "rain"]);
  const requestedFog = readNumber("atmosphere", "fog", atmosphere) ?? 0;
  // A strength outside [0, 1] clamps the way `camera.perspectiveStrength`
  // does, and the clamp is recorded so the trace can name the move.
  const fog = Math.min(Math.max(requestedFog, 0), MAX_FOG);
  return {
    fog,
    fogClamped: fog !== requestedFog,
    rain: readCount("atmosphere", "rain", atmosphere, MAX_RAIN_STROKES) ?? 0,
  };
}

/** Read every environment block of one spec, sky, ground, and atmosphere. */
export function environmentDecisionOf(spec: SceneSpec): EnvironmentDecision {
  return {
    sky: skyDecisionOf(spec),
    ground: groundDecisionOf(spec),
    atmosphere: atmosphereDecisionOf(spec),
  };
}

/**
 * The share of its ink one object keeps under one fog value.
 *
 * `depth` is the draw depth of the object, 0 for the background role to 3
 * for the focal role. An object on the front plane keeps every unit of its
 * ink; each plane behind it gives up the fog share of
 * {@link MAX_FOG_FADE}, so at full fog the background plane keeps 35
 * percent and the midground keeps about 57. The result rounds to four
 * decimals, so the fills and the contours it scales stay short numbers.
 */
export function fogInkShare(fog: number, depth: number): number {
  const distance = (FRONT_ROLE_DEPTH - depth) / FRONT_ROLE_DEPTH;
  const share = 1 - fog * distance * MAX_FOG_FADE;
  return Math.round(share * 10000) / 10000;
}

/**
 * The fill style of the rain region one atmosphere asks for.
 *
 * The rain draws in the contour ink of the style, at a fraction of its
 * weight, so weather reads lighter than the terrain it falls on. The
 * spacing spreads the requested stroke count across the canvas width.
 */
export function rainFillStyle(
  style: ResolvedStyleSpec,
  canvas: Canvas,
  rain: number,
): FillStyle {
  return {
    type: "hatch",
    angle: RAIN_ANGLE_DEGREES,
    spacing: canvas.width / rain,
    stroke: style.contours.color,
    weight: style.contours.weight * RAIN_WEIGHT_SHARE,
    jitter: RAIN_JITTER,
  };
}

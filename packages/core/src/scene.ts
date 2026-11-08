/**
 * The scene description model (specification section 5).
 *
 * A SceneSpec is the structured input of the compiler and the primary
 * editing object (specification section 15). Edits patch this spec and
 * re-render; they never touch pixels.
 */

import { z } from "zod";

import { EnvironmentTypeSchema } from "./environment.js";
import { formatIssues } from "./error.js";
import { JsonObjectSchema, JsonValueSchema } from "./json.js";
import { PointSchema } from "./path.js";
import { isStyleRole, STYLE_ROLE_NAMES } from "./style-role.js";
import { StyleOverridesSchema } from "./style.js";

/** Draw roles a scene object can take (specification section 5). */
export const SceneObjectRoleSchema = z.enum([
  "foreground",
  "midground",
  "background",
  "focal",
]);

/** One placed object, referenced by generator kind (specification section 5). */
export const SceneObjectSchema = z.object({
  id: z.string().min(1, { message: "an object needs an id" }),
  kind: z
    .string()
    .min(1, { message: "an object needs a kind, for example 'tree'" }),
  role: SceneObjectRoleSchema.optional(),
  position: PointSchema,
  scale: z
    .number()
    .finite()
    .positive({ message: "scale must be greater than 0" }),
  rotation: z.number().finite().optional(),
  params: z.record(z.string(), JsonValueSchema).optional(),
  /**
   * The fill style role of specification section 16D that fills every
   * style zone of the object, for example "sky hatch". It replaces the
   * family each zone's own role resolves to; see style-role.ts.
   */
  styleRole: z.string().min(1).optional(),
});

/** Ratio format for meta.aspectRatio, for example "4:3" or "16:9". */
const ASPECT_RATIO_PATTERN = /^\d+:\d+$/;

/**
 * Scene metadata. Every field is required because it drives determinism and
 * style resolution (specification sections 5 and 10): identical id, seed,
 * preset, and spec version must give identical output.
 */
export const SceneMetaSchema = z.object({
  id: z.string().min(1, { message: "meta.id is required" }),
  seed: z.number().int({ message: "meta.seed must be an integer" }),
  stylePreset: z.string().min(1, { message: "meta.stylePreset is required" }),
  aspectRatio: z.string().regex(ASPECT_RATIO_PATTERN, {
    message: "meta.aspectRatio must look like '4:3' or '16:9'",
  }),
  version: z.string().min(1, { message: "meta.version is required" }),
});

/** How much of the frame the subject fills (specification section 5). */
export const FramingSchema = z.enum(["wide", "medium", "close"]);

/** Which lens the camera carries (specification section 5). */
export const LensSchema = z.enum(["normal", "wide", "ultra-wide"]);

/** Where the composition carries its weight (specification section 5). */
export const BalanceSchema = z.enum(["left", "center", "right", "asymmetric"]);

/** Camera and framing (specification section 5). */
export const CameraSchema = z.object({
  framing: FramingSchema,
  lens: LensSchema,
  horizonY: z
    .number()
    .min(0, { message: "horizonY is a normalized height between 0 and 1" })
    .max(1, { message: "horizonY is a normalized height between 0 and 1" }),
  tilt: z.number().finite().optional(),
  perspectiveStrength: z.number().finite().optional(),
});

/** Composition intent (specification section 5). */
export const CompositionSchema = z.object({
  focalPoints: z.array(z.string().min(1)),
  balance: BalanceSchema,
  /**
   * The share of the paper the render keeps free of hatch ink. The
   * negative-space model reads it against the floor of the resolved style
   * and opens every hatch spacing by the difference; see negative-space.ts.
   */
  negativeSpace: z
    .number()
    .min(0, { message: "negativeSpace is a ratio between 0 and 1" })
    .max(1, { message: "negativeSpace is a ratio between 0 and 1" }),
  depthLayers: z
    .number()
    .int({ message: "depthLayers must be an integer" })
    .min(0, { message: "depthLayers must be 0 or greater" }),
});

/**
 * Environment type plus loose sky, ground, and atmosphere blocks
 * (specification section 5).
 *
 * The blocks stay free-form JSON here, because section 5 writes them as
 * open blocks. Each part has one reader that owns its vocabulary: the
 * environment model reads the type and all three blocks, rejects a key it
 * does not read by name, and checks the type against the family of the
 * resolved preset, so a spec cannot ask for weather or a world the
 * compiler ignores.
 */
export const EnvironmentSchema = z.object({
  type: EnvironmentTypeSchema,
  sky: JsonObjectSchema.optional(),
  ground: JsonObjectSchema.optional(),
  atmosphere: JsonObjectSchema.optional(),
});

/**
 * Debug overlay flags (specification sections 5 and 9). The first four come
 * from the section 5 debug block; the last three switch the section 9
 * overlays on: hatch direction map, negative-space map, contour-only preview.
 */
export const DebugFlagsSchema = z.object({
  showRegions: z.boolean().optional(),
  showAnchors: z.boolean().optional(),
  showDepthMap: z.boolean().optional(),
  showConstructionLines: z.boolean().optional(),
  showHatchDirections: z.boolean().optional(),
  showNegativeSpace: z.boolean().optional(),
  showContourOnly: z.boolean().optional(),
});

/**
 * Every debug flag, in the order its overlay draws (specification sections 5
 * and 9).
 *
 * The order fixes two things: the draw order of the overlay layers, and the
 * order the trace names the enabled overlays in. `showContourOnly` draws
 * first because its layer carries the paper wash every later overlay sits on.
 */
export const DEBUG_FLAG_NAMES = [
  "showContourOnly",
  "showRegions",
  "showDepthMap",
  "showHatchDirections",
  "showNegativeSpace",
  "showAnchors",
  "showConstructionLines",
] as const;

/** One flag of the debug block. */
export type DebugFlagName = (typeof DEBUG_FLAG_NAMES)[number];

/**
 * The flags one debug block switches on, in draw order.
 *
 * A spec without a debug block switches none on, and a block that leaves a
 * flag out or sets it false switches that one off. The three spellings of
 * "every overlay off" - no block, an empty block, a block of false flags -
 * therefore agree, which is what the byte identity of a plain render rests on.
 */
export function enabledDebugFlags(
  debug: DebugFlags | undefined,
): DebugFlagName[] {
  if (debug === undefined) {
    return [];
  }
  return DEBUG_FLAG_NAMES.filter((flag) => debug[flag] === true);
}

/** The complete scene specification (specification section 5). */
export const SceneSpecSchema = z.object({
  meta: SceneMetaSchema,
  camera: CameraSchema,
  composition: CompositionSchema,
  environment: EnvironmentSchema,
  objects: z.array(SceneObjectSchema),
  styleOverrides: StyleOverridesSchema.optional(),
  debug: DebugFlagsSchema.optional(),
}).superRefine((spec, ctx) => {
  // Edit operations address objects by id (specification section 21), so a
  // duplicate id makes the spec ambiguous.
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const object of spec.objects) {
    if (seen.has(object.id)) {
      duplicates.add(object.id);
    }
    seen.add(object.id);
  }
  if (duplicates.size > 0) {
    ctx.addIssue({
      code: "custom",
      path: ["objects"],
      message: `object ids must be unique; duplicate id: ${[...duplicates].join(", ")}`,
    });
  }
  // A style role the compiler cannot fill is a reserved word, not a free
  // string: the field changes the spec hash, so a value nothing reads must
  // fail here instead of rendering an unchanged composition.
  for (const [index, object] of spec.objects.entries()) {
    if (object.styleRole !== undefined && !isStyleRole(object.styleRole)) {
      ctx.addIssue({
        code: "custom",
        path: ["objects", index, "styleRole"],
        message:
          `styleRole must name a fill role of specification section 16D: ` +
          `${STYLE_ROLE_NAMES.join(", ")}`,
      });
    }
  }
});

export type SceneObjectRole = z.infer<typeof SceneObjectRoleSchema>;
export type SceneObject = z.infer<typeof SceneObjectSchema>;
export type SceneMeta = z.infer<typeof SceneMetaSchema>;
export type Framing = z.infer<typeof FramingSchema>;
export type Lens = z.infer<typeof LensSchema>;
export type Balance = z.infer<typeof BalanceSchema>;
export type Camera = z.infer<typeof CameraSchema>;
export type Composition = z.infer<typeof CompositionSchema>;
export type Environment = z.infer<typeof EnvironmentSchema>;
export type DebugFlags = z.infer<typeof DebugFlagsSchema>;
export type SceneSpec = z.infer<typeof SceneSpecSchema>;

/**
 * Parse unknown input as a SceneSpec. Throw one readable error on failure.
 * Use this at every spec entry point: the agent API, the engine, and tests.
 */
export function parseSceneSpec(input: unknown): SceneSpec {
  const result = SceneSpecSchema.safeParse(input);
  if (!result.success) {
    throw new Error(`invalid SceneSpec: ${formatIssues(result.error.issues)}`);
  }
  return result.data;
}

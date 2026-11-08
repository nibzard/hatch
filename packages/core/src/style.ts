/**
 * The style grammar (specification section 8).
 *
 * A preset is not a bag of constants. It is a grammar: a palette, one hatch
 * family per style zone, contour rules, object and composition grammar, and
 * texture knobs. The same grammar lets a caller ask for "same style but
 * denser sky hatching" through {@link StyleOverrides}.
 */

import { z } from "zod";

import { EnvironmentTypeSchema } from "./environment.js";
import { formatIssues } from "./error.js";
import {
  CrossHatchFillStyleSchema,
  HatchFillStyleSchema,
} from "./fill.js";

const colorField = z
  .string()
  .min(1, { message: "color must be a CSS color name or hex value" });

/** One single-angle hatch family, assigned to a style zone. */
export const HatchSpecSchema = HatchFillStyleSchema.omit({ type: true });

/** Two crossing hatch families, assigned to a style zone. */
export const CrossHatchSpecSchema = CrossHatchFillStyleSchema.omit({
  type: true,
});

/** Ink and paper colors (specification section 8). */
export const PaletteSchema = z.object({
  paper: colorField,
  sky: colorField,
  grass: colorField,
  architecture: colorField,
  water: colorField,
  accent: colorField,
  mountain: colorField,
  trunk: colorField,
});

/** One hatch spec per style zone (specification sections 8 and 16C). */
export const HatchFamiliesSchema = z.object({
  sky: HatchSpecSchema,
  field: HatchSpecSchema,
  foliage: CrossHatchSpecSchema,
  mountain: HatchSpecSchema,
  water: CrossHatchSpecSchema,
  cliff: HatchSpecSchema,
});

/** Rules for contour strokes (specification section 8). */
export const ContourRulesSchema = z.object({
  weight: z
    .number()
    .finite()
    .positive({ message: "contour weight must be greater than 0" }),
  color: colorField,
  wobble: z
    .number()
    .finite()
    .min(0, { message: "wobble must be 0 or greater" }),
  simplifyTolerance: z
    .number()
    .finite()
    .min(0, { message: "simplifyTolerance must be 0 or greater" }),
});

/** How much detail an object may carry (specification section 8). */
export const ObjectGrammarSchema = z.object({
  /**
   * How far the style abstracts an object, 0 to 1. 0 keeps every mark the
   * generator drew, 1 abstracts the object to its silhouette alone. The
   * geometry synthesis stage scales the detail budget by it.
   */
  abstractionLevel: z
    .number()
    .finite({ message: "abstractionLevel must be a finite number" })
    .min(0, { message: "abstractionLevel must be between 0 and 1" })
    .max(1, { message: "abstractionLevel must be between 0 and 1" }),
  /**
   * The ceiling of internal boundaries one object may carry, whatever its
   * parameters ask for. The geometry synthesis stage drops every boundary
   * beyond the budget the abstraction level leaves.
   */
  maxDetailPerObject: z
    .number()
    .int({ message: "maxDetailPerObject must be an integer" })
    .min(0, { message: "maxDetailPerObject must be 0 or greater" }),
  /**
   * How round the edges of an object draw, 0 to 1. The geometry synthesis
   * stage rounds every polyline corner of an object by the share this bias
   * carries; 0 leaves every corner as drawn.
   */
  edgeRoundnessBias: z
    .number()
    .finite({ message: "edgeRoundnessBias must be a finite number" })
    .min(0, { message: "edgeRoundnessBias must be between 0 and 1" })
    .max(1, { message: "edgeRoundnessBias must be between 0 and 1" }),
  /**
   * Whether openings stay paper: the windows and the doorway of a house,
   * and the cloud cutouts of the scene. When false, the style fills across
   * them instead.
   */
  keepNegativeSpace: z.boolean(),
});

/** Composition limits the planner respects (specification section 8). */
export const CompositionGrammarSchema = z.object({
  minEmptyAreaRatio: z
    .number()
    .min(0, { message: "minEmptyAreaRatio must be between 0 and 1" })
    .max(1, { message: "minEmptyAreaRatio must be between 0 and 1" }),
  preferredHorizonBand: z
    .tuple([
      z.number().min(0, { message: "horizon band values must be between 0 and 1" }).max(1, { message: "horizon band values must be between 0 and 1" }),
      z.number().min(0, { message: "horizon band values must be between 0 and 1" }).max(1, { message: "horizon band values must be between 0 and 1" }),
    ])
    .refine(([low, high]) => low <= high, {
      message: "preferredHorizonBand must be [low, high] with low <= high",
    }),
  focalObjectCount: z
    .number()
    .int({ message: "focalObjectCount must be an integer" })
    .min(0, { message: "focalObjectCount must be 0 or greater" }),
});

/** Humanization knobs for every stroke (specification sections 8 and 17). */
export const TextureSchema = z.object({
  lineJitter: z.number().finite().min(0, { message: "lineJitter must be 0 or greater" }),
  dropout: z
    .number()
    .min(0, { message: "dropout is a probability between 0 and 1" })
    .max(1, { message: "dropout is a probability between 0 and 1" }),
  pressureVariance: z
    .number()
    .finite()
    .min(0, { message: "pressureVariance must be 0 or greater" }),
  paperNoise: z.number().finite().min(0, { message: "paperNoise must be 0 or greater" }),
});

/** A complete style preset, for example pastoral-v1 (specification section 8). */
export const StyleSpecSchema = z.object({
  /**
   * The environment family the preset draws, for example `rural` for
   * pastoral-v1. The intent stage reads it against `environment.type` and
   * rejects a scene that names another family, so the two fields own one
   * pairing decision instead of two inert strings. A preset that declares
   * no family, or declares `custom`, draws every environment. The field
   * belongs to the preset alone: no style override can carry it.
   */
  environmentType: EnvironmentTypeSchema.optional(),
  palette: PaletteSchema,
  hatchFamilies: HatchFamiliesSchema,
  contours: ContourRulesSchema,
  objectGrammar: ObjectGrammarSchema,
  compositionGrammar: CompositionGrammarSchema,
  texture: TextureSchema,
});

/**
 * A partial style, applied over a preset (specification section 5).
 *
 * `environmentType` stays out on purpose: it states which world the preset
 * draws, so it belongs to the preset, not to the scene asking for it. A
 * scene that wants a preset outside its family says `custom` in
 * `environment.type` instead.
 */
export const StyleOverridesSchema = StyleSpecSchema.omit({
  environmentType: true,
}).partial();

/**
 * A preset with every override merged in. The style application stage
 * resolves overrides before it fills regions (specification section 22).
 */
export const ResolvedStyleSpecSchema = StyleSpecSchema.extend({
  preset: z.string().min(1, { message: "a resolved style names its preset" }),
});

export type HatchSpec = z.infer<typeof HatchSpecSchema>;
export type CrossHatchSpec = z.infer<typeof CrossHatchSpecSchema>;
export type Palette = z.infer<typeof PaletteSchema>;
export type HatchFamilies = z.infer<typeof HatchFamiliesSchema>;
export type ContourRules = z.infer<typeof ContourRulesSchema>;
export type ObjectGrammar = z.infer<typeof ObjectGrammarSchema>;
export type CompositionGrammar = z.infer<typeof CompositionGrammarSchema>;
export type Texture = z.infer<typeof TextureSchema>;
export type StyleSpec = z.infer<typeof StyleSpecSchema>;
export type StyleOverrides = z.infer<typeof StyleOverridesSchema>;
export type ResolvedStyleSpec = z.infer<typeof ResolvedStyleSpecSchema>;

/**
 * Parse unknown input as a StyleSpec. Throw one readable error on failure.
 * Presets from @hatch/styles validate through this helper.
 */
export function parseStyleSpec(input: unknown): StyleSpec {
  const result = StyleSpecSchema.safeParse(input);
  if (!result.success) {
    throw new Error(`invalid StyleSpec: ${formatIssues(result.error.issues)}`);
  }
  return result.data;
}

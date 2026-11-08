/**
 * Fill styles for regions (specification section 7).
 *
 * A region is drawn either with one line system (hatch), two crossing line
 * systems (crosshatch), or nothing at all (none, for pure negative space).
 */

import { z } from "zod";

/** Stroke fields shared by every line-based fill. */
const strokeFields = {
  stroke: z
    .string()
    .min(1, { message: "stroke must be a CSS color name or hex value" }),
  weight: z
    .number()
    .finite()
    .positive({ message: "weight must be greater than 0" }),
  jitter: z
    .number()
    .finite()
    .min(0, { message: "jitter must be 0 or greater" }),
};

const angleField = z
  .number()
  .finite({ message: "angle must be a finite number in degrees" });

const spacingField = z
  .number()
  .finite()
  .positive({ message: "spacing must be greater than 0" });

/** Parallel strokes at one angle. */
export const HatchFillStyleSchema = z.object({
  type: z.literal("hatch"),
  angle: angleField,
  spacing: spacingField,
  ...strokeFields,
});

/** Two stroke families that cross at different angles. */
export const CrossHatchFillStyleSchema = z.object({
  type: z.literal("crosshatch"),
  angleA: angleField,
  angleB: angleField,
  spacingA: spacingField,
  spacingB: spacingField,
  ...strokeFields,
});

/** No fill. The region stays as paper, which is negative space. */
export const NoneFillStyleSchema = z.object({
  type: z.literal("none"),
});

/** The fill style of a region. */
export const FillStyleSchema = z.discriminatedUnion("type", [
  HatchFillStyleSchema,
  CrossHatchFillStyleSchema,
  NoneFillStyleSchema,
]);

export type HatchFillStyle = z.infer<typeof HatchFillStyleSchema>;
export type CrossHatchFillStyle = z.infer<typeof CrossHatchFillStyleSchema>;
export type NoneFillStyle = z.infer<typeof NoneFillStyleSchema>;
export type FillStyle = z.infer<typeof FillStyleSchema>;

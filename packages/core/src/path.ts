/**
 * Serializable geometry primitives (specification sections 7 and 11).
 *
 * Regions clip to paths and the SVG renderer walks the same commands, so the
 * core package defines one plain-data path model. Conversion to and from
 * Paper.js paths lives in @hatch/geometry; the core model stays
 * dependency-free and JSON-safe.
 */

import { z } from "zod";

/** A point in scene units. */
export const PointSchema = z.object({
  x: z.number().finite({ message: "x must be a finite number" }),
  y: z.number().finite({ message: "y must be a finite number" }),
});

/** Move the pen to a point without drawing. */
export const MoveCommandSchema = z.object({
  command: z.literal("move"),
  to: PointSchema,
});

/** Draw a straight segment to a point. */
export const LineCommandSchema = z.object({
  command: z.literal("line"),
  to: PointSchema,
});

/** Draw a cubic bezier segment to a point. */
export const CurveCommandSchema = z.object({
  command: z.literal("curve"),
  to: PointSchema,
  control1: PointSchema,
  control2: PointSchema,
});

/** Close the path back to its first point. */
export const CloseCommandSchema = z.object({
  command: z.literal("close"),
});

/** One pen command inside a path. */
export const PathCommandSchema = z.discriminatedUnion("command", [
  MoveCommandSchema,
  LineCommandSchema,
  CurveCommandSchema,
  CloseCommandSchema,
]);

/** A connected series of pen commands, JSON-safe by design. */
export const PathSchema = z.object({
  commands: z
    .array(PathCommandSchema)
    .min(1, { message: "a path needs at least one command" }),
})
  .superRefine((path, ctx) => {
    if (path.commands[0]?.command !== "move") {
      ctx.addIssue({
        code: "custom",
        path: ["commands", 0],
        message: "a path must start with a 'move' command",
      });
    }
  });

export type Point = z.infer<typeof PointSchema>;
export type MoveCommand = z.infer<typeof MoveCommandSchema>;
export type LineCommand = z.infer<typeof LineCommandSchema>;
export type CurveCommand = z.infer<typeof CurveCommandSchema>;
export type CloseCommand = z.infer<typeof CloseCommandSchema>;
export type PathCommand = z.infer<typeof PathCommandSchema>;
export type Path = z.infer<typeof PathSchema>;

/**
 * Render traces and output metrics (specification sections 4, 9, and 10).
 *
 * Every render leaves a trace: the spec hash, preset, seed, compiler
 * version, one event per stage, and the full output metric set of section
 * 9E. The trace carries no wall-clock timestamp, so no value names when a
 * render ran. One metric is a measurement instead of a compile fact:
 * `exportDurationMs` times the run on the host clock, so two renders of one
 * identity share every trace byte except that one number
 * (specification section 10).
 */

import { z } from "zod";

import { JsonValueSchema } from "./json.js";

/** Compiler stages, in pipeline order (specification section 4). */
export const TRACE_STAGES = [
  "intent",
  "planning",
  "geometry",
  "style",
  "render",
] as const;

/** One stage name. */
export const TraceStageSchema = z.enum(TRACE_STAGES);

/**
 * One instrumentation event: layout decisions, geometry facts, or render
 * facts (specification section 9B to 9D).
 */
export const TraceEventSchema = z.object({
  stage: TraceStageSchema,
  name: z.string().min(1, { message: "a trace event needs a name" }),
  message: z.string().optional(),
  data: JsonValueSchema.optional(),
  durationMs: z.number().min(0).optional(),
});

/**
 * The output metrics of one render, the full set of specification section
 * 9E: region count, stroke count, SVG size, export timing, and the visual
 * density score.
 *
 * Four of the five are compile facts, so identical inputs give identical
 * values. `exportDurationMs` is measured wall-clock time, so it is the one
 * metric two renders of the same identity never share.
 *
 * The visual density score is the total length of the hatch strokes the
 * document draws, in user units, divided by the canvas area in square user
 * units. A paper with no hatch strokes scores 0. A mask that hides strokes,
 * a cloud cutout, still counts them: the score measures the hatching the
 * compiler laid down, not what a mask leaves visible. Contour strokes and
 * symbol marks stay out of the score; they are ink, but they carry no
 * region fill.
 */
export const OutputMetricsSchema = z.object({
  regionCount: z.number().int().min(0),
  strokeCount: z.number().int().min(0),
  svgSizeBytes: z.number().int().min(0),
  exportDurationMs: z.number().min(0),
  visualDensityScore: z.number().min(0),
});

/** The trace of one compilation run (specification section 9A). */
export const RenderTraceSchema = z.object({
  specHash: z.string().min(1, { message: "the trace needs the scene spec hash" }),
  preset: z.string().min(1, { message: "the trace needs the style preset name" }),
  seed: z.number().int({ message: "seed must be an integer" }),
  compilerVersion: z
    .string()
    .min(1, { message: "the trace needs the compiler version" }),
  prompt: z.string().optional(),
  events: z.array(TraceEventSchema),
  metrics: OutputMetricsSchema.optional(),
});

export type TraceStage = z.infer<typeof TraceStageSchema>;
export type TraceEvent = z.infer<typeof TraceEventSchema>;
export type OutputMetrics = z.infer<typeof OutputMetricsSchema>;
export type RenderTrace = z.infer<typeof RenderTraceSchema>;

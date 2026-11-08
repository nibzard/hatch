import { describe, expect, it } from "vitest";

import { RenderTraceSchema, TRACE_STAGES } from "../src/index.js";

import { validRenderTrace } from "./fixtures.js";

describe("RenderTraceSchema", () => {
  it("parses a valid trace", () => {
    const result = RenderTraceSchema.safeParse(validRenderTrace());
    expect(result.success).toBe(true);
  });

  it("exposes the five compiler stages in pipeline order", () => {
    expect(TRACE_STAGES).toEqual([
      "intent",
      "planning",
      "geometry",
      "style",
      "render",
    ]);
  });

  it("rejects an unknown stage on an event", () => {
    const trace = validRenderTrace();
    const result = RenderTraceSchema.safeParse({
      ...trace,
      events: [...trace.events, { stage: "export", name: "png written" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a trace without the compiler version", () => {
    const trace = validRenderTrace() as unknown as Record<string, unknown>;
    delete trace.compilerVersion;
    const result = RenderTraceSchema.safeParse(trace);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((issue) => issue.path.join("."));
      expect(paths).toContain("compilerVersion");
    }
  });

  it("rejects a negative region count in the metrics", () => {
    const trace = validRenderTrace();
    const result = RenderTraceSchema.safeParse({
      ...trace,
      metrics: { ...trace.metrics, regionCount: -1 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects metrics without the export timing or the density score", () => {
    // The full section 9E set is required: a trace that carries only the
    // three compile facts fails validation, and so does a negative
    // duration or score.
    const trace = validRenderTrace();
    const { exportDurationMs: _duration, visualDensityScore: _score, ...partial } =
      trace.metrics!;
    const missing = RenderTraceSchema.safeParse({ ...trace, metrics: partial });
    expect(missing.success).toBe(false);
    if (!missing.success) {
      const paths = missing.error.issues.map((issue) => issue.path.join("."));
      expect(paths).toContain("metrics.exportDurationMs");
      expect(paths).toContain("metrics.visualDensityScore");
    }
    for (const field of ["exportDurationMs", "visualDensityScore"] as const) {
      const negative = RenderTraceSchema.safeParse({
        ...trace,
        metrics: { ...trace.metrics!, [field]: -1 },
      });
      expect(negative.success).toBe(false);
    }
  });

  it("accepts a trace without metrics", () => {
    const trace = validRenderTrace();
    const { metrics: _metrics, ...withoutMetrics } = trace;
    const result = RenderTraceSchema.safeParse(withoutMetrics);
    expect(result.success).toBe(true);
  });
});

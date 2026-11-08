import { describe, expect, it } from "vitest";

import {
  parseStyleSpec,
  ResolvedStyleSpecSchema,
  StyleOverridesSchema,
  StyleSpecSchema,
} from "../src/index.js";

import { validStyleSpec } from "./fixtures.js";

describe("StyleSpecSchema", () => {
  it("parses a valid preset", () => {
    const result = StyleSpecSchema.safeParse(validStyleSpec());
    expect(result.success).toBe(true);
  });

  it("rejects a preset without palette.paper and names the field", () => {
    const style = validStyleSpec() as unknown as Record<string, unknown>;
    const palette: Record<string, unknown> = {
      ...(style.palette as Record<string, unknown>),
    };
    delete palette.paper;
    const result = StyleSpecSchema.safeParse({ ...style, palette });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((issue) => issue.path.join("."));
      expect(paths).toContain("palette.paper");
    }
  });

  it("rejects a hatch family with zero spacing", () => {
    const style = validStyleSpec();
    const result = StyleSpecSchema.safeParse({
      ...style,
      hatchFamilies: {
        ...style.hatchFamilies,
        sky: { ...style.hatchFamilies.sky, spacing: 0 },
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(
        (entry) => entry.path.join(".") === "hatchFamilies.sky.spacing",
      );
      expect(issue?.message).toMatch(/greater than 0/);
    }
  });

  it("rejects a texture dropout above 1", () => {
    const style = validStyleSpec();
    const result = StyleSpecSchema.safeParse({
      ...style,
      texture: { ...style.texture, dropout: 1.5 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects an inverted preferred horizon band", () => {
    const style = validStyleSpec();
    const result = StyleSpecSchema.safeParse({
      ...style,
      compositionGrammar: {
        ...style.compositionGrammar,
        preferredHorizonBand: [0.8, 0.2],
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/low <= high/);
    }
  });

  it("rejects a fractional maxDetailPerObject", () => {
    const style = validStyleSpec();
    const result = StyleSpecSchema.safeParse({
      ...style,
      objectGrammar: { ...style.objectGrammar, maxDetailPerObject: 2.5 },
    });
    expect(result.success).toBe(false);
  });
});

describe("StyleOverridesSchema", () => {
  it("accepts a subset of top-level style fields", () => {
    const result = StyleOverridesSchema.safeParse({
      contours: { weight: 2, color: "#111111", wobble: 0.1, simplifyTolerance: 0.4 },
    });
    expect(result.success).toBe(true);
  });

  it("rejects an override value that breaks the grammar", () => {
    const result = StyleOverridesSchema.safeParse({
      texture: { lineJitter: 0.1, dropout: 2, pressureVariance: 0.1, paperNoise: 0.01 },
    });
    expect(result.success).toBe(false);
  });
});

describe("ResolvedStyleSpecSchema", () => {
  it("accepts a preset merged with its preset name", () => {
    const result = ResolvedStyleSpecSchema.safeParse({
      ...validStyleSpec(),
      preset: "pastoral-v1",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a resolved style without the preset name", () => {
    const result = ResolvedStyleSpecSchema.safeParse(validStyleSpec());
    expect(result.success).toBe(false);
  });
});

describe("parseStyleSpec", () => {
  it("returns the parsed style for valid input", () => {
    const style = parseStyleSpec(validStyleSpec());
    expect(style.palette.paper).toBe("#f7f3e8");
  });

  it("throws one readable error for a malformed style", () => {
    const style = validStyleSpec();
    expect(() =>
      parseStyleSpec({
        ...style,
        contours: { ...style.contours, weight: -1 },
      }),
    ).toThrowError(/invalid StyleSpec: .*contours\.weight/s);
  });
});

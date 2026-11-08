import { describe, expect, it } from "vitest";

import type { CrossHatchSpec, HatchSpec } from "@hatch/core";
import { parseStyleSpec, StyleSpecSchema } from "@hatch/core";

import { PASTORAL_V1_PRESET_ID, pastoralV1 } from "../src/index.js";

/** Relative luminance of one #rrggbb color, between 0 and 1. */
function luminance(hex: string): number {
  const digits = hex.replace("#", "");
  const channels = [0, 2, 4].map((offset) =>
    Number.parseInt(digits.slice(offset, offset + 2), 16) / 255,
  );
  return (
    0.2126 * (channels[0] ?? 0) +
    0.7152 * (channels[1] ?? 0) +
    0.0722 * (channels[2] ?? 0)
  );
}

describe("pastoral-v1 acceptance", () => {
  it("validates against the StyleSpec schema", () => {
    const result = StyleSpecSchema.safeParse(pastoralV1);
    expect(result.success).toBe(true);
  });

  it("parses through parseStyleSpec without changes", () => {
    expect(parseStyleSpec(pastoralV1)).toEqual(pastoralV1);
  });

  it("survives a JSON round trip unchanged", () => {
    expect(JSON.parse(JSON.stringify(pastoralV1))).toEqual(pastoralV1);
  });

  it("carries the preset id used by meta.stylePreset", () => {
    expect(PASTORAL_V1_PRESET_ID).toBe("pastoral-v1");
  });
});

describe("pastoral-v1 palette", () => {
  it("names all eight colors as six-digit hex values", () => {
    const keys = Object.keys(pastoralV1.palette).sort();
    expect(keys).toEqual(
      [
        "accent",
        "architecture",
        "grass",
        "mountain",
        "paper",
        "sky",
        "trunk",
        "water",
      ].sort(),
    );
    for (const value of Object.values(pastoralV1.palette)) {
      expect(value).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe("pastoral-v1 hatch families", () => {
  it("covers exactly the six style zones of specification section 8", () => {
    expect(Object.keys(pastoralV1.hatchFamilies).sort()).toEqual(
      ["cliff", "field", "foliage", "mountain", "sky", "water"].sort(),
    );
  });

  it("uses single hatch where the grammar asks for hatch", () => {
    for (const zone of ["sky", "field", "mountain", "cliff"] as const) {
      const family = pastoralV1.hatchFamilies[zone] as HatchSpec;
      expect(family, zone).toEqual(
        expect.objectContaining({ stroke: expect.any(String) }),
      );
      expect(Object.keys(family).sort(), zone).toEqual(
        ["angle", "jitter", "spacing", "stroke", "weight"].sort(),
      );
    }
  });

  it("uses crosshatch for foliage and water", () => {
    for (const zone of ["foliage", "water"] as const) {
      const family = pastoralV1.hatchFamilies[zone] as CrossHatchSpec;
      expect(Object.keys(family).sort(), zone).toEqual(
        [
          "angleA",
          "angleB",
          "jitter",
          "spacingA",
          "spacingB",
          "stroke",
          "weight",
        ].sort(),
      );
    }
  });

  it("hatches the field horizontally and evenly (section 3B)", () => {
    expect(pastoralV1.hatchFamilies.field.angle).toBe(0);
  });

  it("keeps sky lines more regular than foliage (section 17)", () => {
    expect(pastoralV1.hatchFamilies.sky.jitter).toBeLessThan(
      pastoralV1.hatchFamilies.foliage.jitter,
    );
  });

  it("hatches mountains denser than the sky (section 3B)", () => {
    expect(pastoralV1.hatchFamilies.mountain.spacing).toBeLessThan(
      pastoralV1.hatchFamilies.sky.spacing,
    );
  });

  it("hatches foliage denser than the sky", () => {
    expect(pastoralV1.hatchFamilies.foliage.spacingA).toBeLessThan(
      pastoralV1.hatchFamilies.sky.spacing,
    );
  });

  it("draws contours in a darker ink than the hatch (section 3B)", () => {
    expect(luminance(pastoralV1.contours.color)).toBeLessThan(
      luminance(pastoralV1.hatchFamilies.sky.stroke),
    );
  });

  it("uses one shared hatch ink across every zone", () => {
    const inks = new Set(
      Object.values(pastoralV1.hatchFamilies).map((family) => family.stroke),
    );
    expect(inks.size).toBe(1);
  });
});

describe("pastoral-v1 grammar ranges", () => {
  it("keeps every ratio inside its schema range", () => {
    expect(pastoralV1.compositionGrammar.minEmptyAreaRatio).toBeGreaterThan(0);
    expect(pastoralV1.compositionGrammar.minEmptyAreaRatio).toBeLessThan(1);
    const [low, high] = pastoralV1.compositionGrammar.preferredHorizonBand;
    expect(low).toBeLessThan(high);
    expect(pastoralV1.texture.dropout).toBeGreaterThanOrEqual(0);
    expect(pastoralV1.texture.dropout).toBeLessThanOrEqual(1);
  });

  it("reserves empty paper and one focal object (section 3D)", () => {
    expect(pastoralV1.compositionGrammar.minEmptyAreaRatio).toBeGreaterThanOrEqual(0.3);
    expect(pastoralV1.compositionGrammar.focalObjectCount).toBeLessThanOrEqual(3);
    expect(pastoralV1.objectGrammar.keepNegativeSpace).toBe(true);
  });
});

describe("pastoral-v1 immutability", () => {
  it("ships the preset frozen, nested included", () => {
    expect(Object.isFrozen(pastoralV1)).toBe(true);
    expect(Object.isFrozen(pastoralV1.palette)).toBe(true);
    expect(Object.isFrozen(pastoralV1.hatchFamilies)).toBe(true);
    expect(Object.isFrozen(pastoralV1.hatchFamilies.sky)).toBe(true);
  });
});

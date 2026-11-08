import { describe, expect, it } from "vitest";

import type { CrossHatchSpec, HatchSpec } from "@hatch/core";
import { parseStyleSpec, StyleSpecSchema } from "@hatch/core";

import { coastalV1, COASTAL_V1_PRESET_ID, pastoralV1 } from "../src/index.js";

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

describe("coastal-v1 acceptance", () => {
  it("validates against the StyleSpec schema", () => {
    const result = StyleSpecSchema.safeParse(coastalV1);
    expect(result.success).toBe(true);
  });

  it("parses through parseStyleSpec without changes", () => {
    expect(parseStyleSpec(coastalV1)).toEqual(coastalV1);
  });

  it("survives a JSON round trip unchanged", () => {
    expect(JSON.parse(JSON.stringify(coastalV1))).toEqual(coastalV1);
  });

  it("carries the preset id used by meta.stylePreset", () => {
    expect(COASTAL_V1_PRESET_ID).toBe("coastal-v1");
  });
});

describe("coastal-v1 palette", () => {
  it("names all eight colors as six-digit hex values", () => {
    const keys = Object.keys(coastalV1.palette).sort();
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
    for (const value of Object.values(coastalV1.palette)) {
      expect(value).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("washes paper and sky cooler than the pastoral sheet", () => {
    expect(luminance(coastalV1.palette.sky)).toBeGreaterThan(
      luminance(pastoralV1.palette.sky),
    );
  });
});

describe("coastal-v1 hatch families", () => {
  it("covers exactly the six style zones of specification section 8", () => {
    expect(Object.keys(coastalV1.hatchFamilies).sort()).toEqual(
      ["cliff", "field", "foliage", "mountain", "sky", "water"].sort(),
    );
  });

  it("uses single hatch where the grammar asks for hatch", () => {
    for (const zone of ["sky", "field", "mountain", "cliff"] as const) {
      const family = coastalV1.hatchFamilies[zone] as HatchSpec;
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
      const family = coastalV1.hatchFamilies[zone] as CrossHatchSpec;
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

  it("keeps the sky the widest zone of the composition (section 3D)", () => {
    expect(coastalV1.hatchFamilies.sky.spacing).toBeGreaterThan(
      coastalV1.hatchFamilies.field.spacing,
    );
    expect(coastalV1.hatchFamilies.sky.spacing).toBeGreaterThan(
      coastalV1.hatchFamilies.mountain.spacing,
    );
  });

  it("hatches a restless sea, unlike the calm pastoral water", () => {
    expect(coastalV1.hatchFamilies.water.jitter).toBeGreaterThan(
      pastoralV1.hatchFamilies.water.jitter,
    );
  });

  it("combs the dune grass off the horizon line", () => {
    expect(coastalV1.hatchFamilies.field.angle).toBeGreaterThan(0);
    expect(coastalV1.hatchFamilies.field.jitter).toBeGreaterThan(
      pastoralV1.hatchFamilies.field.jitter,
    );
  });

  it("hatches the sea cliff the hardest of the preset", () => {
    expect(coastalV1.hatchFamilies.cliff.weight).toBeGreaterThan(
      coastalV1.hatchFamilies.mountain.weight,
    );
    expect(coastalV1.hatchFamilies.cliff.spacing).toBeLessThan(
      coastalV1.hatchFamilies.mountain.spacing,
    );
  });

  it("draws contours in a darker ink than the hatch (section 3B)", () => {
    expect(luminance(coastalV1.contours.color)).toBeLessThan(
      luminance(coastalV1.hatchFamilies.sky.stroke),
    );
  });

  it("uses one shared hatch ink across every zone", () => {
    const inks = new Set(
      Object.values(coastalV1.hatchFamilies).map((family) => family.stroke),
    );
    expect(inks.size).toBe(1);
  });
});

describe("coastal-v1 grammar ranges", () => {
  it("keeps every ratio inside its schema range", () => {
    expect(coastalV1.compositionGrammar.minEmptyAreaRatio).toBeGreaterThan(0);
    expect(coastalV1.compositionGrammar.minEmptyAreaRatio).toBeLessThan(1);
    const [low, high] = coastalV1.compositionGrammar.preferredHorizonBand;
    expect(low).toBeLessThan(high);
    expect(coastalV1.texture.dropout).toBeGreaterThanOrEqual(0);
    expect(coastalV1.texture.dropout).toBeLessThanOrEqual(1);
  });

  it("reserves more empty paper and a lower horizon than pastoral", () => {
    expect(coastalV1.compositionGrammar.minEmptyAreaRatio).toBeGreaterThan(
      pastoralV1.compositionGrammar.minEmptyAreaRatio,
    );
    expect(coastalV1.compositionGrammar.preferredHorizonBand[0]).toBeGreaterThan(
      pastoralV1.compositionGrammar.preferredHorizonBand[0],
    );
    expect(coastalV1.objectGrammar.keepNegativeSpace).toBe(true);
  });

  it("lets the air move: every texture knob runs above pastoral", () => {
    expect(coastalV1.texture.lineJitter).toBeGreaterThan(
      pastoralV1.texture.lineJitter,
    );
    expect(coastalV1.texture.dropout).toBeGreaterThan(
      pastoralV1.texture.dropout,
    );
    expect(coastalV1.texture.pressureVariance).toBeGreaterThan(
      pastoralV1.texture.pressureVariance,
    );
    expect(coastalV1.texture.paperNoise).toBeGreaterThan(
      pastoralV1.texture.paperNoise,
    );
  });
});

describe("coastal-v1 immutability", () => {
  it("ships the preset frozen, nested included", () => {
    expect(Object.isFrozen(coastalV1)).toBe(true);
    expect(Object.isFrozen(coastalV1.palette)).toBe(true);
    expect(Object.isFrozen(coastalV1.hatchFamilies)).toBe(true);
    expect(Object.isFrozen(coastalV1.hatchFamilies.sky)).toBe(true);
  });
});

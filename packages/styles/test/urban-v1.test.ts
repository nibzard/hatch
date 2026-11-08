import { describe, expect, it } from "vitest";

import type { CrossHatchSpec, HatchSpec } from "@hatch/core";
import { parseStyleSpec, StyleSpecSchema } from "@hatch/core";

import { pastoralV1, urbanV1, URBAN_V1_PRESET_ID } from "../src/index.js";

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

describe("urban-v1 acceptance", () => {
  it("validates against the StyleSpec schema", () => {
    const result = StyleSpecSchema.safeParse(urbanV1);
    expect(result.success).toBe(true);
  });

  it("parses through parseStyleSpec without changes", () => {
    expect(parseStyleSpec(urbanV1)).toEqual(urbanV1);
  });

  it("survives a JSON round trip unchanged", () => {
    expect(JSON.parse(JSON.stringify(urbanV1))).toEqual(urbanV1);
  });

  it("carries the preset id used by meta.stylePreset", () => {
    expect(URBAN_V1_PRESET_ID).toBe("urban-v1");
  });
});

describe("urban-v1 palette", () => {
  it("names all eight colors as six-digit hex values", () => {
    const keys = Object.keys(urbanV1.palette).sort();
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
    for (const value of Object.values(urbanV1.palette)) {
      expect(value).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("greys the paper and the sky of the pastoral sheet", () => {
    expect(luminance(urbanV1.palette.paper)).toBeLessThan(
      luminance(pastoralV1.palette.paper),
    );
    expect(luminance(urbanV1.palette.sky)).toBeLessThan(
      luminance(pastoralV1.palette.sky),
    );
  });
});

describe("urban-v1 hatch families", () => {
  it("covers exactly the six style zones of specification section 8", () => {
    expect(Object.keys(urbanV1.hatchFamilies).sort()).toEqual(
      ["cliff", "field", "foliage", "mountain", "sky", "water"].sort(),
    );
  });

  it("uses single hatch where the grammar asks for hatch", () => {
    for (const zone of ["sky", "field", "mountain", "cliff"] as const) {
      const family = urbanV1.hatchFamilies[zone] as HatchSpec;
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
      const family = urbanV1.hatchFamilies[zone] as CrossHatchSpec;
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

  it("hatches the façade horizontally and evenly (section 3B)", () => {
    expect(urbanV1.hatchFamilies.field.angle).toBe(0);
  });

  it("rules every built surface steadier than pastoral ground", () => {
    expect(urbanV1.hatchFamilies.field.jitter).toBeLessThan(
      pastoralV1.hatchFamilies.field.jitter,
    );
    expect(urbanV1.hatchFamilies.mountain.jitter).toBeLessThan(
      pastoralV1.hatchFamilies.mountain.jitter,
    );
    expect(urbanV1.hatchFamilies.water.jitter).toBeLessThan(
      pastoralV1.hatchFamilies.water.jitter,
    );
  });

  it("hatches metalwork the straightest and heaviest of the preset", () => {
    expect(urbanV1.hatchFamilies.cliff.weight).toBeGreaterThan(
      urbanV1.hatchFamilies.mountain.weight,
    );
    expect(urbanV1.hatchFamilies.cliff.spacing).toBeLessThan(
      urbanV1.hatchFamilies.mountain.spacing,
    );
    expect(urbanV1.hatchFamilies.cliff.jitter).toBeLessThan(
      urbanV1.hatchFamilies.sky.jitter,
    );
  });

  it("keeps glass calmer than the pastoral water it draws on", () => {
    expect(urbanV1.hatchFamilies.water.jitter).toBeLessThan(
      pastoralV1.hatchFamilies.water.jitter,
    );
  });

  it("draws contours in a darker ink than the hatch (section 3B)", () => {
    expect(luminance(urbanV1.contours.color)).toBeLessThan(
      luminance(urbanV1.hatchFamilies.sky.stroke),
    );
  });

  it("uses one shared hatch ink across every zone", () => {
    const inks = new Set(
      Object.values(urbanV1.hatchFamilies).map((family) => family.stroke),
    );
    expect(inks.size).toBe(1);
  });
});

describe("urban-v1 grammar ranges", () => {
  it("keeps every ratio inside its schema range", () => {
    expect(urbanV1.compositionGrammar.minEmptyAreaRatio).toBeGreaterThan(0);
    expect(urbanV1.compositionGrammar.minEmptyAreaRatio).toBeLessThan(1);
    const [low, high] = urbanV1.compositionGrammar.preferredHorizonBand;
    expect(low).toBeLessThan(high);
    expect(urbanV1.texture.dropout).toBeGreaterThanOrEqual(0);
    expect(urbanV1.texture.dropout).toBeLessThanOrEqual(1);
  });

  it("lets the frame fill and keeps the negative space (section 3D)", () => {
    expect(urbanV1.compositionGrammar.minEmptyAreaRatio).toBeLessThan(
      pastoralV1.compositionGrammar.minEmptyAreaRatio,
    );
    expect(urbanV1.compositionGrammar.minEmptyAreaRatio).toBeGreaterThan(0.1);
    expect(urbanV1.compositionGrammar.preferredHorizonBand[0]).toBeLessThan(
      pastoralV1.compositionGrammar.preferredHorizonBand[0],
    );
    expect(urbanV1.objectGrammar.keepNegativeSpace).toBe(true);
  });

  it("keeps objects geometric and detailed, with square edges", () => {
    expect(urbanV1.objectGrammar.abstractionLevel).toBeGreaterThan(
      pastoralV1.objectGrammar.abstractionLevel,
    );
    expect(urbanV1.objectGrammar.maxDetailPerObject).toBeGreaterThan(
      pastoralV1.objectGrammar.maxDetailPerObject,
    );
    expect(urbanV1.objectGrammar.edgeRoundnessBias).toBeLessThan(
      pastoralV1.objectGrammar.edgeRoundnessBias,
    );
  });

  it("holds the hand steady: every texture knob runs below pastoral", () => {
    expect(urbanV1.texture.lineJitter).toBeLessThan(
      pastoralV1.texture.lineJitter,
    );
    expect(urbanV1.texture.dropout).toBeLessThan(pastoralV1.texture.dropout);
    expect(urbanV1.texture.pressureVariance).toBeLessThan(
      pastoralV1.texture.pressureVariance,
    );
    expect(urbanV1.texture.paperNoise).toBeLessThan(
      pastoralV1.texture.paperNoise,
    );
  });
});

describe("urban-v1 immutability", () => {
  it("ships the preset frozen, nested included", () => {
    expect(Object.isFrozen(urbanV1)).toBe(true);
    expect(Object.isFrozen(urbanV1.palette)).toBe(true);
    expect(Object.isFrozen(urbanV1.hatchFamilies)).toBe(true);
    expect(Object.isFrozen(urbanV1.hatchFamilies.sky)).toBe(true);
  });
});

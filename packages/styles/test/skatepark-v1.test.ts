import { describe, expect, it } from "vitest";

import type { CrossHatchSpec, HatchSpec } from "@hatch/core";
import { parseStyleSpec, StyleSpecSchema } from "@hatch/core";

import { pastoralV1, SKATEPARK_V1_PRESET_ID, skateparkV1 } from "../src/index.js";

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

describe("skatepark-v1 acceptance", () => {
  it("validates against the StyleSpec schema", () => {
    const result = StyleSpecSchema.safeParse(skateparkV1);
    expect(result.success).toBe(true);
  });

  it("parses through parseStyleSpec without changes", () => {
    expect(parseStyleSpec(skateparkV1)).toEqual(skateparkV1);
  });

  it("survives a JSON round trip unchanged", () => {
    expect(JSON.parse(JSON.stringify(skateparkV1))).toEqual(skateparkV1);
  });

  it("carries the preset id used by meta.stylePreset", () => {
    expect(SKATEPARK_V1_PRESET_ID).toBe("skatepark-v1");
  });
});

describe("skatepark-v1 palette", () => {
  it("names all eight colors as six-digit hex values", () => {
    const keys = Object.keys(skateparkV1.palette).sort();
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
    for (const value of Object.values(skateparkV1.palette)) {
      expect(value).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("cools the paper of the pastoral sheet", () => {
    expect(luminance(skateparkV1.palette.paper)).toBeGreaterThan(
      luminance(pastoralV1.palette.paper),
    );
  });
});

describe("skatepark-v1 hatch families", () => {
  it("covers exactly the six style zones of specification section 8", () => {
    expect(Object.keys(skateparkV1.hatchFamilies).sort()).toEqual(
      ["cliff", "field", "foliage", "mountain", "sky", "water"].sort(),
    );
  });

  it("uses single hatch where the grammar asks for hatch", () => {
    for (const zone of ["sky", "field", "mountain", "cliff"] as const) {
      const family = skateparkV1.hatchFamilies[zone] as HatchSpec;
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
      const family = skateparkV1.hatchFamilies[zone] as CrossHatchSpec;
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

  it("hatches the deck horizontally, wider and flatter than pasture", () => {
    expect(skateparkV1.hatchFamilies.field.angle).toBe(0);
    expect(skateparkV1.hatchFamilies.field.spacing).toBeGreaterThan(
      pastoralV1.hatchFamilies.field.spacing,
    );
    expect(skateparkV1.hatchFamilies.field.jitter).toBeLessThan(
      pastoralV1.hatchFamilies.field.jitter,
    );
  });

  it("hatches the formed transition crisper than pastoral rock", () => {
    expect(skateparkV1.hatchFamilies.mountain.spacing).toBeLessThan(
      skateparkV1.hatchFamilies.field.spacing,
    );
    expect(skateparkV1.hatchFamilies.mountain.jitter).toBeLessThan(
      pastoralV1.hatchFamilies.mountain.jitter,
    );
  });

  it("hatches coping and rail exactly vertical, the heaviest of the preset", () => {
    expect(skateparkV1.hatchFamilies.cliff.angle).toBe(90);
    expect(skateparkV1.hatchFamilies.cliff.weight).toBeGreaterThan(
      skateparkV1.hatchFamilies.mountain.weight,
    );
    expect(skateparkV1.hatchFamilies.cliff.spacing).toBeLessThan(
      skateparkV1.hatchFamilies.mountain.spacing,
    );
    expect(skateparkV1.hatchFamilies.cliff.jitter).toBeLessThan(
      skateparkV1.hatchFamilies.sky.jitter,
    );
  });

  it("keeps the cast shadow the densest fill of the park", () => {
    expect(skateparkV1.hatchFamilies.foliage.spacingA).toBeLessThan(
      skateparkV1.hatchFamilies.field.spacing,
    );
    expect(skateparkV1.hatchFamilies.foliage.weight).toBeGreaterThan(
      skateparkV1.hatchFamilies.field.weight,
    );
  });

  it("keeps sky lines more regular than the shadow mass (section 17)", () => {
    expect(skateparkV1.hatchFamilies.sky.jitter).toBeLessThan(
      skateparkV1.hatchFamilies.foliage.jitter,
    );
  });

  it("draws contours in a darker ink than the hatch (section 3B)", () => {
    expect(luminance(skateparkV1.contours.color)).toBeLessThan(
      luminance(skateparkV1.hatchFamilies.sky.stroke),
    );
  });

  it("uses one shared hatch ink across every zone", () => {
    const inks = new Set(
      Object.values(skateparkV1.hatchFamilies).map((family) => family.stroke),
    );
    expect(inks.size).toBe(1);
  });
});

describe("skatepark-v1 grammar ranges", () => {
  it("keeps every ratio inside its schema range", () => {
    expect(skateparkV1.compositionGrammar.minEmptyAreaRatio).toBeGreaterThan(0);
    expect(skateparkV1.compositionGrammar.minEmptyAreaRatio).toBeLessThan(1);
    const [low, high] = skateparkV1.compositionGrammar.preferredHorizonBand;
    expect(low).toBeLessThan(high);
    expect(skateparkV1.texture.dropout).toBeGreaterThanOrEqual(0);
    expect(skateparkV1.texture.dropout).toBeLessThanOrEqual(1);
  });

  it("gives the park the lower frame and keeps the paper open (section 3D)", () => {
    expect(
      skateparkV1.compositionGrammar.preferredHorizonBand[1],
    ).toBeLessThanOrEqual(
      pastoralV1.compositionGrammar.preferredHorizonBand[1],
    );
    expect(skateparkV1.compositionGrammar.minEmptyAreaRatio).toBeGreaterThan(
      0.25,
    );
    expect(skateparkV1.objectGrammar.keepNegativeSpace).toBe(true);
    expect(skateparkV1.compositionGrammar.focalObjectCount).toBeLessThanOrEqual(
      3,
    );
  });

  it("keeps the line work clean, under the pastoral drift", () => {
    expect(skateparkV1.contours.wobble).toBeLessThan(
      pastoralV1.contours.wobble,
    );
    expect(skateparkV1.contours.simplifyTolerance).toBeLessThan(
      pastoralV1.contours.simplifyTolerance,
    );
    expect(skateparkV1.texture.lineJitter).toBeLessThan(
      pastoralV1.texture.lineJitter,
    );
  });
});

describe("skatepark-v1 immutability", () => {
  it("ships the preset frozen, nested included", () => {
    expect(Object.isFrozen(skateparkV1)).toBe(true);
    expect(Object.isFrozen(skateparkV1.palette)).toBe(true);
    expect(Object.isFrozen(skateparkV1.hatchFamilies)).toBe(true);
    expect(Object.isFrozen(skateparkV1.hatchFamilies.sky)).toBe(true);
  });
});

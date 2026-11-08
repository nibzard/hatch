import { describe, expect, it } from "vitest";

import { StyleSpecSchema } from "@hatch/core";

import {
  coastalV1,
  COASTAL_V1_PRESET_ID,
  environmentTypeOfPreset,
  getStylePreset,
  hasStylePreset,
  listStylePresets,
  pastoralV1,
  PASTORAL_V1_PRESET_ID,
  presetIdsForEnvironment,
  resolveStyle,
  SKATEPARK_V1_PRESET_ID,
  skateparkV1,
  STYLE_PRESETS,
  urbanV1,
  URBAN_V1_PRESET_ID,
} from "../src/index.js";

describe("preset registry", () => {
  it("registers every shipped preset under its preset id", () => {
    expect(STYLE_PRESETS[PASTORAL_V1_PRESET_ID]).toEqual(pastoralV1);
    expect(STYLE_PRESETS[COASTAL_V1_PRESET_ID]).toEqual(coastalV1);
    expect(STYLE_PRESETS[URBAN_V1_PRESET_ID]).toEqual(urbanV1);
    expect(STYLE_PRESETS[SKATEPARK_V1_PRESET_ID]).toEqual(skateparkV1);
  });

  it("lists the registered preset ids in alphabetical order", () => {
    expect(listStylePresets()).toEqual([
      "coastal-v1",
      "pastoral-v1",
      "skatepark-v1",
      "urban-v1",
    ]);
  });

  it("answers hasStylePreset for known and unknown ids", () => {
    expect(hasStylePreset("pastoral-v1")).toBe(true);
    expect(hasStylePreset("coastal-v1")).toBe(true);
    expect(hasStylePreset("urban-v1")).toBe(true);
    expect(hasStylePreset("skatepark-v1")).toBe(true);
    expect(hasStylePreset("interior-v1")).toBe(false);
  });

  it("keeps every preset distinct from its neighbours", () => {
    const presets = [pastoralV1, coastalV1, urbanV1, skateparkV1];
    for (const preset of presets) {
      expect(
        presets.filter(
          (other) => JSON.stringify(other) === JSON.stringify(preset),
        ),
      ).toHaveLength(1);
    }
  });

  it("validates every registered preset against the StyleSpec schema", () => {
    expect(listStylePresets().length).toBeGreaterThan(0);
    for (const id of listStylePresets()) {
      const result = StyleSpecSchema.safeParse(getStylePreset(id));
      expect(result.success, id).toBe(true);
    }
  });

  it("returns a copy that a caller may mutate freely", () => {
    const preset = getStylePreset("pastoral-v1");
    preset.palette.paper = "#000000";
    preset.hatchFamilies.sky.spacing = 99;
    expect(getStylePreset("pastoral-v1").palette.paper).toBe("#f6f1e7");
    expect(getStylePreset("pastoral-v1").hatchFamilies.sky.spacing).toBe(7);
  });

  it("throws one readable error for an unknown preset id", () => {
    expect(() => getStylePreset("interior-v1")).toThrowError(
      /unknown style preset 'interior-v1'; available presets: coastal-v1, pastoral-v1, skatepark-v1, urban-v1/,
    );
  });
});

describe("resolveStyle", () => {
  it("resolves a bare preset and records its name", () => {
    const style = resolveStyle("pastoral-v1");
    expect(style.preset).toBe("pastoral-v1");
    expect(style).toEqual({ ...pastoralV1, preset: "pastoral-v1" });
  });

  it("resolves the preset id the core scene fixture names", () => {
    // meta.stylePreset of the example scene in @hatch/core is
    // "pastoral-v1"; the lookup must accept exactly that string.
    expect(hasStylePreset("pastoral-v1")).toBe(true);
  });

  it("replaces one whole top-level section", () => {
    const preset = getStylePreset("pastoral-v1");
    const style = resolveStyle("pastoral-v1", {
      hatchFamilies: {
        ...preset.hatchFamilies,
        sky: { ...preset.hatchFamilies.sky, spacing: 4 },
      },
    });
    expect(style.hatchFamilies.sky.spacing).toBe(4);
    expect(style.hatchFamilies.field).toEqual(pastoralV1.hatchFamilies.field);
    expect(style.texture).toEqual(pastoralV1.texture);
  });

  it("returns a resolved style that no caller state can corrupt", () => {
    const style = resolveStyle("pastoral-v1");
    style.hatchFamilies.sky.spacing = 99;
    style.palette.accent = "#000000";
    expect(getStylePreset("pastoral-v1").hatchFamilies.sky.spacing).toBe(7);
    expect(getStylePreset("pastoral-v1").palette.accent).toBe("#b0452e");
  });

  it("throws one readable error for invalid overrides", () => {
    expect(() =>
      resolveStyle("pastoral-v1", {
        texture: { lineJitter: 0.1, dropout: 5, pressureVariance: 0.1, paperNoise: 0.01 },
      }),
    ).toThrowError(/invalid style overrides for preset 'pastoral-v1': texture\.dropout/);
  });

  it("throws the registry error for an unknown preset before looking at overrides", () => {
    expect(() => resolveStyle("interior-v1")).toThrowError(
      /unknown style preset 'interior-v1'/,
    );
  });
});

describe("preset environment families", () => {
  it("declares the family every shipped preset draws", () => {
    // The intent stage checks environment.type against this value, so a
    // preset without a family would accept every environment silently.
    expect(pastoralV1.environmentType).toBe("rural");
    expect(coastalV1.environmentType).toBe("coastal");
    expect(urbanV1.environmentType).toBe("urban");
    expect(skateparkV1.environmentType).toBe("skatepark");
  });

  it("answers the family of one preset", () => {
    expect(environmentTypeOfPreset(PASTORAL_V1_PRESET_ID)).toBe("rural");
    expect(environmentTypeOfPreset(COASTAL_V1_PRESET_ID)).toBe("coastal");
    expect(() => environmentTypeOfPreset("interior-v1")).toThrow(
      /unknown style preset 'interior-v1'/,
    );
  });

  it("carries the family through resolveStyle", () => {
    expect(resolveStyle(PASTORAL_V1_PRESET_ID).environmentType).toBe("rural");
  });

  it("lists the presets of one family, and none for a family it does not ship", () => {
    expect(presetIdsForEnvironment("rural")).toEqual(["pastoral-v1"]);
    expect(presetIdsForEnvironment("coastal")).toEqual(["coastal-v1"]);
    expect(presetIdsForEnvironment("urban")).toEqual(["urban-v1"]);
    expect(presetIdsForEnvironment("skatepark")).toEqual(["skatepark-v1"]);
    // interior-v1 has not shipped, so no preset draws the family yet.
    expect(presetIdsForEnvironment("interior")).toEqual([]);
    // custom names no family, so every preset pairs with it.
    expect(presetIdsForEnvironment("custom")).toEqual(listStylePresets());
  });
});

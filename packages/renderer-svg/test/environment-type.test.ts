/**
 * Acceptance tests for the environment type field (task T053).
 *
 * `environment.type` names the world the scene draws, and every preset
 * names the world it styles. Before T053 the two strings never met: the
 * schema accepted the type, the spec hash consumed it, the planning trace
 * copied it, and no stage read it, so a spec that said `interior` under
 * `pastoral-v1` rendered the same picture with different seeded bytes.
 *
 * The decision T053 ships: the intent stage checks the type of the scene
 * against the family of the resolved preset and rejects the mismatch, so
 * the field owns the pairing of a scene with its style. `custom` is the
 * one value that names no family, so it pairs with every preset. These
 * tests render two specs that differ in nothing but `environment.type`
 * and pin the render on one side, the rejection on the other.
 */

import { describe, expect, it } from "vitest";

import type { EnvironmentType, RenderIR, SceneSpec, TraceEvent } from "@hatch/core";

import { createV1Engine } from "../src/index.js";
import { assertWellFormedXml } from "./xml-check.js";

/** What one test renders: the document, the intermediate representation. */
function render(spec: SceneSpec): { svg: string; ir: RenderIR } {
  const result = createV1Engine().renderScene(spec);
  assertWellFormedXml(result.svg);
  return { svg: result.svg, ir: result.ir };
}

/** The message one rejected render throws. */
function renderError(spec: SceneSpec): string {
  try {
    createV1Engine().renderScene(spec);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("test expected the render to fail");
}

/**
 * One pastoral scene whose environment type is the only value the caller
 * sets. The same scene under the same seed keeps every other byte of the
 * render identity fixed, so two renders of this spec differ exactly where
 * the field drives a decision.
 */
function environmentTypeScene(
  type: EnvironmentType,
  stylePreset = "pastoral-v1",
): SceneSpec {
  return {
    meta: {
      id: "environment-type-0001",
      seed: 20261107,
      stylePreset,
      aspectRatio: "4:3",
      version: "1.0.0",
    },
    camera: { framing: "medium", lens: "normal", horizonY: 0.68 },
    composition: {
      focalPoints: ["cottage-1"],
      balance: "center",
      negativeSpace: 0.35,
      depthLayers: 3,
    },
    environment: { type, sky: { cloudCount: 2 } },
    objects: [
      {
        id: "hill-1",
        kind: "hill",
        role: "background",
        position: { x: 0.3, y: 0.7 },
        scale: 2,
        params: { width: 300, height: 80 },
      },
      {
        id: "cottage-1",
        kind: "house",
        role: "focal",
        position: { x: 0.62, y: 0.8 },
        scale: 1.5,
        params: { width: 150, wallHeight: 80, windows: 2, chimney: true },
      },
    ],
  } as SceneSpec;
}

/** The intent event of one trace. */
function intentEventOf(events: readonly TraceEvent[]): TraceEvent {
  const event = events.find((entry) => entry.stage === "intent");
  if (event === undefined) {
    throw new Error("test expected an intent event");
  }
  return event;
}

describe("environment.type acceptance: the family check", () => {
  it("renders the scene whose type names the family of its preset", () => {
    const { ir } = render(environmentTypeScene("rural"));
    expect(ir.regions.length).toBeGreaterThan(0);
    expect(ir.style.preset).toBe("pastoral-v1");
  });

  it("rejects a scene whose type names another family, with the fix", () => {
    // The two specs differ in nothing but environment.type. One renders,
    // the other fails before any stage runs, so the field can no longer
    // move the spec hash alone.
    const coastal = environmentTypeScene("coastal");
    expect(renderError(coastal)).toBe(
      'environment.type "coastal" does not match the style preset ' +
        '"pastoral-v1", which draws "rural" environments; the presets that ' +
        'draw "coastal" are: coastal-v1. Set environment.type to "rural" to ' +
        'render this scene under "pastoral-v1", or to "custom" to keep the ' +
        "preset.",
    );
  });

  it("renders the cross-pairing the custom type names", () => {
    const { ir } = render(environmentTypeScene("custom"));
    expect(ir.regions.length).toBeGreaterThan(0);
    expect(ir.style.preset).toBe("pastoral-v1");
  });

  it("rejects a family no registered preset draws yet", () => {
    // interior-v1 is the one preset of specification section 11 that has
    // not shipped, so an interior scene has no preset to render under.
    // The error says so instead of rendering an unchanged composition.
    expect(renderError(environmentTypeScene("interior"))).toContain(
      'no registered preset draws "interior" environments yet',
    );
  });

  it("rejects a mismatch under every round 2 preset as well", () => {
    const families = [
      ["coastal-v1", "coastal"],
      ["urban-v1", "urban"],
      ["skatepark-v1", "skatepark"],
    ] as const;
    for (const [preset, family] of families) {
      const message = renderError(environmentTypeScene("rural", preset));
      expect(message, preset).toContain("does not match the style preset");
      // The message names the pair it rejected and the fix the message offers.
      expect(message, preset).toContain(`"${preset}", which draws "${family}"`);
    }
    // The preset that draws the asked family is the other fix it names.
    expect(renderError(environmentTypeScene("rural", "coastal-v1"))).toContain(
      'the presets that draw "rural" are: pastoral-v1',
    );
  });

  it("records the pair in the intent event of the trace", () => {
    const { ir } = render(environmentTypeScene("rural"));
    const data = intentEventOf(ir.trace.events).data as Record<string, unknown>;
    expect(data.environmentType).toBe("rural");
    expect(data.presetEnvironmentType).toBe("rural");

    const custom = render(environmentTypeScene("custom"));
    const customData = intentEventOf(custom.ir.trace.events).data as Record<
      string,
      unknown
    >;
    expect(customData.environmentType).toBe("custom");
    expect(customData.presetEnvironmentType).toBe("rural");
  });

  it("keeps the structure of the render on the accepted cross-pairing", () => {
    // The custom type changes no stroke by itself: it states a pairing,
    // not a style. The accepted render therefore holds the same regions
    // with the same fills as the matching pair, apart from the seeded
    // streams the spec hash moves.
    const matching = render(environmentTypeScene("rural"));
    const custom = render(environmentTypeScene("custom"));
    expect(custom.ir.regions.map((region) => region.fillStyle)).toEqual(
      matching.ir.regions.map((region) => region.fillStyle),
    );
    expect(custom.ir.style).toEqual(matching.ir.style);
  });
});

describe("environment.type acceptance: the round 2 families", () => {
  it("renders each round 2 scene under the preset of its own family", () => {
    for (const [preset, type] of [
      ["coastal-v1", "coastal"],
      ["urban-v1", "urban"],
      ["skatepark-v1", "skatepark"],
    ] as const) {
      const { ir } = render(environmentTypeScene(type, preset));
      expect(ir.style.preset, preset).toBe(preset);
      expect(ir.regions.length, preset).toBeGreaterThan(0);
    }
  });

  it("keeps the family out of the style overrides", () => {
    // The family states which world the preset draws, so a scene cannot
    // rewrite it to slip a mismatched pair past the check. The override
    // parses to nothing and the render still fails on the pair.
    const spec = environmentTypeScene("coastal");
    const overridden = {
      ...spec,
      styleOverrides: { environmentType: "custom" },
    } as unknown as SceneSpec;
    expect(renderError(overridden)).toContain(
      'environment.type "coastal" does not match',
    );
  });
});

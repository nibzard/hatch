/**
 * Tests for the environment and style role model (tasks T045 and T049).
 *
 * The scene schema carries three free-form environment blocks, `sky`,
 * `ground`, and `atmosphere`, and a `styleRole` string on every object. A
 * field the compiler only stores changes the spec hash, the hash moves the
 * seeded streams, and the bytes drift while the picture stays the same.
 * These tests pin the number each field moves, so a field that goes inert
 * fails on an exact value, not on byte noise.
 */

import { describe, expect, it } from "vitest";

import {
  atmosphereDecisionOf,
  environmentDecisionOf,
  environmentFamilyMatches,
  ENVIRONMENT_TYPE_NAMES,
  EnvironmentSchema,
  fogInkShare,
  FRONT_ROLE_DEPTH,
  groundDecisionOf,
  groundStrips,
  isEnvironmentType,
  MAX_CLOUD_COUNT,
  MAX_FOG_FADE,
  MAX_GROUND_STRIPS,
  MAX_RAIN_STROKES,
  planScene,
  RAIN_ANGLE_DEGREES,
  RAIN_JITTER,
  RAIN_WEIGHT_SHARE,
  rainFillStyle,
  SceneSpecSchema,
  skyDecisionOf,
  STYLE_ROLE_FAMILIES,
  STYLE_ROLE_NAMES,
  isStyleRole,
  styleRoleFamily,
} from "../src/index.js";
import { createRng, type SeededRng } from "../src/rng.js";
import type { Path, Point } from "../src/path.js";
import type { SceneSpec } from "../src/scene.js";
import { validSceneSpec, validStyleSpec } from "./fixtures.js";

/** The resolved style the planner reads, over the fixture preset. */
function resolvedStyle() {
  return { ...validStyleSpec(), preset: "test-pastoral" } as const;
}

/** One planning stream, reproducible by label. */
function planRng(label: string): SeededRng {
  return createRng(`hatch-environment-test:${label}`);
}

/** The fixture spec with the environment blocks replaced. */
function specWithEnvironment(environment: Partial<SceneSpec["environment"]>): SceneSpec {
  const spec = validSceneSpec();
  return { ...spec, environment: { ...spec.environment, ...environment } };
}

/** Every point one path moves through, close commands excepted. */
function pathPoints(path: Path): Point[] {
  return path.commands.flatMap((command) =>
    command.command === "close" ? [] : [command.to],
  );
}

describe("skyDecisionOf", () => {
  it("reads a clear sky when the block is absent or empty", () => {
    expect(
      skyDecisionOf(specWithEnvironment({ sky: undefined })),
    ).toEqual({ cloudCount: 0 });
    expect(skyDecisionOf(specWithEnvironment({ sky: {} }))).toEqual({
      cloudCount: 0,
    });
  });

  it("reads the cloud count", () => {
    expect(skyDecisionOf(validSceneSpec())).toEqual({ cloudCount: 3 });
    expect(
      skyDecisionOf(
        specWithEnvironment({ sky: { cloudCount: MAX_CLOUD_COUNT } }),
      ),
    ).toEqual({ cloudCount: MAX_CLOUD_COUNT });
  });

  it("rejects a count that is not an integer in range", () => {
    for (const cloudCount of [-1, 1.5, MAX_CLOUD_COUNT + 1, "many"]) {
      expect(() =>
        skyDecisionOf(specWithEnvironment({ sky: { cloudCount } })),
      ).toThrow(
        /environment\.sky\.cloudCount must be an integer between 0 and 12/,
      );
    }
  });

  it("rejects a key the compiler does not read, by name", () => {
    expect(() =>
      skyDecisionOf(
        specWithEnvironment({ sky: { cloudCount: 3, storminess: 0.9 } }),
      ),
    ).toThrow(
      /environment\.sky\.storminess is not read by the compiler; environment\.sky accepts cloudCount only/,
    );
  });
});

describe("groundDecisionOf", () => {
  it("reads zero strips when the block is absent or empty", () => {
    expect(groundDecisionOf(validSceneSpec())).toEqual({ strips: 0 });
    expect(
      groundDecisionOf(specWithEnvironment({ ground: {} })),
    ).toEqual({ strips: 0 });
  });

  it("reads the strip count", () => {
    expect(
      groundDecisionOf(specWithEnvironment({ ground: { strips: 4 } })),
    ).toEqual({ strips: 4 });
  });

  it("rejects a count that is not an integer in range", () => {
    for (const strips of [-1, 1.5, MAX_GROUND_STRIPS + 1, "many"]) {
      expect(() =>
        groundDecisionOf(specWithEnvironment({ ground: { strips } })),
      ).toThrow(/environment\.ground\.strips must be an integer between 0 and 6/);
    }
  });

  it("rejects a key the compiler does not read, by name", () => {
    expect(() =>
      groundDecisionOf(specWithEnvironment({ ground: { furrows: 3 } })),
    ).toThrow(
      /environment\.ground\.furrows is not read by the compiler; environment\.ground accepts strips only/,
    );
  });
});

describe("atmosphereDecisionOf", () => {
  it("reads a clear atmosphere when the block is absent or empty", () => {
    const clear = { fog: 0, fogClamped: false, rain: 0 };
    expect(atmosphereDecisionOf(validSceneSpec())).toEqual(clear);
    expect(
      atmosphereDecisionOf(specWithEnvironment({ atmosphere: {} })),
    ).toEqual(clear);
  });

  it("reads the fog and the rain", () => {
    expect(
      atmosphereDecisionOf(
        specWithEnvironment({ atmosphere: { fog: 0.5, rain: 40 } }),
      ),
    ).toEqual({ fog: 0.5, fogClamped: false, rain: 40 });
  });

  it("clamps the fog into [0, 1] and records the clamp", () => {
    const high = atmosphereDecisionOf(
      specWithEnvironment({ atmosphere: { fog: 4 } }),
    );
    expect(high.fog).toBe(1);
    expect(high.fogClamped).toBe(true);
    const low = atmosphereDecisionOf(
      specWithEnvironment({ atmosphere: { fog: -0.5 } }),
    );
    expect(low.fog).toBe(0);
    expect(low.fogClamped).toBe(true);
  });

  it("rejects a fog that is not a finite number", () => {
    expect(() =>
      atmosphereDecisionOf(specWithEnvironment({ atmosphere: { fog: "mist" } })),
    ).toThrow(/environment\.atmosphere\.fog must be a finite number/);
  });

  it("rejects a rain count that is not an integer in range", () => {
    for (const rain of [-1, 2.5, MAX_RAIN_STROKES + 1, "drizzle"]) {
      expect(() =>
        atmosphereDecisionOf(specWithEnvironment({ atmosphere: { rain } })),
      ).toThrow(
        /environment\.atmosphere\.rain must be an integer between 0 and 160/,
      );
    }
  });

  it("rejects a key the compiler does not read, by name", () => {
    expect(() =>
      atmosphereDecisionOf(
        specWithEnvironment({ atmosphere: { haze: 0.4 } }),
      ),
    ).toThrow(
      /environment\.atmosphere\.haze is not read by the compiler; environment\.atmosphere accepts fog, rain only/,
    );
  });
});

describe("environmentDecisionOf", () => {
  it("reads every block in one decision", () => {
    expect(
      environmentDecisionOf(
        specWithEnvironment({
          sky: { cloudCount: 2 },
          ground: { strips: 2 },
          atmosphere: { fog: 1, rain: 60 },
        }),
      ),
    ).toEqual({
      sky: { cloudCount: 2 },
      ground: { strips: 2 },
      atmosphere: { fog: 1, fogClamped: false, rain: 60 },
    });
  });
});

describe("fogInkShare", () => {
  it("leaves every plane its full ink under no fog", () => {
    for (const depth of [0, 1, 2, 3]) {
      expect(fogInkShare(0, depth)).toBe(1);
    }
  });

  it("leaves the focal plane untouched and fades each plane behind it", () => {
    expect(fogInkShare(1, FRONT_ROLE_DEPTH)).toBe(1);
    // Full fog takes MAX_FOG_FADE of the background ink and a proportional
    // share of the planes between, so distance reads as lighter ink. The
    // shares of the middle planes round to four decimals.
    expect(fogInkShare(1, 0)).toBeCloseTo(1 - MAX_FOG_FADE, 9);
    expect(fogInkShare(1, 1)).toBeCloseTo(1 - (MAX_FOG_FADE * 2) / 3, 4);
    expect(fogInkShare(1, 2)).toBeCloseTo(1 - MAX_FOG_FADE / 3, 4);
    const half = fogInkShare(0.5, 0);
    expect(half).toBeGreaterThan(fogInkShare(1, 0));
    expect(half).toBeLessThan(1);
  });

  it("rounds to four decimals so the fills stay short numbers", () => {
    expect(fogInkShare(0.33, 1)).toBe(
      Math.round((1 - 0.33 * (2 / 3) * MAX_FOG_FADE) * 10000) / 10000,
    );
  });
});

describe("rainFillStyle", () => {
  it("spreads the requested strokes across the canvas width", () => {
    const style = resolvedStyle();
    const canvas = { width: 1024, height: 768 };
    const fill = rainFillStyle(style, canvas, 60);
    expect(fill).toEqual({
      type: "hatch",
      angle: RAIN_ANGLE_DEGREES,
      spacing: canvas.width / 60,
      stroke: style.contours.color,
      weight: style.contours.weight * RAIN_WEIGHT_SHARE,
      jitter: RAIN_JITTER,
    });
    // The angle runs off the vertical and the weight stays under the contour
    // ink, so the weather reads lighter than the terrain it falls on.
    expect(RAIN_ANGLE_DEGREES).toBeLessThan(90);
    expect(RAIN_WEIGHT_SHARE).toBeLessThan(1);
  });
});

describe("groundStrips", () => {
  const canvas = { width: 1024, height: 768 };
  const heights = { left: 522.24, right: 522.24 };

  it("lays one line per strip, in band order from the horizon down", () => {
    const strips = groundStrips(3, planRng("strips"), canvas, heights);
    expect(strips.map((strip) => strip.id)).toEqual([
      "ground-strip-1",
      "ground-strip-2",
      "ground-strip-3",
    ]);
    expect(groundStrips(0, planRng("strips"), canvas, heights)).toEqual([]);
  });

  it("runs every line across the canvas below the horizon", () => {
    for (const strip of groundStrips(4, planRng("strips"), canvas, heights)) {
      const points = pathPoints(strip.path);
      expect(points[0]?.x).toBe(0);
      expect(points[points.length - 1]?.x).toBe(canvas.width);
      for (const point of points) {
        expect(point.y).toBeGreaterThan(heights.left);
        expect(point.y).toBeLessThanOrEqual(canvas.height);
      }
    }
  });

  it("draws the identical strip for the identical stream", () => {
    const first = groundStrips(2, planRng("strips"), canvas, heights);
    const second = groundStrips(2, planRng("strips"), canvas, heights);
    expect(first).toEqual(second);
    expect(groundStrips(2, planRng("other"), canvas, heights)).not.toEqual(first);
  });

  it("holds the wave of one strip when the ground gains more", () => {
    // Each strip forks its own stream under its index, so a ground that asks
    // for more strips moves the share of every band, never the wave inside
    // it: the vertical distance between the same points of two strips of one
    // ground stays constant under a level horizon.
    const sparse = groundStrips(2, planRng("strips"), canvas, heights);
    const dense = groundStrips(5, planRng("strips"), canvas, heights);
    const shareSparse = 1 / 3;
    const shareDense = 1 / 6;
    const band = canvas.height - heights.left;
    for (const [index, point] of pathPoints(sparse[0]!.path).entries()) {
      const other = pathPoints(dense[0]!.path)[index]!;
      expect(point.y - other.y).toBeCloseTo((shareSparse - shareDense) * band, 2);
    }
  });
});

describe("planScene reads the environment", () => {
  it("plans a clear ground and atmosphere by default", () => {
    const plan = planScene(validSceneSpec(), resolvedStyle(), planRng("scene"));
    expect(plan.environment).toEqual({
      sky: { cloudCount: 3 },
      ground: { strips: 0 },
      atmosphere: { fog: 0, fogClamped: false, rain: 0 },
    });
    expect(plan.groundStrips).toEqual([]);
  });

  it("carries the environment decision and the strips it asked for", () => {
    const spec = specWithEnvironment({
      ground: { strips: 2 },
      atmosphere: { fog: 0.5, rain: 40 },
    });
    const plan = planScene(spec, resolvedStyle(), planRng("scene"));
    expect(plan.environment).toEqual({
      sky: { cloudCount: 3 },
      ground: { strips: 2 },
      atmosphere: { fog: 0.5, fogClamped: false, rain: 40 },
    });
    expect(plan.groundStrips.map((strip) => strip.id)).toEqual([
      "ground-strip-1",
      "ground-strip-2",
    ]);
  });

  it("rejects an unread environment key before it plans", () => {
    expect(() =>
      planScene(
        specWithEnvironment({ atmosphere: { smog: 0.2 } }),
        resolvedStyle(),
        planRng("scene"),
      ),
    ).toThrow(/environment\.atmosphere\.smog is not read by the compiler/);
    expect(() =>
      planScene(
        specWithEnvironment({ sky: { cloudCount: 3, storminess: 0.9 } }),
        resolvedStyle(),
        planRng("scene"),
      ),
    ).toThrow(/environment\.sky\.storminess is not read by the compiler/);
  });
});

describe("the style role vocabulary", () => {
  it("maps every role name to the family it fills with", () => {
    expect(STYLE_ROLE_NAMES).toEqual(Object.keys(STYLE_ROLE_FAMILIES));
    for (const [role, family] of Object.entries(STYLE_ROLE_FAMILIES)) {
      expect(isStyleRole(role)).toBe(true);
      expect(styleRoleFamily(role)).toBe(family);
    }
    // One role per family the style carries, plus the paper role that leaves
    // an object as negative space.
    expect(STYLE_ROLE_NAMES).toContain("sky hatch");
    expect(STYLE_ROLE_NAMES).toContain("paper");
    expect(STYLE_ROLE_FAMILIES["paper"]).toBe("none");
  });

  it("rejects a name outside the vocabulary", () => {
    expect(isStyleRole("meadow")).toBe(false);
    expect(() => styleRoleFamily("meadow")).toThrow(
      /styleRole "meadow" names no fill of the style/,
    );
  });

  it("accepts every role name on an object and rejects any other string", () => {
    const spec = validSceneSpec();
    for (const role of STYLE_ROLE_NAMES) {
      const result = SceneSpecSchema.safeParse({
        ...spec,
        objects: [{ ...spec.objects[0]!, styleRole: role }],
      });
      expect(result.success).toBe(true);
    }
    const rejected = SceneSpecSchema.safeParse({
      ...spec,
      objects: [{ ...spec.objects[0]!, styleRole: "contour" }],
    });
    expect(rejected.success).toBe(false);
    expect(JSON.stringify(rejected.error?.issues)).toMatch(
      /styleRole must name a fill role of specification section 16D/,
    );
  });
});

describe("the environment type vocabulary", () => {
  it("lists every family the scene schema accepts", () => {
    // The list is the enum of specification section 5, in spec order, with
    // the one escape hatch last.
    expect(ENVIRONMENT_TYPE_NAMES).toEqual([
      "rural",
      "coastal",
      "urban",
      "interior",
      "skatepark",
      "custom",
    ]);
    for (const name of ENVIRONMENT_TYPE_NAMES) {
      expect(isEnvironmentType(name)).toBe(true);
    }
  });

  it("accepts every family on a spec and rejects any other string", () => {
    const spec = validSceneSpec();
    for (const type of ENVIRONMENT_TYPE_NAMES) {
      const result = EnvironmentSchema.safeParse({
        ...spec.environment,
        type,
      });
      expect(result.success, type).toBe(true);
    }
    const rejected = EnvironmentSchema.safeParse({
      ...spec.environment,
      type: "arctic",
    });
    expect(rejected.success).toBe(false);
  });
});

describe("environmentFamilyMatches", () => {
  it("pairs a scene with the preset that draws its family", () => {
    expect(environmentFamilyMatches("rural", "rural")).toBe(true);
    expect(environmentFamilyMatches("coastal", "coastal")).toBe(true);
    expect(environmentFamilyMatches("interior", "interior")).toBe(true);
  });

  it("rejects a preset from another family", () => {
    expect(environmentFamilyMatches("coastal", "rural")).toBe(false);
    expect(environmentFamilyMatches("interior", "rural")).toBe(false);
  });

  it("lets the scene opt out with custom", () => {
    // custom names no family, so it pairs with every preset: the cross
    // pairing a scene states on purpose, for example a rural scene under
    // a round 2 preset.
    for (const family of ENVIRONMENT_TYPE_NAMES) {
      if (family === "custom") {
        continue;
      }
      expect(environmentFamilyMatches("custom", family)).toBe(true);
    }
  });

  it("lets a preset that declares no family draw every environment", () => {
    // A preset built by hand, for example a test fixture, states no family.
    for (const type of ENVIRONMENT_TYPE_NAMES) {
      expect(environmentFamilyMatches(type, undefined)).toBe(true);
    }
    // A preset that declares custom states no family either.
    expect(environmentFamilyMatches("rural", "custom")).toBe(true);
  });
});

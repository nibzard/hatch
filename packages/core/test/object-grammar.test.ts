/**
 * Tests for the object grammar model (task T043).
 *
 * `objectGrammar` is a required section every shipped preset defines, so
 * the compiler must read it: a section that only enters the spec hash
 * moves the seeded streams while the picture stays the same. These tests
 * pin the numbers the section moves - the detail budget of the geometry
 * stage, the corner share, and the kept negative space - so a field that
 * goes inert fails on an exact value, not on byte noise.
 */

import { describe, expect, it } from "vitest";

import {
  EDGE_ROUNDNESS_SHARE_GAIN,
  applySceneStyle,
  detailBudgetOf,
  edgeRoundnessShare,
  HatchEngine,
  objectGrammarDecisionOf,
  objectGrammarDetailOf,
  planScene,
  synthesizeSceneGeometry,
  StyleSpecSchema,
  type Geometry,
  type ObjectGeometry,
  type ObjectGrammar,
  type ObjectGeometryRequest,
  type ResolvedStyleSpec,
  type SeededRng,
  type StyleSpec,
} from "../src/index.js";
import { createRng } from "../src/rng.js";
import { trianglePath, validSceneSpec, validStyleSpec } from "./fixtures.js";

/** The resolved style the planner reads, over the fixture preset. */
function resolvedStyle(overrides: Partial<StyleSpec> = {}): ResolvedStyleSpec {
  return { ...validStyleSpec(), ...overrides, preset: "test-pastoral" } as const;
}

/** One planning stream, reproducible by label. */
function planRng(label: string): SeededRng {
  return createRng(`hatch-object-grammar-test:${label}`);
}

/** The object grammar of a style, with one field replaced. */
function grammarWith(
  field: keyof ObjectGrammar,
  value: ObjectGrammar[keyof ObjectGrammar],
): ObjectGrammar {
  return { ...validStyleSpec().objectGrammar, [field]: value };
}

/** The hatch family of every role the fixture scene and stub use. */
const ZONE_FAMILIES = {
  sky: "sky",
  ground: "field",
  foliage: "foliage",
} as const;

/** The one-object geometry the style stage draws in these tests. */
function stubGeometry(): ObjectGeometry {
  const anchor = { x: 100, y: 100 };
  const geometry: Geometry = {
    silhouette: {
      commands: [
        { command: "move", to: anchor },
        { command: "line", to: { x: anchor.x + 40, y: anchor.y } },
        { command: "line", to: { x: anchor.x + 40, y: anchor.y - 40 } },
        { command: "line", to: { x: anchor.x, y: anchor.y - 40 } },
        { command: "close" },
      ],
    },
    contours: [],
    internalBoundaries: [],
    styleZones: [{ role: "foliage", path: { commands: [{ command: "move", to: anchor }] } }],
  };
  const spec = validSceneSpec();
  return {
    placement: {
      object: spec.objects[0]!,
      anchor,
      depth: 1,
      depthIndex: 0,
      positionClamped: false,
      focal: true,
      camera: { scale: 1, rotation: 0 },
    },
    geometry,
  };
}

describe("detailBudgetOf", () => {
  it("keeps the whole ceiling at abstraction 0", () => {
    expect(detailBudgetOf(grammarWith("abstractionLevel", 0))).toBe(
      validStyleSpec().objectGrammar.maxDetailPerObject,
    );
  });

  it("keeps no boundary at abstraction 1", () => {
    expect(detailBudgetOf(grammarWith("abstractionLevel", 1))).toBe(0);
  });

  it("rounds to the nearest mark between the ends", () => {
    // The fixture ceiling is 12 at abstraction 0.6: 4.8 marks survive.
    expect(detailBudgetOf(validStyleSpec().objectGrammar)).toBe(5);
    expect(detailBudgetOf(grammarWith("abstractionLevel", 0.55))).toBe(5);
    expect(detailBudgetOf(grammarWith("abstractionLevel", 0.7))).toBe(4);
  });

  it("never allows a mark beyond the ceiling", () => {
    // A level below 0 cannot buy detail the ceiling forbids.
    expect(detailBudgetOf({ ...grammarWith("abstractionLevel", -1) })).toBe(
      validStyleSpec().objectGrammar.maxDetailPerObject,
    );
    expect(detailBudgetOf(grammarWith("maxDetailPerObject", 0))).toBe(0);
  });
});

describe("edgeRoundnessShare", () => {
  it("leaves every corner sharp at bias 0", () => {
    expect(edgeRoundnessShare(0)).toBe(0);
  });

  it("cuts to the midpoint of the shorter segment at bias 1", () => {
    expect(edgeRoundnessShare(1)).toBe(EDGE_ROUNDNESS_SHARE_GAIN);
    expect(EDGE_ROUNDNESS_SHARE_GAIN).toBe(0.5);
  });

  it("moves half as far as the bias between the ends", () => {
    expect(edgeRoundnessShare(0.55)).toBe(0.275);
    expect(edgeRoundnessShare(0.25)).toBe(0.125);
  });
});

describe("objectGrammarDecisionOf", () => {
  it("reads the four fields of the style and their budget", () => {
    const style = resolvedStyle();
    expect(objectGrammarDecisionOf(style)).toEqual({
      abstractionLevel: style.objectGrammar.abstractionLevel,
      maxDetailPerObject: style.objectGrammar.maxDetailPerObject,
      edgeRoundnessBias: style.objectGrammar.edgeRoundnessBias,
      keepNegativeSpace: style.objectGrammar.keepNegativeSpace,
      detailBudget: detailBudgetOf(style.objectGrammar),
    });
  });
});

describe("the planning stage carries the decision", () => {
  it("plans the object grammar of the style into the plan", () => {
    const spec = validSceneSpec();
    const style = resolvedStyle();
    const plan = planScene(spec, style, planRng("scene"));
    expect(plan.objectGrammar).toEqual(objectGrammarDecisionOf(style));
  });

  it("records the decision in the planning trace event", () => {
    const spec = validSceneSpec();
    const style = resolvedStyle();
    const engine = new HatchEngine({
      styles: [{ id: spec.meta.stylePreset, style: validStyleSpec() }],
      objects: { generateObject: () => stubGeometry().geometry },
      renderer: {
        render: (ir) => ({
          svg: `<svg data-regions="${ir.regions.length}"></svg>`,
          strokeCount: ir.regions.length,
          strokeLength: 0,
        }),
      },
      zoneFamilies: ZONE_FAMILIES,
    });
    const planning = engine.renderScene(spec).trace.events.find(
      (event) => event.stage === "planning",
    );
    const data = planning?.data as Record<string, unknown> | undefined;
    expect(data?.objectGrammar).toEqual(objectGrammarDecisionOf(style));
  });
});

describe("the geometry synthesis stage hands the grammar to the source", () => {
  it("passes the grammar decision of the plan in every request", () => {
    const spec = validSceneSpec();
    const style = resolvedStyle();
    const plan = planScene(spec, style, planRng("geometry"));
    const requests: ObjectGeometryRequest[] = [];
    const geometry = synthesizeSceneGeometry(
      plan,
      {
        generateObject: (request) => {
          requests.push(request);
          return stubGeometry().geometry;
        },
      },
      planRng("geometry-stream"),
    );
    expect(requests.map((request) => request.objectGrammar)).toEqual([
      plan.objectGrammar,
    ]);
    expect(geometry.objects).toHaveLength(1);
  });
});

describe("the style application stage reads the kept negative space", () => {
  it("keeps the cloud cutouts while the grammar keeps negative space", () => {
    const spec = validSceneSpec();
    const style = resolvedStyle();
    const plan = planScene(spec, style, planRng("keep"));
    const styled = applySceneStyle(
      plan,
      { objects: [stubGeometry()] },
      style,
      ZONE_FAMILIES,
      {},
      planRng("keep-style"),
    );
    expect(plan.masks.length).toBeGreaterThan(0);
    expect(styled.masks).toHaveLength(plan.masks.length);
  });

  it("drops the cloud cutouts when the grammar fills its paper", () => {
    const spec = validSceneSpec();
    const style = resolvedStyle({
      objectGrammar: grammarWith("keepNegativeSpace", false),
    });
    const plan = planScene(spec, style, planRng("drop"));
    const styled = applySceneStyle(
      plan,
      { objects: [stubGeometry()] },
      style,
      ZONE_FAMILIES,
      {},
      planRng("drop-style"),
    );
    expect(plan.masks.length).toBeGreaterThan(0);
    expect(styled.masks).toEqual([]);
  });
});

describe("the geometry trace records what the grammar omitted", () => {
  /** The budget of the fixture style: a ceiling of 12 at abstraction 0.6. */
  const BUDGET = 5;

  /** One placed geometry of `kept` internal boundaries, with its report. */
  function reportedGeometry(kept: number, emitted: number): Geometry & {
    grammarDetail: ReturnType<typeof objectGrammarDetailOf>;
  } {
    const stub = stubGeometry().geometry;
    return {
      ...stub,
      internalBoundaries: Array.from(
        { length: kept },
        () => trianglePath(),
      ),
      grammarDetail: objectGrammarDetailOf(emitted, kept, BUDGET),
    };
  }

  it("keeps the report of the source beside the geometry, not inside it", () => {
    const spec = validSceneSpec();
    const style = resolvedStyle();
    const plan = planScene(spec, style, planRng("keep-report"));
    const geometry = synthesizeSceneGeometry(
      plan,
      {
        generateObject: () => reportedGeometry(BUDGET, BUDGET + 3),
      },
      planRng("keep-report-stream"),
    );
    const [entry] = geometry.objects;
    expect(entry?.grammarDetail).toEqual({
      detailBudget: BUDGET,
      emittedInternalBoundaries: BUDGET + 3,
      keptInternalBoundaries: BUDGET,
      droppedInternalBoundaries: 3,
    });
    // The geometry itself stays the four fields every consumer reads.
    expect("grammarDetail" in (entry?.geometry ?? {})).toBe(false);
  });

  it("states the emitted, kept, and dropped counts per object", () => {
    const spec = validSceneSpec();
    const engine = new HatchEngine({
      styles: [{ id: spec.meta.stylePreset, style: validStyleSpec() }],
      objects: { generateObject: () => reportedGeometry(BUDGET, BUDGET + 2) },
      renderer: {
        render: (ir) => ({
          svg: `<svg data-regions="${ir.regions.length}"></svg>`,
          strokeCount: ir.regions.length,
          strokeLength: 0,
        }),
      },
      zoneFamilies: ZONE_FAMILIES,
    });
    const geometryEvent = engine.renderScene(spec).trace.events.find(
      (event) => event.stage === "geometry",
    );
    const data = geometryEvent?.data as Record<string, unknown> | undefined;
    expect(data?.omittedInternalBoundaries).toBe(2);
    expect(data?.objects).toEqual([
      {
        id: spec.objects[0]!.id,
        kind: spec.objects[0]!.kind,
        depthIndex: 0,
        contours: 0,
        internalBoundaries: BUDGET,
        emittedInternalBoundaries: BUDGET + 2,
        keptInternalBoundaries: BUDGET,
        droppedInternalBoundaries: 2,
        detailBudget: BUDGET,
        styleZones: 1,
      },
    ]);
    expect(geometryEvent?.message).toContain(
      "2 internal boundary(ies) dropped by the object grammar",
    );
  });

  it("leaves the record plain when the source counts no omission", () => {
    const spec = validSceneSpec();
    const engine = new HatchEngine({
      styles: [{ id: spec.meta.stylePreset, style: validStyleSpec() }],
      objects: { generateObject: () => stubGeometry().geometry },
      renderer: {
        render: (ir) => ({
          svg: `<svg data-regions="${ir.regions.length}"></svg>`,
          strokeCount: ir.regions.length,
          strokeLength: 0,
        }),
      },
      zoneFamilies: ZONE_FAMILIES,
    });
    const geometryEvent = engine.renderScene(spec).trace.events.find(
      (event) => event.stage === "geometry",
    );
    const data = geometryEvent?.data as
      | {
          omittedInternalBoundaries?: number;
          objects?: Array<Record<string, unknown>>;
        }
      | undefined;
    expect(data?.omittedInternalBoundaries).toBe(0);
    expect(
      data?.objects?.every(
        (entry) =>
          !("emittedInternalBoundaries" in entry) &&
          !("droppedInternalBoundaries" in entry),
      ),
    ).toBe(true);
    expect(geometryEvent?.message).not.toContain("dropped");
  });
});

describe("the style schema bounds the grammar fields it interprets", () => {
  it("accepts the whole stated range", () => {
    for (const value of [0, 0.5, 1]) {
      const style = validStyleSpec();
      style.objectGrammar.abstractionLevel = value;
      style.objectGrammar.edgeRoundnessBias = value;
      expect(
        StyleSpecSchema.safeParse(style).success,
        `abstractionLevel and edgeRoundnessBias ${value}`,
      ).toBe(true);
    }
  });

  it("rejects a level or a bias outside 0 to 1", () => {
    for (const value of [-0.1, 1.01]) {
      const level = validStyleSpec();
      level.objectGrammar.abstractionLevel = value;
      expect(StyleSpecSchema.safeParse(level).success).toBe(false);
      const bias = validStyleSpec();
      bias.objectGrammar.edgeRoundnessBias = value;
      expect(StyleSpecSchema.safeParse(bias).success).toBe(false);
    }
  });
});

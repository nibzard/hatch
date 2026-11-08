/**
 * Tests for the object grammar pass (task T043).
 *
 * The `objectGrammar` section of a style preset is a required part of the
 * StyleSpec, so the geometry synthesis stage must enforce it: a section
 * that changes only the spec hash moves the seeded streams while the
 * geometry stays the same. These tests pin the three effects the pass
 * owns - the detail budget over the internal boundaries, the corner
 * rounding over every polyline, and the kept negative space of the house
 * openings - on exact counts, not on byte noise.
 */

import { describe, expect, it } from "vitest";

import { createRng, type ObjectGrammar } from "@hatch/core";
import { booleanClip, pathArea, pointInPath } from "@hatch/geometry";

import { defaultFenceParameters, generateFence } from "../src/fence.js";
import { defaultHouseParameters, generateHouse } from "../src/house.js";
import { applyObjectGrammar } from "../src/grammar.js";
import { generateSceneObject } from "../src/scene-object.js";
import { objectStream } from "../src/scene-object.js";

/** One grammar with one field replaced. */
function grammarWith(
  field: keyof ObjectGrammar,
  value: ObjectGrammar[keyof ObjectGrammar],
): ObjectGrammar {
  return {
    abstractionLevel: 0,
    maxDetailPerObject: 100,
    edgeRoundnessBias: 0,
    keepNegativeSpace: true,
    [field]: value,
  };
}

/** One seeded stream, reproducible by label. */
function stream(label: string) {
  return createRng(`hatch-object-grammar-test:${label}`);
}

describe("applyObjectGrammar: the detail budget", () => {
  it("keeps every boundary under a permissive grammar", () => {
    const fence = generateFence(defaultFenceParameters);
    const governed = applyObjectGrammar(fence, grammarWith("abstractionLevel", 0));
    expect(governed).toBe(fence);
  });

  it("drops the boundaries beyond the budget, in emission order", () => {
    // The default fence carries more marks than a tight ceiling allows.
    const fence = generateFence(defaultFenceParameters);
    const budget = 3;
    const governed = applyObjectGrammar(
      fence,
      grammarWith("maxDetailPerObject", budget),
    );
    expect(governed.internalBoundaries).toHaveLength(budget);
    expect(governed.internalBoundaries).toEqual(
      fence.internalBoundaries.slice(0, budget),
    );
  });

  it("keeps no boundary at full abstraction", () => {
    const fence = generateFence(defaultFenceParameters);
    const governed = applyObjectGrammar(
      fence,
      grammarWith("abstractionLevel", 1),
    );
    expect(governed.internalBoundaries).toEqual([]);
  });

  it("scales the ceiling by the abstraction level", () => {
    // A ceiling of 10 at abstraction 0.6 leaves four marks.
    const governed = applyObjectGrammar(
      generateFence(defaultFenceParameters),
      { abstractionLevel: 0.6, maxDetailPerObject: 10, edgeRoundnessBias: 0, keepNegativeSpace: true },
    );
    expect(governed.internalBoundaries).toHaveLength(4);
  });
});

describe("applyObjectGrammar: the corner rounding", () => {
  it("curves the silhouette and the zones of a square object", () => {
    const house = generateHouse(defaultHouseParameters);
    const governed = applyObjectGrammar(
      house,
      grammarWith("edgeRoundnessBias", 0.5),
    );
    const curvesOf = (path: { commands: Array<{ command: string }> }) =>
      path.commands.filter((command) => command.command === "curve").length;
    expect(curvesOf(governed.silhouette)).toBeGreaterThan(
      curvesOf(house.silhouette),
    );
    for (const zone of governed.styleZones) {
      expect(curvesOf(zone.path)).toBeGreaterThan(0);
    }
  });

  it("keeps every contained zone inside the rounded silhouette", () => {
    const house = generateHouse(defaultHouseParameters);
    const governed = applyObjectGrammar(
      house,
      grammarWith("edgeRoundnessBias", 0.99),
    );
    for (const zone of governed.styleZones) {
      // The wall zone is the one the door shortens, so its own arc cuts
      // less than the arc of the silhouette; the pass must clip it back.
      // Containment holds when the zone loses nothing to the silhouette.
      const intersection = booleanClip(
        zone.path,
        governed.silhouette,
        "intersect",
      );
      const kept = intersection === null ? 0 : pathArea(intersection);
      expect(pathArea(zone.path) - kept).toBeLessThan(1e-3);
      expect(pointInPath(governed.silhouette, { x: 0, y: -1 })).toBe(true);
    }
  });
});

describe("the house keeps its openings as paper only while the grammar asks", () => {
  it("subtracts the openings from the wall zone by default", () => {
    const house = generateHouse(defaultHouseParameters, {
      rng: objectStream(stream("house-keep"), "house-1"),
    });
    const wall = house.styleZones.find(
      (zone) => zone.role === "architecture",
    );
    // The door and the windows are holes: the wall zone carries less area
    // than the plain wall rectangle.
    expect(wall).toBeDefined();
    expect(wall!.path.commands.length).toBeGreaterThan(5);
  });

  it("fills the wall across its openings when the grammar drops the paper", () => {
    const house = generateHouse(defaultHouseParameters, {
      rng: objectStream(stream("house-fill"), "house-1"),
      grammar: grammarWith("keepNegativeSpace", false),
    });
    const wall = house.styleZones.find(
      (zone) => zone.role === "architecture",
    );
    expect(wall).toBeDefined();
    // Without holes the wall zone is the plain rectangle: four corners.
    expect(wall!.path.commands).toHaveLength(5);
  });
});

describe("generateSceneObject reports what the grammar omitted", () => {
  const object = {
    id: "fence-1",
    kind: "fence",
    position: { x: 0.5, y: 0.8 },
    scale: 1,
  };
  const anchor = { x: 512, y: 600 };

  it("counts the marks the budget dropped, beside the kept geometry", () => {
    // The ungoverned fence states what the generator emitted; the governed
    // one states what survived the ceiling of three marks.
    const emitted = generateFence(defaultFenceParameters).internalBoundaries
      .length;
    expect(emitted).toBeGreaterThan(3);
    const governed = generateSceneObject({
      object,
      anchor,
      rng: stream("fence-report"),
      objectGrammar: grammarWith("maxDetailPerObject", 3),
    });
    expect(governed.internalBoundaries).toHaveLength(3);
    expect(governed.grammarDetail).toEqual({
      detailBudget: 3,
      emittedInternalBoundaries: emitted,
      keptInternalBoundaries: 3,
      droppedInternalBoundaries: emitted - 3,
    });
  });

  it("reports no omission when the budget covers every mark", () => {
    const governed = generateSceneObject({
      object,
      anchor,
      rng: stream("fence-open"),
      objectGrammar: grammarWith("abstractionLevel", 0),
    });
    expect(governed.grammarDetail?.droppedInternalBoundaries).toBe(0);
    expect(governed.grammarDetail?.keptInternalBoundaries).toBe(
      governed.internalBoundaries.length,
    );
  });

  it("counts every mark as dropped at full abstraction", () => {
    const governed = generateSceneObject({
      object,
      anchor,
      rng: stream("fence-abstract"),
      objectGrammar: grammarWith("abstractionLevel", 1),
    });
    expect(governed.internalBoundaries).toEqual([]);
    expect(governed.grammarDetail).toMatchObject({
      detailBudget: 0,
      keptInternalBoundaries: 0,
      droppedInternalBoundaries:
        governed.grammarDetail?.emittedInternalBoundaries,
    });
  });

  it("reports nothing when no grammar governs the object", () => {
    const plain = generateSceneObject({
      object,
      anchor,
      rng: stream("fence-plain"),
    });
    expect("grammarDetail" in plain).toBe(false);
  });
});

describe("generateSceneObject enforces the grammar of its request", () => {
  const object = {
    id: "fence-1",
    kind: "fence",
    position: { x: 0.5, y: 0.8 },
    scale: 1,
  };

  it("applies the grammar pass to the generated geometry", () => {
    const plain = generateSceneObject({
      object,
      anchor: { x: 512, y: 600 },
      rng: stream("fence"),
    });
    const governed = generateSceneObject({
      object,
      anchor: { x: 512, y: 600 },
      rng: stream("fence"),
      objectGrammar: grammarWith("maxDetailPerObject", 2),
    });
    expect(governed.internalBoundaries).toHaveLength(2);
    expect(plain.internalBoundaries.length).toBeGreaterThan(2);
  });

  it("hands the grammar to the generator options", () => {
    const house = {
      id: "house-1",
      kind: "house",
      position: { x: 0.5, y: 0.8 },
      scale: 1,
    };
    const filled = generateSceneObject({
      object: house,
      anchor: { x: 512, y: 600 },
      rng: stream("house"),
      objectGrammar: grammarWith("keepNegativeSpace", false),
    });
    const wall = filled.styleZones.find(
      (zone) => zone.role === "architecture",
    );
    expect(wall!.path.commands).toHaveLength(5);
  });

  it("stays deterministic under one grammar", () => {
    const first = generateSceneObject({
      object,
      anchor: { x: 512, y: 600 },
      rng: stream("fence"),
      objectGrammar: grammarWith("edgeRoundnessBias", 0.4),
    });
    const second = generateSceneObject({
      object,
      anchor: { x: 512, y: 600 },
      rng: stream("fence"),
      objectGrammar: grammarWith("edgeRoundnessBias", 0.4),
    });
    expect(first).toEqual(second);
  });
});

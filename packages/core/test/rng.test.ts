/**
 * Determinism tests for the seeded RNG (specification section 10).
 *
 * The contract: the identical version, seed, preset, and spec give the
 * identical random sequence. Every stream derives from one seed key, so a
 * draw in one stage or fork never shifts the numbers of another.
 */

import { describe, expect, it } from "vitest";

import {
  TRACE_STAGES,
  createSceneRng,
  createStageRng,
  sceneSeedKey,
} from "../src/index.js";
import type { SceneSeedParts, SeededRng } from "../src/index.js";

/** One render identity, shaped like the identity block of a trace. */
function seedParts(): SceneSeedParts {
  return {
    compilerVersion: "0.1.0",
    seed: 42,
    stylePreset: "pastoral-v1",
    specHash: "sha256:2fd4e1c67a2d28fc",
  };
}

/** Draw `count` values from one stream. */
function draw(rng: SeededRng, count: number): number[] {
  return Array.from({ length: count }, () => rng.next());
}

describe("createSceneRng", () => {
  it("derives one stable seed key from the render identity", () => {
    expect(sceneSeedKey(seedParts())).toBe(
      '["hatch-rng-v1","0.1.0",42,"pastoral-v1","sha256:2fd4e1c67a2d28fc"]',
    );
  });

  it("gives the identical sequence for the identical version, seed, preset, and spec", () => {
    const first = draw(createSceneRng(seedParts()), 64);
    const second = draw(createSceneRng(seedParts()), 64);
    expect(second).toEqual(first);
  });

  it("changes the sequence when any identity part changes", () => {
    const baseline = draw(createSceneRng(seedParts()), 64);
    const variants: [string, SceneSeedParts][] = [
      ["compilerVersion", { ...seedParts(), compilerVersion: "0.2.0" }],
      ["seed", { ...seedParts(), seed: 43 }],
      ["stylePreset", { ...seedParts(), stylePreset: "coastal-v1" }],
      ["specHash", { ...seedParts(), specHash: "sha256:9f86d081884c7d65" }],
    ];

    for (const [label, variant] of variants) {
      expect(draw(createSceneRng(variant), 64), `changed ${label}`).not.toEqual(
        baseline,
      );
    }
  });

  it("returns floats in the range [0, 1)", () => {
    const rng = createSceneRng(seedParts());
    for (let index = 0; index < 256; index += 1) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe("createStageRng", () => {
  it("gives every render stage its own deterministic stream", () => {
    for (const stage of TRACE_STAGES) {
      const first = draw(createStageRng(seedParts(), stage), 32);
      const second = draw(createStageRng(seedParts(), stage), 32);
      expect(second, `stage ${stage}`).toEqual(first);
      expect(createStageRng(seedParts(), stage).seedKey.endsWith(`#stage:${stage}`)).toBe(
        true,
      );
    }
  });

  it("gives different stages different sequences", () => {
    for (const one of TRACE_STAGES) {
      for (const other of TRACE_STAGES) {
        if (one === other) continue;
        expect(draw(createStageRng(seedParts(), other), 8)).not.toEqual(
          draw(createStageRng(seedParts(), one), 8),
        );
      }
    }
  });

  it("keeps a stage stream independent of draws in other stages", () => {
    const before = draw(createStageRng(seedParts(), "style"), 16);

    const geometry = createStageRng(seedParts(), "geometry");
    draw(geometry, 100);

    const after = draw(createStageRng(seedParts(), "style"), 16);
    expect(after).toEqual(before);
  });

  it("differs from the master stream of the same render", () => {
    const master = draw(createSceneRng(seedParts()), 16);
    for (const stage of TRACE_STAGES) {
      expect(draw(createStageRng(seedParts(), stage), 16)).not.toEqual(master);
    }
  });
});

describe("SeededRng helpers", () => {
  it("float stays inside the requested range", () => {
    const rng = createSceneRng(seedParts());
    for (let index = 0; index < 256; index += 1) {
      const value = rng.float(-2, 3);
      expect(value).toBeGreaterThanOrEqual(-2);
      expect(value).toBeLessThan(3);
    }
    expect(rng.float(1.5, 1.5)).toBe(1.5);
  });

  it("int covers every value of an inclusive range", () => {
    const rng = createSceneRng(seedParts());
    const seen = new Set<number>();
    for (let index = 0; index < 200; index += 1) {
      const value = rng.int(1, 5);
      expect(Number.isInteger(value)).toBe(true);
      seen.add(value);
    }
    expect(seen).toEqual(new Set([1, 2, 3, 4, 5]));
  });

  it("chance returns fixed outcomes at probability 0 and 1", () => {
    const rng = createSceneRng(seedParts());
    for (let index = 0; index < 32; index += 1) {
      expect(rng.chance(0)).toBe(false);
      expect(rng.chance(1)).toBe(true);
    }
  });

  it("pick chooses from the items and throws on an empty array", () => {
    const rng = createSceneRng(seedParts());
    const seen = new Set<string>();
    for (let index = 0; index < 300; index += 1) {
      seen.add(rng.pick(["a", "b", "c"]));
    }
    expect(seen).toEqual(new Set(["a", "b", "c"]));
    expect(() => rng.pick([])).toThrow(/at least one item/);
  });

  it("forks labeled streams that do not depend on other draws", () => {
    const parent = createSceneRng(seedParts());
    const early = draw(parent.fork("region:sky"), 16);

    draw(parent, 50);
    draw(parent.fork("region:field"), 50);

    expect(parent.fork("region:sky").seedKey).toBe(`${parent.seedKey}/fork:"region:sky"`);
    expect(draw(parent.fork("region:sky"), 16)).toEqual(early);
    expect(draw(parent.fork("region:field"), 16)).not.toEqual(early);
    expect(draw(parent, 16)).not.toEqual(early);
  });
});

describe("fork label escaping", () => {
  it("quotes the label inside the seed key", () => {
    const parent = createSceneRng(seedParts());
    expect(parent.fork("region:sky").seedKey).toBe(
      `${parent.seedKey}/fork:"region:sky"`,
    );
    expect(parent.fork("region\"sky").seedKey).toBe(
      `${parent.seedKey}/fork:"region\\"sky"`,
    );
  });

  it("keeps two fork chains with colliding text apart", () => {
    // Without the quotes, the family fork of the label "hill" and the fork
    // of the label "hill/fork:a" resolved to one and the same seed key, so
    // two regions drew from one stream.
    const parent = createSceneRng(seedParts());
    const familyStream = parent.fork("hill").fork("a");
    const regionStream = parent.fork("hill/fork:a");

    expect(familyStream.seedKey).not.toBe(regionStream.seedKey);
    expect(draw(regionStream, 16)).not.toEqual(draw(familyStream, 16));
  });

  it("gives every fork-shaped label its own stream", () => {
    const parent = createSceneRng(seedParts());
    const labels = [
      "hill",
      "hill/fork:a",
      'hill/fork:"a"',
      'hill"/fork:a',
      "hill\\fork:a",
      "hill/fork:",
    ];
    const keys = labels.map((label) => parent.fork(label).seedKey);
    expect(new Set(keys).size).toBe(labels.length);
    const streams = labels.map((label) => draw(parent.fork(label), 8));
    for (const [index, stream] of streams.entries()) {
      for (const other of streams.slice(0, index)) {
        expect(stream).not.toEqual(other);
      }
    }
  });

  it("keeps one nested chain stable", () => {
    const parent = createSceneRng(seedParts());
    const chain = draw(parent.fork("hill").fork("crest").fork("1"), 16);
    expect(draw(parent.fork("hill").fork("crest").fork("1"), 16)).toEqual(chain);
    // A chain that spells the same text as one label stays its own stream.
    expect(draw(parent.fork('hill/fork:"crest"'), 16)).not.toEqual(chain);
  });
});

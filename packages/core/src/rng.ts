/**
 * Deterministic seeded randomness (specification sections 2, 10, and 17).
 *
 * Specification section 10 drives every render with four inputs: version,
 * seed, style preset, and scene spec. When those are identical, the output
 * must be identical. This module is the single source of randomness behind
 * that contract. It wraps seedrandom (specification section 2) and derives
 * one stream per render stage, so a draw in one stage never shifts the
 * numbers of another stage.
 *
 * The humanization parameters of specification section 17 consume these
 * streams. Nothing in the render path may draw from the global random
 * source of JavaScript; the guard test in test/no-math-random.test.ts
 * blocks that call in every package source file.
 */

import seedrandom from "seedrandom";

import type { TraceStage } from "./trace.js";

/**
 * The four identity parts of one render (specification section 10). They
 * mirror the identity block of a RenderTrace: compiler version, preset,
 * seed, and spec hash.
 */
export interface SceneSeedParts {
  /** Compiler version, for example "0.1.0". */
  compilerVersion: string;
  /** The seed from meta.seed. */
  seed: number;
  /** The style preset name from meta.stylePreset. */
  stylePreset: string;
  /** Hash of the canonical scene spec, as recorded in the trace. */
  specHash: string;
}

/** One deterministic random stream. */
export interface SeededRng {
  /** The exact seed key this stream derives from. */
  readonly seedKey: string;
  /** One uniform float in the range [0, 1). */
  next(): number;
  /** One uniform float in the range [min, max). Needs min <= max. */
  float(min: number, max: number): number;
  /** One uniform integer in the range [min, maxInclusive]. Needs min <= maxInclusive. */
  int(min: number, maxInclusive: number): number;
  /** True with the given probability in the range [0, 1]. Drives dropout. */
  chance(probability: number): boolean;
  /** One uniformly chosen item. Throws when the array is empty. */
  pick<T>(items: readonly T[]): T;
  /**
   * One independent stream for a named sub-context, for example one region
   * or one object. The same label under the same parent key gives the same
   * stream, whatever other streams draw in the meantime. The label is
   * quoted inside the seed key, so any label text is safe: two fork chains
   * whose plain labels collide stay two streams.
   */
  fork(label: string): SeededRng;
}

/** Names the key format. Bump it to start a new family of streams. */
const SEED_KEY_PREFIX = "hatch-rng-v1";

/** The separator between one seed key and the label of one fork. */
const FORK_KEY_SEPARATOR = "/fork:";

/**
 * Build the seed key of one forked stream.
 *
 * The label is quoted as one JSON string, so the composition stays
 * injective: a quote inside the label is escaped, the key format never
 * appears inside the quoted part, and two fork chains whose plain labels
 * collide stay two streams. Without the quotes, the family fork of the
 * label "hill" and the fork of the label "hill/fork:a" would resolve to
 * one and the same key.
 */
function forkSeedKey(seedKey: string, label: string): string {
  return `${seedKey}${FORK_KEY_SEPARATOR}${JSON.stringify(label)}`;
}

/**
 * Build the canonical seed key of one render. The key is one JSON array, so
 * field values never blur into each other and every parts object maps to
 * exactly one string.
 */
export function sceneSeedKey(parts: SceneSeedParts): string {
  return JSON.stringify([
    SEED_KEY_PREFIX,
    parts.compilerVersion,
    parts.seed,
    parts.stylePreset,
    parts.specHash,
  ]);
}

/** Create one stream from an explicit seed key. */
export function createRng(seedKey: string): SeededRng {
  const prng = seedrandom(seedKey);
  return {
    seedKey,
    next: () => prng(),
    float: (min, max) => min + prng() * (max - min),
    int: (min, maxInclusive) =>
      min + Math.floor(prng() * (maxInclusive - min + 1)),
    chance: (probability) => prng() < probability,
    pick: <T>(items: readonly T[]): T => {
      if (items.length === 0) {
        throw new Error("rng.pick needs at least one item to choose from");
      }
      const item = items[Math.floor(prng() * items.length)];
      if (item === undefined) {
        throw new Error("rng.pick drew outside its input array");
      }
      return item;
    },
    fork: (label) => createRng(forkSeedKey(seedKey, label)),
  };
}

/**
 * The master stream of one render. Two calls with identical parts return
 * streams that emit the identical sequence (specification section 10).
 */
export function createSceneRng(parts: SceneSeedParts): SeededRng {
  return createRng(sceneSeedKey(parts));
}

/**
 * One stream for one render stage, for example "geometry" or "style". Every
 * stage derives its own stream from the render identity, so stages can run
 * or replay in any order and still draw the same numbers.
 */
export function createStageRng(
  parts: SceneSeedParts,
  stage: TraceStage,
): SeededRng {
  return createRng(`${sceneSeedKey(parts)}#stage:${stage}`);
}

/**
 * Shared helpers for the seeded parameter sweep (tasks T015 and T020
 * acceptance).
 *
 * The acceptance asks every generator for non-empty geometry across a
 * seeded parameter sweep, with tests on the structure and the bounds. The
 * sweep samples each parameter inside the range its generator states, so
 * the samples always parse and the sweep covers the whole knob range.
 */

import { describe, expect, it } from "vitest";

import {
  createRng,
  type Geometry,
  type JsonObject,
  type Path,
  type SeededRng,
} from "@hatch/core";
import { pathBounds } from "@hatch/geometry";

import type { ObjectGenerator } from "../src/generator.js";
import type { ParameterSpace } from "../src/parameters.js";
import { STYLE_ZONE_ROLES } from "../src/roles.js";

/** Slack for envelope comparisons: splines overshoot their anchors a little. */
export const TOLERANCE = 1e-6;

/** The extent an envelope check needs: the four edges of a box. */
export interface Envelope {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/** One seeded stream for a test, labelled by what it drives. */
export function testRng(label: string): SeededRng {
  return createRng(`hatch-objects-test:${label}`);
}

/** Round a sample so a reported parameter value stays readable. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Sample one parameter set from a space: one draw per field, in field
 * order. Numbers span their whole range, counts span their whole range,
 * and booleans flip by chance.
 */
export function sampleParameters(
  space: ParameterSpace,
  rng: SeededRng,
): JsonObject {
  const sample: JsonObject = {};
  for (const [name, field] of Object.entries(space)) {
    if (field.kind === "boolean") {
      sample[name] = rng.chance(0.5);
    } else if (field.kind === "integer") {
      sample[name] = rng.int(field.min, field.max);
    } else {
      sample[name] = round(rng.float(field.min, field.max));
    }
  }
  return sample;
}

/** One sample of the sweep: what went in and what came out. */
export interface SweepSample {
  readonly index: number;
  readonly parameters: JsonObject;
  readonly geometry: Geometry;
}

/**
 * Run one generator across `samples` seeded parameter sets.
 *
 * The sample stream and the generator stream fork from one labelled
 * stream, so re-running with the same label replays the identical sweep.
 */
export function sweepGenerator(
  generator: ObjectGenerator,
  seed: string,
  samples: number,
): SweepSample[] {
  const rng = testRng(`sweep:${generator.kind}:${seed}`);
  const results: SweepSample[] = [];
  for (let index = 0; index < samples; index += 1) {
    const parameters = sampleParameters(generator.parameterSpace, rng);
    const geometry = generator.generate(parameters, {
      rng: rng.fork(`sample:${index}`),
    });
    results.push({ index, parameters, geometry });
  }
  return results;
}

/** One path of a geometry with a name for failure messages. */
export interface NamedPath {
  readonly what: string;
  readonly path: Path;
}

/** Every path of one geometry, in draw order, each with its role. */
export function geometryPaths(geometry: Geometry): NamedPath[] {
  const paths: NamedPath[] = [
    { what: "silhouette", path: geometry.silhouette },
  ];
  geometry.contours.forEach((path, index) => {
    paths.push({ what: `contour ${index}`, path });
  });
  geometry.internalBoundaries.forEach((path, index) => {
    paths.push({ what: `internal boundary ${index}`, path });
  });
  geometry.styleZones.forEach((zone, index) => {
    paths.push({ what: `style zone ${index} (${zone.role})`, path: zone.path });
  });
  return paths;
}

/**
 * Assert the structure of one geometry: every field non-empty, every path
 * well-formed, and every style zone role one the style stage knows.
 */
export function expectCompleteGeometry(kind: string, geometry: Geometry): void {
  expect(geometry.silhouette.commands.length, `${kind}: silhouette`).toBeGreaterThan(0);
  expect(geometry.contours.length, `${kind}: contours`).toBeGreaterThan(0);
  geometry.contours.forEach((contour, index) => {
    expect(contour.commands.length, `${kind}: contour ${index}`).toBeGreaterThan(0);
  });
  expect(geometry.internalBoundaries.length, `${kind}: internal boundaries`).toBeGreaterThan(0);
  geometry.internalBoundaries.forEach((boundary, index) => {
    expect(boundary.commands.length, `${kind}: boundary ${index}`).toBeGreaterThan(0);
  });
  expect(geometry.styleZones.length, `${kind}: style zones`).toBeGreaterThan(0);
  for (const zone of geometry.styleZones) {
    expect(zone.path.commands.length, `${kind}: zone ${zone.role}`).toBeGreaterThan(0);
    expect(
      STYLE_ZONE_ROLES.some((entry) => entry.role === zone.role),
      `${kind}: zone role "${zone.role}" is not in the role vocabulary`,
    ).toBe(true);
  }
}

/** What one generator promises about its own determinism. */
export interface ObjectContractOptions<Parameters extends JsonObject> {
  /**
   * The envelope the parameters promise, in the local frame of the object.
   * One call per sweep sample, so the bound follows the sample. The
   * parameter type is the typed shape the generator parses.
   */
  readonly envelopeOf: (parameters: Parameters) => Envelope;
  /** How many seeded samples the sweep runs. Default 32. */
  readonly samples?: number;
  /**
   * True when the generator draws no random number, so its seed cannot
   * change it. The contract adds a seed-invariance test for these.
   */
  readonly seedInvariant?: boolean;
}

/**
 * Register the generator contract tests every object shares (task T015
 * acceptance, extended by T020 to every new kind).
 *
 * Call this inside a `describe` block. It covers the default geometry, the
 * seeded sweep with the structure and bounds checks, and the replay of the
 * identical sweep, plus the seed-invariance test for the generators that
 * draw no random number.
 */
export function describeObjectContract<Parameters extends JsonObject>(
  generator: ObjectGenerator,
  options: ObjectContractOptions<Parameters>,
): void {
  const samples = options.samples ?? 32;
  // The samples come from the parameter space of the generator itself, so
  // every field the envelope reads is present; the cast only hands the
  // JSON-shaped sample to the typed envelope.
  const envelopeOf = (parameters: JsonObject): Envelope =>
    options.envelopeOf(parameters as Parameters);

  describe(`the ${generator.kind} generator contract`, () => {
    it("builds a complete geometry from the default parameters", () => {
      const geometry = generator.generate(generator.defaultParameters, {
        rng: testRng(`contract:${generator.kind}:defaults`),
      });
      expectCompleteGeometry(generator.kind, geometry);
      expectWithinEnvelope(
        generator.kind,
        geometry,
        envelopeOf(generator.defaultParameters),
      );
    });

    it("returns non-empty geometry inside its bounds across seeded samples", () => {
      const runs = sweepGenerator(generator, "bounds", samples);
      expect(runs).toHaveLength(samples);
      for (const { parameters, geometry } of runs) {
        expectCompleteGeometry(generator.kind, geometry);
        expectWithinEnvelope(
          generator.kind,
          geometry,
          envelopeOf(parameters),
        );
      }
    });

    it("replays the identical sweep under the same label", () => {
      const first = sweepGenerator(generator, "replay", 8);
      const second = sweepGenerator(generator, "replay", 8);
      expect(second.map((sample) => geometryJson(sample.geometry))).toEqual(
        first.map((sample) => geometryJson(sample.geometry)),
      );
    });

    if (options.seedInvariant) {
      it("draws no random number, so the seed cannot change it", () => {
        const first = generator.generate(generator.defaultParameters, {
          rng: testRng(`contract:${generator.kind}:a`),
        });
        const second = generator.generate(generator.defaultParameters, {
          rng: testRng(`contract:${generator.kind}:b`),
        });
        expect(geometryJson(second)).toBe(geometryJson(first));
      });
    }
  });
}

/** Assert every path of one geometry stays inside an envelope. */
export function expectWithinEnvelope(
  kind: string,
  geometry: Geometry,
  envelope: Envelope,
): void {
  for (const { what, path } of geometryPaths(geometry)) {
    const bounds = pathBounds(path);
    expect(bounds.minX, `${kind}: ${what} left edge`).toBeGreaterThanOrEqual(
      envelope.minX - TOLERANCE,
    );
    expect(bounds.maxX, `${kind}: ${what} right edge`).toBeLessThanOrEqual(
      envelope.maxX + TOLERANCE,
    );
    expect(bounds.minY, `${kind}: ${what} top edge`).toBeGreaterThanOrEqual(
      envelope.minY - TOLERANCE,
    );
    expect(bounds.maxY, `${kind}: ${what} bottom edge`).toBeLessThanOrEqual(
      envelope.maxY + TOLERANCE,
    );
  }
}

/** A stable JSON form of a geometry, for byte-level determinism checks. */
export function geometryJson(geometry: Geometry): string {
  return JSON.stringify(geometry);
}

/** Read one numeric field of a sweep sample, failing loudly on a wrong type. */
export function numberParameter(parameters: JsonObject, name: string): number {
  const value = parameters[name];
  if (typeof value !== "number") {
    throw new Error(`the sweep sample field "${name}" is not a number`);
  }
  return value;
}

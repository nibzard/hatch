/**
 * Tests for the bench generator: the contract of task T015, the seat, the
 * backrest, and the two material zones.
 */

import { describe, expect, it } from "vitest";

import { pathBounds } from "@hatch/geometry";

import { clamp } from "../src/shapes.js";
import {
  benchGenerator,
  defaultBenchParameters,
  generateBench,
} from "../src/bench.js";

import {
  describeObjectContract,
  type Envelope,
} from "./sweep.js";

/** The envelope the bench parameters promise. */
function benchEnvelope(parameters: {
  width: number;
  seatHeight: number;
  backHeight: number;
}): Envelope {
  const thickness = clamp(parameters.width * 0.05, 6, 16);
  return {
    minX: -parameters.width / 2,
    minY: -(parameters.seatHeight + parameters.backHeight + thickness),
    maxX: parameters.width / 2 + parameters.backHeight * 0.18 + thickness,
    maxY: 0,
  };
}

describeObjectContract(benchGenerator, {
  envelopeOf: benchEnvelope,
  seedInvariant: true,
});

describe("generateBench", () => {
  it("lifts the seat to its height above the ground", () => {
    const geometry = generateBench(defaultBenchParameters);
    const bounds = pathBounds(geometry.silhouette);
    expect(bounds.maxY).toBeCloseTo(0, 6);
    // The backrest rises past the seat height.
    expect(bounds.minY).toBeLessThan(-defaultBenchParameters.seatHeight * 1.4);
  });

  it("splits its zones between wood and metal legs", () => {
    const geometry = generateBench(defaultBenchParameters);
    expect(geometry.styleZones.map((zone) => zone.role)).toEqual([
      "architecture",
      "metal",
    ]);
  });

  it("drops the backrest on request and keeps the slat lines", () => {
    const geometry = generateBench({
      ...defaultBenchParameters,
      backHeight: 0,
    });
    expect(geometry.styleZones.map((zone) => zone.role)).toEqual([
      "architecture",
      "metal",
    ]);
    // One slat line per slat plus one outline per leg.
    expect(geometry.internalBoundaries.length).toBe(
      defaultBenchParameters.slats + defaultBenchParameters.legs,
    );
    expect(pathBounds(geometry.silhouette).minY).toBeGreaterThan(
      -defaultBenchParameters.seatHeight * 1.5,
    );
  });

  it("keeps its geometry identical under any seed", () => {
    const first = generateBench(defaultBenchParameters);
    const second = generateBench(defaultBenchParameters);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});

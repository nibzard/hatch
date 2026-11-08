/**
 * Tests for the car generator: the contract of task T015, the body, the
 * glazed cabin, and the wheels.
 */

import { describe, expect, it } from "vitest";

import { pathBounds } from "@hatch/geometry";

import {
  carGenerator,
  defaultCarParameters,
  generateCar,
} from "../src/car.js";

import {
  describeObjectContract,
  type Envelope,
} from "./sweep.js";

/** The envelope the car parameters promise. */
function carEnvelope(parameters: {
  length: number;
  bodyHeight: number;
  cabin: number;
  wheelRadius: number;
}): Envelope {
  return {
    minX: -parameters.length / 2,
    minY: -(parameters.wheelRadius * 1.3 + parameters.bodyHeight * (1 + parameters.cabin)),
    maxX: parameters.length / 2,
    maxY: 0,
  };
}

describeObjectContract(carGenerator, {
  envelopeOf: carEnvelope,
  seedInvariant: true,
});

describe("generateCar", () => {
  it("rests its wheels on the ground line inside its length", () => {
    const geometry = generateCar(defaultCarParameters);
    const bounds = pathBounds(geometry.silhouette);
    expect(bounds.maxY).toBeCloseTo(0, 6);
    expect(bounds.minX).toBeCloseTo(-defaultCarParameters.length / 2, 6);
    expect(bounds.maxX).toBeCloseTo(defaultCarParameters.length / 2, 6);
  });

  it("splits its zones between body, glass, and wheels", () => {
    const geometry = generateCar(defaultCarParameters);
    expect(geometry.styleZones.map((zone) => zone.role)).toEqual([
      "architecture",
      "glass",
      "metal",
    ]);
  });

  it("drops the cabin and the glazing on a delivery profile", () => {
    const geometry = generateCar({
      ...defaultCarParameters,
      cabin: 0,
      windows: 0,
    });
    expect(geometry.styleZones.map((zone) => zone.role)).toEqual([
      "architecture",
      "metal",
    ]);
    const cabinless = pathBounds(geometry.silhouette);
    expect(cabinless.minY).toBeGreaterThan(-defaultCarParameters.length);
  });

  it("keeps its wheels inside its own length", () => {
    const geometry = generateCar({
      ...defaultCarParameters,
      length: 90,
      wheelRadius: 50,
    });
    const bounds = pathBounds(geometry.silhouette);
    expect(bounds.minX).toBeCloseTo(-45, 5);
    expect(bounds.maxX).toBeCloseTo(45, 5);
    // The wheels were shrunk to fit, so the car still touches the ground.
    expect(bounds.maxY).toBeCloseTo(0, 6);
  });

  it("keeps its geometry identical under any seed", () => {
    const first = generateCar(defaultCarParameters);
    const second = generateCar(defaultCarParameters);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});

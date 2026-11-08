/**
 * Tests for the house generator: structure, bounds, cutouts, and the
 * seeded parameter sweep of the task acceptance.
 */

import { describe, expect, it } from "vitest";

import { pathBounds, pointInPath } from "@hatch/geometry";

import { spaceDefaults } from "../src/parameters.js";
import {
  defaultHouseParameters,
  generateHouse,
  houseGenerator,
  houseParameterSpace,
} from "../src/house.js";

import {
  type Envelope,
  expectCompleteGeometry,
  expectWithinEnvelope,
  geometryJson,
  numberParameter,
  sweepGenerator,
} from "./sweep.js";

/** The envelope the house parameters promise, in the local frame. */
function houseEnvelope(parameters: {
  width: number;
  wallHeight: number;
  roofPitch: number;
  overhang: number;
}): Envelope {
  const eave = parameters.width / 2 + parameters.width * parameters.overhang;
  return {
    minX: -eave,
    minY: -(parameters.wallHeight + (parameters.width / 2) * parameters.roofPitch),
    maxX: eave,
    maxY: 0,
  };
}

describe("generateHouse", () => {
  it("builds a complete geometry from the default parameters", () => {
    const geometry = generateHouse(defaultHouseParameters);
    expectCompleteGeometry("house", geometry);
    expectWithinEnvelope("house", geometry, houseEnvelope(defaultHouseParameters));
  });

  it("splits the mass into wall, roof, and chimney zones", () => {
    const geometry = generateHouse(defaultHouseParameters);
    const roles = geometry.styleZones.map((zone) => zone.role);
    expect(roles).toContain("roof");
    // The default chimney rises above the roof, so it carries its own
    // architecture zone besides the wall.
    expect(roles.filter((role) => role === "architecture")).toHaveLength(2);
  });

  it("places the peak at the exact pitch height", () => {
    const parameters = { ...defaultHouseParameters, width: 200, roofPitch: 1.2 };
    const geometry = generateHouse(parameters);
    const bounds = pathBounds(geometry.silhouette);
    expect(bounds.minY).toBeCloseTo(
      -(parameters.wallHeight + 100 * 1.2),
      6,
    );
    expect(bounds.maxY).toBeCloseTo(0, 6);
  });

  it("carves the door and the windows out of the wall zone", () => {
    const geometry = generateHouse(defaultHouseParameters);
    const wall = geometry.styleZones.find(
      (zone) => zone.role === "architecture" && zone.zIndex === 10,
    );
    expect(wall).toBeDefined();
    const wallPath = wall === undefined ? geometry.silhouette : wall.path;
    // The wall area stays filled beside the door...
    expect(pointInPath(wallPath, { x: -40, y: -30 })).toBe(true);
    // ...and the door leaf is paper, not wall.
    expect(pointInPath(wallPath, { x: 0, y: -10 })).toBe(false);
    // The boundary list holds the eaves line plus one frame per opening.
    expect(geometry.internalBoundaries.length).toBeGreaterThanOrEqual(3);
  });

  it("draws no random number, so the seed cannot change it", () => {
    const first = generateHouse(defaultHouseParameters);
    const second = generateHouse(defaultHouseParameters);
    expect(geometryJson(second)).toBe(geometryJson(first));
  });

  it("drops the chimney and the door on request", () => {
    const plain = generateHouse({
      ...defaultHouseParameters,
      chimney: false,
      door: false,
      windows: 0,
    });
    expect(plain.styleZones.map((zone) => zone.role)).toEqual([
      "architecture",
      "roof",
    ]);
    // The eaves line still separates the wall from the roof.
    expect(plain.internalBoundaries).toHaveLength(1);
  });

  it("rejects a parameter outside its range with a readable error", () => {
    expect(() => houseGenerator.parseParameters({ width: 10000 })).toThrowError(
      /invalid house parameters:.*width/,
    );
  });

  it("states a space whose defaults parse", () => {
    expect(houseGenerator.parseParameters(undefined)).toEqual(
      houseGenerator.defaultParameters,
    );
    expect(houseGenerator.defaultParameters).toEqual(
      spaceDefaults(houseParameterSpace),
    );
    expect(Object.keys(houseParameterSpace).sort()).toEqual(
      Object.keys(defaultHouseParameters).sort(),
    );
  });
});

describe("house parameter sweep", () => {
  it("returns non-empty geometry inside its bounds across seeded samples", () => {
    const samples = sweepGenerator(houseGenerator, "bounds", 32);
    expect(samples).toHaveLength(32);
    for (const { parameters, geometry } of samples) {
      expectCompleteGeometry("house", geometry);
      expectWithinEnvelope(
        "house",
        geometry,
        houseEnvelope({
          width: numberParameter(parameters, "width"),
          wallHeight: numberParameter(parameters, "wallHeight"),
          roofPitch: numberParameter(parameters, "roofPitch"),
          overhang: numberParameter(parameters, "overhang"),
        }),
      );
    }
  });

  it("replays the identical sweep under the same label", () => {
    const first = sweepGenerator(houseGenerator, "replay", 8);
    const second = sweepGenerator(houseGenerator, "replay", 8);
    expect(second.map((sample) => geometryJson(sample.geometry))).toEqual(
      first.map((sample) => geometryJson(sample.geometry)),
    );
  });
});

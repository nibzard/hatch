/**
 * Tests for the tram generator: the contract of task T015, the body, the
 * window band, the doors, and the wheels.
 */

import { describe, expect, it } from "vitest";

import { pathBounds, pointInPath } from "@hatch/geometry";

import {
  defaultTramParameters,
  generateTram,
  tramGenerator,
} from "../src/tram.js";

import {
  describeObjectContract,
  type Envelope,
} from "./sweep.js";

/** The envelope the tram parameters promise, pantograph included. */
function tramEnvelope(parameters: {
  length: number;
  floorHeight: number;
  bodyHeight: number;
}): Envelope {
  return {
    minX: -parameters.length / 2,
    minY: -(parameters.floorHeight + parameters.bodyHeight * 1.25),
    maxX: parameters.length / 2,
    maxY: 0,
  };
}

describeObjectContract(tramGenerator, {
  envelopeOf: tramEnvelope,
  seedInvariant: true,
});

describe("generateTram", () => {
  it("rests its wheels on the ground line inside its body length", () => {
    const geometry = generateTram(defaultTramParameters);
    const bounds = pathBounds(geometry.silhouette);
    expect(bounds.maxY).toBeCloseTo(0, 6);
    expect(bounds.minX).toBeCloseTo(-defaultTramParameters.length / 2, 6);
    expect(bounds.maxX).toBeCloseTo(defaultTramParameters.length / 2, 6);
  });

  it("splits its zones between body, glass, and wheels", () => {
    const geometry = generateTram(defaultTramParameters);
    expect(geometry.styleZones.map((zone) => zone.role)).toEqual([
      "architecture",
      "glass",
      "metal",
    ]);
    const glass = geometry.styleZones.find((zone) => zone.role === "glass");
    expect(glass).toBeDefined();
    if (glass !== undefined) {
      // The glass band sits above the floor line, inside the body.
      const bounds = pathBounds(glass.path);
      expect(bounds.maxY).toBeLessThan(-defaultTramParameters.floorHeight);
      expect(bounds.minY).toBeGreaterThan(
        -(defaultTramParameters.floorHeight + defaultTramParameters.bodyHeight),
      );
    }
  });

  it("fills the body with architecture ink across its whole length", () => {
    const geometry = generateTram(defaultTramParameters);
    const body = geometry.styleZones.find((zone) => zone.role === "architecture");
    expect(body).toBeDefined();
    if (body !== undefined) {
      const mid = -(defaultTramParameters.floorHeight +
        defaultTramParameters.bodyHeight * 0.2);
      expect(pointInPath(body.path, { x: 0, y: mid })).toBe(true);
      expect(pointInPath(body.path, { x: 0, y: -2 })).toBe(false);
    }
  });

  it("drops the pantograph on request", () => {
    const withArm = generateTram(defaultTramParameters);
    const withoutArm = generateTram({
      ...defaultTramParameters,
      pantograph: false,
    });
    expect(pathBounds(withoutArm.silhouette).minY).toBeCloseTo(
      -(defaultTramParameters.floorHeight + defaultTramParameters.bodyHeight),
      5,
    );
    expect(withArm.contours.length).toBe(withoutArm.contours.length + 2);
  });

  it("keeps its geometry identical under any seed", () => {
    const first = generateTram(defaultTramParameters);
    const second = generateTram(defaultTramParameters);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});

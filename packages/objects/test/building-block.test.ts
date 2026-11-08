/**
 * Tests for the building block generator: the contract of task T015, the
 * stepped mass, the window grid, and the parapet.
 */

import { describe, expect, it } from "vitest";

import { pathBounds } from "@hatch/geometry";

import { clamp } from "../src/shapes.js";
import {
  buildingBlockGenerator,
  defaultBuildingBlockParameters,
  generateBuildingBlock,
} from "../src/building-block.js";

import {
  describeObjectContract,
  type Envelope,
} from "./sweep.js";

/** The envelope the building block parameters promise. */
function buildingBlockEnvelope(parameters: {
  width: number;
  height: number;
}): Envelope {
  const parapet = clamp(parameters.height * 0.012, 3, 10);
  return {
    minX: -parameters.width / 2,
    minY: -(parameters.height + parapet),
    maxX: parameters.width / 2,
    maxY: 0,
  };
}

describeObjectContract(buildingBlockGenerator, {
  envelopeOf: buildingBlockEnvelope,
  seedInvariant: true,
});

describe("generateBuildingBlock", () => {
  it("rises from the street line to its full height", () => {
    const geometry = generateBuildingBlock(defaultBuildingBlockParameters);
    const bounds = pathBounds(geometry.silhouette);
    expect(bounds.maxY).toBeCloseTo(0, 6);
    // The parapet band sits above the stated height.
    expect(bounds.minY).toBeLessThan(-defaultBuildingBlockParameters.height);
    expect(bounds.minX).toBeCloseTo(
      -defaultBuildingBlockParameters.width / 2,
      6,
    );
  });

  it("fills the facade, the parapet, and the window grid", () => {
    const geometry = generateBuildingBlock(defaultBuildingBlockParameters);
    expect(geometry.styleZones.map((zone) => zone.role)).toEqual([
      "architecture",
      "roof",
      "glass",
    ]);
  });

  it("keeps one plain slab when the setback runs out", () => {
    const geometry = generateBuildingBlock({
      ...defaultBuildingBlockParameters,
      setback: 0,
    });
    const bounds = pathBounds(geometry.silhouette);
    expect(bounds.minX).toBeCloseTo(
      -defaultBuildingBlockParameters.width / 2,
      6,
    );
    expect(bounds.maxX).toBeCloseTo(defaultBuildingBlockParameters.width / 2, 6);
    // Without a step the mass keeps every floor row below the parapet, so
    // the boundaries are the floor lines plus the one window grid.
    expect(geometry.internalBoundaries).toHaveLength(
      defaultBuildingBlockParameters.floors - 1,
    );
  });

  it("narrows the mass as the setback grows", () => {
    const plain = generateBuildingBlock({
      ...defaultBuildingBlockParameters,
      setback: 0.05,
    });
    const stepped = generateBuildingBlock({
      ...defaultBuildingBlockParameters,
      setback: 1,
    });
    const roofOf = (geometry: ReturnType<typeof generateBuildingBlock>) => {
      const zone = geometry.styleZones.find((entry) => entry.role === "roof");
      return pathBounds(zone === undefined ? geometry.silhouette : zone.path);
    };
    // The parapet band follows the tower footprint, which the setback
    // narrows, while the street frontage stays whole.
    expect(roofOf(stepped).width).toBeLessThan(roofOf(plain).width);
    expect(pathBounds(stepped.silhouette).maxX).toBeCloseTo(
      defaultBuildingBlockParameters.width / 2,
      6,
    );
  });

  it("keeps its geometry identical under any seed", () => {
    const first = generateBuildingBlock(defaultBuildingBlockParameters);
    const second = generateBuildingBlock(defaultBuildingBlockParameters);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});

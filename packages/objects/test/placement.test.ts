/**
 * Tests for the local frame to scene placement: point mapping, geometry
 * mapping, and the readable errors.
 */

import { describe, expect, it } from "vitest";

import { pathBounds } from "@hatch/geometry";

import { defaultHouseParameters } from "../src/house.js";
import {
  placementOf,
  transformGeometry,
  transformPoint,
} from "../src/placement.js";
import { generateHouse } from "../src/house.js";

/** A square in the local frame, built by the house generator with the
 * default parameters. */
function localGeometry() {
  return generateHouse(defaultHouseParameters);
}

describe("transformPoint", () => {
  it("leaves the local frame alone at the default placement", () => {
    const point = { x: 12, y: -34 };
    expect(transformPoint({ position: { x: 0, y: 0 } }, point)).toEqual(point);
  });

  it("moves the local origin to the anchor", () => {
    expect(
      transformPoint({ position: { x: 512, y: 384 } }, { x: 10, y: -20 }),
    ).toEqual({ x: 522, y: 364 });
  });

  it("scales the local units around the anchor", () => {
    expect(
      transformPoint({ position: { x: 0, y: 0 }, scale: 2 }, { x: 10, y: -20 }),
    ).toEqual({ x: 20, y: -40 });
  });

  it("rotates counter-clockwise as the viewer sees it", () => {
    // A point to the right of the anchor moves above it under a quarter
    // turn on the y-down canvas.
    const turned = transformPoint(
      { position: { x: 0, y: 0 }, rotation: 90 },
      { x: 10, y: 0 },
    );
    expect(turned.x).toBeCloseTo(0, 6);
    expect(turned.y).toBeCloseTo(-10, 6);
  });

  it("rejects a scale the transform cannot apply", () => {
    expect(() =>
      transformPoint({ position: { x: 0, y: 0 }, scale: 0 }, { x: 1, y: 1 }),
    ).toThrowError(/placement scale must be a finite number greater than 0/);
    expect(() =>
      transformPoint({ position: { x: 0, y: 0 }, rotation: Number.NaN }, {
        x: 1,
        y: 1,
      }),
    ).toThrowError(/placement rotation must be a finite number of degrees/);
  });
});

describe("transformGeometry", () => {
  it("moves every path of the geometry with it", () => {
    const geometry = localGeometry();
    const anchor = { x: 512, y: 384 };
    const placed = transformGeometry(geometry, { position: anchor });
    const local = pathBounds(geometry.silhouette);
    const moved = pathBounds(placed.silhouette);
    expect(moved.minX - local.minX).toBeCloseTo(512, 6);
    expect(moved.maxY - local.maxY).toBeCloseTo(384, 6);
    // The shape keeps its size: a move does not scale.
    expect(moved.width).toBeCloseTo(local.width, 6);
    expect(moved.height).toBeCloseTo(local.height, 6);
    expect(placed.styleZones).toHaveLength(geometry.styleZones.length);
    expect(placed.internalBoundaries).toHaveLength(
      geometry.internalBoundaries.length,
    );
  });

  it("keeps the style zone zIndex and role through the transform", () => {
    const placed = transformGeometry(localGeometry(), {
      position: { x: 100, y: 100 },
      scale: 3,
    });
    const roles = placed.styleZones.map((zone) => `${zone.role}:${zone.zIndex}`);
    expect(roles).toContain("architecture:10");
    expect(roles).toContain("roof:12");
  });

  it("reads the placement of a scene object", () => {
    expect(
      placementOf(
        {
          id: "house-1",
          kind: "house",
          position: { x: 0.5, y: 0.6 },
          scale: 1.5,
          rotation: 12,
        },
        { x: 512, y: 460 },
      ),
    ).toEqual({ position: { x: 512, y: 460 }, scale: 1.5, rotation: 12 });
  });
});

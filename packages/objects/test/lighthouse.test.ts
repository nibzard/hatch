/**
 * Tests for the lighthouse generator: the contract of the registry, the
 * tower, the signal band, the gallery deck, and the lamp room.
 */

import { describe, expect, it } from "vitest";

import { pathArea, pathBounds } from "@hatch/geometry";

import {
  defaultLighthouseParameters,
  generateLighthouse,
  lighthouseGenerator,
  lighthouseMeasures,
  type LighthouseParameters,
} from "../src/lighthouse.js";

import {
  describeObjectContract,
  type Envelope,
} from "./sweep.js";

/** The envelope the lighthouse parameters promise. */
function lighthouseEnvelope(parameters: LighthouseParameters): Envelope {
  const measures = lighthouseMeasures(parameters);
  const half = Math.max(measures.plinthHalf, measures.galleryHalf);
  return { minX: -half, maxX: half, minY: measures.peakY, maxY: 0 };
}

describeObjectContract(lighthouseGenerator, {
  envelopeOf: lighthouseEnvelope,
  seedInvariant: true,
});

describe("generateLighthouse", () => {
  it("stands on the ground line and reaches its peak", () => {
    const geometry = generateLighthouse(defaultLighthouseParameters);
    const bounds = pathBounds(geometry.silhouette);
    const measures = lighthouseMeasures(defaultLighthouseParameters);
    expect(bounds.maxY).toBeCloseTo(0, 6);
    expect(bounds.minY).toBeCloseTo(measures.peakY, 6);
  });

  it("keeps the gallery deck wider than the tower top", () => {
    const measures = lighthouseMeasures(defaultLighthouseParameters);
    expect(measures.galleryHalf).toBeGreaterThan(measures.topHalf);
    // The plinth covers the foot of the tower, so it is the widest part of
    // the whole mass at the default taper.
    expect(measures.plinthHalf).toBeGreaterThan(measures.footHalf);
    const geometry = generateLighthouse(defaultLighthouseParameters);
    const bounds = pathBounds(geometry.silhouette);
    expect(bounds.maxX).toBeCloseTo(
      Math.max(measures.plinthHalf, measures.galleryHalf),
      6,
    );
    expect(bounds.minX).toBeCloseTo(
      -Math.max(measures.plinthHalf, measures.galleryHalf),
      6,
    );
  });

  it("fills the tower wall, the band, the metalwork, and the glass", () => {
    const geometry = generateLighthouse(defaultLighthouseParameters);
    expect(geometry.styleZones.map((zone) => zone.role)).toEqual([
      "architecture",
      "signal",
      "metal",
      "glass",
    ]);
    for (const zone of geometry.styleZones) {
      expect(pathArea(zone.path)).toBeGreaterThan(0);
    }
  });

  it("paints the band inside the taper of the tower", () => {
    const geometry = generateLighthouse(defaultLighthouseParameters);
    const band = geometry.styleZones.find((zone) => zone.role === "signal");
    expect(band).toBeDefined();
    if (band === undefined) {
      return;
    }
    const bandBounds = pathBounds(band.path);
    const parameters = defaultLighthouseParameters;
    const measures = lighthouseMeasures(parameters);
    const center = -parameters.height * parameters.bandPosition;
    // The band follows the tower, so it never leaves the stated height...
    expect(bandBounds.minY).toBeGreaterThanOrEqual(
      center - measures.bandHeight / 2 - 0.1,
    );
    expect(bandBounds.maxY).toBeLessThanOrEqual(
      center + measures.bandHeight / 2 + 0.1,
    );
    // ...and it sits narrower than the foot of the tower, because the
    // tower tapers on its way up.
    expect(bandBounds.maxX).toBeLessThan(parameters.baseWidth / 2);
  });

  it("draws no band when the scene asks for none", () => {
    const geometry = generateLighthouse({
      ...defaultLighthouseParameters,
      band: false,
    });
    expect(geometry.styleZones.map((zone) => zone.role)).toEqual([
      "architecture",
      "metal",
      "glass",
    ]);
    // The band lines leave the boundaries with the zone.
    expect(geometry.internalBoundaries).toHaveLength(3);
  });

  it("cuts the door out of the wall zone", () => {
    const withDoor = generateLighthouse(defaultLighthouseParameters);
    const withoutDoor = generateLighthouse({
      ...defaultLighthouseParameters,
      door: false,
    });
    const wallOf = (geometry: typeof withDoor) =>
      geometry.styleZones.find((zone) => zone.role === "architecture");
    expect(pathArea(wallOf(withDoor)?.path ?? withDoor.silhouette)).toBeLessThan(
      pathArea(wallOf(withoutDoor)?.path ?? withoutDoor.silhouette),
    );
  });

  it("hangs the lamp room above the gallery deck", () => {
    const geometry = generateLighthouse(defaultLighthouseParameters);
    const lantern = geometry.styleZones.find((zone) => zone.role === "glass");
    expect(lantern).toBeDefined();
    if (lantern === undefined) {
      return;
    }
    const measures = lighthouseMeasures(defaultLighthouseParameters);
    const bounds = pathBounds(lantern.path);
    expect(bounds.maxY).toBeCloseTo(measures.deckTopY, 4);
    expect(bounds.minY).toBeCloseTo(measures.lanternTopY, 4);
  });

  it("keeps its geometry identical under any seed", () => {
    const first = generateLighthouse(defaultLighthouseParameters);
    const second = generateLighthouse(defaultLighthouseParameters);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});

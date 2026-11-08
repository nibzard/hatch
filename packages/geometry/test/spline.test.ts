/**
 * Tests for spline interpolation: the curve passes through every anchor.
 */

import { describe, expect, it } from "vitest";

import type { Point } from "@hatch/core";

import { samplePathPoints, splineThroughPoints } from "../src/index.js";

import { circlePoints, nearestDistance, roundedPath } from "./fixtures.js";

/** Anchor points along one hill crest. */
const hillAnchors: Point[] = [
  { x: 0, y: 60 },
  { x: 30, y: 20 },
  { x: 60, y: 8 },
  { x: 90, y: 30 },
  { x: 120, y: 62 },
];

describe("splineThroughPoints", () => {
  it("interpolates every anchor of an open spline", () => {
    const spline = splineThroughPoints(hillAnchors);
    for (const anchor of hillAnchors) {
      expect(nearestDistance(spline, anchor)).toBeLessThan(1e-6);
    }
  });

  it("interpolates every anchor of a closed spline", () => {
    const anchors = circlePoints(50, 40, 30, 7);
    const spline = splineThroughPoints(anchors, { closed: true });
    for (const anchor of anchors) {
      expect(nearestDistance(spline, anchor)).toBeLessThan(1e-6);
    }
    const commands = spline.commands;
    expect(commands[commands.length - 1]?.command).toBe("close");
  });

  it("emits one curve command per segment for a smooth spline", () => {
    const spline = splineThroughPoints(hillAnchors);
    expect(spline.commands).toHaveLength(hillAnchors.length);
    expect(spline.commands[0]?.command).toBe("move");
    for (const command of spline.commands.slice(1)) {
      expect(command.command).toBe("curve");
    }
  });

  it("wraps a closed spline around all its anchors", () => {
    const spline = splineThroughPoints(hillAnchors, { closed: true });
    // One move, one curve per anchor including the wrap segment, close.
    expect(spline.commands).toHaveLength(hillAnchors.length + 2);
  });

  it("draws straight lines at tension 0", () => {
    const spline = splineThroughPoints(hillAnchors, { tension: 0 });
    expect(spline.commands).toHaveLength(hillAnchors.length);
    for (const command of spline.commands.slice(1)) {
      expect(command.command).toBe("line");
    }
    for (const anchor of hillAnchors) {
      expect(nearestDistance(spline, anchor)).toBeLessThan(1e-6);
    }
  });

  it("gives identical output for identical anchors", () => {
    const first = splineThroughPoints(hillAnchors, { closed: true });
    const second = splineThroughPoints(hillAnchors, { closed: true });
    expect(roundedPath(second)).toEqual(roundedPath(first));
  });

  it("rejects too few points", () => {
    expect(() => splineThroughPoints([{ x: 0, y: 0 }])).toThrow(
      /at least 2 points/,
    );
    expect(() =>
      splineThroughPoints(hillAnchors.slice(0, 2), { closed: true }),
    ).toThrow(/at least 3 points/);
  });

  it("rejects a negative or non-finite tension", () => {
    expect(() => splineThroughPoints(hillAnchors, { tension: -1 })).toThrow(
      /tension/,
    );
    expect(() =>
      splineThroughPoints(hillAnchors, { tension: Number.NaN }),
    ).toThrow(/tension/);
  });

  it("rejects a non-finite anchor", () => {
    const bad: Point[] = [
      { x: 0, y: 0 },
      { x: Number.POSITIVE_INFINITY, y: 10 },
    ];
    expect(() => splineThroughPoints(bad)).toThrow(/finite/);
  });

  it("advances monotonically in x for evenly spaced anchors", () => {
    // The anchors sit 30 units apart in x, so the spline never doubles
    // back. That is what a hill crest or a horizon needs.
    const spline = splineThroughPoints(hillAnchors);
    const samples = samplePathPoints(spline, 2);
    expect(samples.length).toBeGreaterThan(10);
    for (let index = 1; index < samples.length; index += 1) {
      const previous = samples[index - 1];
      const current = samples[index];
      if (previous === undefined || current === undefined) {
        continue;
      }
      expect(current.x).toBeGreaterThanOrEqual(previous.x - 1e-9);
    }
  });
});

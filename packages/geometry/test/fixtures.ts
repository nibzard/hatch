/**
 * Shared fixtures for the @hatch/geometry tests.
 *
 * Every builder returns a fresh object. The helpers measure distance
 * through the same Paper.js bridge the package uses, so the tests assert
 * geometry, not implementation details.
 */

import paper from "paper";

import type { FillStyle, Path, Point } from "@hatch/core";

import { toPaperPath } from "../src/index.js";

/** An axis-aligned closed rectangle. */
export function rectPath(x: number, y: number, w: number, h: number): Path {
  return {
    commands: [
      { command: "move", to: { x, y } },
      { command: "line", to: { x: x + w, y } },
      { command: "line", to: { x: x + w, y: y + h } },
      { command: "line", to: { x, y: y + h } },
      { command: "close" },
    ],
  };
}

/** One open stroke between two points. */
export function strokePath(from: Point, to: Point): Path {
  return {
    commands: [
      { command: "move", to: from },
      { command: "line", to },
    ],
  };
}

/** One open polyline through the given points. */
export function polylinePath(points: readonly Point[]): Path {
  if (points.length === 0) {
    throw new Error("a polyline needs at least one point");
  }
  const [first, ...rest] = points;
  return {
    commands: [
      { command: "move", to: first ?? { x: 0, y: 0 } },
      ...rest.map((point) => ({ command: "line" as const, to: point })),
    ],
  };
}

/** One closed polygon through the given points. */
export function polygonPath(points: readonly Point[]): Path {
  return { commands: [...polylinePath(points).commands, { command: "close" }] };
}

/** Anchor points spread evenly on a circle. */
export function circlePoints(
  cx: number,
  cy: number,
  radius: number,
  count: number,
): Point[] {
  const points: Point[] = [];
  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * Math.PI * 2;
    points.push({
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    });
  }
  return points;
}

/** One closed polygon around a circle. */
export function circlePath(
  cx: number,
  cy: number,
  radius: number,
  count: number,
): Path {
  return polygonPath(circlePoints(cx, cy, radius, count));
}

/** A hatch fill style for composed regions. */
export function hatchFill(): FillStyle {
  return {
    type: "hatch",
    angle: 20,
    spacing: 6,
    stroke: "#1f2937",
    weight: 0.6,
    jitter: 0.4,
  };
}

/** Exact area of the regular polygon a circlePath fixture builds. */
export function regularPolygonArea(radius: number, count: number): number {
  return (count / 2) * radius * radius * Math.sin((2 * Math.PI) / count);
}

/** Exact perimeter of the regular polygon a circlePath fixture builds. */
export function regularPolygonPerimeter(radius: number, count: number): number {
  return 2 * count * radius * Math.sin(Math.PI / count);
}

/** Shortest distance from a point to the geometry of a path. */
export function nearestDistance(path: Path, point: Point): number {
  const item = toPaperPath(path);
  const target = new paper.Point(point.x, point.y);
  const nearest = item.getNearestPoint(target);
  return nearest === null ? Number.POSITIVE_INFINITY : nearest.getDistance(target);
}

/** Round every coordinate of a path, for deep-equality checks. */
export function roundedPath(path: Path, digits = 6): unknown {
  const factor = 10 ** digits;
  const round = (value: number): number =>
    Math.round(value * factor) / factor;
  return {
    commands: path.commands.map((command) => {
      if (command.command === "close") {
        return { command: command.command };
      }
      const rounded: Record<string, unknown> = {
        command: command.command,
        to: { x: round(command.to.x), y: round(command.to.y) },
      };
      if (command.command === "curve") {
        rounded.control1 = {
          x: round(command.control1.x),
          y: round(command.control1.y),
        };
        rounded.control2 = {
          x: round(command.control2.x),
          y: round(command.control2.y),
        };
      }
      return rounded;
    }),
  };
}

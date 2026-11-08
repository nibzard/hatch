/**
 * Path measurement (specification sections 4C and 9C).
 *
 * Traces report bounding boxes and areas, the hatching engine walks
 * strokes at an even spacing, and validators test whether a point falls
 * inside a region. These helpers answer those questions through Paper.js,
 * for simple and compound paths alike.
 */

import paper from "paper";

import type { Path, Point } from "@hatch/core";

import { toPaperPath } from "./paper.js";

/** The axis-aligned extent of a path. */
export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

/**
 * Read the contours of a Paper.js item. A simple item gives one contour.
 */
function contoursOf(item: paper.PathItem): paper.Path[] {
  if (item instanceof paper.CompoundPath) {
    // The typings name the children `Item[]`; a compound path only ever
    // holds path contours.
    return item.children as paper.Path[];
  }
  return [item as paper.Path];
}

/** Total length of the path in scene units. */
export function pathLength(path: Path): number {
  const item = toPaperPath(path);
  return contoursOf(item).reduce((total, contour) => total + contour.length, 0);
}

/**
 * The area the path covers, in square scene units. Holes of a compound
 * path count against the area, whatever the winding of the input.
 */
export function pathArea(path: Path): number {
  const item = toPaperPath(path);
  // `area` is signed by winding, and holes of a compound path carry the
  // opposite sign of their outer contour.
  const area = item instanceof paper.CompoundPath ? item.area : (item as paper.Path).area;
  return Math.abs(area);
}

/** The axis-aligned extent of the path geometry. */
export function pathBounds(path: Path): Bounds {
  const item = toPaperPath(path);
  const bounds = item.bounds;
  return {
    minX: bounds.left,
    minY: bounds.top,
    maxX: bounds.right,
    maxY: bounds.bottom,
    width: bounds.width,
    height: bounds.height,
  };
}

/**
 * True when the point lies inside the path. The test follows the nonzero
 * winding rule, so a hole in a compound path excludes the points inside
 * it. An open path counts as closed, as Paper.js defines it.
 */
export function pointInPath(path: Path, point: Point): boolean {
  const item = toPaperPath(path);
  return item.contains(new paper.Point(point.x, point.y));
}

/**
 * Points along the path, one every `spacing` scene units, plus the end
 * point of the path. The first point sits at offset 0.
 *
 * The path must hold exactly one contour, because offsets run along one
 * chain of segments. Throws for a compound path.
 */
export function samplePathPoints(path: Path, spacing: number): Point[] {
  if (!Number.isFinite(spacing) || spacing <= 0) {
    throw new Error("sample spacing must be a finite number greater than 0");
  }
  const item = toPaperPath(path);
  if (item instanceof paper.CompoundPath) {
    throw new Error(
      "samplePathPoints needs a path with one contour, received a compound path",
    );
  }
  const contour = item as paper.Path;
  const length = contour.length;
  const points: Point[] = [];
  const pushAt = (offset: number): void => {
    const point = contour.getPointAt(Math.min(offset, length));
    if (point === null) {
      return;
    }
    // A closed path repeats its start point at the full length, and a
    // spacing that divides the length lands on it. Keep one of them.
    const last = points[points.length - 1];
    if (last !== undefined && Math.hypot(point.x - last.x, point.y - last.y) < 1e-9) {
      return;
    }
    const first = points[0];
    if (
      contour.closed &&
      points.length > 0 &&
      first !== undefined &&
      Math.hypot(point.x - first.x, point.y - first.y) < 1e-9
    ) {
      return;
    }
    points.push({ x: point.x, y: point.y });
  };
  const steps = Math.floor(length / spacing);
  for (let step = 0; step <= steps; step += 1) {
    pushAt(step * spacing);
  }
  if (length - steps * spacing > 1e-9) {
    pushAt(length);
  }
  return points;
}

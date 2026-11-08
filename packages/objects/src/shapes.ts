/**
 * Path constructors shared by the object generators (specification
 * sections 6 and 16A).
 *
 * Generators assemble their shapes from the JSON-safe path model of
 * @hatch/core: a list of move, line, curve, and close commands. These
 * helpers build the common pieces - rectangles, polygons, polylines - and
 * join paths into one compound path, so every result starts with the move
 * command the Path schema requires.
 */

import type { Path, Point } from "@hatch/core";

/** Reject a non-finite coordinate before it reaches a path. */
function finitePoint(point: Point, what: string): Point {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new Error(`${what} needs finite x and y coordinates`);
  }
  return point;
}

/** Check a point list for the minimum length a shape needs. */
function requirePoints(what: string, points: readonly Point[], minimum: number): void {
  if (points.length < minimum) {
    throw new Error(`${what} needs at least ${minimum} points, received ${points.length}`);
  }
}

/** Build one closed polygon from its corner points, in order. */
export function polygonPath(points: readonly Point[]): Path {
  requirePoints("a polygon", points, 3);
  const first = points[0];
  if (first === undefined) {
    throw new Error("a polygon needs points");
  }
  const commands: Path["commands"] = [
    { command: "move", to: finitePoint(first, "a polygon point") },
  ];
  for (const point of points.slice(1)) {
    commands.push({ command: "line", to: finitePoint(point, "a polygon point") });
  }
  commands.push({ command: "close" });
  return { commands };
}

/** Build one open polyline from its points, in order. */
export function polylinePath(points: readonly Point[]): Path {
  requirePoints("a polyline", points, 2);
  const first = points[0];
  if (first === undefined) {
    throw new Error("a polyline needs points");
  }
  const commands: Path["commands"] = [
    { command: "move", to: finitePoint(first, "a polyline point") },
  ];
  for (const point of points.slice(1)) {
    commands.push({ command: "line", to: finitePoint(point, "a polyline point") });
  }
  return { commands };
}

/**
 * Build one closed axis-aligned rectangle from its edges.
 *
 * `minY` may lie above or below `maxY`; the caller works in the y-down
 * canvas of SVG either way. Both spans must be positive.
 */
export function rectanglePath(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): Path {
  if (!(maxX > minX) || !(maxY > minY)) {
    throw new Error(
      `a rectangle needs a positive width and height, received x ${minX} to ` +
        `${maxX} and y ${minY} to ${maxY}`,
    );
  }
  for (const value of [minX, minY, maxX, maxY]) {
    if (!Number.isFinite(value)) {
      throw new Error("a rectangle needs finite edges");
    }
  }
  return polygonPath([
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ]);
}

/**
 * Continue one open path with another: every command of `head`, then every
 * command of `tail` after its leading move.
 *
 * The first anchor of `tail` must sit where `head` ends, because the move
 * that would jump the pen there is dropped. Use this to weld splines and
 * segments into one contour.
 */
export function continuePath(head: Path, tail: Path): Path {
  const lead = tail.commands[0];
  if (lead === undefined || lead.command !== "move") {
    throw new Error("the appended path must start with a move command");
  }
  return { commands: [...head.commands, ...tail.commands.slice(1)] };
}

/**
 * Collect many paths into one compound path: every command of every part,
 * each move included, so every part stays its own contour.
 *
 * The result models disjoint pieces and holes in one path, the shape the
 * boolean helpers of @hatch/geometry produce.
 */
export function compoundPath(parts: readonly Path[]): Path | null {
  if (parts.length === 0) {
    return null;
  }
  const commands: Path["commands"] = [];
  for (const part of parts) {
    if (part.commands[0]?.command !== "move") {
      throw new Error("every part of a compound path must start with a move");
    }
    commands.push(...part.commands);
  }
  return { commands };
}

/**
 * Close a path, unless it already ends with a close command.
 * The close command draws one straight segment back to the first anchor.
 */
export function withClose(path: Path): Path {
  const last = path.commands[path.commands.length - 1];
  if (last !== undefined && last.command === "close") {
    return path;
  }
  return { commands: [...path.commands, { command: "close" }] };
}

/** Linear interpolation between two numbers. */
export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/** Clamp a value into an inclusive range. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** The bezier handle length that draws one quarter circle, as a radius share. */
const ARC_HANDLE = 4 / 3 * (Math.SQRT2 - 1);

/**
 * Build one closed ellipse from four cubic curves.
 *
 * The ellipse starts at its rightmost point and runs clockwise on the y-down
 * canvas. Four curves approximate the outline to a fraction of a user unit,
 * so wheels, heads, lamp lenses, and ground shadows stay round at any size.
 */
export function ellipsePath(center: Point, radiusX: number, radiusY: number): Path {
  if (!Number.isFinite(radiusX) || radiusX <= 0 || !Number.isFinite(radiusY) || radiusY <= 0) {
    throw new Error(
      `an ellipse needs positive radii, received ${radiusX} by ${radiusY}`,
    );
  }
  const { x, y } = finitePoint(center, "an ellipse center");
  const handleX = radiusX * ARC_HANDLE;
  const handleY = radiusY * ARC_HANDLE;
  const commands: Path["commands"] = [
    { command: "move", to: { x: x + radiusX, y } },
  ];
  const corners: readonly [Point, Point, Point][] = [
    [
      { x: x + radiusX, y: y + handleY },
      { x: x + handleX, y: y + radiusY },
      { x, y: y + radiusY },
    ],
    [
      { x: x - handleX, y: y + radiusY },
      { x: x - radiusX, y: y + handleY },
      { x: x - radiusX, y },
    ],
    [
      { x: x - radiusX, y: y - handleY },
      { x: x - handleX, y: y - radiusY },
      { x, y: y - radiusY },
    ],
    [
      { x: x + handleX, y: y - radiusY },
      { x: x + radiusX, y: y - handleY },
      { x: x + radiusX, y },
    ],
  ];
  for (const [control1, control2, to] of corners) {
    commands.push({ command: "curve", to, control1, control2 });
  }
  commands.push({ command: "close" });
  return { commands };
}

/**
 * Build one closed circle from four cubic curves.
 *
 * The circle starts at its rightmost point and runs clockwise on the y-down
 * canvas.
 */
export function discPath(center: Point, radius: number): Path {
  return ellipsePath(center, radius, radius);
}

/**
 * Build one closed rounded rectangle from four lines and four corner curves.
 *
 * `radius` clamps to half the shorter side, so a square stays a disc at most
 * and a wide band keeps its corners whole. A radius of 0 gives the plain
 * rectangle.
 */
export function roundedRectanglePath(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  radius: number,
): Path {
  if (!(maxX > minX) || !(maxY > minY)) {
    throw new Error(
      `a rounded rectangle needs a positive width and height, received x ` +
        `${minX} to ${maxX} and y ${minY} to ${maxY}`,
    );
  }
  const limit = Math.min(maxX - minX, maxY - minY) / 2;
  const corner = clamp(radius, 0, limit);
  if (corner <= 0) {
    return rectanglePath(minX, minY, maxX, maxY);
  }
  const handle = corner * ARC_HANDLE;
  const commands: Path["commands"] = [
    { command: "move", to: { x: minX + corner, y: minY } },
    { command: "line", to: { x: maxX - corner, y: minY } },
    {
      command: "curve",
      to: { x: maxX, y: minY + corner },
      control1: { x: maxX - handle, y: minY },
      control2: { x: maxX, y: minY + handle },
    },
    { command: "line", to: { x: maxX, y: maxY - corner } },
    {
      command: "curve",
      to: { x: maxX - corner, y: maxY },
      control1: { x: maxX, y: maxY - handle },
      control2: { x: maxX - handle, y: maxY },
    },
    { command: "line", to: { x: minX + corner, y: maxY } },
    {
      command: "curve",
      to: { x: minX, y: maxY - corner },
      control1: { x: minX + handle, y: maxY },
      control2: { x: minX, y: maxY - handle },
    },
    { command: "line", to: { x: minX, y: minY + corner } },
    {
      command: "curve",
      to: { x: minX + corner, y: minY },
      control1: { x: minX, y: minY + handle },
      control2: { x: minX + handle, y: minY },
    },
    { command: "close" },
  ];
  return { commands };
}

/**
 * Build one closed quad that spans `from` to `to` and tapers.
 *
 * The quad grows a half `widthFrom` at the start and a half `widthTo` at the
 * end, both measured across the travel direction. Limbs of a figure and
 * slats of a bench come out of this helper.
 */
export function limbPolygon(
  from: Point,
  to: Point,
  widthFrom: number,
  widthTo: number,
): Path {
  const start = finitePoint(from, "a limb start");
  const end = finitePoint(to, "a limb end");
  if (widthFrom <= 0 || widthTo <= 0) {
    throw new Error(
      `a limb needs positive widths, received ${widthFrom} to ${widthTo}`,
    );
  }
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) {
    throw new Error("a limb needs a start away from its end");
  }
  // The normal of the travel direction: rotate (dx, dy) by -90 degrees.
  const nx = -dy / length;
  const ny = dx / length;
  return polygonPath([
    { x: start.x + nx * widthFrom / 2, y: start.y + ny * widthFrom / 2 },
    { x: end.x + nx * widthTo / 2, y: end.y + ny * widthTo / 2 },
    { x: end.x - nx * widthTo / 2, y: end.y - ny * widthTo / 2 },
    { x: start.x - nx * widthFrom / 2, y: start.y - ny * widthFrom / 2 },
  ]);
}

/**
 * Walk one polyline and emit one point at a distance along it.
 *
 * The walk crosses every corner, so a dash that spans a corner bends with
 * the line.
 */
function pointAlong(points: readonly Point[], along: number): Point {
  let walked = 0;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    if (from === undefined || to === undefined) {
      throw new Error("a dashed path needs its points in order");
    }
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    if (walked + length >= along) {
      const share = length === 0 ? 0 : (along - walked) / length;
      return {
        x: lerp(from.x, to.x, share),
        y: lerp(from.y, to.y, share),
      };
    }
    walked += length;
  }
  const last = points[points.length - 1];
  if (last === undefined) {
    throw new Error("a dashed path needs its points");
  }
  return last;
}

/** The total length of one polyline. */
function polylineLength(points: readonly Point[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    if (from === undefined || to === undefined) {
      throw new Error("a dashed path needs its points in order");
    }
    total += Math.hypot(to.x - from.x, to.y - from.y);
  }
  return total;
}

/**
 * Build one dashed path along a polyline as a compound path of segments.
 *
 * Each dash runs `dash` units along the line with `gap` units of paper
 * between dashes. Lane markings and kerb lines read as dashes, and a
 * compound path keeps them one boundary. A line shorter than one dash draws
 * as one segment.
 */
export function dashedPolylinePath(
  points: readonly Point[],
  dash: number,
  gap: number,
): Path | null {
  if (points.length < 2) {
    throw new Error("a dashed path needs at least two points");
  }
  if (!(dash > 0) || gap < 0) {
    throw new Error(
      `a dashed path needs a positive dash and a non-negative gap, received ` +
        `${dash} and ${gap}`,
    );
  }
  for (const point of points) {
    finitePoint(point, "a dashed path point");
  }
  const length = polylineLength(points);
  if (length === 0) {
    return null;
  }
  const parts: Path[] = [];
  let along = 0;
  while (along < length) {
    const end = Math.min(along + dash, length);
    const from = pointAlong(points, along);
    const to = pointAlong(points, end);
    parts.push(polylinePath([from, to]));
    along = end + gap;
  }
  return compoundPath(parts);
}

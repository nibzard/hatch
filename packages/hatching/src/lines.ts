/**
 * Parallel line placement (specification sections 7 and 11).
 *
 * One hatch family is one set of parallel lines at one angle and one
 * spacing. This module holds the placement math: project a region onto the
 * direction of the family and onto its normal, then read the offsets at
 * which a line still meets the region.
 *
 * Every function here is pure numeric code on points and bounds. It draws
 * no random numbers, so the same frame and offset always give the same
 * line (specification section 10).
 */

import type { Path, Point } from "@hatch/core";

import type { Bounds } from "@hatch/geometry";

/** Convert degrees to radians. */
export function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Convert radians to degrees. */
export function radiansToDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

/** One unit vector at `degrees`, following the style angle convention. */
export function angleDirection(degrees: number): Point {
  const radians = degreesToRadians(degrees);
  return { x: Math.cos(radians), y: Math.sin(radians) };
}

/** The unit vector at 90 degrees to `direction`. */
export function normalOf(direction: Point): Point {
  return { x: -direction.y, y: direction.x };
}

/**
 * The placement frame of one hatch family over one region extent.
 *
 * `nMin` and `nMax` bound the offsets at which a line of the family angle
 * meets the extent. `dMin` and `dMax` bound how far the extent reaches
 * along the line direction.
 */
export interface LineFrame {
  /** The center of the extent. Every offset is measured from here. */
  center: Point;
  /** The unit direction of the family angle. */
  direction: Point;
  /** The unit normal of the family angle. */
  normal: Point;
  /** The lowest offset along the normal that meets the extent. */
  nMin: number;
  /** The highest offset along the normal that meets the extent. */
  nMax: number;
  /** The lowest reach along the line direction. */
  dMin: number;
  /** The highest reach along the line direction. */
  dMax: number;
}

/**
 * Build the placement frame of one family angle over one extent.
 *
 * The extent is the bounding box of the region, so every line that meets
 * the box also meets the region search space. Corners of the box give both
 * ranges, because projection onto a unit vector is monotone along each box
 * edge.
 */
export function lineFrame(bounds: Bounds, angleDegrees: number): LineFrame {
  const direction = angleDirection(angleDegrees);
  const normal = normalOf(direction);
  const center: Point = {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  };
  const corners: Point[] = [
    { x: bounds.minX - center.x, y: bounds.minY - center.y },
    { x: bounds.maxX - center.x, y: bounds.minY - center.y },
    { x: bounds.maxX - center.x, y: bounds.maxY - center.y },
    { x: bounds.minX - center.x, y: bounds.maxY - center.y },
  ];
  const alongNormal = corners.map(
    (corner) => corner.x * normal.x + corner.y * normal.y,
  );
  const alongDirection = corners.map(
    (corner) => corner.x * direction.x + corner.y * direction.y,
  );
  return {
    center,
    direction,
    normal,
    nMin: Math.min(...alongNormal),
    nMax: Math.max(...alongNormal),
    dMin: Math.min(...alongDirection),
    dMax: Math.max(...alongDirection),
  };
}

/**
 * How far a line of this frame reaches along its own direction, once both
 * ends grow by `margin`. The engine uses this length to scale angle drift.
 */
export function extentLength(frame: LineFrame, margin: number): number {
  return frame.dMax - frame.dMin + 2 * margin;
}

/**
 * The length of an open path built from `move` and `line` commands only.
 *
 * Returns `null` when the path holds a curve or a close command, so the
 * caller falls back to the Paper.js measurement instead of receiving a
 * wrong number. The engine builds its stroke pieces as polylines, so this
 * measures them without a Paper.js round trip.
 */
export function polylineLength(path: Path): number | null {
  let length = 0;
  let previous: Point | undefined;
  for (const command of path.commands) {
    if (command.command === "close") {
      return null;
    }
    if (previous !== undefined) {
      length += Math.hypot(
        command.to.x - previous.x,
        command.to.y - previous.y,
      );
    }
    previous = command.to;
  }
  return previous === undefined ? null : length;
}

/** One ideal line of a family, before humanization and clipping. */
export interface IdealLine {
  /** The first end of the line. */
  from: Point;
  /** The last end of the line. */
  to: Point;
  /** The distance from `from` to `to`. */
  length: number;
  /** The offset of the line from the frame center, along the frame normal. */
  offset: number;
  /** The angle of the line in degrees. It already holds the angle drift. */
  angleDegrees: number;
}

/**
 * Build the ideal line at one offset.
 *
 * The line runs at `angleDegrees`, which may differ from the frame angle by
 * the angle drift of this stroke. The margin grows both ends past the
 * extent, so the tilted line still crosses the whole region.
 */
export function idealLine(
  frame: LineFrame,
  offset: number,
  angleDegrees: number,
  margin: number,
): IdealLine {
  const direction = angleDirection(angleDegrees);
  const base: Point = {
    x: frame.center.x + frame.normal.x * offset,
    y: frame.center.y + frame.normal.y * offset,
  };
  const from: Point = {
    x: base.x + direction.x * (frame.dMin - margin),
    y: base.y + direction.y * (frame.dMin - margin),
  };
  const to: Point = {
    x: base.x + direction.x * (frame.dMax + margin),
    y: base.y + direction.y * (frame.dMax + margin),
  };
  return {
    from,
    to,
    length: extentLength(frame, margin),
    offset,
    angleDegrees,
  };
}

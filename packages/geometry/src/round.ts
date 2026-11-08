/**
 * Corner rounding (specification sections 8 and 17).
 *
 * The `objectGrammar.edgeRoundnessBias` field of a style preset states how
 * round the edges of an object draw. This module holds that promise as one
 * path operation: {@link roundPathCorners} cuts every corner of a polyline
 * into one cubic curve, the way a pen turning a corner leaves a small arc
 * instead of a needle point.
 *
 * The share parameter states how far one corner cuts into the shorter of
 * its two segments, as a fraction of that segment. 0 returns the input
 * unchanged; 0.5, the largest share the operation accepts, cuts every
 * corner to the midpoints of its neighbours, so two corners of one short
 * segment meet exactly at its middle and never fold past each other.
 *
 * Only polyline corners round: a subpath that carries a curve command
 * keeps its commands exactly, because a spline corner is already smooth.
 * The cubic control points sit on the tangents of the two segments at the
 * circular-arc constant, so a square corner reads as a quarter-round and a
 * shallow corner as a soft blend. Everything is pure numeric code, so the
 * same input and share always give the same output (specification section
 * 10).
 */

import type { Path, Point } from "@hatch/core";

import { subpathsOf } from "./paper.js";

/**
 * The cubic-bezier constant of a quarter circle: the control points of a
 * curve that approximates a 90 degree arc sit this share of the radius
 * along the tangents.
 */
const ARC_CONSTANT = 0.5523;

/** The largest share one corner may cut, the half of a segment. */
export const MAX_CORNER_SHARE = 0.5;

/** Corners that turn less than this share of a right angle stay sharp. */
const MIN_TURN_SINE = 1e-7;

/** A corner radius below this many units rounds to nothing. */
const MIN_RADIUS = 1e-9;

/** Round one length to whole milli-units, so path numbers stay short. */
function roundLength(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** One point rounded to milli-units. */
function roundedPoint(point: Point): Point {
  return { x: roundLength(point.x), y: roundLength(point.y) };
}

/** One planned corner: the cut points and the control points of its curve. */
interface CornerCut {
  /** Where the incoming segment stops. */
  readonly entry: Point;
  /** Where the outgoing curve lands. */
  readonly exit: Point;
  /** First control point, on the incoming tangent. */
  readonly control1: Point;
  /** Second control point, on the outgoing tangent. */
  readonly control2: Point;
}

/** The unit vector from `from` towards `to`, or null for a zero segment. */
function unitVector(from: Point, to: Point): Point | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length <= 1e-12) {
    return null;
  }
  return { x: dx / length, y: dy / length };
}

/**
 * The cut of one corner, or null when the corner stays sharp.
 *
 * A corner stays sharp when a segment around it has no length, when the
 * turn is straight (the segments continue one another) or folded back on
 * itself, or when the share leaves no radius to draw.
 */
function cornerCut(
  previous: Point,
  corner: Point,
  next: Point,
  share: number,
): CornerCut | null {
  const incoming = unitVector(previous, corner);
  const outgoing = unitVector(corner, next);
  if (incoming === null || outgoing === null) {
    return null;
  }
  // A straight continuation has no corner to round, and a fold would turn
  // the arc into a spike, so both stay as drawn.
  const cross = incoming.x * outgoing.y - incoming.y * outgoing.x;
  const dot = incoming.x * outgoing.x + incoming.y * outgoing.y;
  if (Math.abs(cross) < MIN_TURN_SINE || dot < -0.999) {
    return null;
  }
  const radius = share * Math.min(
    Math.hypot(corner.x - previous.x, corner.y - previous.y),
    Math.hypot(next.x - corner.x, next.y - corner.y),
  );
  if (radius < MIN_RADIUS) {
    return null;
  }
  const entry = {
    x: corner.x - incoming.x * radius,
    y: corner.y - incoming.y * radius,
  };
  const exit = {
    x: corner.x + outgoing.x * radius,
    y: corner.y + outgoing.y * radius,
  };
  const control = radius * ARC_CONSTANT;
  return {
    entry,
    exit,
    control1: {
      x: entry.x + incoming.x * control,
      y: entry.y + incoming.y * control,
    },
    control2: {
      x: exit.x - outgoing.x * control,
      y: exit.y - outgoing.y * control,
    },
  };
}

/**
 * Round one polyline subpath, given as its vertex list and closed flag.
 *
 * Returns null when no corner rounds, so the caller keeps the original
 * commands of the subpath.
 */
function roundedPolyline(
  points: readonly Point[],
  closed: boolean,
  share: number,
): Path["commands"] | null {
  const cornerCount = closed ? points.length : points.length - 2;
  if (cornerCount < 1) {
    return null;
  }
  const cuts: (CornerCut | null)[] = [];
  for (let index = 0; index < points.length; index += 1) {
    // The first vertex of an open polyline is an endpoint, not a corner.
    const isOpenEnd = !closed && (index === 0 || index === points.length - 1);
    if (isOpenEnd) {
      cuts.push(null);
      continue;
    }
    const previous = points[(index - 1 + points.length) % points.length];
    const corner = points[index];
    const next = points[(index + 1) % points.length];
    if (previous === undefined || corner === undefined || next === undefined) {
      cuts.push(null);
      continue;
    }
    cuts.push(cornerCut(previous, corner, next, share));
  }
  if (cuts.every((cut) => cut === null)) {
    return null;
  }

  const commands: Path["commands"] = [];
  const curve = (cut: CornerCut): void => {
    commands.push({
      command: "curve",
      to: roundedPoint(cut.exit),
      control1: roundedPoint(cut.control1),
      control2: roundedPoint(cut.control2),
    });
  };
  if (closed) {
    // The ring starts where the curve of the first corner lands, walks the
    // segments to every later corner, and closes on the same point, so the
    // join of the ring rounds like every other corner.
    const first = cuts[0] ?? null;
    commands.push({
      command: "move",
      to: roundedPoint(first === null ? points[0]! : first.exit),
    });
    for (let index = 1; index < points.length; index += 1) {
      const cut = cuts[index] ?? null;
      const point = points[index]!;
      commands.push({
        command: "line",
        to: roundedPoint(cut === null ? point : cut.entry),
      });
      if (cut !== null) {
        curve(cut);
      }
    }
    if (first !== null) {
      commands.push({ command: "line", to: roundedPoint(first.entry) });
      curve(first);
    }
    commands.push({ command: "close" });
    return commands;
  }
  commands.push({
    command: "move",
    to: roundedPoint(points[0]!),
  });
  for (let index = 1; index < points.length - 1; index += 1) {
    const cut = cuts[index] ?? null;
    const point = points[index]!;
    commands.push({
      command: "line",
      to: roundedPoint(cut === null ? point : cut.entry),
    });
    if (cut !== null) {
      curve(cut);
    }
  }
  commands.push({
    command: "line",
    to: roundedPoint(points[points.length - 1]!),
  });
  return commands;
}

/**
 * Round every polyline corner of one path into a curve.
 *
 * `share` states how far one corner cuts into the shorter of its two
 * segments, as a fraction from 0 to {@link MAX_CORNER_SHARE}. A share of 0
 * returns the input path unchanged. Subpaths that hold curve commands keep
 * their commands exactly, and so do subpaths where no corner turns enough
 * to round, so a path of straight two-point segments is byte-identical
 * after the call.
 */
export function roundPathCorners(path: Path, share: number): Path {
  if (!Number.isFinite(share) || share < 0 || share > MAX_CORNER_SHARE) {
    throw new Error(
      `corner share must be a finite number between 0 and ${MAX_CORNER_SHARE}, received ${share}`,
    );
  }
  if (share === 0) {
    return path;
  }
  let changed = false;
  const commands: Path["commands"] = [];
  for (const subpath of subpathsOf(path)) {
    const points: Point[] = [];
    let straight = true;
    let closed = false;
    for (const command of subpath.commands) {
      if (command.command === "curve") {
        straight = false;
        break;
      }
      if (command.command === "close") {
        closed = true;
      } else {
        points.push(command.to);
      }
    }
    const rounded =
      straight && points.length >= 3
        ? roundedPolyline(points, closed, share)
        : null;
    if (rounded === null) {
      commands.push(...subpath.commands);
    } else {
      changed = true;
      commands.push(...rounded);
    }
  }
  return changed ? { commands } : path;
}

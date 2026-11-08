/**
 * The bridge between the core path model and Paper.js (specification
 * sections 2, 11, and 20).
 *
 * @hatch/core defines one JSON-safe path model: a list of move, line,
 * curve, and close commands. Paper.js does the geometry work. This module
 * converts between the two models and keeps one headless Paper.js scope
 * for the whole process.
 *
 * A core path may hold more than one move-to group. Such a path is a
 * compound path: several closed contours in one command list, in the
 * winding the boolean helpers produce. The SVG renderer writes one `d`
 * attribute for it. {@link subpathsOf} splits a compound path back into
 * single contours when a caller needs one contour per path.
 */

import paper from "paper";

import type { Path, Point } from "@hatch/core";

/**
 * Size of the headless view. Geometry helpers never draw, so the size
 * carries no meaning. Paper.js only needs a view to create paths.
 */
const HOST_VIEW_SIZE = 1000;

/** True once the Paper.js scope is prepared. */
let scopeReady = false;

/**
 * Prepare the process-wide Paper.js scope. Calling it twice is a no-op.
 *
 * Paper.js runs headless in Node: the scope needs no canvas for path
 * construction, boolean operations, or measurement. Items are kept out of
 * the project, so long render runs do not accumulate scene-graph state.
 */
export function ensurePaperScope(): void {
  if (scopeReady) return;
  paper.setup(new paper.Size(HOST_VIEW_SIZE, HOST_VIEW_SIZE));
  paper.settings.insertItems = false;
  scopeReady = true;
}

/** One anchor with its incoming and outgoing bezier handles, if any. */
interface AnchorPoint {
  point: Point;
  /** Handle that leads into the anchor, relative to the anchor. */
  handleIn?: Point;
  /** Handle that leads out of the anchor, relative to the anchor. */
  handleOut?: Point;
}

/** One move-to group of a core path. */
interface SubpathDraft {
  anchors: AnchorPoint[];
  closed: boolean;
}

/**
 * Split a core path into its move-to groups. The first command must be a
 * move. A close command ends the current group; the next command must be
 * a move again. Throws a readable error on any other sequence.
 */
function subpathDrafts(path: Path): SubpathDraft[] {
  const groups: SubpathDraft[] = [];
  let current: SubpathDraft | undefined;
  for (const command of path.commands) {
    if (command.command === "close") {
      if (current === undefined) {
        throw new Error(
          "invalid Path: a close command must follow a move command",
        );
      }
      current.closed = true;
      current = undefined;
      continue;
    }
    if (command.command === "move" || current === undefined) {
      if (command.command !== "move") {
        throw new Error(
          `invalid Path: a ${command.command} command must follow a move command`,
        );
      }
      current = { anchors: [{ point: command.to }], closed: false };
      groups.push(current);
      continue;
    }
    if (command.command === "line") {
      current.anchors.push({ point: command.to });
    } else {
      const previous = current.anchors[current.anchors.length - 1];
      if (previous === undefined) {
        throw new Error("invalid Path: a subpath needs a leading move command");
      }
      // A curve command stores absolute control points. The outgoing
      // handle of the previous anchor and the incoming handle of the new
      // anchor are relative to their anchor points.
      previous.handleOut = subtract(
        command.control1,
        previous.point,
      );
      current.anchors.push({
        point: command.to,
        handleIn: subtract(command.control2, command.to),
      });
    }
  }
  if (groups.length === 0) {
    throw new Error("invalid Path: a path needs at least one move command");
  }
  return groups;
}

/** `a - b` for points. */
function subtract(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y };
}

/** Build one Paper.js path from one move-to group. */
function draftToPaperPath(draft: SubpathDraft): paper.Path {
  const segments = draft.anchors.map(
    (anchor) =>
      new paper.Segment(
        new paper.Point(anchor.point.x, anchor.point.y),
        anchor.handleIn === undefined
          ? undefined
          : new paper.Point(anchor.handleIn.x, anchor.handleIn.y),
        anchor.handleOut === undefined
          ? undefined
          : new paper.Point(anchor.handleOut.x, anchor.handleOut.y),
      ),
  );
  return new paper.Path({ segments, closed: draft.closed, insert: false });
}

/**
 * Convert a core path into a Paper.js item.
 *
 * A path with one move-to group becomes a `Path`. A path with more groups
 * becomes a `CompoundPath`. The item is a fresh copy: changing it never
 * touches the input.
 */
export function toPaperPath(path: Path): paper.PathItem {
  ensurePaperScope();
  const drafts = subpathDrafts(path);
  const [first] = drafts;
  if (drafts.length === 1 && first !== undefined) {
    return draftToPaperPath(first);
  }
  return new paper.CompoundPath({
    children: drafts.map(draftToPaperPath),
    insert: false,
  });
}

/** Read the sub-contours of a Paper.js item. Empty items give no contours. */
function paperSubItems(item: paper.PathItem): paper.Path[] {
  if (item instanceof paper.CompoundPath) {
    // The typings name the children `Item[]`; a compound path only ever
    // holds path contours.
    const children = item.children as paper.Path[];
    return children.filter((child) => child.segments.length > 0);
  }
  const single = item as paper.Path;
  return single.segments.length > 0 ? [single] : [];
}

/** One contour of a Paper.js path, as a list of pen commands. */
function paperItemCommands(item: paper.Path): Path["commands"] {
  const segments = item.segments;
  const first = segments[0];
  if (first === undefined) {
    throw new Error("invalid Paper.js item: a contour needs one segment");
  }
  const commands: Path["commands"] = [
    { command: "move", to: { x: first.point.x, y: first.point.y } },
  ];
  for (let index = 1; index < segments.length; index += 1) {
    const previous = segments[index - 1];
    const segment = segments[index];
    if (previous === undefined || segment === undefined) {
      continue;
    }
    const curveIn = previous.handleOut;
    const curveOut = segment.handleIn;
    if (curveIn.isZero() && curveOut.isZero()) {
      commands.push({
        command: "line",
        to: { x: segment.point.x, y: segment.point.y },
      });
    } else {
      commands.push({
        command: "curve",
        to: { x: segment.point.x, y: segment.point.y },
        control1: {
          x: previous.point.x + curveIn.x,
          y: previous.point.y + curveIn.y,
        },
        control2: {
          x: segment.point.x + curveOut.x,
          y: segment.point.y + curveOut.y,
        },
      });
    }
  }
  if (item.closed) {
    const last = segments[segments.length - 1];
    if (last !== undefined && (!last.handleOut.isZero() || !first.handleIn.isZero())) {
      // The closing edge is a curve, so write it out before closing.
      commands.push({
        command: "curve",
        to: { x: first.point.x, y: first.point.y },
        control1: {
          x: last.point.x + last.handleOut.x,
          y: last.point.y + last.handleOut.y,
        },
        control2: {
          x: first.point.x + first.handleIn.x,
          y: first.point.y + first.handleIn.y,
        },
      });
    }
    commands.push({ command: "close" });
  }
  return commands;
}

/**
 * Convert a Paper.js item back into one core path.
 *
 * A compound item keeps all its contours in one core path, in order. The
 * result then models the holes of the item through winding, which is what
 * the boolean helpers produce.
 *
 * Returns `null` for an empty item, so callers can drop empty results
 * without throwing.
 */
export function fromPaperPath(item: paper.PathItem): Path | null {
  const contours = paperSubItems(item);
  if (contours.length === 0) {
    return null;
  }
  const commands: Path["commands"] = [];
  for (const contour of contours) {
    commands.push(...paperItemCommands(contour));
  }
  return { commands };
}

/**
 * Split a core path into single-contour paths, one per move-to group.
 * Each returned path keeps the close command of its group.
 */
export function subpathsOf(path: Path): Path[] {
  const groups = subpathDrafts(path);
  return groups.map((group) => {
    const start = group.anchors[0];
    if (start === undefined) {
      throw new Error("invalid Path: a subpath needs a leading move command");
    }
    const commands: Path["commands"] = [
      { command: "move", to: start.point },
    ];
    for (let index = 1; index < group.anchors.length; index += 1) {
      const anchor = group.anchors[index];
      const previous = group.anchors[index - 1];
      if (anchor === undefined || previous === undefined) {
        continue;
      }
      if (
        anchor.handleIn === undefined &&
        previous.handleOut === undefined
      ) {
        commands.push({ command: "line", to: anchor.point });
      } else {
        commands.push({
          command: "curve",
          to: anchor.point,
          control1:
            previous.handleOut === undefined
              ? previous.point
              : {
                  x: previous.point.x + previous.handleOut.x,
                  y: previous.point.y + previous.handleOut.y,
                },
          control2:
            anchor.handleIn === undefined
              ? anchor.point
              : {
                  x: anchor.point.x + anchor.handleIn.x,
                  y: anchor.point.y + anchor.handleIn.y,
                },
        });
      }
    }
    if (group.closed) {
      commands.push({ command: "close" });
    }
    return { commands };
  });
}

/**
 * True when every move-to group of the path ends with a close command.
 * A path with one open group counts as open.
 */
export function isClosedPath(path: Path): boolean {
  const groups = subpathDrafts(path);
  return groups.every((group) => group.closed);
}

/** Every anchor point of the path, in command order. */
export function pathPoints(path: Path): Point[] {
  const points: Point[] = [];
  for (const command of path.commands) {
    if (command.command !== "close") {
      points.push(command.to);
    }
  }
  return points;
}

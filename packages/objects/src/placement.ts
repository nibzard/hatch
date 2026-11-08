/**
 * Object placement (specification sections 5 and 6).
 *
 * Every generator builds its geometry in one local frame: the object sits
 * on the line `y = 0`, centered on `x = 0`, with its mass above that line
 * towards negative y. The scene planner places each object with one
 * transform - an anchor point in scene units, a uniform scale, and a
 * rotation around the anchor - so generators never see absolute scene
 * coordinates.
 *
 * The transform is closed-form numeric code, so the same geometry and the
 * same placement always give the same result (specification section 10).
 */

import type {
  Geometry,
  Path,
  Point,
  PlacementCamera,
  SceneObject,
} from "@hatch/core";

/** Where and how one object sits in the scene. */
export interface Placement {
  /** Where the local origin of the object lands, in scene units. */
  readonly position: Point;
  /** Uniform scale multiplier of the local units. Default 1. */
  readonly scale?: number;
  /**
   * Rotation around the local origin in degrees. Positive values turn the
   * object counter-clockwise as the viewer sees it on the y-down canvas.
   * Default 0.
   */
  readonly rotation?: number;
}

/**
 * The placement of one scene object, anchored at a scene point.
 *
 * The camera record the planner computed wins over the fields the object
 * states: it already carries the object scale under the framing, the depth
 * plane, and the focal emphasis, and the object rotation plus the camera
 * roll. Without it the object draws exactly as the spec states it.
 */
export function placementOf(
  sceneObject: SceneObject,
  anchor: Point,
  camera?: PlacementCamera,
): Placement {
  if (camera === undefined) {
    return {
      position: anchor,
      scale: sceneObject.scale,
      ...(sceneObject.rotation === undefined
        ? {}
        : { rotation: sceneObject.rotation }),
    };
  }
  return {
    position: anchor,
    scale: camera.scale,
    rotation: camera.rotation,
  };
}

/** Reject a placement the transform cannot apply. */
function placementParts(placement: Placement): {
  position: Point;
  scale: number;
  angle: number;
} {
  const { position } = placement;
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) {
    throw new Error("a placement needs a finite position in x and y");
  }
  const scale = placement.scale ?? 1;
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new Error(
      `a placement scale must be a finite number greater than 0, received ${scale}`,
    );
  }
  const degrees = placement.rotation ?? 0;
  if (!Number.isFinite(degrees)) {
    throw new Error("a placement rotation must be a finite number of degrees");
  }
  return { position, scale, angle: (degrees * Math.PI) / 180 };
}

/** Map one point from the local frame of an object into the scene. */
export function transformPoint(placement: Placement, point: Point): Point {
  const { position, scale, angle } = placementParts(placement);
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new Error("a transformed point needs finite x and y coordinates");
  }
  const x = point.x * scale;
  const y = point.y * scale;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // The y axis of the canvas points down, so the negated sine turns the
  // object counter-clockwise as the viewer sees it.
  return {
    x: position.x + x * cos + y * sin,
    y: position.y - x * sin + y * cos,
  };
}

/** Map every point of one path from the local frame into the scene. */
export function transformPath(placement: Placement, path: Path): Path {
  const commands: Path["commands"] = path.commands.map((command) => {
    if (command.command === "close") {
      return command;
    }
    if (command.command === "curve") {
      return {
        command: "curve" as const,
        to: transformPoint(placement, command.to),
        control1: transformPoint(placement, command.control1),
        control2: transformPoint(placement, command.control2),
      };
    }
    return {
      command: command.command,
      to: transformPoint(placement, command.to),
    };
  });
  return { commands };
}

/** Place one whole geometry: silhouette, contours, boundaries, and zones. */
export function transformGeometry(
  geometry: Geometry,
  placement: Placement,
): Geometry {
  return {
    silhouette: transformPath(placement, geometry.silhouette),
    contours: geometry.contours.map((contour) =>
      transformPath(placement, contour),
    ),
    internalBoundaries: geometry.internalBoundaries.map((boundary) =>
      transformPath(placement, boundary),
    ),
    styleZones: geometry.styleZones.map((zone) => ({
      role: zone.role,
      path: transformPath(placement, zone.path),
      ...(zone.zIndex === undefined ? {} : { zIndex: zone.zIndex }),
    })),
  };
}

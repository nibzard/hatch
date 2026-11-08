/**
 * Tests for the camera and composition model (task T042).
 *
 * Every control of the camera and the composition block must move one number
 * of the layout. The tests pin each number, so a control that stops driving
 * the plan fails here before it fails in a render.
 */

import { describe, expect, it } from "vitest";

import {
  ASYMMETRIC_SPREAD,
  BALANCE_SHIFT,
  cameraDecisionOf,
  DEFAULT_PERSPECTIVE_STRENGTH,
  depthRampOf,
  depthScaleOf,
  DEPTH_SCALE_SPAN,
  FOCAL_EMPHASIS_SCALE,
  FRAMING_SUBJECT_SCALE,
  isFocalPoint,
  LENS_PERSPECTIVE,
  MAX_CAMERA_TILT_DEGREES,
  MAX_DEPTH_LAYERS,
  MAX_PERSPECTIVE_STRENGTH,
  placementCameraOf,
  rollPath,
  rollPoint,
  rolledHorizonHeights,
} from "../src/index.js";
import type { SceneObject, SceneSpec } from "../src/index.js";
import { validSceneSpec } from "./fixtures.js";

/** One object of the fixture scene, with one field replaced. */
function objectWith(patch: Partial<SceneObject>): SceneObject {
  return { ...validSceneSpec().objects[0]!, ...patch };
}

/** The fixture spec with the camera and the composition replaced. */
function specWith(
  camera: Partial<SceneSpec["camera"]>,
  composition: Partial<SceneSpec["composition"]>,
  objects: readonly SceneObject[] = validSceneSpec().objects,
): SceneSpec {
  const spec = validSceneSpec();
  return {
    ...spec,
    camera: { ...spec.camera, ...camera },
    composition: { ...spec.composition, focalPoints: [], ...composition },
    objects: [...objects],
  };
}

describe("cameraDecisionOf", () => {
  it("reads the framing as the subject scale", () => {
    for (const [framing, scale] of Object.entries(FRAMING_SUBJECT_SCALE)) {
      const decision = cameraDecisionOf(
        specWith({ framing: framing as SceneSpec["camera"]["framing"] }, {}),
      );
      expect(decision.framingScale).toBe(scale);
    }
    // The three framings separate: a close frame draws larger than a wide one.
    expect(FRAMING_SUBJECT_SCALE.wide).toBeLessThan(FRAMING_SUBJECT_SCALE.medium);
    expect(FRAMING_SUBJECT_SCALE.medium).toBeLessThan(FRAMING_SUBJECT_SCALE.close);
  });

  it("reads the lens as the base depth exaggeration", () => {
    for (const [lens, base] of Object.entries(LENS_PERSPECTIVE)) {
      const decision = cameraDecisionOf(
        specWith({ lens: lens as SceneSpec["camera"]["lens"] }, {}),
      );
      expect(decision.perspective).toBe(base);
    }
    expect(LENS_PERSPECTIVE.normal).toBeLessThan(LENS_PERSPECTIVE.wide);
    expect(LENS_PERSPECTIVE.wide).toBeLessThan(LENS_PERSPECTIVE["ultra-wide"]);
  });

  it("applies the full base of the lens when the strength is absent", () => {
    const decision = cameraDecisionOf(specWith({}, {}));
    expect(decision.perspectiveStrength).toBe(DEFAULT_PERSPECTIVE_STRENGTH);
    expect(decision.perspectiveStrengthClamped).toBe(false);
    expect(decision.perspective).toBe(LENS_PERSPECTIVE[validSceneSpec().camera.lens]);
  });

  it("scales the base of the lens by the strength", () => {
    const decision = cameraDecisionOf(
      specWith({ perspectiveStrength: 0.5 }, {}),
    );
    expect(decision.perspective).toBe(
      LENS_PERSPECTIVE[validSceneSpec().camera.lens] * 0.5,
    );
  });

  it("clamps a strength outside [0, 1] and records the clamp", () => {
    const high = cameraDecisionOf(specWith({ perspectiveStrength: 4 }, {}));
    expect(high.perspectiveStrength).toBe(MAX_PERSPECTIVE_STRENGTH);
    expect(high.perspectiveStrengthClamped).toBe(true);
    const low = cameraDecisionOf(specWith({ perspectiveStrength: -1 }, {}));
    expect(low.perspectiveStrength).toBe(0);
    expect(low.perspectiveStrengthClamped).toBe(true);
    expect(low.perspective).toBe(0);
  });

  it("clamps the roll into the band a wide canvas holds", () => {
    const rolled = cameraDecisionOf(specWith({ tilt: 90 }, {}));
    expect(rolled.tiltDegrees).toBe(MAX_CAMERA_TILT_DEGREES);
    expect(rolled.tiltClamped).toBe(true);
    const level = cameraDecisionOf(specWith({}, {}));
    expect(level.tiltDegrees).toBe(0);
    expect(level.tiltClamped).toBe(false);
  });

  it("reads the balance as a shift, and the asymmetric balance as a spread", () => {
    for (const [balance, shift] of Object.entries(BALANCE_SHIFT)) {
      const decision = cameraDecisionOf(
        specWith({}, { balance: balance as SceneSpec["composition"]["balance"] }),
      );
      expect(decision.balanceShift).toBe(shift);
      expect(decision.balanceSpread).toBe(
        balance === "asymmetric" ? ASYMMETRIC_SPREAD : 0,
      );
    }
    // The two directions separate from the centered layout.
    expect(BALANCE_SHIFT.left).toBeLessThan(BALANCE_SHIFT.center);
    expect(BALANCE_SHIFT.center).toBeLessThan(BALANCE_SHIFT.right);
  });

  it("clamps the depth stack into the four planes the roles span", () => {
    expect(cameraDecisionOf(specWith({}, { depthLayers: 1 })).depthLayers).toBe(1);
    expect(cameraDecisionOf(specWith({}, { depthLayers: 4 })).depthLayers).toBe(4);
    const deep = cameraDecisionOf(specWith({}, { depthLayers: 9 }));
    expect(deep.depthLayers).toBe(MAX_DEPTH_LAYERS);
    expect(deep.depthLayersClamped).toBe(true);
    const empty = cameraDecisionOf(specWith({}, { depthLayers: 0 }));
    expect(empty.depthLayers).toBe(1);
    expect(empty.depthLayersClamped).toBe(true);
  });

  it("rejects a focal point that names no object", () => {
    expect(() =>
      cameraDecisionOf(specWith({}, { focalPoints: ["cottage-9"] })),
    ).toThrow(
      /composition\.focalPoints names "cottage-9", which no object of scene/,
    );
  });

  it("keeps the focal points the composition names", () => {
    const decision = cameraDecisionOf(
      specWith({}, { focalPoints: ["tree-1"] }),
    );
    expect(decision.focalPointIds).toEqual(["tree-1"]);
  });
});

describe("depthRampOf", () => {
  it("flattens a one-plane stack and fills a four-plane stack", () => {
    expect(depthRampOf(cameraDecisionOf(specWith({}, { depthLayers: 1 })))).toBe(0);
    expect(depthRampOf(cameraDecisionOf(specWith({}, { depthLayers: 2 })))).toBeCloseTo(1 / 3, 9);
    expect(depthRampOf(cameraDecisionOf(specWith({}, { depthLayers: 4 })))).toBe(1);
    // A stack deeper than the roles span clamps, so the ramp holds.
    expect(depthRampOf(cameraDecisionOf(specWith({}, { depthLayers: 12 })))).toBe(1);
  });
});

describe("depthScaleOf", () => {
  it("holds the neutral role at the framing size", () => {
    const decision = cameraDecisionOf(
      specWith({ lens: "ultra-wide", perspectiveStrength: 1 }, { depthLayers: 4 }),
    );
    expect(depthScaleOf(decision, 1)).toBe(1);
  });

  it("grows the planes in front and shrinks the planes behind", () => {
    const decision = cameraDecisionOf(
      specWith({ lens: "ultra-wide", perspectiveStrength: 1 }, { depthLayers: 4 }),
    );
    const background = depthScaleOf(decision, 0);
    const foreground = depthScaleOf(decision, 2);
    const focal = depthScaleOf(decision, 3);
    expect(background).toBeLessThan(1);
    expect(foreground).toBeGreaterThan(1);
    expect(focal).toBeGreaterThan(foreground);
    // The span constant keeps the ramp inside the bounds the model states.
    expect(focal).toBeCloseTo(1 / (1 - DEPTH_SCALE_SPAN), 9);
    expect(background).toBeCloseTo(1 / (1 + DEPTH_SCALE_SPAN / 2), 9);
  });

  it("returns 1 for a flat stack, whatever the lens carries", () => {
    const flat = cameraDecisionOf(
      specWith({ lens: "ultra-wide", perspectiveStrength: 1 }, { depthLayers: 1 }),
    );
    for (const depth of [0, 1, 2, 3]) {
      expect(depthScaleOf(flat, depth)).toBe(1);
    }
  });

  it("returns 1 for a flattened perspective, whatever the stack spans", () => {
    const flattened = cameraDecisionOf(
      specWith({ lens: "ultra-wide", perspectiveStrength: 0 }, { depthLayers: 4 }),
    );
    for (const depth of [0, 1, 2, 3]) {
      expect(depthScaleOf(flattened, depth)).toBe(1);
    }
  });
});

describe("placementCameraOf", () => {
  it("composes framing, depth plane, and focal emphasis into one scale", () => {
    const decision = cameraDecisionOf(
      specWith(
        { framing: "close", lens: "ultra-wide", perspectiveStrength: 1 },
        { depthLayers: 4, focalPoints: ["tree-1"] },
      ),
    );
    const object = objectWith({ role: "focal", scale: 2 });
    const camera = placementCameraOf(decision, object, 3);
    expect(camera.scale).toBeCloseTo(
      2 *
        FRAMING_SUBJECT_SCALE.close *
        depthScaleOf(decision, 3) *
        FOCAL_EMPHASIS_SCALE,
      6,
    );
  });

  it("adds the roll to the rotation the object states", () => {
    const level = cameraDecisionOf(specWith({}, {}));
    const rolled = cameraDecisionOf(specWith({ tilt: 6 }, {}));
    const object = objectWith({ rotation: 10 });
    expect(placementCameraOf(level, object, 1).rotation).toBe(10);
    expect(placementCameraOf(rolled, object, 1).rotation).toBe(16);
    expect(placementCameraOf(rolled, objectWith({ rotation: undefined }), 1).rotation).toBe(6);
  });

  it("marks the objects the composition names", () => {
    const decision = cameraDecisionOf(
      specWith({}, { focalPoints: ["tree-1"] }),
    );
    expect(isFocalPoint(decision, objectWith({ id: "tree-1" }))).toBe(true);
    expect(isFocalPoint(decision, objectWith({ id: "hill-1" }))).toBe(false);
  });
});

describe("rollPoint and rollPath", () => {
  const center = { x: 512, y: 384 };

  it("leaves every point alone under a level camera", () => {
    const point = { x: 80, y: 240 };
    expect(rollPoint(point, center, 0)).toBe(point);
    const path = { commands: [{ command: "close" as const }] };
    expect(rollPath(path, center, 0)).toBe(path);
  });

  it("turns a point counter-clockwise as the viewer sees it", () => {
    // A point to the right of the center moves above it under a quarter turn.
    const turned = rollPoint({ x: center.x + 100, y: center.y }, center, 90);
    expect(turned.x).toBeCloseTo(center.x, 6);
    expect(turned.y).toBeCloseTo(center.y - 100, 6);
  });

  it("keeps the center of the canvas fixed", () => {
    expect(rollPoint(center, center, 37.5)).toEqual(center);
  });

  it("rolls every point of a path, control points included", () => {
    const path = {
      commands: [
        {
          command: "curve" as const,
          to: { x: 10, y: 0 },
          control1: { x: 0, y: 10 },
          control2: { x: 5, y: 5 },
        },
        { command: "close" as const },
      ],
    };
    const rolled = rollPath(path, center, 90);
    const curve = rolled.commands[0]!;
    if (curve.command !== "curve") {
      throw new Error("test expected the rolled command to stay a curve");
    }
    expect(curve.to).toEqual(rollPoint({ x: 10, y: 0 }, center, 90));
    expect(curve.control1).toEqual(rollPoint({ x: 0, y: 10 }, center, 90));
    expect(curve.control2).toEqual(rollPoint({ x: 5, y: 5 }, center, 90));
    expect(rolled.commands[1]?.command).toBe("close");
  });
});

describe("rolledHorizonHeights", () => {
  const canvas = { width: 1024, height: 768 };

  it("keeps a level horizon at one height across the canvas", () => {
    expect(rolledHorizonHeights(522.24, canvas, 0)).toEqual({
      left: 522.24,
      right: 522.24,
      center: 522.24,
    });
  });

  it("slopes a rolled horizon away from the center column", () => {
    const heights = rolledHorizonHeights(522.24, canvas, MAX_CAMERA_TILT_DEGREES);
    // A counter-clockwise roll lifts the right side and drops the left one.
    expect(heights.right).toBeLessThan(heights.center);
    expect(heights.center).toBeLessThan(heights.left);
    // The heights stay on the canvas, so the regions they bound stay closed.
    for (const height of [heights.left, heights.right, heights.center]) {
      expect(height).toBeGreaterThanOrEqual(0);
      expect(height).toBeLessThanOrEqual(canvas.height);
    }
  });

  it("slopes the other way under a negative roll", () => {
    const up = rolledHorizonHeights(400, canvas, 10);
    const down = rolledHorizonHeights(400, canvas, -10);
    expect(down.left).toBeLessThan(down.center);
    expect(down.right).toBeGreaterThan(down.center);
    expect(up.left).toBeGreaterThan(up.center);
  });
});

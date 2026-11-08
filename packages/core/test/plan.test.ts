/**
 * Tests for the scene planning stage (task T017).
 *
 * Planning is pure layout: canvas, horizon, region skeletons, depth order,
 * anchors, and cloud cutouts. Every test drives it with an explicit stream,
 * so a planning result is reproducible by key alone.
 */

import { describe, expect, it } from "vitest";

import {
  ASYMMETRIC_SPREAD,
  BALANCE_SHIFT,
  cameraDecisionOf,
  canvasOfAspectRatio,
  CANVAS_BASE_WIDTH,
  cloudCountOf,
  cloudMasks,
  cloudPath,
  depthOfObject,
  depthScaleOf,
  DEFAULT_ROLE_DEPTH,
  FOCAL_EMPHASIS_SCALE,
  FRAMING_SUBJECT_SCALE,
  horizonOf,
  MAX_CLOUD_COUNT,
  planScene,
  placementsOf,
  rectanglePath,
  rollPoint,
  rolledHorizonHeights,
  ROLE_DEPTH,
} from "../src/index.js";
import { createRng, type SeededRng } from "../src/rng.js";
import type { Path, Point } from "../src/path.js";
import type { SceneSpec } from "../src/scene.js";
import { validSceneSpec, validStyleSpec } from "./fixtures.js";

/** The resolved style the planner reads, over the fixture preset. */
function resolvedStyle() {
  return { ...validStyleSpec(), preset: "test-pastoral" } as const;
}

/** One planning stream, reproducible by label. */
function planRng(label: string): SeededRng {
  return createRng(`hatch-plan-test:${label}`);
}

/** Every point one path moves through, close commands excepted. */
function pathPoints(path: Path): Point[] {
  return path.commands.flatMap((command) =>
    command.command === "close" ? [] : [command.to],
  );
}

describe("canvasOfAspectRatio", () => {
  it("scales the base width by the ratio", () => {
    expect(canvasOfAspectRatio("4:3")).toEqual({
      width: CANVAS_BASE_WIDTH,
      height: 768,
    });
    expect(canvasOfAspectRatio("16:9")).toEqual({ width: 1024, height: 576 });
    expect(canvasOfAspectRatio("1:1")).toEqual({ width: 1024, height: 1024 });
    // A ratio that does not divide the base width rounds to whole units.
    expect(canvasOfAspectRatio("3:4")).toEqual({ width: 1024, height: 1365 });
  });

  it("rejects a ratio without two positive numbers", () => {
    expect(() => canvasOfAspectRatio("0:3")).toThrow(/two positive numbers/);
    expect(() => canvasOfAspectRatio("4:0")).toThrow(/two positive numbers/);
    expect(() => canvasOfAspectRatio("wide")).toThrow(/must look like/);
  });
});

describe("horizonOf", () => {
  it("passes a horizon inside the preferred band through", () => {
    const spec = validSceneSpec();
    const horizon = horizonOf(spec, resolvedStyle());
    expect(horizon.horizonY).toBe(spec.camera.horizonY);
    expect(horizon.wasClamped).toBe(false);
    expect(horizon.preferredHorizonBand).toEqual([0.6, 0.75]);
  });

  it("moves a horizon outside the band to the nearer edge", () => {
    const spec = {
      ...validSceneSpec(),
      camera: { ...validSceneSpec().camera, horizonY: 0.95 },
    };
    const horizon = horizonOf(spec, resolvedStyle());
    expect(horizon.horizonY).toBe(0.75);
    expect(horizon.requestedHorizonY).toBe(0.95);
    expect(horizon.wasClamped).toBe(true);
  });

  it("lifts a horizon that sits too high", () => {
    const spec = {
      ...validSceneSpec(),
      camera: { ...validSceneSpec().camera, horizonY: 0.1 },
    };
    expect(horizonOf(spec, resolvedStyle()).horizonY).toBe(0.6);
  });
});

describe("depth and placement", () => {
  it("orders the roles background to focal", () => {
    expect(ROLE_DEPTH.background).toBeLessThan(ROLE_DEPTH.midground);
    expect(ROLE_DEPTH.midground).toBeLessThan(ROLE_DEPTH.foreground);
    expect(ROLE_DEPTH.foreground).toBeLessThan(ROLE_DEPTH.focal);
    const unroled = validSceneSpec().objects[0]!;
    expect(unroled.role).toBe("midground");
    expect(depthOfObject({ ...unroled, role: undefined })).toBe(
      DEFAULT_ROLE_DEPTH,
    );
  });

  it("sorts objects by depth and keeps the spec order between equals", () => {
    const spec = validSceneSpec();
    spec.objects = [
      { ...spec.objects[0]!, id: "tree-fg", role: "foreground" },
      { ...spec.objects[0]!, id: "tree-mid-a", role: "midground" },
      { ...spec.objects[0]!, id: "hill-bg", role: "background" },
      { ...spec.objects[0]!, id: "tree-mid-b", role: "midground" },
    ];
    // The objects carry new ids, so the focal point of the fixture would
    // name an object the scene no longer holds.
    spec.composition = { ...spec.composition, focalPoints: [] };
    const placements = placementsOf(spec, { width: 1000, height: 500 });
    expect(placements.map((entry) => entry.object.id)).toEqual([
      "hill-bg",
      "tree-mid-a",
      "tree-mid-b",
      "tree-fg",
    ]);
    expect(placements.map((entry) => entry.depthIndex)).toEqual([0, 1, 2, 3]);
  });

  it("maps normalized positions onto scene anchors", () => {
    const spec = validSceneSpec();
    // A centered balance maps the position straight onto the canvas.
    spec.composition = { ...spec.composition, balance: "center" };
    spec.objects = [
      { ...spec.objects[0]!, position: { x: 0.25, y: 0.5 } },
    ];
    const [placement] = placementsOf(spec, { width: 1000, height: 400 });
    expect(placement?.anchor).toEqual({ x: 250, y: 200 });
    expect(placement?.positionClamped).toBe(false);
  });

  it("clamps a position outside the canvas and records the clamp", () => {
    const spec = validSceneSpec();
    spec.objects = [
      { ...spec.objects[0]!, position: { x: 1.4, y: -0.2 } },
    ];
    const [placement] = placementsOf(spec, { width: 1000, height: 400 });
    expect(placement?.anchor).toEqual({ x: 1000, y: 0 });
    expect(placement?.positionClamped).toBe(true);
  });
});

describe("the camera and the composition drive the layout", () => {
  /** The fixture scene under one camera and one composition patch. */
  function specUnder(
    camera: Partial<SceneSpec["camera"]>,
    composition: Partial<SceneSpec["composition"]>,
  ): SceneSpec {
    const spec = validSceneSpec();
    return {
      ...spec,
      camera: { ...spec.camera, ...camera },
      composition: { ...spec.composition, focalPoints: [], ...composition },
    };
  }

  it("gives every placement the transform the camera computed", () => {
    const spec = specUnder(
      { framing: "close", lens: "ultra-wide", perspectiveStrength: 1, tilt: 5 },
      { depthLayers: 4, balance: "center" },
    );
    const [placement] = placementsOf(spec, { width: 1024, height: 768 });
    expect(placement?.camera.scale).toBeCloseTo(
      placement!.object.scale *
        FRAMING_SUBJECT_SCALE.close *
        depthScaleOf(cameraDecisionOf(spec), placement!.depth),
      6,
    );
    expect(placement?.camera.rotation).toBe(5);
  });

  it("marks the placements the composition names as focal points", () => {
    const spec = validSceneSpec();
    spec.composition = { ...spec.composition, focalPoints: ["tree-1"] };
    const [placement] = placementsOf(spec, { width: 1024, height: 768 });
    expect(placement?.focal).toBe(true);
    expect(placement?.camera.scale).toBeCloseTo(
      placement!.object.scale *
        FRAMING_SUBJECT_SCALE[spec.camera.framing] *
        FOCAL_EMPHASIS_SCALE,
      6,
    );
  });

  it("moves the anchors off the center line under a one-sided balance", () => {
    const canvas = { width: 1000, height: 500 };
    const left = placementsOf(
      specUnder({}, { balance: "left" }),
      canvas,
    )[0]!.anchor;
    const right = placementsOf(
      specUnder({}, { balance: "right" }),
      canvas,
    )[0]!.anchor;
    const center = placementsOf(
      specUnder({}, { balance: "center" }),
      canvas,
    )[0]!.anchor;
    expect(left.x).toBeCloseTo(center.x + BALANCE_SHIFT.left * canvas.width, 3);
    expect(right.x).toBeCloseTo(center.x + BALANCE_SHIFT.right * canvas.width, 3);
  });

  it("spreads the anchors away from the center line under an asymmetric balance", () => {
    const canvas = { width: 1000, height: 500 };
    const spec = specUnder({}, { balance: "center" });
    spec.objects = [
      { ...spec.objects[0]!, position: { x: 0.75, y: 0.5 } },
    ];
    const centered = placementsOf(spec, canvas)[0]!.anchor;
    const spread = placementsOf(
      { ...spec, composition: { ...spec.composition, balance: "asymmetric" } },
      canvas,
    )[0]!.anchor;
    expect(spread.x).toBeCloseTo(
      500 + (centered.x - 500) * (1 + ASYMMETRIC_SPREAD),
      3,
    );
    // An object that sits on the center line keeps its anchor there.
    spec.objects = [
      { ...spec.objects[0]!, position: { x: 0.5, y: 0.5 } },
    ];
    expect(placementsOf(
      { ...spec, composition: { ...spec.composition, balance: "asymmetric" } },
      canvas,
    )[0]!.anchor.x).toBe(500);
  });

  it("clamps an anchor the balance pushed off the canvas", () => {
    const spec = specUnder({}, { balance: "right" });
    spec.objects = [{ ...spec.objects[0]!, position: { x: 0.98, y: 0.5 } }];
    const [placement] = placementsOf(spec, { width: 1000, height: 500 });
    expect(placement?.anchor.x).toBe(1000);
    expect(placement?.positionClamped).toBe(true);
  });

  it("turns the anchors about the canvas center under a camera roll", () => {
    const canvas = { width: 1024, height: 768 };
    const spec = specUnder({}, { balance: "center" });
    spec.objects = [
      { ...spec.objects[0]!, position: { x: 0.75, y: 0.5 } },
    ];
    const level = placementsOf(spec, canvas)[0]!.anchor;
    const rolled = placementsOf(
      { ...spec, camera: { ...spec.camera, tilt: 8 } },
      canvas,
    )[0]!.anchor;
    const expected = rollPoint(
      level,
      { x: canvas.width / 2, y: canvas.height / 2 },
      8,
    );
    expect(rolled).toEqual({
      x: Math.round(expected.x * 1000) / 1000,
      y: Math.round(expected.y * 1000) / 1000,
    });
  });

});

describe("cloudCountOf", () => {
  it("reads the count from environment.sky.cloudCount", () => {
    const spec = validSceneSpec();
    expect(cloudCountOf(spec)).toBe(3);
    expect(
      cloudCountOf({ ...spec, environment: { type: "rural" } }),
    ).toBe(0);
    expect(
      cloudCountOf({
        ...spec,
        environment: { type: "rural", sky: {} },
      }),
    ).toBe(0);
  });

  it("rejects a count that is not an integer in range", () => {
    const spec = validSceneSpec();
    for (const cloudCount of [-1, 1.5, MAX_CLOUD_COUNT + 1, "three"]) {
      expect(() =>
        cloudCountOf({
          ...spec,
          environment: { type: "rural", sky: { cloudCount } },
        }),
      ).toThrow(/environment\.sky\.cloudCount must be an integer/);
    }
  });

  it("rejects a key the compiler does not read, by name", () => {
    const spec = validSceneSpec();
    expect(() =>
      cloudCountOf({
        ...spec,
        environment: { type: "rural", sky: { cloudCount: 3, cloudShape: "cumulus" } },
      }),
    ).toThrow(
      /environment\.sky\.cloudShape is not read by the compiler; environment\.sky accepts cloudCount only/,
    );
  });
});

describe("cloud cutouts", () => {
  it("places one cutout per cloud, each with its own stream", () => {
    const canvas = { width: 1024, height: 768 };
    const masks = cloudMasks(3, planRng("clouds"), canvas, 522.24);
    expect(masks.map((mask) => mask.id)).toEqual(["cloud-1", "cloud-2", "cloud-3"]);
    for (const mask of masks) {
      const ys = pathPoints(mask.path).map((point) => point.y);
      // The mass grows up from the base line and stays on the canvas.
      expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...ys)).toBeLessThanOrEqual(768);
    }
  });

  it("draws the identical cloud for the identical stream", () => {
    const center = { x: 200, y: 120 };
    const first = cloudPath(planRng("cloud-shape"), center, 160);
    const second = cloudPath(planRng("cloud-shape"), center, 160);
    expect(first).toEqual(second);
    expect(cloudPath(planRng("cloud-other"), center, 160)).not.toEqual(first);
  });

  it("closes the cloud along its flat base", () => {
    const path = cloudPath(planRng("cloud-shape"), { x: 200, y: 120 }, 160);
    expect(path.commands[path.commands.length - 1]?.command).toBe("close");
    expect(pathPoints(path)[0]?.y).toBe(120);
  });

  it("returns no masks for a clear sky", () => {
    expect(cloudMasks(0, planRng("clear"), { width: 1024, height: 768 }, 522)).toEqual([]);
  });
});

describe("planScene", () => {
  it("lays out the canvas, the horizon, and both region skeletons", () => {
    const spec = validSceneSpec();
    const plan = planScene(spec, resolvedStyle(), planRng("scene"));
    expect(plan.canvas).toEqual({ width: 1024, height: 768 });
    expect(plan.horizonY).toBe(0.68 * 768);
    expect(plan.regions.map((region) => region.id)).toEqual(["sky", "ground"]);
    expect(plan.regions[0]?.zIndex).toBe(0);
    expect(plan.regions[1]?.zIndex).toBe(1);
    // The sky stops at the horizon and the ground starts there.
    const groundYs = pathPoints(plan.regions[1]!.path).map((point) => point.y);
    expect(Math.min(...groundYs)).toBe(plan.horizonY);
  });

  it("carries the cloud cutouts of the environment", () => {
    const spec = validSceneSpec();
    const plan = planScene(spec, resolvedStyle(), planRng("scene"));
    expect(plan.masks).toHaveLength(3);
    expect(plan.depthOrder).toEqual(["tree-1"]);
  });

  it("plans the identical scene for the identical stream", () => {
    const spec = validSceneSpec();
    expect(planScene(spec, resolvedStyle(), planRng("scene"))).toEqual(
      planScene(spec, resolvedStyle(), planRng("scene")),
    );
  });

  it("plans a scene whose horizon moved with a recorded reason", () => {
    const spec = {
      ...validSceneSpec(),
      camera: { ...validSceneSpec().camera, horizonY: 0.9 },
    };
    const plan = planScene(spec, resolvedStyle(), planRng("scene"));
    expect(plan.horizon.horizonY).toBe(0.75);
    expect(plan.horizon.wasClamped).toBe(true);
    expect(plan.horizonY).toBe(0.75 * 768);
  });

  it("keeps the level horizon as the two rectangles the quads describe", () => {
    const spec = validSceneSpec();
    const plan = planScene(spec, resolvedStyle(), planRng("scene"));
    // A level camera plans the identical regions the rectangle builder wrote,
    // so a spec that carries no roll renders the layout it always rendered.
    expect(plan.regions[0]?.path).toEqual(
      rectanglePath(0, 0, plan.canvas.width, plan.horizonY),
    );
    expect(plan.regions[1]?.path).toEqual(
      rectanglePath(0, plan.horizonY, plan.canvas.width, plan.canvas.height - plan.horizonY),
    );
    expect(plan.horizonHeights).toEqual({
      left: plan.horizonY,
      right: plan.horizonY,
      center: plan.horizonY,
    });
  });

  it("rolls the horizon, the anchors, and the clouds with the camera", () => {
    const rolled = {
      ...validSceneSpec(),
      camera: { ...validSceneSpec().camera, tilt: 8 },
    };
    const level = validSceneSpec();
    const rolledPlan = planScene(rolled, resolvedStyle(), planRng("scene"));
    const levelPlan = planScene(level, resolvedStyle(), planRng("scene"));
    const heights = rolledHorizonHeights(
      levelPlan.horizonY,
      levelPlan.canvas,
      8,
    );
    expect(rolledPlan.horizonHeights).toEqual({
      left: round(heights.left),
      right: round(heights.right),
      center: round(heights.center),
    });
    // The sky and the ground share the rolled edge, and stay closed.
    const sky = pathPoints(rolledPlan.regions[0]!.path);
    const ground = pathPoints(rolledPlan.regions[1]!.path);
    expect(sky[2]).toEqual({ x: 1024, y: round(heights.right) });
    expect(sky[3]).toEqual({ x: 0, y: round(heights.left) });
    expect(ground[0]).toEqual({ x: 0, y: round(heights.left) });
    expect(ground[1]).toEqual({ x: 1024, y: round(heights.right) });
    // The anchors turn with the framing.
    expect(rolledPlan.placements[0]!.anchor).not.toEqual(
      levelPlan.placements[0]!.anchor,
    );
    // The clouds turn with the sky they sit in.
    expect(rolledPlan.masks[0]!.path).not.toEqual(levelPlan.masks[0]!.path);
    expect(rolledPlan.camera.tiltDegrees).toBe(8);
  });

  it("rejects a focal point that names no object of the scene", () => {
    const spec = validSceneSpec();
    spec.composition = { ...spec.composition, focalPoints: ["cottage-4"] };
    expect(() =>
      planScene(spec, resolvedStyle(), planRng("scene")),
    ).toThrow(/composition\.focalPoints names "cottage-4"/);
  });

  /** Round one length to whole milli-units, the way the planner does. */
  function round(value: number): number {
    return Math.round(value * 1000) / 1000;
  }
});

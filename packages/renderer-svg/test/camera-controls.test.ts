/**
 * Acceptance tests for the camera and composition controls (task T042).
 *
 * The scene schema accepts seven controls the compiler must honor:
 * `camera.framing`, `camera.lens`, `camera.tilt`,
 * `camera.perspectiveStrength`, `composition.balance`,
 * `composition.depthLayers`, and `composition.focalPoints`. A control that
 * only changes the spec hash changes the seeded stream, so the bytes drift
 * while the picture stays the same. These tests pin the layout each control
 * produces - the anchors and the scene regions of the intermediate
 * representation - so a control that goes inert fails on an exact number,
 * not on byte noise.
 */

import { describe, expect, it } from "vitest";

import {
  BALANCE_SHIFT,
  cameraDecisionOf,
  depthScaleOf,
  FOCAL_EMPHASIS_SCALE,
  FRAMING_SUBJECT_SCALE,
  rollPoint,
  type ObjectAnchor,
  type SceneSpec,
} from "@hatch/core";

import { createV1Engine } from "../src/index.js";
import { assertWellFormedXml } from "./xml-check.js";

/**
 * One scene over three draw planes: a hill behind, a pond and a tree at the
 * neutral plane, a cottage in front as the focal point. The camera and the
 * composition start centered and level, so every control moves the layout
 * away from one known baseline.
 */
function controlScene(
  patches: {
    camera?: Partial<SceneSpec["camera"]>;
    composition?: Partial<SceneSpec["composition"]>;
  } = {},
): SceneSpec {
  return {
    meta: {
      id: "camera-controls-0001",
      seed: 20261107,
      stylePreset: "pastoral-v1",
      aspectRatio: "4:3",
      version: "1.0.0",
    },
    camera: {
      framing: "medium",
      lens: "normal",
      horizonY: 0.68,
      ...patches.camera,
    },
    composition: {
      focalPoints: ["cottage-1"],
      balance: "center",
      negativeSpace: 0.35,
      depthLayers: 3,
      ...patches.composition,
    },
    environment: { type: "rural", sky: { cloudCount: 2 } },
    objects: [
      {
        id: "hill-1",
        kind: "hill",
        role: "background",
        position: { x: 0.3, y: 0.7 },
        scale: 2,
        params: { width: 300, height: 80 },
      },
      {
        id: "pond-1",
        kind: "water",
        role: "midground",
        position: { x: 0.45, y: 0.78 },
        scale: 1.5,
        params: { width: 360, depth: 90 },
      },
      {
        id: "cottage-1",
        kind: "house",
        role: "focal",
        position: { x: 0.62, y: 0.8 },
        scale: 1.5,
        params: { width: 150, wallHeight: 80, windows: 2, chimney: true },
      },
    ],
  } as SceneSpec;
}

/** The anchor of one object in one render, by object id. */
function anchorOf(anchors: readonly ObjectAnchor[], id: string): ObjectAnchor {
  const anchor = anchors.find((entry) => entry.objectId === id);
  if (anchor === undefined) {
    throw new Error(`test expected an anchor for "${id}"`);
  }
  return anchor;
}

/** Render one control scene and report the document and its anchors. */
function render(patches: Parameters<typeof controlScene>[0]) {
  const engine = createV1Engine();
  const spec = controlScene(patches);
  const result = engine.renderScene(spec);
  assertWellFormedXml(result.svg);
  return {
    spec,
    svg: result.svg,
    anchors: result.ir.anchors,
    regions: result.ir.regions,
    horizonY: result.ir.horizonY,
    horizonTilt: result.ir.horizonTilt,
  };
}

describe("the camera and the composition drive the render", () => {
  const baseline = render({});

  it("gives the baseline a level, centered layout", () => {
    expect(baseline.horizonTilt).toBeUndefined();
    expect(baseline.svg).toBe(createV1Engine().renderScene(controlScene()).svg);
  });

  it("camera.framing scales every subject by the framing ratio", () => {
    const close = render({ camera: { framing: "close" } });
    expect(close.svg).not.toBe(baseline.svg);
    for (const anchor of baseline.anchors) {
      const turned = anchorOf(close.anchors, anchor.objectId);
      expect(turned.scale).toBeCloseTo(
        anchor.scale * (FRAMING_SUBJECT_SCALE.close / FRAMING_SUBJECT_SCALE.medium),
        6,
      );
    }
  });

  it("camera.lens separates the planes the roles span", () => {
    const ultraWide = render({ camera: { lens: "ultra-wide" } });
    expect(ultraWide.svg).not.toBe(baseline.svg);
    // The hill behind the neutral plane shrinks, the cottage in front grows,
    // and the pond on the neutral plane holds its size.
    const hill = anchorOf(ultraWide.anchors, "hill-1").scale /
      anchorOf(baseline.anchors, "hill-1").scale;
    const pond = anchorOf(ultraWide.anchors, "pond-1").scale /
      anchorOf(baseline.anchors, "pond-1").scale;
    const cottage = anchorOf(ultraWide.anchors, "cottage-1").scale /
      anchorOf(baseline.anchors, "cottage-1").scale;
    expect(hill).toBeLessThan(1);
    expect(pond).toBeCloseTo(1, 6);
    expect(cottage).toBeGreaterThan(1);
  });

  it("camera.perspectiveStrength flattens the depth the lens draws", () => {
    const deep = render({ camera: { lens: "ultra-wide", perspectiveStrength: 1 } });
    const flat = render({ camera: { lens: "ultra-wide", perspectiveStrength: 0 } });
    expect(flat.svg).not.toBe(deep.svg);
    // A flattened strength returns every plane to the framing size, whatever
    // the lens carries: only the depth factor of the deep render comes off.
    for (const anchor of deep.anchors) {
      const factor = depthScaleOf(cameraDecisionOf(deep.spec), anchor.depth);
      expect(anchorOf(flat.anchors, anchor.objectId).scale).toBeCloseTo(
        anchor.scale / factor,
        6,
      );
    }
    // A half strength draws half the depth of the full one: the hill behind
    // the neutral plane shrinks towards its flat size, the cottage in front
    // grows towards its deep one.
    const half = render({
      camera: { lens: "ultra-wide", perspectiveStrength: 0.5 },
    });
    const hill = (anchors: readonly ObjectAnchor[]): number =>
      anchorOf(anchors, "hill-1").scale;
    const cottage = (anchors: readonly ObjectAnchor[]): number =>
      anchorOf(anchors, "cottage-1").scale;
    expect(hill(half.anchors)).toBeLessThan(hill(flat.anchors));
    expect(hill(half.anchors)).toBeGreaterThan(hill(deep.anchors));
    expect(cottage(half.anchors)).toBeGreaterThan(cottage(flat.anchors));
    expect(cottage(half.anchors)).toBeLessThan(cottage(deep.anchors));
  });

  it("camera.tilt rolls the anchors and the horizon with the framing", () => {
    const rolled = render({ camera: { tilt: 6 } });
    expect(rolled.svg).not.toBe(baseline.svg);
    expect(rolled.horizonTilt).toBe(6);
    const canvas = { width: 1024, height: 768 };
    for (const anchor of baseline.anchors) {
      const turned = anchorOf(rolled.anchors, anchor.objectId);
      const expected = rollPoint(anchor.position, {
        x: canvas.width / 2,
        y: canvas.height / 2,
      }, 6);
      expect(turned.position).toEqual({
        x: Math.round(expected.x * 1000) / 1000,
        y: Math.round(expected.y * 1000) / 1000,
      });
      // The roll leans the object, and the scale the framing set holds.
      expect(turned.scale).toBe(anchor.scale);
    }
    // The sky and the ground follow the rolled horizon, so the scene regions
    // the render draws are not the level ones.
    expect(rolled.regions[0]?.path).not.toEqual(baseline.regions[0]?.path);
    expect(rolled.regions[1]?.path).not.toEqual(baseline.regions[1]?.path);
  });

  it("composition.balance moves the layout off the center line", () => {
    const right = render({ composition: { balance: "right" } });
    expect(right.svg).not.toBe(baseline.svg);
    const shift = BALANCE_SHIFT.right * 1024;
    for (const anchor of baseline.anchors) {
      const moved = anchorOf(right.anchors, anchor.objectId);
      expect(moved.position.x).toBeCloseTo(anchor.position.x + shift, 3);
      expect(moved.position.y).toBe(anchor.position.y);
      expect(moved.scale).toBe(anchor.scale);
    }
  });

  it("composition.depthLayers flattens the stack onto one plane", () => {
    const flat = render({ composition: { depthLayers: 1 } });
    expect(flat.svg).not.toBe(baseline.svg);
    // One plane means no depth separation: every object draws at the framing
    // size, the focal emphasis apart.
    for (const anchor of baseline.anchors) {
      const depthFactor = depthScaleOf(
        cameraDecisionOf(baseline.spec),
        anchor.depth,
      );
      expect(anchorOf(flat.anchors, anchor.objectId).scale).toBeCloseTo(
        anchor.scale / depthFactor,
        6,
      );
    }
  });

  it("composition.focalPoints emphasizes the objects it names", () => {
    const plain = render({ composition: { focalPoints: [] } });
    expect(plain.svg).not.toBe(baseline.svg);
    expect(
      anchorOf(plain.anchors, "cottage-1").scale,
    ).toBeCloseTo(
      anchorOf(baseline.anchors, "cottage-1").scale / FOCAL_EMPHASIS_SCALE,
      6,
    );
    // An object the composition does not name keeps its size.
    expect(anchorOf(plain.anchors, "pond-1").scale).toBe(
      anchorOf(baseline.anchors, "pond-1").scale,
    );
  });

  it("rejects a focal point that names no object", () => {
    const engine = createV1Engine();
    expect(() =>
      engine.renderScene(
        controlScene({ composition: { focalPoints: ["boathouse-9"] } }),
      ),
    ).toThrow(/composition\.focalPoints names "boathouse-9"/);
  });

  it("renders the same layout twice for the same controls", () => {
    const again = render({ camera: { tilt: -4 }, composition: { balance: "left" } });
    const repeated = render({ camera: { tilt: -4 }, composition: { balance: "left" } });
    expect(repeated.svg).toBe(again.svg);
    expect(repeated.anchors).toEqual(again.anchors);
  });
});

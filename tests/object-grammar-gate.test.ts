/**
 * The object grammar gate (task T043, specification sections 3C, 8, and 18).
 *
 * The `objectGrammar` section is required by the StyleSpec schema and
 * defined by every shipped preset, so the compiler must read it. This gate
 * is the executable form of the finding that closed task T043: before the
 * wiring, a `styleOverrides` block that replaced the whole section with
 * flipped values left the render at the same region count and the same
 * contour count, with the stroke count drifting on the seed shift alone -
 * the section moved the spec hash, the hash moved the streams, and the
 * picture stayed the same.
 *
 * The gate renders one example scene three ways:
 *
 * 1. the scene as written,
 * 2. a control that carries an override block holding the preset's own
 *    values, which isolates the seed drift from the grammar values,
 * 3. the flipped grammar of the finding: abstraction 0.99, one mark per
 *    object, roundness 0.99, and no kept negative space.
 *
 * The control holds every drift-invariant fact of the baseline: an
 * override block alone moves bytes - the streams move with the spec hash -
 * and it may drop or add the odd boundary a generator draws only when its
 * stream lands a wave or a crack inside the silhouette, but it never
 * moves a count by a margin. The flipped render must move the structure
 * by a margin: many fewer contour strokes through the detail budget, no
 * cloud cutouts through the dropped negative space, and a rounder
 * silhouette on the cottage, the one object whose generator draws no
 * random number, so its geometry answers the grammar alone.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  createStageRng,
  planScene,
  renderIdentityOf,
  type Geometry,
  type ResolvedStyleSpec,
  type SceneSpec,
} from "@hatch/core";
import { generateSceneObject } from "@hatch/objects";
import { pathArea } from "@hatch/geometry";
import { createV1Engine } from "@hatch/renderer-svg";

/** The repository root, one level above this file's `tests/` directory. */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The scene of the finding: a cottage behind a creek, clouds over the sky. */
const scenePath = path.join(repoRoot, "examples", "scenes", "pastoral-creek-0001.json");

/** The id of the cottage, the deterministic object of the scene. */
const COTTAGE_ID = "cottage-1";

/** The flipped object grammar of the original finding. */
const FLIPPED_GRAMMAR = {
  abstractionLevel: 0.99,
  maxDetailPerObject: 1,
  edgeRoundnessBias: 0.99,
  keepNegativeSpace: false,
} as const;

/** The grammar the scene's preset states, filled once the baseline ran. */
let BASELINE_GRAMMAR: Record<string, number | boolean> = {};

/**
 * One override block that flips a single grammar field.
 *
 * A style override carries whole sections, so the block states the whole
 * grammar of the baseline render with one field replaced - the same rule
 * the finding used to flip all four fields at once.
 */
function grammarOverride(
  field: keyof typeof FLIPPED_GRAMMAR,
  value: number | boolean,
): { objectGrammar: Record<string, number | boolean> } {
  return {
    objectGrammar: { ...BASELINE_GRAMMAR, [field]: value },
  };
}

describe("the object grammar gate (task T043)", () => {
  const engine = createV1Engine();
  const scene = JSON.parse(readFileSync(scenePath, "utf8")) as SceneSpec;

  const baseline = engine.renderScene(scene);
  // The resolved style of the baseline render carries the grammar the
  // preset states, so the control overrides with the values already in
  // force - the override mechanism runs, the values stay put.
  BASELINE_GRAMMAR = { ...baseline.ir.style.objectGrammar };
  const control = engine.renderScene({
    ...scene,
    styleOverrides: { objectGrammar: baseline.ir.style.objectGrammar },
  });
  const flipped = engine.renderScene({
    ...scene,
    styleOverrides: { objectGrammar: FLIPPED_GRAMMAR },
  });

  it("renders the scene with clouds and object detail to work on", () => {
    expect(baseline.ir.masks.length).toBeGreaterThan(0);
    expect(baseline.ir.contours.length).toBeGreaterThan(0);
  });

  it("holds the drift-invariant structure under a value-identical override", () => {
    // The override block changes the spec hash, so the streams move and
    // the bytes drift. The region stack and the cloud cutouts stay.
    expect(control.ir.regions).toHaveLength(baseline.ir.regions.length);
    expect(control.ir.masks).toHaveLength(baseline.ir.masks.length);
    expect(control.svg).not.toBe(baseline.svg);
  });

  it("drops the detail marks the flipped budget does not allow", () => {
    // A ceiling of one mark at abstraction 0.99 leaves no internal
    // boundary, so every boundary stroke leaves the contour layer. The
    // margin stands far over the one or two marks a stream shift moves.
    expect(flipped.ir.contours.length).toBeLessThanOrEqual(
      control.ir.contours.length - 10,
    );
  });

  it("fills the clouds when the grammar keeps no negative space", () => {
    expect(flipped.ir.masks).toHaveLength(0);
    expect(control.ir.masks.length).toBeGreaterThan(0);
  });

  it("rounds the silhouette of the cottage under a high bias", () => {
    // The cottage generator draws no random number (buildings stay
    // controlled, section 17), so its placed geometry answers the grammar
    // alone: same stream label, same shape, rounder corners. The render
    // with the flipped bias is only the style holder; its streams never
    // reach the cottage.
    const roundRender = engine.renderScene({
      ...scene,
      styleOverrides: grammarOverride("edgeRoundnessBias", 0.99),
    });
    const sharp = cottageGeometry(control.sceneSpec, control.ir.style);
    const round = cottageGeometry(
      roundRender.sceneSpec,
      roundRender.ir.style,
    );
    // The union the house builds already carries curve commands, so the
    // bias does not grow a count; it cuts the corners, and every cut
    // removes area from the mass the silhouette covers.
    expect(pathArea(round.silhouette)).toBeLessThan(pathArea(sharp.silhouette));
    expect(round.contours).toHaveLength(sharp.contours.length);
    expect(JSON.stringify(round.silhouette)).not.toBe(
      JSON.stringify(sharp.silhouette),
    );
  });

  it("records the grammar decision in the planning trace", () => {
    const planning = flipped.trace.events.find(
      (event) => event.stage === "planning",
    );
    const data = planning?.data as Record<string, unknown> | undefined;
    expect(data?.objectGrammar).toMatchObject({
      ...FLIPPED_GRAMMAR,
      detailBudget: 0,
    });
  });

  it("stays deterministic under the flipped grammar", () => {
    const again = engine.renderScene({
      ...scene,
      styleOverrides: { objectGrammar: FLIPPED_GRAMMAR },
    });
    expect(again.svg).toBe(flipped.svg);
  });
});

/**
 * The placed geometry of the cottage of one spec, rebuilt the way the
 * engine built it: the public planning and geometry entries under the
 * streams of the same identity, against the resolved style of the render
 * the spec came from.
 */
function cottageGeometry(spec: SceneSpec, style: ResolvedStyleSpec): Geometry {
  const identity = renderIdentityOf(spec);
  const plan = planScene(spec, style, createStageRng(identity, "planning"));
  const placement = plan.placements.find(
    (entry) => entry.object.id === COTTAGE_ID,
  );
  if (placement === undefined) {
    throw new Error(`the scene names no object "${COTTAGE_ID}"`);
  }
  return generateSceneObject({
    object: placement.object,
    anchor: placement.anchor,
    camera: placement.camera,
    rng: createStageRng(identity, "geometry"),
    objectGrammar: style.objectGrammar,
  });
}

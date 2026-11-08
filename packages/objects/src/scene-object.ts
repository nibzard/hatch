/**
 * Scene object synthesis (specification sections 4C and 6).
 *
 * The geometry synthesis stage of the compiler walks the objects of a
 * scene spec and asks this package for the geometry of each one. This
 * facade holds the whole contract in one call: it resolves the generator,
 * parses the semantic parameters, forks the render stream under the object
 * id, builds the geometry in the local frame of the object, enforces the
 * object grammar of the style over it, places it in the scene, and reports
 * how many marks the grammar dropped, so the trace can state the omission
 * (specification section 9B).
 *
 * Each object forks its own stream under its id, so adding an object or
 * changing one never shifts the numbers another object draws
 * (specification section 10).
 */

import {
  detailBudgetOf,
  objectGrammarDetailOf,
  type GeneratedObjectGeometry,
  type ObjectGrammar,
  type Point,
  type PlacementCamera,
  type SceneObject,
  type SeededRng,
} from "@hatch/core";

import { objectGenerator, validateGeometry } from "./generator.js";
import { applyObjectGrammar } from "./grammar.js";
import { placementOf, transformGeometry } from "./placement.js";

/** What one scene object needs to become geometry. */
export interface SceneObjectRequest {
  /** The scene object from the spec: id, kind, scale, rotation, params. */
  readonly object: SceneObject;
  /**
   * Where the local origin of the object lands, in SVG user units. Each
   * generator documents its origin: the ground center of a house, the
   * trunk foot of a tree, the shoreline center of a water band.
   */
  readonly anchor: Point;
  /**
   * The placement transform the camera computed: the scale of the object
   * under the framing, the depth plane, and the focal emphasis, and the
   * rotation of the object plus the camera roll. Absent means the object
   * draws at the scale and the rotation the spec states.
   */
  readonly camera?: PlacementCamera;
  /** The seeded stream of the render. */
  readonly rng: SeededRng;
  /**
   * The object grammar of the resolved style (specification section 8).
   * The facade enforces it over the geometry the generator returns: the
   * detail budget over the internal boundaries, the corner rounding over
   * every polyline the object draws. Absent means no grammar, so the
   * geometry leaves the generator as authored.
   */
  readonly objectGrammar?: ObjectGrammar;
}

/**
 * Build the geometry of one placed scene object, and report what its
 * grammar omitted.
 *
 * Throws one readable error when the kind is outside the registry or when a
 * parameter sits outside its range.
 *
 * The returned value is the placed geometry, carrying one extra key:
 * `grammarDetail`, the internal boundary count the generator emitted and
 * the count the grammar kept (specification section 9B). The geometry
 * synthesis stage lifts the key off the geometry and records it in the
 * trace, so what the style simplified away stays countable. A request with
 * no grammar reports nothing, because nothing was omitted.
 */
export function generateSceneObject(
  request: SceneObjectRequest,
): GeneratedObjectGeometry {
  const { object } = request;
  const generator = objectGenerator(object.kind);
  const parameters = generator.parseParameters(object.params);
  const local = generator.generate(parameters, {
    rng: objectStream(request.rng, object.id),
    ...(request.objectGrammar === undefined
      ? {}
      : { grammar: request.objectGrammar }),
  });
  const governed =
    request.objectGrammar === undefined
      ? local
      : applyObjectGrammar(local, request.objectGrammar);
  const placed = transformGeometry(
    governed,
    placementOf(object, request.anchor, request.camera),
  );
  const validated = validateGeometry(object.kind, placed);
  return request.objectGrammar === undefined
    ? validated
    : {
        ...validated,
        grammarDetail: objectGrammarDetailOf(
          local.internalBoundaries.length,
          governed.internalBoundaries.length,
          detailBudgetOf(request.objectGrammar),
        ),
      };
}

/**
 * The stream one object draws from.
 *
 * The fork escapes the label, so no id can collide with the label of
 * another stream, whatever characters it holds.
 */
export function objectStream(rng: SeededRng, objectId: string): SeededRng {
  return rng.fork(`object:${objectId}`);
}

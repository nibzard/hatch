/**
 * The object generator contract (specification sections 6 and 11).
 *
 * An object is never "just SVG paths" (specification section 6). A
 * generator maps semantic parameters to a Geometry: a silhouette, contour
 * lines, internal boundaries, and style zones. The style application
 * stage turns the zones into filled regions and the renderer draws them,
 * which keeps every object reusable, inspectable, and testable.
 *
 * This module holds the shared contract and the registry of the shipped
 * generators: the five V1 objects of specification section 24 (house, tree,
 * hill, mountain, water), the twelve round 2 objects the same section lists
 * under "object library expansion" (the skatepark objects bowl, quarter
 * pipe, handrail, skater, fence, and bench, and the urban objects tram,
 * building block, streetlight, car, road, and lamp post), and the coastal
 * objects of sections 1, 5, and 14: lighthouse, cliff, and rock.
 */

import {
  formatIssues,
  GeometrySchema,
  type Geometry,
  type JsonObject,
  type ObjectGrammar,
  type SeededRng,
} from "@hatch/core";

import { benchGenerator } from "./bench.js";
import { bowlGenerator } from "./bowl.js";
import { buildingBlockGenerator } from "./building-block.js";
import { carGenerator } from "./car.js";
import { cliffGenerator } from "./cliff.js";
import { fenceGenerator } from "./fence.js";
import { handrailGenerator } from "./handrail.js";
import { hillGenerator } from "./hill.js";
import { houseGenerator } from "./house.js";
import { lampPostGenerator } from "./lamp-post.js";
import { lighthouseGenerator } from "./lighthouse.js";
import { mountainGenerator } from "./mountain.js";
import { quarterPipeGenerator } from "./quarter-pipe.js";
import { roadGenerator } from "./road.js";
import { rockGenerator } from "./rock.js";
import { skaterGenerator } from "./skater.js";
import { streetlightGenerator } from "./streetlight.js";
import { tramGenerator } from "./tram.js";
import { treeGenerator } from "./tree.js";
import { waterGenerator } from "./water.js";
import type { ParameterSpace } from "./parameters.js";
import type { StyleZoneRole } from "./roles.js";

/** The options every generator receives. */
export interface GenerateOptions {
  /**
   * The seeded stream of this object. Generators fork their own streams
   * under stable labels, so the same parameters and the same stream always
   * give the same geometry (specification section 10).
   */
  readonly rng: SeededRng;
  /**
   * The object grammar of the resolved style (specification section 8).
   * The scene object facade applies the shared grammar pass over the
   * geometry every generator returns, so no generator needs to count its
   * own detail marks or round its own corners. A generator reads the
   * grammar only where the pass cannot: the house, for example, subtracts
   * its openings from the wall zone while it builds them, so it asks the
   * grammar whether they stay paper (`keepNegativeSpace`). Absent means
   * the caller set no grammar and the generator draws its own limits.
   */
  readonly grammar?: ObjectGrammar;
}

/**
 * One semantic object generator (specification section 6).
 *
 * The interface keeps the parameter type erased, so one registry holds
 * every generator. Each module also exports a typed `generate` function
 * for callers that want the checked parameters of one object.
 */
export interface ObjectGenerator {
  /** The `kind` value of a scene object this generator serves. */
  readonly kind: string;
  /** One line on the object. */
  readonly title: string;
  /** Every style zone role the generator emits. */
  readonly zoneRoles: readonly StyleZoneRole[];
  /** The parameter space: the range and the default of every knob. */
  readonly parameterSpace: ParameterSpace;
  /** The default parameters, the same values the space states. */
  readonly defaultParameters: JsonObject;
  /**
   * Parse raw scene params: defaults for missing fields, readable errors
   * for out-of-range fields, unknown fields dropped.
   */
  parseParameters(raw: unknown): JsonObject;
  /** Build the geometry in the local frame of the object. */
  generate(parameters: JsonObject, options: GenerateOptions): Geometry;
}

/**
 * Check one geometry against the core schema.
 *
 * A generator that emits a malformed path fails here, at the source, with
 * the field named - not later in the renderer.
 */
export function validateGeometry(kind: string, geometry: Geometry): Geometry {
  const parsed = GeometrySchema.safeParse(geometry);
  if (!parsed.success) {
    throw new Error(
      `the ${kind} generator built invalid geometry: ${formatIssues(
        parsed.error.issues,
      )}`,
    );
  }
  return parsed.data;
}

/** The object kinds of the first release (specification section 24). */
export const V1_OBJECT_KINDS = [
  "house",
  "tree",
  "hill",
  "mountain",
  "water",
] as const;

/** One object kind of the first release. */
export type V1ObjectKind = (typeof V1_OBJECT_KINDS)[number];

/** The skatepark object kinds of round 2 (specification sections 5 and 24). */
export const SKATEPARK_OBJECT_KINDS = [
  "bowl",
  "quarter-pipe",
  "handrail",
  "skater",
  "fence",
  "bench",
] as const;

/** One skatepark object kind. */
export type SkateparkObjectKind = (typeof SKATEPARK_OBJECT_KINDS)[number];

/** The urban object kinds of round 2 (specification sections 5 and 24). */
export const URBAN_OBJECT_KINDS = [
  "tram",
  "building-block",
  "streetlight",
  "car",
  "road",
  "lamp-post",
] as const;

/** One urban object kind. */
export type UrbanObjectKind = (typeof URBAN_OBJECT_KINDS)[number];

/** Every object kind round 2 adds to the library. */
export const V2_OBJECT_KINDS = [
  ...SKATEPARK_OBJECT_KINDS,
  ...URBAN_OBJECT_KINDS,
] as const;

/** One object kind of round 2. */
export type V2ObjectKind = (typeof V2_OBJECT_KINDS)[number];

/**
 * The coastal object kinds: the lighthouse, the cliff, and the rock
 * (specification sections 1, 5, 11, 14, and 16).
 *
 * The coastal preset of round 2 already tunes the families these kinds
 * fill, so the coastal intent of sections 1 and 14 renders from the round
 * that asks for it.
 */
export const COASTAL_OBJECT_KINDS = [
  "lighthouse",
  "cliff",
  "rock",
] as const;

/** One coastal object kind. */
export type CoastalObjectKind = (typeof COASTAL_OBJECT_KINDS)[number];

/** Every object kind the registry ships, V1 first, round 2 after. */
export const OBJECT_KINDS = [
  ...V1_OBJECT_KINDS,
  ...V2_OBJECT_KINDS,
  ...COASTAL_OBJECT_KINDS,
] as const;

/** One object kind of the registry. */
export type ObjectKind = (typeof OBJECT_KINDS)[number];

/**
 * Kind names the specification states for an object this registry serves
 * under a different name. A scene written straight from specification
 * section 5 or 11 resolves through this table.
 */
export const OBJECT_KIND_ALIASES: Readonly<Record<string, ObjectKind>> = {
  // Specification sections 5 and 11 name the handrail `rail`.
  rail: "handrail",
  // Specification section 11 names the building block `building block`.
  building: "building-block",
  // Specification section 11 names the house `cottage`.
  cottage: "house",
};

/** Every generator, keyed by object kind. */
export const objectGenerators: Record<ObjectKind, ObjectGenerator> = {
  house: houseGenerator,
  tree: treeGenerator,
  hill: hillGenerator,
  mountain: mountainGenerator,
  water: waterGenerator,
  bowl: bowlGenerator,
  "quarter-pipe": quarterPipeGenerator,
  handrail: handrailGenerator,
  skater: skaterGenerator,
  fence: fenceGenerator,
  bench: benchGenerator,
  tram: tramGenerator,
  "building-block": buildingBlockGenerator,
  streetlight: streetlightGenerator,
  car: carGenerator,
  road: roadGenerator,
  "lamp-post": lampPostGenerator,
  lighthouse: lighthouseGenerator,
  cliff: cliffGenerator,
  rock: rockGenerator,
};

/** True when `kind` names one of the shipped objects. */
export function isObjectKind(kind: string): kind is ObjectKind {
  return (OBJECT_KINDS as readonly string[]).includes(kind);
}

/**
 * Look up the generator of one object kind.
 *
 * Resolves the alias table first, so a scene that names the specification
 * kind still finds its generator. Throws one readable error that lists
 * every shipped kind, so an agent that asks for a later-round object learns
 * what exists.
 */
export function objectGenerator(kind: string): ObjectGenerator {
  const alias = OBJECT_KIND_ALIASES[kind];
  const resolved = alias ?? kind;
  if (!isObjectKind(resolved)) {
    throw new Error(
      `unknown object kind "${kind}"; the object kinds are ` +
        OBJECT_KINDS.join(", "),
    );
  }
  return objectGenerators[resolved];
}

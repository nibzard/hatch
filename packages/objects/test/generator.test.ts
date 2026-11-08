/**
 * Tests for the object registry and the scene object facade the geometry
 * synthesis stage calls.
 */

import { describe, expect, it } from "vitest";

import { createRng, type SceneObject } from "@hatch/core";
import { pathBounds } from "@hatch/geometry";

import {
  generateSceneObject,
  objectStream,
} from "../src/scene-object.js";
import {
  OBJECT_KINDS,
  OBJECT_KIND_ALIASES,
  objectGenerators,
  objectGenerator,
  isObjectKind,
  COASTAL_OBJECT_KINDS,
  SKATEPARK_OBJECT_KINDS,
  URBAN_OBJECT_KINDS,
  V1_OBJECT_KINDS,
  V2_OBJECT_KINDS,
} from "../src/generator.js";

import { geometryJson, testRng } from "./sweep.js";

/** One scene object of a given kind. */
function sceneObject(
  kind: string,
  id: string,
  params?: SceneObject["params"],
): SceneObject {
  return {
    id,
    kind,
    position: { x: 0.5, y: 0.6 },
    scale: 1,
    ...(params === undefined ? {} : { params }),
  };
}

describe("the object registry", () => {
  it("lists the five V1 objects of specification section 24", () => {
    expect([...V1_OBJECT_KINDS]).toEqual([
      "house",
      "tree",
      "hill",
      "mountain",
      "water",
    ]);
  });

  it("adds the six skatepark objects of round 2", () => {
    expect([...SKATEPARK_OBJECT_KINDS]).toEqual([
      "bowl",
      "quarter-pipe",
      "handrail",
      "skater",
      "fence",
      "bench",
    ]);
  });

  it("adds the six urban objects of round 2", () => {
    expect([...URBAN_OBJECT_KINDS]).toEqual([
      "tram",
      "building-block",
      "streetlight",
      "car",
      "road",
      "lamp-post",
    ]);
  });

  it("adds the three coastal objects of the specification", () => {
    expect([...COASTAL_OBJECT_KINDS]).toEqual(["lighthouse", "cliff", "rock"]);
  });

  it("holds every shipped kind exactly once", () => {
    expect([...OBJECT_KINDS]).toHaveLength(20);
    expect(new Set(OBJECT_KINDS).size).toBe(OBJECT_KINDS.length);
    expect([...V2_OBJECT_KINDS]).toEqual([
      ...SKATEPARK_OBJECT_KINDS,
      ...URBAN_OBJECT_KINDS,
    ]);
  });

  it("answers the kind check and names every kind on a miss", () => {
    expect(isObjectKind("house")).toBe(true);
    expect(isObjectKind("bowl")).toBe(true);
    // The coastal kinds of specification sections 1, 5, and 14 resolve.
    expect(isObjectKind("lighthouse")).toBe(true);
    expect(isObjectKind("cliff")).toBe(true);
    expect(isObjectKind("rock")).toBe(true);
    expect(isObjectKind("volcano")).toBe(false);
    expect(() => objectGenerator("volcano")).toThrowError(
      /unknown object kind "volcano".*house, tree, hill, mountain, water,/,
    );
  });

  it("resolves the kind names the specification states", () => {
    expect(objectGenerator("rail").kind).toBe("handrail");
    expect(objectGenerator("building").kind).toBe("building-block");
    expect(objectGenerator("cottage").kind).toBe("house");
    expect(OBJECT_KIND_ALIASES.rail).toBe("handrail");
    expect(OBJECT_KIND_ALIASES.cottage).toBe("house");
  });

  it("gives every generator the same contract pieces", () => {
    for (const kind of OBJECT_KINDS) {
      const generator = objectGenerators[kind];
      expect(generator.kind).toBe(kind);
      expect(generator.title.length).toBeGreaterThan(0);
      expect(Object.keys(generator.parameterSpace).length).toBeGreaterThan(0);
      expect(generator.zoneRoles.length).toBeGreaterThan(0);
      expect(generator.defaultParameters).toEqual(
        generator.parseParameters(undefined),
      );
    }
  });
});

describe("generateSceneObject", () => {
  it("places each object at its anchor in scene units", () => {
    const anchor = { x: 512, y: 600 };
    const geometry = generateSceneObject({
      object: sceneObject("house", "house-1"),
      anchor,
      rng: testRng("scene:house"),
    });
    const bounds = pathBounds(geometry.silhouette);
    // The house stands on the ground line of the anchor.
    expect(bounds.maxY).toBeCloseTo(anchor.y, 6);
    expect(bounds.minX).toBeLessThan(anchor.x);
    expect(bounds.maxX).toBeGreaterThan(anchor.x);
  });

  it("scales the local units with the object scale", () => {
    const anchor = { x: 0, y: 0 };
    const small = generateSceneObject({
      object: { ...sceneObject("house", "h1"), scale: 1 },
      anchor,
      rng: testRng("scene:scale"),
    });
    const large = generateSceneObject({
      object: { ...sceneObject("house", "h2"), scale: 3 },
      anchor,
      rng: testRng("scene:scale"),
    });
    expect(pathBounds(large.silhouette).width).toBeCloseTo(
      pathBounds(small.silhouette).width * 3,
      4,
    );
  });

  it("draws under the placement transform the camera computed", () => {
    const anchor = { x: 512, y: 600 };
    const plain = generateSceneObject({
      object: sceneObject("house", "house-1"),
      anchor,
      rng: testRng("scene:camera"),
    });
    // The framing, the depth plane, and the focal emphasis the planner folds
    // into one scale, with no roll to blur the measurement.
    const framed = generateSceneObject({
      object: sceneObject("house", "house-1"),
      anchor,
      camera: { scale: 1.5, rotation: 0 },
      rng: testRng("scene:camera"),
    });
    expect(pathBounds(framed.silhouette).width).toBeCloseTo(
      pathBounds(plain.silhouette).width * 1.5,
      4,
    );
    expect(pathBounds(framed.silhouette).height).toBeCloseTo(
      pathBounds(plain.silhouette).height * 1.5,
      4,
    );
    // The roll the camera adds turns the object about its own anchor, so the
    // same mass lands in a different bounding box on the same footprint.
    const rolled = generateSceneObject({
      object: sceneObject("house", "house-1"),
      anchor,
      camera: { scale: 1, rotation: 20 },
      rng: testRng("scene:camera"),
    });
    expect(pathBounds(rolled.silhouette).width).not.toBeCloseTo(
      pathBounds(plain.silhouette).width,
      2,
    );
    expect(pathBounds(rolled.silhouette).maxY).toBeGreaterThan(anchor.y + 1);
  });

  it("parses the semantic parameters of the object", () => {
    const geometry = generateSceneObject({
      object: sceneObject("tree", "tree-1", { canopyRadius: 80, canopyLobes: 5 }),
      anchor: { x: 100, y: 100 },
      rng: testRng("scene:tree"),
    });
    expect(geometry.styleZones.map((zone) => zone.role)).toEqual(["foliage"]);
  });

  it("builds every round 2 kind through the same facade", () => {
    for (const kind of V2_OBJECT_KINDS) {
      const geometry = generateSceneObject({
        object: sceneObject(kind, `${kind}-1`),
        anchor: { x: 512, y: 600 },
        rng: testRng(`scene:${kind}`),
      });
      expect(geometry.silhouette.commands.length, kind).toBeGreaterThan(0);
      expect(geometry.styleZones.length, kind).toBeGreaterThan(0);
    }
  });

  it("builds every coastal kind through the same facade", () => {
    for (const kind of COASTAL_OBJECT_KINDS) {
      const geometry = generateSceneObject({
        object: sceneObject(kind, `${kind}-1`),
        anchor: { x: 512, y: 600 },
        rng: testRng(`scene:${kind}`),
      });
      expect(geometry.silhouette.commands.length, kind).toBeGreaterThan(0);
      expect(geometry.styleZones.length, kind).toBeGreaterThan(0);
    }
  });

  it("throws a readable error for a kind outside the registry", () => {
    expect(() =>
      generateSceneObject({
        object: sceneObject("volcano", "volcano-1"),
        anchor: { x: 0, y: 0 },
        rng: testRng("scene:volcano"),
      }),
    ).toThrowError(/unknown object kind "volcano"/);
  });

  it("replays the identical geometry from the same seed", () => {
    const request = {
      object: sceneObject("tree", "tree-1"),
      anchor: { x: 200, y: 300 },
      rng: createRng("scene:determinism"),
    };
    const first = generateSceneObject(request);
    const second = generateSceneObject({
      ...request,
      rng: createRng("scene:determinism"),
    });
    expect(geometryJson(second)).toBe(geometryJson(first));
  });

  it("forks one stream per object id", () => {
    const base = createRng("scene:fork");
    const left = objectStream(base, "tree-left");
    const right = objectStream(base, "tree-right");
    // Two different ids give two different streams...
    expect(left.seedKey).not.toBe(right.seedKey);
    // ...and the same id gives the same stream whatever else drew.
    expect(objectStream(base, "tree-left").seedKey).toBe(left.seedKey);
    // Ids that would collide as raw fork labels stay apart.
    expect(objectStream(base, "a/b").seedKey).not.toBe(
      objectStream(base, "a").seedKey,
    );
  });

  it("draws each object from its own stream, not the scene order", () => {
    const treeA = sceneObject("tree", "tree-a");
    const treeB = sceneObject("tree", "tree-b");
    const rng = testRng("scene:order");
    const firstAlone = generateSceneObject({
      object: treeA,
      anchor: { x: 0, y: 0 },
      rng,
    });
    const afterAnother = generateSceneObject({
      object: treeA,
      anchor: { x: 0, y: 0 },
      rng: (() => {
        // Burn numbers through another object first.
        const stream = testRng("scene:order");
        generateSceneObject({
          object: treeB,
          anchor: { x: 0, y: 0 },
          rng: stream,
        });
        return stream;
      })(),
    });
    expect(geometryJson(afterAnother)).toBe(geometryJson(firstAlone));
  });
});

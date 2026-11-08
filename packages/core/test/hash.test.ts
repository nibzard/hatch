/**
 * Tests for canonical JSON and the scene spec hash.
 *
 * The digest implementation is plain code inside this package, so the test
 * suite checks it against `node:crypto` on every shape that matters: the
 * empty string, one block, several blocks, multi-byte UTF-8, and the
 * canonical JSON of a real spec. A wrong constant or a lost carry fails
 * here, not in a rendered scene.
 */

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  canonicalJson,
  hashJsonValue,
  sceneSpecHash,
  sha256Hex,
  type JsonValue,
} from "../src/index.js";
import { validSceneSpec } from "./fixtures.js";

/** The SHA-256 digest of one string, as Node computes it. */
function nodeSha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

describe("canonicalJson", () => {
  it("sorts object keys, whatever order they arrive in", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalJson({ a: 2, b: 1 })).toBe('{"a":2,"b":1}');
  });

  it("sorts the keys of nested objects and keeps array order", () => {
    expect(canonicalJson({ outer: { z: 1, a: [3, 1, 2] } })).toBe(
      '{"outer":{"a":[3,1,2],"z":1}}',
    );
  });

  it("writes one spelling per scalar", () => {
    expect(canonicalJson(null)).toBe("null");
    expect(canonicalJson(true)).toBe("true");
    expect(canonicalJson(1.5)).toBe("1.5");
    expect(canonicalJson("text")).toBe('"text"');
  });

  it("drops a key whose value is undefined, like JSON.stringify", () => {
    expect(
      canonicalJson({ a: 1, b: undefined } as unknown as JsonValue),
    ).toBe('{"a":1}');
  });

  it("writes the same text for two specs that differ only in key order", () => {
    const spec = validSceneSpec();
    const reordered = {
      composition: spec.composition,
      camera: spec.camera,
      objects: spec.objects,
      meta: spec.meta,
      environment: spec.environment,
    };
    expect(canonicalJson(reordered)).toBe(canonicalJson(spec));
  });
});

describe("sha256Hex", () => {
  it.each([
    ["the empty string", ""],
    ["one short block", "abc"],
    ["multi-byte UTF-8", "çé你好，hatch"],
    ["many blocks", "hatch".repeat(400)],
    ["canonical JSON of a spec", canonicalJson(validSceneSpec())],
  ])("matches node:crypto for %s", (_label, input) => {
    expect(sha256Hex(input)).toBe(nodeSha256(input));
  });

  it("writes 64 lowercase hex characters", () => {
    expect(sha256Hex("hatch")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("sceneSpecHash", () => {
  it("names its algorithm and digests the canonical spec", () => {
    const spec = validSceneSpec();
    const hash = sceneSpecHash(spec);
    expect(hash).toBe(`sha256:${nodeSha256(canonicalJson(spec))}`);
  });

  it("hashes the same scene whatever key order the input used", () => {
    const spec = validSceneSpec();
    const reordered = {
      composition: spec.composition,
      camera: spec.camera,
      objects: spec.objects,
      meta: spec.meta,
      environment: spec.environment,
    };
    expect(sceneSpecHash(reordered as typeof spec)).toBe(sceneSpecHash(spec));
  });

  it("changes when the scene changes", () => {
    const spec = validSceneSpec();
    const moved = {
      ...spec,
      objects: spec.objects.map((object) => ({
        ...object,
        position: { x: 0.2, y: object.position.y },
      })),
    };
    expect(sceneSpecHash(moved)).not.toBe(sceneSpecHash(spec));
  });

  describe("the debug block", () => {
    it("stays out of the hash, whatever flags it switches on", () => {
      const spec = validSceneSpec();
      expect(
        sceneSpecHash({ ...spec, debug: { showRegions: true, showAnchors: true } }),
      ).toBe(sceneSpecHash(spec));
    });

    it("makes every spelling of all-off agree with no block at all", () => {
      const spec = validSceneSpec();
      for (const debug of [
        {},
        { showRegions: false, showAnchors: false, showDepthMap: false },
      ]) {
        expect(sceneSpecHash({ ...spec, debug })).toBe(sceneSpecHash(spec));
      }
    });

    it("keeps the hash of a spec that carries no block unchanged", () => {
      // The debug block is the only field the hash leaves out, so a spec
      // without one digests its own canonical form, nothing narrower.
      const spec = validSceneSpec();
      expect(sceneSpecHash(spec)).toBe(
        `sha256:${nodeSha256(canonicalJson(spec))}`,
      );
    });
  });

  it("exposes the digest through hashJsonValue for any JSON value", () => {
    expect(hashJsonValue({ a: 1 })).toBe(
      `sha256:${nodeSha256('{"a":1}')}`,
    );
  });
});

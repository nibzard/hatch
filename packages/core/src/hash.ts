/**
 * Canonical JSON and the scene spec hash (specification sections 9A and 10).
 *
 * A render is identified by four inputs: compiler version, seed, style
 * preset, and scene spec. The spec needs one stable text form before it can
 * feed that identity, because two JSON texts that differ only in key order
 * describe the same scene. {@link canonicalJson} writes that form: object
 * keys sorted, no whitespace, one spelling per value.
 *
 * The hash is SHA-256 (FIPS 180-4), written here as plain code. @hatch/core
 * runs in every host of the workspace, browsers included, so it stays free of
 * a Node `crypto` import. The test suite checks every digest against
 * `node:crypto`, so the implementation cannot drift.
 */

import type { SceneSpec } from "./scene.js";
import type { JsonValue } from "./json.js";

/** The prefix that names the algorithm in a recorded hash. */
export const SPEC_HASH_PREFIX = "sha256";

/**
 * One JSON scalar in its canonical spelling.
 *
 * `JSON.stringify` already writes one spelling per scalar, including the
 * shortest round-trip form of a double, so the scalars borrow it.
 */
function scalarJson(value: string | number | boolean | null): string {
  return JSON.stringify(value);
}

/**
 * The canonical text form of one JSON value.
 *
 * Object keys sort by code unit, arrays keep their order, and a key whose
 * value is `undefined` drops away, which matches what `JSON.stringify`
 * writes. Two texts that parse to the same value canonicalize to the same
 * bytes, whatever key order they arrived in.
 */
export function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== "object") {
    return scalarJson(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item ?? null)).join(",")}]`;
  }
  const keys = Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort();
  const fields = keys.map((key) => {
    const item: JsonValue | undefined = value[key];
    return `${scalarJson(key)}:${canonicalJson(item ?? null)}`;
  });
  return `{${fields.join(",")}}`;
}

/** Rotate one 32-bit word right by `count` bits. */
function rotr(word: number, count: number): number {
  return (word >>> count) | (word << (32 - count));
}

/** The sixty-four round constants of SHA-256, in round order (FIPS 180-4). */
const ROUND_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** The first eight hash words of SHA-256 (FIPS 180-4). */
const INITIAL_HASH = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
  0x1f83d9ab, 0x5be0cd19,
]);

/**
 * The SHA-256 digest of one string, as 64 lowercase hex characters.
 *
 * The input is UTF-8 encoded first, so a scene id or a parameter that holds
 * non-ASCII text hashes the same bytes in every host.
 */
export function sha256Hex(input: string): string {
  const data = new TextEncoder().encode(input);
  const blockCount = Math.floor((data.length + 8) / 64) + 1;
  const paddedLength = blockCount * 64;
  const message = new Uint8Array(paddedLength);
  message.set(data);
  message[data.length] = 0x80;

  // The bit length of the original input, big-endian, in the last eight
  // bytes. A scene spec stays far below 2^32 bytes, so the high half is 0.
  const bitLength = data.length * 8;
  const view = new DataView(message.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 2 ** 32), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);

  const words = new Uint32Array(64);
  const hash = new Uint32Array(INITIAL_HASH);
  for (let block = 0; block < blockCount; block += 1) {
    const offset = block * 64;
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4, false);
    }
    for (let index = 16; index < 64; index += 1) {
      const fifteen = words[index - 15]!;
      const two = words[index - 2]!;
      const smallSigma0 = rotr(fifteen, 7) ^ rotr(fifteen, 18) ^ (fifteen >>> 3);
      const smallSigma1 = rotr(two, 17) ^ rotr(two, 19) ^ (two >>> 10);
      words[index] =
        (words[index - 16]! + smallSigma0 + words[index - 7]! + smallSigma1) >>>
        0;
    }

    let a = hash[0]!;
    let b = hash[1]!;
    let c = hash[2]!;
    let d = hash[3]!;
    let e = hash[4]!;
    let f = hash[5]!;
    let g = hash[6]!;
    let h = hash[7]!;
    for (let index = 0; index < 64; index += 1) {
      const bigSigma1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temp1 =
        (h + bigSigma1 + choose + ROUND_CONSTANTS[index]! + words[index]!) >>> 0;
      const bigSigma0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (bigSigma0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    hash[0] = (hash[0]! + a) >>> 0;
    hash[1] = (hash[1]! + b) >>> 0;
    hash[2] = (hash[2]! + c) >>> 0;
    hash[3] = (hash[3]! + d) >>> 0;
    hash[4] = (hash[4]! + e) >>> 0;
    hash[5] = (hash[5]! + f) >>> 0;
    hash[6] = (hash[6]! + g) >>> 0;
    hash[7] = (hash[7]! + h) >>> 0;
  }

  let hex = "";
  for (const word of hash) {
    hex += word.toString(16).padStart(8, "0");
  }
  return hex;
}

/** The digest of one canonical JSON value, prefixed with its algorithm. */
export function hashJsonValue(value: JsonValue): string {
  return `${SPEC_HASH_PREFIX}:${sha256Hex(canonicalJson(value))}`;
}

/**
 * The scene spec with its debug block left out.
 *
 * The debug block is a view switch, not scene content: it picks which
 * overlays a render draws beside the artwork, and an overlay must never move
 * a stroke of the artwork itself. A render identity that carried the block
 * would give a debug render a different stream, so its hatching would differ
 * from the plain render it is meant to explain. Leaving the block out keeps
 * both renders on one identity, and makes a spec whose block holds no `true`
 * flag hash exactly like a spec that carries no block at all.
 */
function sceneWithoutDebugBlock(spec: SceneSpec): JsonValue {
  const { debug: _debug, ...scene } = spec;
  return scene;
}

/**
 * The hash of one scene spec: the digest of its canonical JSON form.
 *
 * Hash the parsed spec, never the raw input text, so two documents that
 * differ only in key order or whitespace name the same scene. The value
 * feeds the trace, the embedded metadata, and the seed key of every render
 * stage (specification sections 9A and 10).
 */
export function sceneSpecHash(spec: SceneSpec): string {
  return hashJsonValue(sceneWithoutDebugBlock(spec));
}

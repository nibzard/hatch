/**
 * The embedded metadata block (specification sections 9A, 11, and 12).
 *
 * Every render writes its identity into the SVG itself: the compiler
 * version, the seed, the style preset, and the spec hash. The block is plain
 * JSON inside the standard `<metadata>` element, so an agent or an editor
 * can read the render identity back out of the file without a sidecar
 * (specification section 12: SVG is the source of truth).
 *
 * The JSON holds no timestamp, so identical inputs keep the bytes identical
 * (specification section 10).
 */

import type { RenderTrace } from "@hatch/core";

import { element, text, type XmlElement } from "./xml.js";

/** The renderer that wrote the file. */
export const METADATA_GENERATOR = "@hatch/renderer-svg";

/**
 * The metadata payload of one render. Key order is fixed by construction,
 * because the block is serialized as written, never re-keyed.
 */
export interface MetadataPayload {
  /** The renderer that wrote the file. */
  generator: string;
  /** Compiler version, from the trace (specification section 9A). */
  version: string;
  /** Seed, from the trace (specification section 9A). */
  seed: number;
  /** Style preset name, from the trace (specification section 9A). */
  preset: string;
  /** Hash of the canonical scene spec, from the trace. */
  specHash: string;
}

/** Read the payload of one render out of its trace. */
export function metadataPayload(trace: RenderTrace): MetadataPayload {
  return {
    generator: METADATA_GENERATOR,
    version: trace.compilerVersion,
    seed: trace.seed,
    preset: trace.preset,
    specHash: trace.specHash,
  };
}

/** Build the `<metadata>` element of one render. */
export function metadataElement(trace: RenderTrace): XmlElement {
  return element(
    "metadata",
    [],
    text(JSON.stringify(metadataPayload(trace))),
  );
}

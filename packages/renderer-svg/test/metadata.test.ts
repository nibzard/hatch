/**
 * Tests for the embedded metadata block (specification sections 9A and 12).
 */

import { describe, expect, it } from "vitest";

import { METADATA_GENERATOR, metadataElement, metadataPayload } from "../src/metadata.js";
import { serializeXml } from "../src/xml.js";

import { traceOf } from "./fixtures.js";
import { assertWellFormedXml, parseTags, unescapeXml } from "./xml-check.js";

/** Read the JSON payload back out of one metadata element markup. */
function payloadOf(markup: string): Record<string, unknown> {
  assertWellFormedXml(markup);
  const tokens = parseTags(markup);
  const open = tokens.findIndex((token) => token.name === "metadata");
  if (open < 0) throw new Error("no metadata element");
  return JSON.parse(unescapeXml(tokens[open]!.text)) as Record<string, unknown>;
}

describe("metadataElement", () => {
  it("embeds version, seed, and preset from the trace", () => {
    const markup = serializeXml(metadataElement(traceOf()));
    const payload = payloadOf(markup);
    expect(payload["version"]).toBe("0.1.0");
    expect(payload["seed"]).toBe(42);
    expect(payload["preset"]).toBe("pastoral-v1");
  });

  it("embeds the generator and the spec hash", () => {
    const markup = serializeXml(metadataElement(traceOf()));
    const payload = payloadOf(markup);
    expect(payload["generator"]).toBe(METADATA_GENERATOR);
    expect(payload["specHash"]).toBe("sha256:9f2c");
  });

  it("keeps one fixed key order, so the bytes stay stable", () => {
    const first = serializeXml(metadataElement(traceOf()));
    const second = serializeXml(metadataElement(traceOf({ seed: 7 })));
    expect(first).toBe(
      '<metadata>{"generator":"@hatch/renderer-svg","version":"0.1.0","seed":42,' +
        '"preset":"pastoral-v1","specHash":"sha256:9f2c"}</metadata>\n',
    );
    expect(second).toContain('"seed":7');
  });

  it("escapes markup characters of the payload", () => {
    const markup = serializeXml(
      metadataElement(traceOf({ preset: 'pas&toral<"v1">' })),
    );
    expect(() => assertWellFormedXml(markup)).not.toThrow();
    expect(payloadOf(markup)["preset"]).toBe('pas&toral<"v1">');
  });
});

describe("metadataPayload", () => {
  it("reads every field from the trace", () => {
    expect(metadataPayload(traceOf())).toEqual({
      generator: METADATA_GENERATOR,
      version: "0.1.0",
      seed: 42,
      preset: "pastoral-v1",
      specHash: "sha256:9f2c",
    });
  });
});

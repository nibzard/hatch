/**
 * Tests for masks, clip paths, and the ids they are referenced by.
 */

import { describe, expect, it } from "vitest";

import { IdAllocator, sanitizeId } from "../src/ids.js";
import { clipPathElement, maskElement, urlReference } from "../src/masks.js";
import { pathData } from "../src/path-data.js";
import { serializeXml } from "../src/xml.js";

import { circlePath, cloudMask, rectPath } from "./fixtures.js";
import { assertWellFormedXml } from "./xml-check.js";

const CANVAS = { width: 320, height: 240 };

describe("sanitizeId", () => {
  it("keeps safe characters and prefixes the kind", () => {
    expect(sanitizeId("m", "cloud-1")).toBe("m-cloud-1");
    expect(sanitizeId("clip", "sky")).toBe("clip-sky");
  });

  it("collapses unsafe characters into one hyphen", () => {
    expect(sanitizeId("m", "cloud bank/1")).toBe("m-cloud-bank-1");
    expect(sanitizeId("m", "a  b")).toBe("m-a-b");
  });

  it("still yields a usable id for an empty or unsafe raw id", () => {
    expect(sanitizeId("m", "")).toBe("m-id");
    expect(sanitizeId("m", "///")).toBe("m-id");
  });
});

describe("IdAllocator", () => {
  it("issues distinct ids across kinds", () => {
    const allocator = new IdAllocator();
    expect(allocator.take("m", "sky")).toBe("m-sky");
    expect(allocator.take("clip", "sky")).toBe("clip-sky");
  });

  it("suffixes a second request for the same id", () => {
    const allocator = new IdAllocator();
    expect(allocator.take("m", "cloud")).toBe("m-cloud");
    expect(allocator.take("m", "cloud")).toBe("m-cloud-2");
    expect(allocator.take("m", "cloud")).toBe("m-cloud-3");
  });

  it("separates raw ids that sanitize to the same text", () => {
    const allocator = new IdAllocator();
    expect(allocator.take("m", "a b")).toBe("m-a-b");
    expect(allocator.take("m", "a/b")).toBe("m-a-b-2");
  });
});

describe("maskElement", () => {
  it("carves negative space: white canvas, black mask path", () => {
    const markup = serializeXml(maskElement(cloudMask(), "m-cloud", CANVAS));
    expect(markup).toContain('id="m-cloud"');
    expect(markup).toContain('maskUnits="userSpaceOnUse"');
    // The white rect must cover the full canvas, so the mask cannot shrink
    // to the bounding box of the cloud and leak hatching back in.
    expect(markup).toContain(
      '<rect x="0" y="0" width="320" height="240" fill="#ffffff" />',
    );
    expect(markup).toContain(
      `<path d="${pathData(cloudMask().path)}" fill="#000000" />`,
    );
    expect(() => assertWellFormedXml(markup)).not.toThrow();
  });

  it("keeps only the inside when the mask is not inverted", () => {
    const reveal = {
      id: "frame",
      path: rectPath(10, 10, 100, 80),
      invert: false,
    };
    const markup = serializeXml(maskElement(reveal, "m-frame", CANVAS));
    expect(markup).toContain(
      '<rect x="0" y="0" width="320" height="240" fill="#000000" />',
    );
    expect(markup).toContain(
      `<path d="${pathData(reveal.path)}" fill="#ffffff" />`,
    );
  });

  it("bounds the mask region to the full canvas", () => {
    const markup = serializeXml(maskElement(cloudMask(), "m-cloud", CANVAS));
    expect(markup).toContain('x="0" y="0" width="320" height="240"');
  });

  it("keeps the mask well-formed for splines and compound paths", () => {
    const wavy = { id: "wavy", path: circlePath(50, 50, 20), invert: true };
    const markup = serializeXml(maskElement(wavy, "m-wavy", CANVAS));
    expect(() => assertWellFormedXml(markup)).not.toThrow();
  });
});

describe("clipPathElement", () => {
  it("wraps one path in a userSpaceOnUse clip", () => {
    const clip = rectPath(0, 0, 320, 130);
    const markup = serializeXml(clipPathElement("clip-sky", clip));
    expect(markup).toContain('id="clip-sky"');
    expect(markup).toContain('clipPathUnits="userSpaceOnUse"');
    expect(markup).toContain(`d="${pathData(clip)}"`);
    expect(() => assertWellFormedXml(markup)).not.toThrow();
  });
});

describe("urlReference", () => {
  it("builds the url fragment of one id", () => {
    expect(urlReference("m-cloud-1")).toBe("url(#m-cloud-1)");
  });
});

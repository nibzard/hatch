import { describe, expect, it } from "vitest";

import { RegionSchema, regionsInDrawOrder, type Region } from "../src/index.js";

import { rectPath, trianglePath } from "./fixtures.js";

describe("RegionSchema", () => {
  it("parses a hatch region", () => {
    const result = RegionSchema.safeParse({
      id: "sky-region",
      role: "sky",
      path: rectPath(0, 0, 100, 50),
      fillStyle: { type: "hatch", angle: 20, spacing: 6, stroke: "#000", weight: 0.6, jitter: 0.4 },
      zIndex: 0,
    });
    expect(result.success).toBe(true);
  });

  it("parses a crosshatch region with a clip path", () => {
    const result = RegionSchema.safeParse({
      id: "foliage-region",
      path: trianglePath(),
      fillStyle: {
        type: "crosshatch",
        angleA: 45,
        angleB: 135,
        spacingA: 4,
        spacingB: 6,
        stroke: "#000",
        weight: 0.5,
        jitter: 1.2,
      },
      clip: trianglePath(),
      zIndex: 2,
    });
    expect(result.success).toBe(true);
  });

  it("parses a none region for negative space", () => {
    const result = RegionSchema.safeParse({
      id: "cloud-hole",
      path: rectPath(10, 10, 40, 20),
      fillStyle: { type: "none" },
      zIndex: 1,
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown fill style type", () => {
    const result = RegionSchema.safeParse({
      id: "gradient-region",
      path: rectPath(0, 0, 100, 50),
      fillStyle: { type: "gradient", from: "#fff", to: "#000" },
      zIndex: 0,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path.join(".")).toBe("fillStyle.type");
    }
  });

  it("rejects a path that does not start with a move command", () => {
    const result = RegionSchema.safeParse({
      id: "bad-region",
      path: {
        commands: [
          { command: "line", to: { x: 10, y: 0 } },
          { command: "close" },
        ],
      },
      fillStyle: { type: "none" },
      zIndex: 0,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/move/);
    }
  });

  it("rejects an empty path", () => {
    const result = RegionSchema.safeParse({
      id: "empty-region",
      path: { commands: [] },
      fillStyle: { type: "none" },
      zIndex: 0,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a fractional zIndex", () => {
    const result = RegionSchema.safeParse({
      id: "sky-region",
      path: rectPath(0, 0, 100, 50),
      fillStyle: { type: "none" },
      zIndex: 1.5,
    });
    expect(result.success).toBe(false);
  });
});

describe("regionsInDrawOrder", () => {
  /** One region with the given id and zIndex. */
  function region(id: string, zIndex: number): Region {
    return {
      id,
      path: rectPath(0, 0, 10, 10),
      fillStyle: { type: "none" },
      zIndex,
    };
  }

  it("stacks by ascending zIndex, whatever the input order", () => {
    expect(
      regionsInDrawOrder([
        region("field", 20),
        region("sky", 0),
        region("tree", 10),
      ]).map((entry) => entry.id),
    ).toEqual(["sky", "tree", "field"]);
  });

  it("keeps the input order between regions of one zIndex", () => {
    expect(
      regionsInDrawOrder([
        region("tree-b", 11),
        region("hill", 10),
        region("tree-c", 11),
      ]).map((entry) => entry.id),
    ).toEqual(["hill", "tree-b", "tree-c"]);
  });

  it("leaves the input array alone", () => {
    const input = [region("field", 20), region("sky", 0)];
    regionsInDrawOrder(input);
    expect(input.map((entry) => entry.id)).toEqual(["field", "sky"]);
  });
});

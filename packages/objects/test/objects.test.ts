/**
 * Package identity tests for @hatch/objects.
 */

import { describe, expect, it } from "vitest";

import {
  OBJECT_KINDS,
  COASTAL_OBJECT_KINDS,
  packageName,
  packageRole,
  V1_OBJECT_KINDS,
  V2_OBJECT_KINDS,
} from "../src/index.js";

describe("@hatch/objects", () => {
  it("declares its package identity and role", () => {
    expect(packageName).toBe("@hatch/objects");
    expect(packageRole.length).toBeGreaterThan(0);
  });

  it("ships a generator for every V1 object kind", () => {
    expect(V1_OBJECT_KINDS.length).toBe(5);
  });

  it("ships the skatepark and urban kinds of round 2", () => {
    expect(V2_OBJECT_KINDS.length).toBe(12);
  });

  it("ships the coastal kinds of the specification", () => {
    expect(COASTAL_OBJECT_KINDS.length).toBe(3);
    expect(OBJECT_KINDS.length).toBe(20);
  });
});

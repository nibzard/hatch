import { describe, expect, it } from "vitest";

import { packageName, packageRole } from "../src/index.js";

describe("@hatch/renderer-svg", () => {
  it("declares its package identity and role", () => {
    expect(packageName).toBe("@hatch/renderer-svg");
    expect(packageRole.length).toBeGreaterThan(0);
  });
});

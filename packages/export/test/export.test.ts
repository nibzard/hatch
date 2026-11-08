import { describe, expect, it } from "vitest";

import { packageName, packageRole } from "../src/index.js";

describe("@hatch/export", () => {
  it("declares its package identity and role", () => {
    expect(packageName).toBe("@hatch/export");
    expect(packageRole.length).toBeGreaterThan(0);
  });
});

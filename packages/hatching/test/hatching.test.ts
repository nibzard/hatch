import { describe, expect, it } from "vitest";

import { packageName, packageRole } from "../src/index.js";

describe("@hatch/hatching", () => {
  it("declares its package identity and role", () => {
    expect(packageName).toBe("@hatch/hatching");
    expect(packageRole.length).toBeGreaterThan(0);
  });
});

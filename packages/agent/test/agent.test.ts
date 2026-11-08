import { describe, expect, it } from "vitest";

import { packageName, packageRole } from "../src/index.js";

describe("@hatch/agent", () => {
  it("declares its package identity and role", () => {
    expect(packageName).toBe("@hatch/agent");
    expect(packageRole.length).toBeGreaterThan(0);
  });
});

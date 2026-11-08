import { describe, expect, it } from "vitest";

import {
  FillStyleSchema,
  packageName,
  packageRole,
  RegionSchema,
  RenderIRSchema,
  RenderTraceSchema,
  SceneObjectSchema,
  SceneSpecSchema,
  StyleSpecSchema,
} from "../src/index.js";

describe("@hatch/core", () => {
  it("declares its package identity and role", () => {
    expect(packageName).toBe("@hatch/core");
    expect(packageRole.length).toBeGreaterThan(0);
  });

  it("exports the T010 schemas from the package root", () => {
    const schemas = {
      FillStyleSchema,
      RegionSchema,
      RenderIRSchema,
      RenderTraceSchema,
      SceneObjectSchema,
      SceneSpecSchema,
      StyleSpecSchema,
    } as const;

    for (const [name, schema] of Object.entries(schemas)) {
      expect(typeof schema.parse, `${name}.parse`).toBe("function");
      expect(typeof schema.safeParse, `${name}.safeParse`).toBe("function");
    }
  });
});

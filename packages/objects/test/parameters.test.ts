/**
 * Probe tests: every parameter space agrees with its Zod schema.
 *
 * A generator states its parameters twice (see src/parameters.ts). These
 * tests prove the two agree, so the seeded sweep of the acceptance covers
 * exactly the range the schema accepts.
 */

import { describe, expect, it } from "vitest";

import { OBJECT_KINDS, objectGenerators } from "../src/generator.js";

/** A step small enough to fall outside a range without floating past it. */
function epsilon(min: number, max: number): number {
  return Math.max(1e-6, (max - min) * 1e-3);
}

describe("parameter spaces", () => {
  for (const kind of OBJECT_KINDS) {
    const generator = objectGenerators[kind];

    describe(`the ${kind} parameter space`, () => {
      it("defaults every missing field and drops unknown fields", () => {
        const parsed = generator.parseParameters({
          "not-a-knob": "dropped",
        });
        expect(generator.parseParameters(undefined)).toEqual(parsed);
        expect(Object.keys(parsed)).not.toContain("not-a-knob");
        expect(Object.keys(parsed).length).toBe(
          Object.keys(generator.parameterSpace).length,
        );
      });

      it("accepts the boundaries of every field and rejects past them", () => {
        for (const [name, field] of Object.entries(generator.parameterSpace)) {
          if (field.kind === "boolean") {
            expect(() => generator.parseParameters({ [name]: true })).not.toThrow();
            expect(() => generator.parseParameters({ [name]: false })).not.toThrow();
            expect(() => generator.parseParameters({ [name]: 1 })).toThrowError(
              new RegExp(`invalid ${kind} parameters`),
            );
            continue;
          }
          const step = epsilon(field.min, field.max);
          expect(() =>
            generator.parseParameters({ [name]: field.min }),
          ).not.toThrow();
          expect(() =>
            generator.parseParameters({ [name]: field.max }),
          ).not.toThrow();
          expect(() =>
            generator.parseParameters({ [name]: field.min - step }),
          ).toThrowError(new RegExp(`invalid ${kind} parameters:.*${name}`));
          expect(() =>
            generator.parseParameters({ [name]: field.max + step }),
          ).toThrowError(new RegExp(`invalid ${kind} parameters:.*${name}`));
          if (field.kind === "integer") {
            expect(() =>
              generator.parseParameters({ [name]: field.min + 0.5 }),
            ).toThrowError(new RegExp(`invalid ${kind} parameters:.*${name}`));
          }
        }
      });

      it("carries the space default in its published defaults", () => {
        for (const [name, field] of Object.entries(generator.parameterSpace)) {
          expect(generator.defaultParameters[name]).toEqual(field.default);
        }
      });

      it("rejects params that are not a JSON object", () => {
        expect(() => generator.parseParameters("wide")).toThrowError(
          new RegExp(`the ${kind} generator needs its params as a JSON object`),
        );
        expect(() => generator.parseParameters([1, 2])).toThrowError(
          new RegExp(`the ${kind} generator needs its params as a JSON object`),
        );
      });
    });
  }
});

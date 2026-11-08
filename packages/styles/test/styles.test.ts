import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { listStylePresets, packageName, packageRole, STYLE_PRESETS } from "../src/index.js";

describe("@hatch/styles", () => {
  it("declares its package identity and role", () => {
    expect(packageName).toBe("@hatch/styles");
    expect(packageRole.length).toBeGreaterThan(0);
  });
});

/**
 * Collect the dotted path of every leaf field of a preset. A leaf is a
 * value that is neither a plain object nor undefined. Arrays count as one
 * leaf, for example `compositionGrammar.preferredHorizonBand`.
 */
function leafPaths(value: unknown, prefix: string): string[] {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return Object.entries(value).flatMap(([key, nested]) =>
      leafPaths(nested, prefix === "" ? key : `${prefix}.${key}`),
    );
  }
  return [prefix];
}

describe("package README", () => {
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

  it("exists and documents the package role", () => {
    expect(readme).toContain("# @hatch/styles");
    expect(readme).toContain("StyleSpec");
  });

  it("documents every registered preset id", () => {
    for (const id of listStylePresets()) {
      expect(readme, id).toContain(id);
    }
  });

  it("documents every field of every registered preset", () => {
    expect(listStylePresets().length).toBeGreaterThan(0);
    const missing: string[] = [];
    for (const id of listStylePresets()) {
      for (const fieldPath of leafPaths(STYLE_PRESETS[id], "")) {
        if (!readme.includes(fieldPath)) {
          missing.push(`${id}: ${fieldPath}`);
        }
      }
    }
    expect(missing, "fields the README does not document").toEqual([]);
  });

  it("documents the value each preset ships", () => {
    // One table row per leaf field: | `path` | `value` | ... The rows sit
    // inside the `## <preset id>` section of their preset, so the same
    // path may carry a different value under each preset.
    const rowPattern = /^\| `([a-zA-Z.]+)` \| `([^`]*)` \|/;
    const sectionPattern = /^## (.+)$/;
    const problems: string[] = [];
    let preset: string | null = null;
    for (const line of readme.split("\n")) {
      const section = sectionPattern.exec(line);
      if (section !== null) {
        preset = listStylePresets().includes(section[1]!)
          ? section[1]!
          : null;
        continue;
      }
      if (preset === null) {
        continue;
      }
      const row = rowPattern.exec(line);
      if (row === null) {
        continue;
      }
      const [, fieldPath, text] = row;
      const value = leafValue(STYLE_PRESETS[preset], fieldPath!.split("."));
      if (value === undefined) {
        problems.push(
          `${preset}: ${fieldPath} documents a field it does not hold`,
        );
        continue;
      }
      const documented = parseDocumented(text!);
      if (JSON.stringify(documented) !== JSON.stringify(value)) {
        problems.push(
          `${preset}: ${fieldPath} documents ${text} but ships ` +
            `${JSON.stringify(value)}`,
        );
      }
    }
    expect(problems, "documented values that disagree with the preset").toEqual(
      [],
    );
    // Every leaf of every preset carries one row, not only a mention.
    for (const id of listStylePresets()) {
      const section = readme.split(/^## /m).find((block) =>
        block.startsWith(`${id}\n`),
      );
      for (const fieldPath of leafPaths(STYLE_PRESETS[id], "")) {
        expect(section, `${id}: ${fieldPath}`).toBeDefined();
        expect(section, `${id}: ${fieldPath}`).toContain(`\`${fieldPath}\` |`);
      }
    }
  });
});

/** Read one documented value: JSON for numbers and arrays, text for colors. */
function parseDocumented(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/** Read one nested leaf of a preset by its dotted path. */
function leafValue(value: unknown, path: string[]): unknown {
  let current: unknown = value;
  for (const key of path) {
    if (current === null || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

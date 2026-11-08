/**
 * Static guard for the render path (specification section 10).
 *
 * Determinism needs one rule: package source never calls Math.random. Every
 * random value flows from the seeded RNG of @hatch/core, so the identical
 * version, seed, preset, and spec always give the identical output.
 *
 * This test scans the src/ tree of every workspace package. Test files stay
 * outside the scan because they are not the render path.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** The workspace root, three levels above this file. */
const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

/**
 * Every TypeScript source extension the guard must scan. A package may add
 * any of them later, for example React sources in .tsx, so the list holds
 * every variant instead of one.
 */
const typescriptSourceExtensions = [".ts", ".tsx", ".mts", ".cts"] as const;

/** True when a file name ends in a TypeScript source extension. */
function isTypeScriptSource(name: string): boolean {
  return typescriptSourceExtensions.some((extension) => name.endsWith(extension));
}

/**
 * Collect every TypeScript source file below `dir`, as `prefix/...` paths in
 * stable order.
 */
function collectTypeScriptFiles(dir: string, prefix: string, out: string[]): void {
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : 1,
  );
  for (const entry of entries) {
    const relative = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      collectTypeScriptFiles(path.join(dir, entry.name), relative, out);
    } else if (entry.isFile() && isTypeScriptSource(entry.name)) {
      out.push(relative);
    }
  }
}

/** Every source file of every workspace package, as package-relative paths. */
function packageSourceFiles(): string[] {
  const packagesDir = path.join(workspaceRoot, "packages");
  const files: string[] = [];
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const srcDir = path.join(packagesDir, entry.name, "src");
    if (!existsSync(srcDir)) continue;
    collectTypeScriptFiles(srcDir, `${entry.name}/src`, files);
  }
  return files;
}

/** Matches a call of the global random function, with any spacing. */
const bannedPattern = /\bMath\s*\.\s*random\b/;

/**
 * Report every banned call in `files`, resolved below `root`, as one
 * `file:line` entry per matching line.
 */
function findBannedCalls(root: string, files: readonly string[]): string[] {
  const violations: string[] = [];
  for (const file of files) {
    const lines = readFileSync(path.join(root, file), "utf-8").split("\n");
    lines.forEach((line, index) => {
      if (bannedPattern.test(line)) {
        violations.push(`${file}:${index + 1}`);
      }
    });
  }
  return violations;
}

/**
 * Run `check` against a temporary tree of the given files, given as a map
 * of `name -> contents`. The tree is always removed afterwards, so the
 * fixtures never reach the scanned package sources.
 */
function withFixtureTree(
  files: Readonly<Record<string, string>>,
  check: (root: string) => void,
): void {
  const root = mkdtempSync(path.join(os.tmpdir(), "hatch-math-random-guard-"));
  try {
    for (const [name, contents] of Object.entries(files)) {
      const target = path.join(root, name);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, contents, "utf-8");
    }
    check(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("Math.random guard", () => {
  const files = packageSourceFiles();

  it("scans the source of every workspace package", () => {
    // Specification section 11 defines nine packages. The scan must see
    // them, so a broken path can never turn this guard into a no-op.
    expect(files.length).toBeGreaterThanOrEqual(9);
    expect(files).toContain("core/src/rng.ts");
  });

  it("finds no Math.random call in any package source file", () => {
    const violations = findBannedCalls(path.join(workspaceRoot, "packages"), files);
    expect(violations, `banned calls at: ${violations.join(", ")}`).toEqual([]);
  });
});

describe("Math.random guard coverage", () => {
  it("collects every TypeScript source extension and skips other files", () => {
    withFixtureTree(
      {
        "ui/src/demo.ts": "export const a = 1;\n",
        "ui/src/demo.tsx": "export const b = 2;\n",
        "ui/src/demo.mts": "export const c = 3;\n",
        "ui/src/demo.cts": "export const d = 4;\n",
        "ui/src/nested/e.ts": "export const e = 5;\n",
        "ui/src/demo.js": "export const f = 6;\n",
        "ui/src/demo.jsx": "export const g = 7;\n",
        "ui/src/demo.txt": "plain text\n",
      },
      (root) => {
        const collected: string[] = [];
        collectTypeScriptFiles(path.join(root, "ui", "src"), "ui/src", collected);
        expect(collected).toEqual([
          "ui/src/demo.cts",
          "ui/src/demo.mts",
          "ui/src/demo.ts",
          "ui/src/demo.tsx",
          "ui/src/nested/e.ts",
        ]);
      },
    );
  });

  it("flags a Math.random call in a .tsx source file", () => {
    withFixtureTree(
      {
        "ui/src/editor.tsx":
          "export function spin(): number {\n  return Math.random();\n}\n",
        "ui/src/clean.ts": "export const value = 1;\n",
      },
      (root) => {
        const collected: string[] = [];
        collectTypeScriptFiles(path.join(root, "ui", "src"), "ui/src", collected);
        expect(findBannedCalls(root, collected)).toEqual(["ui/src/editor.tsx:2"]);
      },
    );
  });
});

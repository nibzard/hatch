/**
 * The V1 release gate (task T019, specification section 24).
 *
 * The gate walks the V1 checklist of specification section 24 over every
 * example scene under `examples/scenes/`:
 *
 * 1. SVG output
 * 2. paper background
 * 3. region-based hatching
 * 4. clouds as cutouts
 * 5. the five object types: house, tree, hill, mountain, water
 * 6. one style preset
 * 7. deterministic seed
 * 8. JSON scene spec
 * 9. SVG and PNG export, extended with the PDF export of task T030
 *
 * Acceptance, as tests: two runs of each example are byte-identical, in one
 * process and across two runs of `examples/render.mjs`; the rendered SVG
 * matches the committed golden fixture under `examples/golden/`; and the PNG
 * and PDF bytes of two runs of the same tree agree. One value is exempt
 * from byte identity: the export timing of specification section 9E, a
 * wall-clock measurement every trace now carries (task T027), compared
 * normalized. The golden SVG fixtures
 * stay tracked, while the PNG and PDF output stays ignored under
 * `examples/output/`: the pinned resvg version is one of the fixed inputs of
 * a raster (task T018), so a PNG is proven between runs of one tree, not
 * against a file, and the PDF output is scratch of the same kind (task T040).
 *
 * `pnpm verify` runs this suite through its unit-test step, so the checklist
 * is part of the one-command gate (task T003).
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  cloudCountOf,
  formatIssues,
  RenderTraceSchema,
  SceneSpecSchema,
  TRACE_STAGES,
  type RenderTrace,
  type SceneSpec,
} from "@hatch/core";
import { V1_OBJECT_KINDS } from "@hatch/objects";
import {
  hasPdfTrailer,
  isPdf,
  isPng,
  pdfPageSize,
  pngDimensions,
  svgToPdf,
  svgToPng,
} from "@hatch/export";
import { createV1Engine } from "@hatch/renderer-svg";

/** The repository root, one level above this file's `tests/` directory. */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scenesDir = path.join(repoRoot, "examples", "scenes");
const goldenDir = path.join(repoRoot, "examples", "golden");
const outputDir = path.join(repoRoot, "examples", "output");
const renderScript = path.join(repoRoot, "examples", "render.mjs");

/** The pixel width every PNG export names. Must match `examples/render.mjs`. */
const PNG_WIDTH = 480;

/** The page width every PDF export names, in points. Must match `examples/render.mjs`. */
const PDF_WIDTH = 480;

/** One example scene of the release gate. */
interface ExampleScene {
  /** The scene file name under `examples/scenes/`. */
  readonly file: string;
  /** `meta.id` of the scene, the base name of every artifact. */
  readonly id: string;
  /** The parsed JSON of the file, exactly what a caller hands the engine. */
  readonly raw: unknown;
  /** The same spec after the `SceneSpec` schema accepted it. */
  readonly spec: SceneSpec;
  /** The cloud cutouts the environment asks for. */
  readonly cloudCount: number;
}

/** Load every example scene and parse it against the scene schema. */
function loadExamples(): ExampleScene[] {
  const files = readdirSync(scenesDir)
    .filter((name) => name.endsWith(".json"))
    .sort();
  if (files.length === 0) {
    throw new Error(`the release gate found no scene spec under ${scenesDir}`);
  }
  return files.map((file) => {
    const text = readFileSync(path.join(scenesDir, file), "utf8");
    const raw: unknown = JSON.parse(text);
    const parsed = SceneSpecSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        `${file} is not a valid SceneSpec: ${formatIssues(parsed.error.issues)}`,
      );
    }
    const spec = parsed.data;
    return {
      file,
      id: spec.meta.id,
      raw,
      spec,
      cloudCount: cloudCountOf(spec),
    };
  });
}

const examples = loadExamples();
const engine = createV1Engine();

/** One render per example, compiled once and reused by every checklist item. */
const renders = examples.map((example) => ({
  example,
  result: engine.renderScene(example.raw),
}));

/**
 * One trace with its measured durations zeroed.
 *
 * The export timing of specification section 9E is a wall-clock
 * measurement of the run, not a fact of the compile, so it rides on the
 * metrics and on the render event and differs between two runs of the
 * same inputs. Every determinism comparison of this gate strips it before
 * comparing, which keeps the rest of the trace under the byte-identity
 * contract of specification section 10.
 */
function stripMeasuredDurations(trace: RenderTrace): RenderTrace {
  return {
    ...trace,
    metrics: trace.metrics && { ...trace.metrics, exportDurationMs: 0 },
    events: trace.events.map((event) =>
      event.durationMs === undefined ? event : { ...event, durationMs: 0 },
    ),
  };
}

/** One start or end tag of a serialized document. */
interface TagToken {
  /** Element name. */
  readonly name: string;
  /** True for an end tag. */
  readonly closing: boolean;
  /** True for `<name ... />`. */
  readonly selfClosing: boolean;
  /** Every attribute of a start tag. */
  readonly attributes: Readonly<Record<string, string>>;
}

/** The tag shapes this renderer emits: attributes never hold a raw quote. */
const TAG_PATTERN =
  /<(\/)?([a-zA-Z][-a-zA-Z0-9]*)((?:\s+[a-zA-Z:][-a-zA-Z0-9:]*="[^"]*")*)\s*(\/)?>/g;

/** Tokenize one document into its tags, in document order. */
function tagsOf(markup: string): TagToken[] {
  const tokens: TagToken[] = [];
  for (const match of markup.matchAll(TAG_PATTERN)) {
    const attributes: Record<string, string> = {};
    for (const attribute of match[3]!.matchAll(/([a-zA-Z:][-a-zA-Z0-9:]*)="([^"]*)"/g)) {
      attributes[attribute[1]!] = attribute[2]!;
    }
    tokens.push({
      name: match[2]!,
      closing: match[1] === "/",
      selfClosing: match[4] === "/",
      attributes,
    });
  }
  return tokens;
}

/**
 * The tokens between one start tag and its matching end tag.
 *
 * The document must nest correctly for this to stop; the well-formedness
 * check runs first.
 */
function innerTokens(tokens: readonly TagToken[], open: number): TagToken[] {
  const inner: TagToken[] = [];
  let depth = 0;
  for (let index = open + 1; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token.closing && depth === 0) {
      return inner;
    }
    if (token.closing) {
      depth -= 1;
    } else if (!token.selfClosing) {
      depth += 1;
    }
    inner.push(token);
  }
  return inner;
}

/** Assert the document nests every element and holds exactly one root. */
function assertWellFormedDocument(markup: string): TagToken[] {
  const tokens = tagsOf(markup);
  const stack: string[] = [];
  let roots = 0;
  for (const token of tokens) {
    if (token.closing) {
      expect(stack.pop(), `unbalanced </${token.name}>`).toBe(token.name);
    } else if (token.selfClosing) {
      // A self-closing element opens no scope.
    } else {
      stack.push(token.name);
      if (stack.length === 1) {
        roots += 1;
      }
    }
  }
  expect(stack, "every element closes").toEqual([]);
  expect(roots, "one root element").toBe(1);
  return tokens;
}

/** The SHA-256 of a file's bytes, as one comparable string. */
function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** The style event of one render, typed for the fields this gate reads. */
interface RegionFillEntry {
  readonly id: string;
  readonly role: string;
  readonly family: string;
  readonly zIndex: number;
}

/** The geometry event of one render, typed for the fields this gate reads. */
interface GeometryObjectEntry {
  readonly id: string;
  readonly kind: string;
  readonly contours: number;
  readonly internalBoundaries: number;
  readonly styleZones: number;
}

/** Read the data block of one trace event, or fail naming the stage. */
function eventData(trace: RenderTrace, stage: string): Record<string, unknown> {
  const event = trace.events.find((entry) => entry.stage === stage);
  const data = event?.data;
  if (typeof data !== "object" || data === null) {
    throw new Error(`the ${stage} event carries no data block`);
  }
  return data as Record<string, unknown>;
}

/** One number field of a data block, checked before it is returned. */
function numberField(data: Record<string, unknown>, key: string): number {
  const value = data[key];
  if (typeof value !== "number") {
    throw new Error(`the trace data block carries no number at "${key}"`);
  }
  return value;
}

describe("the example scenes of the release gate", () => {
  it("holds at least one scene spec", () => {
    expect(examples.length).toBeGreaterThanOrEqual(1);
  });

  it("covers two aspect ratios, so both PNG export sizes run", () => {
    const ratios = new Set(examples.map((example) => example.spec.meta.aspectRatio));
    expect(ratios).toContain("4:3");
    expect(ratios.size).toBeGreaterThan(1);
  });

  it("writes one golden SVG per scene and nothing else", () => {
    expect(readdirSync(goldenDir).sort()).toEqual(
      examples.map((example) => `${example.id}.svg`).sort(),
    );
  });
});

describe("the specification section 24 V1 checklist", () => {
  for (const { example, result } of renders) {
    describe(`example ${example.id}`, () => {
      const tokens = assertWellFormedDocument(result.svg);
      const regionTokens = tokens.filter(
        (token) => token.attributes["data-region-id"] !== undefined,
      );
      const regionIds = regionTokens.map(
        (token) => token.attributes["data-region-id"] ?? "",
      );

      it("1+8. compiles from a JSON scene spec with a complete meta block", () => {
        // The raw file content is the engine input, so the gate proves the
        // path a caller takes: JSON from disk, schema-checked, compiled.
        expect(example.spec.meta.id).toBe(example.id);
        expect(example.spec.meta.seed).toBeGreaterThan(0);
        expect(example.spec.meta.stylePreset).toBe("pastoral-v1");
        expect(example.spec.meta.aspectRatio).toMatch(/^\d+:\d+$/);
        expect(example.spec.meta.version).toMatch(/^\d+\.\d+\.\d+$/);
        expect(example.spec.objects.length).toBeGreaterThanOrEqual(5);
        expect(result.sceneSpec).toEqual(example.spec);
      });

      it("1. emits one XML document with a single svg root", () => {
        expect(result.svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(
          true,
        );
        expect(result.svg.endsWith("\n")).toBe(true);
        const root = tokens.find(
          (token) => token.name === "svg" && !token.closing,
        );
        expect(root?.attributes["viewBox"]).toBe(
          `0 0 ${result.ir.canvas.width} ${result.ir.canvas.height}`,
        );
        expect(result.svg).not.toMatch(/NaN|Infinity/);
        expect(result.trace.metrics?.svgSizeBytes).toBe(
          Buffer.byteLength(result.svg, "utf8"),
        );
      });

      it("2. paints the paper background over the full canvas", () => {
        const paper = tokens.find(
          (token) => token.attributes["data-layer"] === "paper",
        );
        expect(paper?.name).toBe("rect");
        expect(paper?.attributes["x"]).toBe("0");
        expect(paper?.attributes["y"]).toBe("0");
        expect(paper?.attributes["width"]).toBe(String(result.ir.canvas.width));
        expect(paper?.attributes["height"]).toBe(String(result.ir.canvas.height));
        // The paper color comes from the resolved preset, and the paper sits
        // under every drawn layer.
        expect(paper?.attributes["fill"]).toBe(result.ir.style.palette.paper);
        const regionsLayer = tokens.findIndex(
          (token) => token.attributes["data-layer"] === "regions",
        );
        const paperLayer = tokens.findIndex(
          (token) => token.attributes["data-layer"] === "paper",
        );
        expect(regionsLayer).toBeGreaterThan(paperLayer);
      });

      it("3. hatches the sky and ground regions of the plan", () => {
        expect(regionIds.slice(0, 2)).toEqual(["sky", "ground"]);
        const zIndexes = regionTokens.map((token) =>
          Number(token.attributes["data-zindex"]),
        );
        expect([...zIndexes].sort((left, right) => left - right)).toEqual(zIndexes);
        const style = eventData(result.trace, "style");
        const fills = (style["regions"] ?? []) as RegionFillEntry[];
        const families = new Set(fills.map((entry) => entry.family));
        // Every family of the pastoral preset that a full scene fills.
        for (const family of ["sky", "field", "foliage", "mountain", "water"]) {
          expect(families).toContain(family);
        }
        expect(result.trace.metrics?.strokeCount ?? 0).toBeGreaterThan(200);
        // Every hatch stroke draws as one subpath of a region run (task
        // T036 groups the strokes by width), and a clipped stroke draws as
        // more than one, so the moves inside the region groups cover the
        // strokes the trace counted.
        const regionMoves = regionTokens.reduce(
          (total, group) =>
            group.selfClosing
              ? total
              : total +
                innerTokens(tokens, tokens.indexOf(group))
                  .filter((token) => token.name === "path")
                  .reduce(
                    (sum, token) =>
                      sum + (token.attributes["d"]?.match(/[Mm]/g)?.length ?? 0),
                    0,
                  ),
          0,
        );
        expect(regionMoves).toBeGreaterThanOrEqual(
          result.trace.metrics?.strokeCount ?? 0,
        );
      });

      it("4. carves the cloud cutouts as negative space over the hatching", () => {
        expect(example.cloudCount).toBeGreaterThan(0);
        const planning = eventData(result.trace, "planning");
        expect(numberField(planning, "cloudCount")).toBe(example.cloudCount);
        for (let index = 1; index <= example.cloudCount; index += 1) {
          const maskId = `m-cloud-${index}`;
          const mask = tokens.findIndex(
            (token) => token.name === "mask" && token.attributes["id"] === maskId,
          );
          expect(mask).toBeGreaterThanOrEqual(0);
          const inner = innerTokens(tokens, mask);
          // The default cutout semantics: a white canvas keeps the hatching,
          // the black cloud path erases it, so the paper shows through.
          expect(inner[0]?.name).toBe("rect");
          expect(inner[0]?.attributes["fill"]).toBe("#ffffff");
          expect(inner[1]?.name).toBe("path");
          expect(inner[1]?.attributes["fill"]).toBe("#000000");
          // The whole region stack sits under the mask.
          const wrapped = tokens.filter(
            (token) => token.attributes["mask"] === `url(#${maskId})`,
          );
          expect(wrapped).toHaveLength(1);
        }
      });

      it("5. draws every one of the five V1 object types", () => {
        const kinds = example.spec.objects.map((object) => object.kind);
        expect([...new Set(kinds)].sort()).toEqual([...V1_OBJECT_KINDS].sort());
        const geometry = eventData(result.trace, "geometry");
        const placed = (geometry["objects"] ?? []) as GeometryObjectEntry[];
        expect(placed.map((entry) => entry.id).sort()).toEqual(
          example.spec.objects.map((object) => object.id).sort(),
        );
        for (const entry of placed) {
          expect(entry.contours).toBeGreaterThan(0);
          expect(entry.styleZones).toBeGreaterThan(0);
          // Every object contributes at least one hatched zone region.
          expect(regionIds.some((id) => id.startsWith(`${entry.id}:z`))).toBe(true);
        }
        // The contours draw above the hatch fields.
        const contoursLayer = tokens.findIndex(
          (token) => token.attributes["data-layer"] === "contours",
        );
        const regionsLayer = tokens.findIndex(
          (token) => token.attributes["data-layer"] === "regions",
        );
        expect(contoursLayer).toBeGreaterThan(regionsLayer);
      });

      it("6. resolves the one style preset the spec names", () => {
        // The registry grew in round 2 (specification section 24: more
        // style presets); the V1 examples still name the V1 preset.
        expect(engine.listPresets()).toEqual([
          "coastal-v1",
          "pastoral-v1",
          "skatepark-v1",
          "urban-v1",
        ]);
        expect(engine.hasPreset(example.spec.meta.stylePreset)).toBe(true);
        expect(result.ir.style.preset).toBe("pastoral-v1");
        // The palette the renderer painted is the palette of the preset.
        expect(result.ir.style.palette.paper).toBe("#f6f1e7");
      });

      it("7. records the deterministic identity in the trace and the SVG", () => {
        expect(RenderTraceSchema.parse(result.trace)).toEqual(result.trace);
        expect(result.trace.events.map((event) => event.stage)).toEqual([
          ...TRACE_STAGES,
        ]);
        expect(result.trace.preset).toBe(example.spec.meta.stylePreset);
        expect(result.trace.seed).toBe(example.spec.meta.seed);
        expect(result.trace.specHash).toMatch(/^sha256:[0-9a-f]{64}$/);
        const metadataOpen = result.svg.indexOf("<metadata>");
        const metadataClose = result.svg.indexOf("</metadata>");
        expect(metadataOpen).toBeGreaterThanOrEqual(0);
        expect(metadataClose).toBeGreaterThan(metadataOpen);
        const payload = JSON.parse(
          result.svg.slice(metadataOpen + "<metadata>".length, metadataClose),
        ) as Record<string, unknown>;
        expect(payload).toMatchObject({
          seed: example.spec.meta.seed,
          preset: example.spec.meta.stylePreset,
          specHash: result.trace.specHash,
        });
      });

      it("7. renders the same example byte-identically twice", () => {
        const fresh = createV1Engine();
        const first = fresh.renderScene(example.raw);
        const second = fresh.renderScene(example.raw);
        expect(second.svg).toBe(first.svg);
        expect(second.svg).toBe(result.svg);
        // The export duration is the one measured value of the trace
        // (specification section 9E): two runs share every other byte.
        expect(stripMeasuredDurations(second.trace)).toEqual(
          stripMeasuredDurations(first.trace),
        );
        expect(
          JSON.stringify({ ...second.ir, trace: stripMeasuredDurations(second.ir.trace) }),
        ).toBe(
          JSON.stringify({ ...first.ir, trace: stripMeasuredDurations(first.ir.trace) }),
        );
      });

      it("7. stays identical after another scene rendered first", () => {
        const other = renders.find((entry) => entry.example.id !== example.id);
        if (other !== undefined) {
          engine.renderScene(other.example.raw);
        }
        expect(engine.renderScene(example.raw).svg).toBe(result.svg);
      });

      it("7. renders different bytes when only the seed changes", () => {
        const meta = example.spec.meta;
        const reseeded: unknown = {
          ...(example.raw as Record<string, unknown>),
          meta: { ...meta, seed: meta.seed + 1 },
        };
        const other = engine.renderScene(reseeded);
        expect(other.svg).not.toBe(result.svg);
        expect(other.trace.seed).toBe(meta.seed + 1);
      });

      it("9. exports PNG at the pixel size of the scene aspect ratio", () => {
        const [widthPart, heightPart] = example.spec.meta.aspectRatio
          .split(":")
          .map((part) => Number(part));
        const expectedHeight = Math.round(
          (PNG_WIDTH * heightPart!) / widthPart!,
        );
        const exported = svgToPng(result.svg, {
          fit: { mode: "width", value: PNG_WIDTH },
        });
        expect(exported.width).toBe(PNG_WIDTH);
        expect(exported.height).toBe(expectedHeight);
        expect(pngDimensions(exported.png)).toMatchObject({
          width: PNG_WIDTH,
          height: expectedHeight,
        });
        expect(isPng(exported.png)).toBe(true);
        // The same document under the same options gives the same bytes.
        const again = svgToPng(result.svg, {
          fit: { mode: "width", value: PNG_WIDTH },
        });
        expect(Buffer.compare(Buffer.from(again.png), Buffer.from(exported.png))).toBe(0);
      });

      it("9. exports PDF at the page size of the scene aspect ratio", () => {
        const [widthPart, heightPart] = example.spec.meta.aspectRatio
          .split(":")
          .map((part) => Number(part));
        const expectedHeight = Math.round(
          (PDF_WIDTH * heightPart!) / widthPart!,
        );
        const exported = svgToPdf(result.svg, {
          fit: { mode: "width", value: PDF_WIDTH },
        });
        // The file states its own header, trailer, and page size.
        expect(isPdf(exported.pdf)).toBe(true);
        expect(hasPdfTrailer(exported.pdf)).toBe(true);
        expect(pdfPageSize(exported.pdf)).toEqual({
          width: PDF_WIDTH,
          height: expectedHeight,
        });
        // Vector strokes, never a raster: every path the document strokes
        // - each hatch run of task T036 carries its strokes as subpaths -
        // arrives as one stroked PDF path, and the paper paints as the one
        // fill (task T030).
        const runPaths = regionTokens.reduce(
          (total, group) =>
            group.selfClosing
              ? total
              : total +
                innerTokens(tokens, tokens.indexOf(group)).filter(
                  (token) => token.name === "path",
                ).length,
          0,
        );
        const strokedPaths =
          runPaths +
          tokens.filter(
            (token) =>
              token.name === "path" && token.attributes["stroke"] !== undefined,
          ).length;
        expect(exported.strokeCount).toBeGreaterThanOrEqual(strokedPaths);
        expect(exported.fillCount).toBeGreaterThanOrEqual(1);
        // The same document under the same options gives the same bytes.
        const again = svgToPdf(result.svg, {
          fit: { mode: "width", value: PDF_WIDTH },
        });
        expect(
          Buffer.compare(Buffer.from(again.pdf), Buffer.from(exported.pdf)),
        ).toBe(0);
      });

      it("matches the committed golden SVG fixture", () => {
        const goldenFile = path.join(goldenDir, `${example.id}.svg`);
        if (!existsSync(goldenFile)) {
          throw new Error(
            `the golden fixture ${goldenFile} is missing; run ` +
              `"node examples/render.mjs --golden" and commit the result`,
          );
        }
        expect(result.svg).toBe(readFileSync(goldenFile, "utf8"));
      });

      it("stays well under the size budget of one full scene (task T036)", () => {
        // The compact stroke runs of task T036 hold a full scene under
        // 100 KB; the gate keeps 10 KB of headroom so a regression shows
        // before the budget is gone.
        expect(result.svg.length).toBeLessThan(90_000);
        expect(result.trace.metrics?.svgSizeBytes ?? 0).toBeLessThan(90_000);
      });
    });
  }
});

describe("acceptance: two runs of each example are byte-identical", () => {
  /** Run the render script once and hash every file it wrote. */
  function runRenderScript(): Map<string, string> {
    execFileSync(process.execPath, [renderScript], {
      cwd: repoRoot,
      stdio: "pipe",
    });
    const hashes = new Map<string, string>();
    for (const file of readdirSync(outputDir).sort()) {
      hashes.set(file, sha256(readFileSync(path.join(outputDir, file))));
    }
    return hashes;
  }

  /**
   * The trace files of one run, with the measured export durations zeroed.
   *
   * The artwork files (SVG, PNG, PDF) compare as bytes. A trace carries the
   * export timing of specification section 9E, a wall-clock measurement of
   * the run, so two runs differ in that one number and compare normalized.
   */
  function normalizedTraces(): Map<string, string> {
    const traces = new Map<string, string>();
    for (const file of readdirSync(outputDir).sort()) {
      if (!file.endsWith(".trace.json")) {
        continue;
      }
      const trace: RenderTrace = JSON.parse(
        readFileSync(path.join(outputDir, file), "utf8"),
      );
      traces.set(file, JSON.stringify(stripMeasuredDurations(trace)));
    }
    return traces;
  }

  it("writes the same SVG, PNG, and PDF bytes, and the same trace except its measured duration", () => {
    const first = runRenderScript();
    const firstTraces = normalizedTraces();
    const second = runRenderScript();
    const secondTraces = normalizedTraces();
    expect([...second.keys()]).toEqual([...first.keys()]);
    for (const [file, digest] of first) {
      if (file.endsWith(".trace.json")) {
        // The measured export duration is the one sanctioned difference
        // between two runs; it must also be present and non-negative.
        const trace: RenderTrace = JSON.parse(
          readFileSync(path.join(outputDir, file), "utf8"),
        );
        expect(trace.metrics?.exportDurationMs).toBeGreaterThanOrEqual(0);
        expect(secondTraces.get(file), `${file} differs between two runs`).toBe(
          firstTraces.get(file),
        );
        continue;
      }
      expect(second.get(file), `${file} differs between two runs`).toBe(digest);
    }
  });

  it("writes the four artifacts of every scene", () => {
    const files = runRenderScript();
    const expected = examples
      .flatMap((example) => [
        `${example.id}.svg`,
        `${example.id}.png`,
        `${example.id}.pdf`,
        `${example.id}.trace.json`,
      ])
      .sort();
    expect([...files.keys()]).toEqual(expected);
  });

  it("writes the same bytes the gate rendered in this process", () => {
    runRenderScript();
    for (const { example, result } of renders) {
      const svg = readFileSync(path.join(outputDir, `${example.id}.svg`));
      expect(svg.toString("utf8")).toBe(result.svg);
      const png = svgToPng(result.svg, {
        fit: { mode: "width", value: PNG_WIDTH },
      });
      expect(
        Buffer.compare(
          readFileSync(path.join(outputDir, `${example.id}.png`)),
          Buffer.from(png.png),
        ),
      ).toBe(0);
      const pdf = svgToPdf(result.svg, {
        fit: { mode: "width", value: PDF_WIDTH },
      });
      expect(
        Buffer.compare(
          readFileSync(path.join(outputDir, `${example.id}.pdf`)),
          Buffer.from(pdf.pdf),
        ),
      ).toBe(0);
      const trace = JSON.parse(
        readFileSync(path.join(outputDir, `${example.id}.trace.json`), "utf8"),
      );
      // The measured export duration differs per run, so both sides strip it.
      expect(stripMeasuredDurations(trace)).toEqual(
        stripMeasuredDurations(result.trace),
      );
    }
  });
});

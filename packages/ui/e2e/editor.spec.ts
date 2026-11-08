/**
 * The Playwright smoke suite of the editor (task T026, specification
 * sections 11, 21, 23, and 24).
 *
 * The acceptance under test: the page loads a spec, edits it through the
 * edit operations, re-renders, and exports SVG and PNG. The suite runs
 * against the production bundle (`vite preview` of the built app), so the
 * pipeline it exercises - the real engine, the real generators, Paper.js
 * - is the one a release ships, all inside the page.
 *
 * Two probes carry most of the "re-rendered" half of the claim:
 *
 * - the spec hash in the canvas footer, which names the render identity
 *   (specification sections 9 and 10) and must move whenever an edit
 *   changes the scene;
 * - the overlay groups of the debug block, which the renderer adds one
 *   of per enabled flag and removes when the flag goes off.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test, type Page } from "@playwright/test";

/** This directory, for the download scratch. */
const e2eDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

/** The PNG signature: the eight bytes every PNG file starts with. */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** The spec hash the canvas footer shows right now. */
async function specHash(page: Page): Promise<string> {
  return (await page.getByTestId("spec-hash").textContent()) ?? "";
}

/** The stroke count the canvas footer shows right now. */
async function strokeCount(page: Page): Promise<number> {
  const text = (await page.getByTestId("metrics").textContent()) ?? "";
  const match = /(\d+) strokes/.exec(text);
  if (match === null) {
    throw new Error(`the metrics footer shows no stroke count: "${text}"`);
  }
  return Number(match[1]);
}

test("loads a spec, edits it through the operations, re-renders, and exports", async ({
  page,
}) => {
  await page.goto("/");

  // The page opens on a starter scene and renders it once.
  await expect(page.getByTestId("canvas").locator("svg")).toHaveCount(1);
  await expect(page.getByTestId("metrics")).toContainText("strokes");
  const initialHash = await specHash(page);

  // The object list shows the starter scene, grouped under its layers.
  await expect(page.getByTestId("object-list").locator(".layer-name")).toHaveCount(4);

  // The inspector opens on one selected object.
  await page.getByTestId("object-tree-1").click();
  await expect(page.getByTestId("inspector")).toContainText("tree-1");

  // moveObject: the position field commits one operation, the scene
  // re-renders, and the render identity moves.
  await page.getByTestId("pos-x").fill("0.6");
  await page.getByTestId("pos-x").press("Enter");
  await expect(page.getByTestId("spec-hash")).not.toHaveText(initialHash);
  const movedHash = await specHash(page);

  // patchComposition: the negative-space field patches the composition
  // block, and the re-render opens the hatch, so the same scene draws
  // fewer strokes on emptier paper (task T048).
  const movedStrokes = await strokeCount(page);
  await page.getByTestId("negative-space").fill("0.95");
  await page.getByTestId("negative-space").press("Enter");
  await expect(page.getByTestId("spec-hash")).not.toHaveText(movedHash);
  await expect.poll(() => strokeCount(page)).toBeLessThan(movedStrokes);
  const composedHash = await specHash(page);

  // replaceObject: the kind select swaps the generator and keeps the
  // placement the patch leaves out.
  await page.getByTestId("kind").selectOption("bench");
  await expect(page.getByTestId("object-list")).toContainText("bench");
  await expect(page.getByTestId("spec-hash")).not.toHaveText(composedHash);

  // setStyle: one hatch control writes one dotted style path.
  const replacedHash = await specHash(page);
  await page.getByTestId("hatch-sky-spacing").fill("9");
  await page.getByTestId("hatch-sky-spacing").press("Enter");
  await expect(page.getByTestId("spec-hash")).not.toHaveText(replacedHash);

  // addObject: the add form appends one object under a fresh id.
  await page.getByTestId("add-kind").selectOption("tram");
  await page.getByTestId("add-id").fill("tram-1");
  await page.getByTestId("add-object").click();
  await expect(page.getByTestId("object-tram-1")).toBeVisible();

  // removeObject: the row remove button drops the object.
  await page.getByTestId("delete-tram-1").click();
  await expect(page.getByTestId("object-tram-1")).toHaveCount(0);

  // The seed field and the preset picker own the render identity.
  const styledHash = await specHash(page);
  await page.getByTestId("seed-input").fill("424242");
  await page.getByTestId("seed-input").press("Enter");
  await expect(page.getByTestId("spec-hash")).not.toHaveText(styledHash);
  await page.getByTestId("preset-select").selectOption("urban-v1");
  await expect(page.getByTestId("metrics")).toContainText("strokes");
  await expect(page.getByTestId("error")).toHaveCount(0);

  // A debug toggle adds exactly one overlay layer, and switching it off
  // removes it again (specification section 9). The document names its
  // overlays by `data-layer`, the contract the renderer states.
  await page.getByTestId("debug-showRegions").check();
  await expect(
    page.getByTestId("canvas").locator('[data-layer="debug-regions"]'),
  ).toHaveCount(1);
  await page.getByTestId("debug-showRegions").uncheck();
  await expect(
    page.getByTestId("canvas").locator('[data-layer="debug-regions"]'),
  ).toHaveCount(0);

  // Export SVG: the download holds the canonical document.
  const svgDownload = page.waitForEvent("download");
  await page.getByTestId("export-svg").click();
  const svgPath = path.join(e2eDir, "..", "test-results", "smoke-export.svg");
  await (await svgDownload).saveAs(svgPath);
  const svgText = readFileSync(svgPath, "utf8");
  expect(svgText).toContain("<svg");
  expect(svgText).toContain("</svg>");

  // Export PNG: the download holds one raster of those same bytes.
  const pngDownload = page.waitForEvent("download");
  await page.getByTestId("export-png").click();
  const pngPath = path.join(e2eDir, "..", "test-results", "smoke-export.png");
  await (await pngDownload).saveAs(pngPath);
  const pngBytes = readFileSync(pngPath);
  expect(pngBytes.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
});

test("loads a spec through the spec panel and the starter picker", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("canvas").locator("svg")).toHaveCount(1);

  // Apply one authored spec: a single tree under a new scene id, with the
  // composition pointing at it (a focal point that names no object is
  // rejected by the schema).
  const spec = JSON.parse(await page.getByTestId("spec-json").inputValue()) as {
    meta: { id: string };
    composition: { focalPoints: string[] };
    objects: unknown[];
  };
  spec.meta.id = "smoke-scene";
  spec.composition.focalPoints = ["solo-tree"];
  spec.objects = [
    {
      id: "solo-tree",
      kind: "tree",
      role: "focal",
      position: { x: 0.5, y: 0.85 },
      scale: 2,
    },
  ];
  await page.getByTestId("spec-json").fill(JSON.stringify(spec, null, 2));
  await page.getByTestId("apply-spec").click();

  await expect(page.getByTestId("object-solo-tree")).toBeVisible();
  await expect(page.getByTestId("object-list").locator(".object-row")).toHaveCount(1);
  await expect(page.getByTestId("error")).toHaveCount(0);
  const importedHash = await specHash(page);

  // The starter picker re-opens a shipped scene.
  await page.getByTestId("starter-select").selectOption("mountain-lake-0002");
  await expect(page.getByTestId("object-list").locator(".object-row").first()).toBeVisible();
  await expect(page.getByTestId("spec-hash")).not.toHaveText(importedHash);
  await expect(page.getByTestId("canvas").locator("svg")).toHaveCount(1);
});

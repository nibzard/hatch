/**
 * The visual regression suite over the PNG output (task T024,
 * specification sections 20 and 24).
 *
 * One committed baseline per case serves two independent comparisons:
 *
 * 1. A byte comparison in Node, outside `toHaveScreenshot`: the PNG bytes
 *    of a fresh render must equal the committed baseline. PNG is a
 *    lossless encoding, so a raster that differs in one pixel always
 *    encodes to different bytes. This comparison has no tolerance and no
 *    heuristic, so it sees every one-pixel drift, wherever it lands.
 * 2. A browser comparison in headless Chromium: the page shows the PNG the
 *    exporter wrote, at one image pixel per device pixel, and
 *    `toHaveScreenshot` matches the pixels the browser shows against the
 *    same baseline. This validates the raster on the browser platform.
 *
 * The byte comparison exists because of a blind spot in the browser one.
 * The comparator behind `toHaveScreenshot` is pixelmatch with its
 * antialiasing detection on, and Playwright exposes no switch for it. That
 * detection drops a lone differing pixel whenever its 3x3 neighbourhood
 * looks like an antialiased edge, whatever `maxDiffPixels: 0` says. The
 * strictness test below proves the blind spot on a real case: it repaints
 * exactly the corner pixel (0,0) through the real exporter, a drift the
 * browser comparison accepts, and asserts that the byte comparison fails.
 *
 * A render change that moves pixels is a failure by design. After a
 * deliberate change, regenerate the baselines with
 * `pnpm --filter @hatch/gate run test:visual:update` and commit the result,
 * the same way `examples/render.mjs --golden` maintains the SVG fixtures.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { isPng, pngDimensions, svgToPng } from "@hatch/export";
import { createV1Engine } from "@hatch/renderer-svg";

import {
  baselineFile,
  baselinesDir,
  PNG_WIDTH,
  renderedCase,
  visualCases,
  type RenderedCase,
  type VisualCase,
} from "./scenes.js";

/** Every case of the suite, read once at collection time. */
const cases = visualCases();

/** The command that rewrites the committed baselines. */
const UPDATE_COMMAND = "pnpm --filter @hatch/gate run test:visual:update";

/** One PNG as a data URL, so the page needs no server and no file access. */
function pngDataUrl(png: Uint8Array): string {
  return `data:image/png;base64,${Buffer.from(png).toString("base64")}`;
}

/** True when two PNG byte sequences hold the same bytes. */
function bytesEqual(one: Uint8Array, two: Uint8Array): boolean {
  return Buffer.compare(Buffer.from(one), Buffer.from(two)) === 0;
}

/** The bytes of one committed baseline, or a failure that names the fix. */
function baselineBytes(id: string): Buffer {
  const file = baselineFile(id);
  if (!existsSync(file)) {
    throw new Error(
      `the baseline ${file} is missing; run "${UPDATE_COMMAND}" and commit the result`,
    );
  }
  return readFileSync(file);
}

/**
 * Show one PNG on the page, at its own pixel size.
 *
 * The image sits at the origin of a margin-free page, so the element
 * screenshot of the image holds exactly the raster the exporter wrote: one
 * image pixel per device pixel, no scaling, no reflow. `waitUntil: "load"`
 * completes once the image decoded.
 */
async function showImage(
  page: Page,
  dataUrl: string,
  width: number,
  height: number,
): Promise<Locator> {
  const images = await showImages(page, [dataUrl], width, height);
  return images.first();
}

/**
 * Show PNGs on the page, stacked at the origin of a margin-free page.
 *
 * The first image decides the layout the way {@link showImage} describes.
 * The ones behind it sit at the same corner, so no test that reads the
 * rasters through the `img` elements depends on the page order.
 */
async function showImages(
  page: Page,
  dataUrls: string[],
  width: number,
  height: number,
): Promise<Locator> {
  await page.setViewportSize({ width, height });
  await page.setContent(
    [
      "<!doctype html>",
      "<style>html,body{margin:0;padding:0;background:#ffffff}",
      "img{display:block;position:absolute;left:0;top:0}</style>",
      ...dataUrls.map((dataUrl) => `<img alt="golden image" src="${dataUrl}">`),
    ].join(""),
    { waitUntil: "load" },
  );
  const images = page.locator("img");
  await images.last().waitFor();
  return images;
}

/**
 * In-page script: the first pixel of the last image on the page, as
 * `[r, g, b, a]`.
 *
 * The script runs as an expression string, because the workspace shares
 * one `tsconfig` whose library is Node, not the DOM. It reads the image
 * from the page, so it needs no argument.
 */
const FIRST_PIXEL = `(() => {
  const shown = document.querySelectorAll("img");
  const image = shown.item(shown.length - 1);
  if (image === null) throw new Error("the page shows no golden image");
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("the page has no 2d canvas context");
  context.drawImage(image, 0, 0);
  return Array.from(context.getImageData(0, 0, 1, 1).data);
})()`;

/**
 * In-page script: the rasters of the images on the page, compared byte by
 * byte.
 *
 * This is the exact counterpart of the comparison behind
 * `toHaveScreenshot`, minus its antialiasing detection: one decode per
 * image, one pass over every byte of both rasters, no tolerance, no
 * dropped pixel. It returns the total number of differing pixels and the
 * coordinates of the first eight, so a test can assert both the count and
 * the position of a drift.
 *
 * The round trip through a canvas is lossless, so the comparison sees the
 * PNG data as it was encoded. The script reads the images from the page,
 * so it needs no argument.
 */
const EXACT_PIXEL_DIFF = `(() => {
  const shown = document.querySelectorAll("img");
  if (shown.length < 2) throw new Error("the page shows fewer than two images");
  const raster = (image) => {
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("the page has no 2d canvas context");
    context.drawImage(image, 0, 0);
    return context.getImageData(0, 0, canvas.width, canvas.height);
  };
  const one = raster(shown.item(0));
  const two = raster(shown.item(1));
  if (one.width !== two.width || one.height !== two.height) {
    throw new Error(
      "the two rasters differ in size: " +
        one.width + "x" + one.height + " and " + two.width + "x" + two.height,
    );
  }
  let count = 0;
  const pixels = [];
  for (let pixel = 0; pixel < one.width * one.height; pixel += 1) {
    const offset = pixel * 4;
    let differs = false;
    for (let channel = 0; channel < 4; channel += 1) {
      if (one.data[offset + channel] !== two.data[offset + channel]) {
        differs = true;
        break;
      }
    }
    if (!differs) continue;
    count += 1;
    if (pixels.length < 8) {
      pixels.push({ x: pixel % one.width, y: Math.floor(pixel / one.width) });
    }
  }
  return { count, pixels };
})()`;

/** The SVG root element of one document: the first `<svg ...>` tag. */
function svgRoot(svg: string): string {
  const root = /<svg[^>]*>/.exec(svg);
  if (root === null) {
    throw new Error("the rendered document holds no <svg> root element");
  }
  return root[0]!;
}

/** One numeric attribute of the SVG root, checked for a usable value. */
function rootNumber(root: string, attribute: string): number {
  const match = new RegExp(`${attribute}="([\\d.]+)"`).exec(root);
  if (match === null) {
    throw new Error(`the SVG root carries no ${attribute} attribute`);
  }
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`the SVG root ${attribute} "${match[1]}" is no usable size`);
  }
  return value;
}

/**
 * Re-render one case with exactly one device pixel repainted: the corner
 * pixel (0,0), the position whose neighbourhood pixelmatch's antialiasing
 * detection treats as an edge.
 *
 * The repaint is one `<rect>` the size of that device pixel, appended as
 * the last child of the document so it paints on top, in the fill color
 * that differs from the pixel there. The same pinned exporter turns the
 * changed document into PNG bytes, so the result is a render product, not
 * a hand-edited file: whatever the encoder writes for a one-pixel drift is
 * what the byte comparison below must reject.
 */
function driftedRender(
  sceneCase: VisualCase,
  rendered: RenderedCase,
  fill: string,
): Uint8Array {
  const { svg } = createV1Engine().renderScene(sceneCase.spec);
  const root = svgRoot(svg);
  // One device pixel, measured in the user units of the document.
  const width = rootNumber(root, "width") / rendered.width;
  const height = rootNumber(root, "height") / rendered.height;
  const rect =
    `<rect x="0" y="0" width="${width}" height="${height}" fill="${fill}" />`;
  const drifted = svg.replace(/<\/svg>\s*$/, `${rect}</svg>`);
  if (drifted === svg) {
    throw new Error("the repaint rect was not injected; the document ends in no </svg>");
  }
  return svgToPng(drifted, { fit: { mode: "width", value: PNG_WIDTH } }).png;
}

test.describe("the committed baselines", () => {
  test("holds one PNG per case and nothing else", () => {
    expect(readdirSync(baselinesDir).sort()).toEqual(
      cases.map((sceneCase) => `${sceneCase.id}.png`).sort(),
    );
  });

  for (const sceneCase of cases) {
    test(`${sceneCase.id}.png is a PNG at the pixel size of its scene`, () => {
      const bytes = baselineBytes(sceneCase.id);
      const rendered = renderedCase(sceneCase);
      expect(isPng(bytes)).toBe(true);
      // The pixel size must match the scene raster. The color type is the
      // encoder's own choice and stays out of the check.
      expect(pngDimensions(bytes)).toMatchObject({
        width: rendered.width,
        height: rendered.height,
      });
    });
  }
});

test.describe("the golden images", () => {
  for (const sceneCase of cases) {
    test(`re-renders ${sceneCase.id} byte-identical to its baseline`, () => {
      // The zero-tolerance gate, outside toHaveScreenshot: the committed
      // baseline holds the exporter's own bytes, so a fresh render must
      // return every one of them. PNG encoding is lossless, so a raster
      // that differs in a single pixel, wherever it sits, cannot encode to
      // the same bytes.
      const rendered = renderedCase(sceneCase);
      expect(
        bytesEqual(rendered.png, baselineBytes(sceneCase.id)),
        `the PNG export of ${sceneCase.id} drifted from its committed baseline; ` +
          `run "${UPDATE_COMMAND}" after a deliberate render change`,
      ).toBe(true);
    });

    test(`shows ${sceneCase.id} in the browser pixel-identical to its baseline`, async ({
      page,
    }) => {
      const rendered = renderedCase(sceneCase);
      const image = await showImage(
        page,
        pngDataUrl(rendered.png),
        rendered.width,
        rendered.height,
      );
      // The strictness lives in the configuration: no acceptable pixel
      // difference, no acceptable color drift. This check validates the
      // raster on the browser platform; the byte comparison above it is
      // the one that tolerates no drift at all.
      await expect(image).toHaveScreenshot(`${sceneCase.id}.png`);
    });
  }
});

test.describe("the strictness of the comparison", () => {
  test("one drifted pixel at a corner fails the byte comparison", async ({ page }) => {
    const sceneCase = cases[0]!;
    const rendered = renderedCase(sceneCase);
    const golden = baselineBytes(sceneCase.id);

    // The undrifted render is the committed golden, so the repaint below
    // is the only difference there is.
    expect(bytesEqual(rendered.png, golden)).toBe(true);

    // A fill color that differs from the pixel at the corner.
    await showImages(page, [pngDataUrl(rendered.png)], rendered.width, rendered.height);
    const corner = (await page.evaluate(FIRST_PIXEL)) as number[];
    const brightness = (corner[0]! + corner[1]! + corner[2]!) / 3;
    const fill = brightness < 128 ? "#ffffff" : "#000000";
    const drifted = driftedRender(sceneCase, rendered, fill);

    // The drift is exactly one pixel, at the corner, proven by the exact
    // in-page comparison: the same rasters, compared byte by byte, with no
    // antialiasing detection to drop the pixel.
    await showImages(
      page,
      [pngDataUrl(rendered.png), pngDataUrl(drifted)],
      rendered.width,
      rendered.height,
    );
    const diff = (await page.evaluate(EXACT_PIXEL_DIFF)) as {
      count: number;
      pixels: { x: number; y: number }[];
    };
    expect(diff.count).toBe(1);
    expect(diff.pixels).toEqual([{ x: 0, y: 0 }]);

    // The zero-tolerance gate sees the drift the browser comparison drops.
    expect(
      bytesEqual(drifted, golden),
      "one drifted pixel must fail the byte comparison",
    ).toBe(false);
  });
});

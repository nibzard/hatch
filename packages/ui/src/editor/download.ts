/**
 * The file handoff of the export panel (specification section 23).
 *
 * Every export button writes one download through a blob URL: the SVG as
 * the canonical bytes the engine produced, the PNG as the raster of them,
 * the spec as the JSON a later session re-opens. The browser records the
 * download, so the Playwright smoke suite can capture the file and check
 * its bytes.
 */

/**
 * Hand one blob to the browser as a named download.
 *
 * The anchor never joins the layout and the URL dies right after the
 * click, so repeated exports never leak object URLs.
 */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** One text file download, for the SVG document and the spec JSON. */
export function downloadText(
  filename: string,
  text: string,
  type: string,
): void {
  downloadBlob(filename, new Blob([text], { type }));
}

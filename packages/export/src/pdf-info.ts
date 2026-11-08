/**
 * Byte-level PDF inspection (task T030, specification sections 11 and 24).
 *
 * The exporter verifies its own output instead of trusting the converter:
 * a caller that writes a PDF reads the page size back out of the file,
 * not out of the option it asked for. The readers here check the header
 * every PDF file starts with, the end-of-file marker every complete one
 * ends with, and the MediaBox of the page - and stop there. Rendering
 * pages is not this package's job.
 */

import { Buffer } from "node:buffer";

/** The marker every PDF file starts with. */
export const PDF_SIGNATURE = "%PDF-";

/** The marker every complete PDF file ends with. */
export const PDF_EOF = "%%EOF";

/** The file bytes as the Latin-1 text a PDF is written in. */
function latin1Of(pdf: Uint8Array): string {
  return Buffer.from(
    pdf.buffer,
    pdf.byteOffset,
    pdf.byteLength,
  ).toString("latin1");
}

/** True when the bytes start with the PDF signature and a version. */
export function isPdf(pdf: Uint8Array): boolean {
  if (pdf.length < PDF_SIGNATURE.length + 3) {
    return false;
  }
  const head = latin1Of(pdf.subarray(0, PDF_SIGNATURE.length + 3));
  return /^%PDF-\d\.\d$/.test(head);
}

/** True when the file ends with its end-of-file marker, so nothing is truncated. */
export function hasPdfTrailer(pdf: Uint8Array): boolean {
  const tail = latin1Of(pdf.subarray(Math.max(0, pdf.length - 16)));
  return tail.trimEnd().endsWith(PDF_EOF);
}

/** What the MediaBox of the page states about its size. */
export interface PdfPageSize {
  /** Page width in points. */
  readonly width: number;
  /** Page height in points. */
  readonly height: number;
}

/** Read the first `/MediaBox [ a b c d ]` of the file as width and height. */
export function pdfPageSize(pdf: Uint8Array): PdfPageSize {
  if (!isPdf(pdf)) {
    throw new Error("these bytes are not a PDF: the header is missing");
  }
  const text = latin1Of(pdf);
  const match = /\/MediaBox\s*\[\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*\]/.exec(
    text,
  );
  if (!match) {
    throw new Error(
      "the PDF carries no /MediaBox, so its page size cannot be read",
    );
  }
  const [, left, bottom, right, top] = match;
  const numbers = [left, bottom, right, top].map((part) =>
    Number.parseFloat(part ?? ""),
  );
  if (numbers.some((part) => !Number.isFinite(part))) {
    throw new Error("the /MediaBox of the PDF holds no plain numbers");
  }
  return {
    width: (numbers[2] ?? 0) - (numbers[0] ?? 0),
    height: (numbers[3] ?? 0) - (numbers[1] ?? 0),
  };
}

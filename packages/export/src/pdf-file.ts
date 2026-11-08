/**
 * The PDF file assembler (task T030).
 *
 * One PDF file is a header, a row of numbered objects, a cross-reference
 * table, and a trailer that points back at it. The assembler writes those
 * pieces in one fixed order and computes every offset from the bytes it
 * has already written, so the same objects always assemble to the same
 * file (specification section 10).
 *
 * Nothing in a file of this assembler varies by machine: no creation
 * date, no random object id, no binary stream compression. Content
 * streams arrive as plain text, and their length is the byte length the
 * Latin-1 encoding of this file gives them.
 */

import { Buffer } from "node:buffer";

/** The PDF version the assembler writes. Clipping needs nothing newer. */
export const PDF_VERSION = "1.4";

/**
 * The document information dictionary of every export.
 *
 * It names the producer and nothing else: a creation date would break
 * byte identity between two exports of the same document, and the render
 * identity already travels inside the SVG the PDF converts.
 */
export const PDF_INFO_BODY = "<< /Producer (@hatch/export) >>";

/** Four bytes above 0x7f, the marker that tells a reader the file is binary. */
const BINARY_MARKER = "%âãÏÓ";

/**
 * Assemble one PDF file from the bodies of its objects.
 *
 * Object 1 becomes the document catalog, object 2 the page tree, object 3
 * the page, object 4 the content stream, and the last object the document
 * information dictionary, which is the layout {@link svgToPdf} writes.
 * The caller hands over plain dictionary or stream bodies; the numbers
 * and the `obj` ... `endobj` framing belong to the assembler.
 *
 * Every offset comes from the running byte count of Latin-1 text, where
 * one character is one byte, so the cross-reference table is correct by
 * construction.
 */
export function buildPdfFile(objects: readonly string[]): Uint8Array {
  if (objects.length === 0) {
    throw new Error("a PDF file needs at least one object");
  }
  const header = `%PDF-${PDF_VERSION}\n${BINARY_MARKER}\n`;
  const offsets: number[] = [];
  let body = "";
  let cursor = header.length;
  objects.forEach((objectBody, index) => {
    const chunk = `${index + 1} 0 obj\n${objectBody}\nendobj\n`;
    offsets.push(cursor);
    body += chunk;
    cursor += chunk.length;
  });

  const xrefOffset = cursor;
  const size = objects.length + 1;
  let xref = `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    xref += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  const infoNumber = objects.length;
  const trailer =
    `trailer\n<< /Size ${size} /Root 1 0 R /Info ${infoNumber} 0 R >>\n` +
    `startxref\n${xrefOffset}\n%%EOF\n`;

  const file = `${header}${body}${xref}${trailer}`;
  return new Uint8Array(Buffer.from(file, "latin1"));
}

/**
 * Byte-level PNG inspection (specification sections 11 and 24).
 *
 * The exporter verifies its own output instead of trusting the rasterizer:
 * a caller that writes a PNG reads the pixel size back out of the file, not
 * out of the option it asked for. The readers here walk the eight signature
 * bytes and the IHDR chunk, the first chunk of every PNG file, and stop
 * there. Decoding pixels is not this package's job.
 */

/** The signature bytes every PNG file starts with. */
export const PNG_SIGNATURE = Uint8Array.of(
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
);

/** The type marker of the header chunk, always the first chunk. */
const IHDR_TYPE = "IHDR";

/** Where the signature ends and the first chunk header starts. */
const SIGNATURE_BYTES = PNG_SIGNATURE.length;

/** The chunk header: four length bytes then four type bytes. */
const CHUNK_HEADER_BYTES = 8;

/** The whole header: signature, first chunk header, and the IHDR body. */
const FILE_HEADER_BYTES = SIGNATURE_BYTES + CHUNK_HEADER_BYTES + 13;

/** True when the bytes start with the PNG signature. */
export function isPng(png: Uint8Array): boolean {
  if (png.length < SIGNATURE_BYTES) {
    return false;
  }
  return PNG_SIGNATURE.every(
    (byte, index) => png[index] === byte,
  );
}

/** Read one big-endian 32-bit integer at `offset`. */
function readUint32(png: Uint8Array, offset: number): number {
  return (
    (((png[offset] ?? 0) << 24) |
      ((png[offset + 1] ?? 0) << 16) |
      ((png[offset + 2] ?? 0) << 8) |
      (png[offset + 3] ?? 0)) >>>
    0
  );
}

/**
 * The pixel size of one PNG file, read from its header.
 *
 * Throws one readable error when the bytes are not a PNG or the header is
 * truncated, so a caller never mistakes a failed export for a small one.
 */
export function pngDimensions(png: Uint8Array): PngDimensions {
  if (!isPng(png)) {
    throw new Error("these bytes are not a PNG: the signature is missing");
  }
  if (png.length < FILE_HEADER_BYTES) {
    throw new Error(
      `the PNG header is truncated: ${png.length} byte(s), ` +
        `${FILE_HEADER_BYTES} needed`,
    );
  }
  const type = String.fromCharCode(...png.subarray(12, 16));
  if (type !== IHDR_TYPE) {
    throw new Error(
      `the first PNG chunk is "${type}", not "${IHDR_TYPE}": ` +
        "the file is not a PNG image",
    );
  }
  return {
    width: readUint32(png, 16),
    height: readUint32(png, 20),
    bitDepth: png[24] ?? 0,
    colorType: png[25] ?? 0,
  };
}

/** What the header of one PNG file states about its raster. */
export interface PngDimensions {
  /** Pixel width. */
  readonly width: number;
  /** Pixel height. */
  readonly height: number;
  /** Sample depth per channel, 8 for the exports of this package. */
  readonly bitDepth: number;
  /** PNG color type, 6 for the RGBA rasters resvg writes. */
  readonly colorType: number;
}

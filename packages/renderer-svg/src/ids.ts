/**
 * Ids for `url(#...)` references inside one SVG document.
 *
 * Masks and clip paths are referenced by fragment id, so their ids must stay
 * XML-safe (name characters only) and unique inside the document. Raw ids
 * come from the scene spec, which allows any non-empty string, so every id
 * passes through one sanitizer and one allocator before it reaches the
 * output.
 */

/**
 * Characters an id keeps. Everything else collapses into one hyphen, which
 * keeps ids readable: `cloud bank/1` becomes `cloud-bank-1`.
 */
const SAFE_ID_CHARACTERS = /[^A-Za-z0-9_-]+/g;

/** Leading hyphens drop away, so the prefix always starts the id. */
const LEADING_HYPHENS = /^-+/;

/**
 * Build one XML-safe id from a prefix and a raw id.
 *
 * The prefix names the kind of reference, for example `m` for a mask or
 * `clip` for a clip path, and keeps ids of different kinds from colliding.
 * An empty or fully unsafe raw id still yields a usable body.
 */
export function sanitizeId(prefix: string, raw: string): string {
  const cleaned = raw
    .replace(SAFE_ID_CHARACTERS, "-")
    .replace(LEADING_HYPHENS, "");
  const body = cleaned.length === 0 ? "id" : cleaned;
  return `${prefix}-${body}`;
}

/**
 * Hands out ids that are unique inside one document.
 *
 * The allocator remembers every id it has issued. A second request for the
 * same id gains a numeric suffix, so two raw ids that sanitize to the same
 * text still reference two different elements.
 */
export class IdAllocator {
  private readonly issued = new Set<string>();

  /** Issue the next unique id for one raw id under one prefix. */
  take(prefix: string, raw: string): string {
    const base = sanitizeId(prefix, raw);
    if (!this.issued.has(base)) {
      this.issued.add(base);
      return base;
    }
    let counter = 2;
    let candidate = `${base}-${counter}`;
    while (this.issued.has(candidate)) {
      counter += 1;
      candidate = `${base}-${counter}`;
    }
    this.issued.add(candidate);
    return candidate;
  }
}

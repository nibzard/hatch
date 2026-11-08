/**
 * Well-formedness checks and markup extractors for the renderer tests.
 *
 * Node ships no XML parser, and round 1 pulls none in (specification
 * section 24). These helpers cover the markup the renderer emits: elements,
 * quoted attributes, and escaped text. {@link assertWellFormedXml} proves
 * the acceptance property the specification names - the output parses as
 * XML - without a host tool, so the gate runs anywhere Vitest runs.
 */

/** One parsed tag with the raw text that follows it. */
export interface TagToken {
  readonly kind: "open" | "close" | "self-closing";
  readonly name: string;
  readonly attributes: Readonly<Record<string, string>>;
  /** Offset of the tag in the markup. */
  readonly offset: number;
  /** Length of the whole tag in the markup. */
  readonly length: number;
  /** Text content that directly follows this tag, when any. */
  readonly text: string;
}

/** One attribute: `name="value"`. */
const ATTRIBUTE_PATTERN = /([A-Za-z_][A-Za-z0-9_.:-]*)="([^"]*)"/g;

/** One whole tag, including its self-closing slash. */
const TAG_PATTERN =
  /<(\/)?([A-Za-z][A-Za-z0-9_.:-]*)((?:\s+[A-Za-z_][A-Za-z0-9_.:-]*="[^"]*")*)\s*(\/)?>/g;

/** One entity reference: a name or a numeric code point. */
const ENTITY_PATTERN = /&(#[0-9]+|#x[0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/g;

/**
 * The text fragments of one gap that still hold a bare ampersand after
 * every valid entity is stripped. An empty list means the gap is clean.
 */
function strayEntities(text: string): string[] {
  const stripped = text.replaceAll(ENTITY_PATTERN, "");
  return stripped.includes("&")
    ? stripped.split(/\s+/).filter((piece) => piece.includes("&"))
    : [];
}

/** The XML declaration the renderer writes before the root element. */
const DECLARATION = /^<\?[^?]*\?>/;

/** Unescape the entities the writer escapes into. */
export function unescapeXml(text: string): string {
  return text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

/** Parse the attribute list of one tag into a name-to-value record. */
function parseAttributes(blob: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of blob.matchAll(ATTRIBUTE_PATTERN)) {
    const name = match[1];
    if (name === undefined) continue;
    if (attributes[name] !== undefined) {
      throw new Error(`duplicate attribute "${name}"`);
    }
    attributes[name] = match[2] ?? "";
  }
  // Whatever valid attributes leave behind must be whitespace only.
  const remainder = blob.replaceAll(ATTRIBUTE_PATTERN, "").trim();
  if (remainder !== "") {
    throw new Error(`unparsable attribute text "${remainder}"`);
  }
  return attributes;
}

/**
 * Report every well-formedness error the checker can find, in document
 * order. An empty list means the text parses as XML.
 */
export function xmlErrors(markup: string): string[] {
  const errors: string[] = [];
  const body = DECLARATION.test(markup)
    ? markup.replace(DECLARATION, "")
    : markup;

  const stack: string[] = [];
  let cursor = 0;
  let sawRoot = false;
  for (const match of body.matchAll(TAG_PATTERN)) {
    const gap = body.slice(cursor, match.index ?? 0);
    cursor = (match.index ?? 0) + match[0].length;
    if (gap.includes("<")) {
      errors.push(`stray "<" outside a tag: ${gap.trim()}`);
    }
    for (const piece of strayEntities(gap)) {
      errors.push(`bare ampersand in text: ${piece}`);
    }
    const name = match[2];
    if (name === undefined) continue;
    if (match[1] === "/") {
      const open = stack.pop();
      if (open === undefined) {
        errors.push(`closing tag </${name}> has no open tag`);
      } else if (open !== name) {
        errors.push(`closing tag </${name}> matches <${open}>`);
      }
    } else {
      if (stack.length === 0) {
        if (sawRoot) errors.push("more than one root element");
        sawRoot = true;
      }
      if (match[4] !== "/") stack.push(name);
      try {
        parseAttributes(match[3] ?? "");
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
  }
  if (body.slice(cursor).includes("<")) {
    errors.push("unterminated tag at end of document");
  }
  if (stack.length > 0) errors.push(`unclosed elements: ${stack.join(", ")}`);
  return errors;
}

/** Assert that one markup string parses as XML. */
export function assertWellFormedXml(markup: string): void {
  const errors = xmlErrors(markup);
  if (errors.length > 0) {
    throw new Error(`markup is not well-formed XML:\n${errors.join("\n")}`);
  }
}

/** Split one markup string into its tags, with the text after each. */
export function parseTags(markup: string): TagToken[] {
  assertWellFormedXml(markup);
  const matches = [...markup.matchAll(TAG_PATTERN)];
  return matches.map((match, index) => {
    const next = matches[index + 1];
    return {
      kind:
        match[1] === "/" ? "close" : match[4] === "/" ? "self-closing" : "open",
      name: match[2] ?? "",
      attributes: parseAttributes(match[3] ?? ""),
      offset: match.index ?? 0,
      length: match[0].length,
      text: markup
        .slice((match.index ?? 0) + match[0].length, next?.index ?? markup.length)
        .trim(),
    };
  });
}

/**
 * The names of every element that is open at one tag, outermost first.
 * Use it to prove containment, for example that the regions layer sits
 * inside its mask wrapper.
 */
export function openChain(
  tokens: readonly TagToken[],
  index: number,
): string[] {
  const chain: string[] = [];
  for (let position = 0; position < index; position += 1) {
    const token = tokens[position];
    if (token === undefined) break;
    if (token.kind === "open") chain.push(token.name);
    if (token.kind === "close") chain.pop();
  }
  return chain;
}

/** The index of the first tag that carries the given data-layer value. */
export function layerIndex(tokens: readonly TagToken[], layer: string): number {
  const index = tokens.findIndex(
    (token) => token.attributes["data-layer"] === layer,
  );
  if (index < 0) {
    throw new Error(`no element carries data-layer="${layer}"`);
  }
  return index;
}

/**
 * The full markup of one element, from the tag at `index` to its matching
 * close. Self-closing tags return just themselves.
 */
export function elementMarkup(
  markup: string,
  tokens: readonly TagToken[],
  index: number,
): string {
  const token = tokens[index];
  if (token === undefined) throw new Error("no token at that index");
  let depth = 0;
  let end = -1;
  for (let position = index; position < tokens.length; position += 1) {
    const current = tokens[position];
    if (current === undefined) break;
    if (current.kind === "open") depth += 1;
    if (current.kind === "close") depth -= 1;
    if (depth === 0) {
      end = position;
      break;
    }
  }
  const closing = tokens[end];
  if (end < 0 || closing === undefined) {
    throw new Error("no matching close tag");
  }
  // For an open element the closing token is the matching close tag; for a
  // self-closing element it is the tag itself. Both end at its last byte.
  return markup.slice(token.offset, closing.offset + closing.length);
}

/** Every `d` attribute value inside one markup slice, in order. */
export function pathDataValues(markup: string): string[] {
  return [...markup.matchAll(/<path\s[^>]*\bd="([^"]*)"/g)].map(
    (match) => match[1] ?? "",
  );
}

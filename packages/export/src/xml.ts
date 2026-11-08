/**
 * A minimal, strict XML reader (task T030).
 *
 * The SVG converter of this package reads the documents
 * `@hatch/renderer-svg` writes, so the reader covers that grammar and no
 * more: one root element, attributes, and text. It mirrors the writer of
 * `packages/renderer-svg/src/xml.ts`, which emits no CDATA, no comments,
 * and no entities beyond the five standard ones.
 *
 * Everything outside the grammar fails with one named error instead of a
 * best guess. A document type declaration is rejected outright, because it
 * opens external entities, and a converter that reads a local file through
 * an entity is a security hole, not a convenience.
 */

/** One attribute of an element. */
export interface XmlAttribute {
  /** Attribute name, for example `stroke-width`. */
  readonly name: string;
  /** Attribute value with entities already decoded. */
  readonly value: string;
}

/** One text node. */
export interface XmlText {
  readonly kind: "text";
  readonly content: string;
}

/** One element with its attributes and children. */
export interface XmlElement {
  readonly kind: "element";
  /** Tag name without any namespace prefix, for example `path`. */
  readonly name: string;
  /** Attributes in document order. */
  readonly attributes: readonly XmlAttribute[];
  /** Children in document order. */
  readonly children: readonly XmlNode[];
}

/** Any node of the parsed tree. */
export type XmlNode = XmlElement | XmlText;

/** The error every malformed input throws, so callers can match on it. */
export class XmlReadError extends Error {
  constructor(message: string) {
    super(`the XML document is not readable: ${message}`);
    this.name = "XmlReadError";
  }
}

/** Fail with one message that names the position. */
function fail(remaining: string, message: string): never {
  const column = remaining.length;
  throw new XmlReadError(`${message} (at character ${column})`);
}

/** One scanning cursor over the source string. */
class Scanner {
  private position = 0;

  constructor(private readonly source: string) {}

  /** True when the cursor reached the end of the source. */
  atEnd(): boolean {
    return this.position >= this.source.length;
  }

  /** The next character without consuming it. */
  peek(): string {
    return this.source.charAt(this.position);
  }

  /** Consume and return the next character. */
  take(): string {
    return this.source.charAt(this.position++);
  }

  /** True when the upcoming source starts with `text`. */
  startsWith(text: string): boolean {
    return this.source.startsWith(text, this.position);
  }

  /** Consume `text` when it is next; report `what` otherwise. */
  expect(text: string, what: string): void {
    if (!this.startsWith(text)) {
      fail(this.source.slice(this.position), `expected ${what}`);
    }
    this.position += text.length;
  }

  /** Consume through and past the next `marker`; fail at the end of input. */
  skipThrough(marker: string): void {
    const found = this.source.indexOf(marker, this.position);
    if (found === -1) {
      fail(
        this.source.slice(this.position),
        `the document ends before the closing "${marker}"`,
      );
    }
    this.position = found + marker.length;
  }

  /** The unparsed rest of the source, for error positions. */
  rest(): string {
    return this.source.slice(this.position);
  }
}

/** XML names start with a letter, underscore, or colon. */
function isNameStart(character: string): boolean {
  return /[A-Za-z_:]/.test(character);
}

/** XML names continue with letters, digits, dots, dashes, underscores, colons. */
function isNameCharacter(character: string): boolean {
  return /[A-Za-z0-9._:-]/.test(character);
}

/** Read one name (element or attribute) at the cursor. */
function takeName(scanner: Scanner): string {
  if (!isNameStart(scanner.peek())) {
    fail(scanner.rest(), "expected a name");
  }
  let name = scanner.take();
  while (isNameCharacter(scanner.peek())) {
    name += scanner.take();
  }
  return name;
}

/** Skip whitespace at the cursor. */
function skipWhitespace(scanner: Scanner): void {
  while (/\s/.test(scanner.peek())) {
    scanner.take();
  }
}

/**
 * Decode the standard entities of one attribute value or text run.
 *
 * Numeric references cover the decimal and hexadecimal forms; every other
 * named entity is outside the grammar and fails.
 */
function decodeEntities(value: string): string {
  return value.replaceAll(/&(#?[0-9a-zA-Z]+);/g, (_, name: string) => {
    switch (name) {
      case "amp":
        return "&";
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "quot":
        return '"';
      case "apos":
        return "'";
      default:
        break;
    }
    const numeric = /^#x([0-9A-Fa-f]+)$/.exec(name) ?? /^#([0-9]+)$/.exec(name);
    const code = numeric ? Number.parseInt(numeric[1] ?? "", numeric[0] === "#x" ? 16 : 10) : Number.NaN;
    if (!Number.isInteger(code) || code < 1 || code > 0x10ffff) {
      throw new XmlReadError(`the entity "&${name};" is outside the grammar`);
    }
    return String.fromCodePoint(code);
  });
}

/** Read one quoted attribute value. The opening quote is next. */
function takeAttributeValue(scanner: Scanner): string {
  const quote = scanner.take();
  if (quote !== '"' && quote !== "'") {
    fail(scanner.rest(), 'expected an attribute value in "quotes"');
  }
  let value = "";
  while (!scanner.atEnd() && scanner.peek() !== quote) {
    value += scanner.take();
  }
  if (scanner.atEnd()) {
    fail(scanner.rest(), "the attribute value is not closed");
  }
  scanner.take();
  return decodeEntities(value);
}

/** Read one text run up to the next `<`. */
function takeText(scanner: Scanner): string {
  let text = "";
  while (!scanner.atEnd() && scanner.peek() !== "<") {
    text += scanner.take();
  }
  return decodeEntities(text);
}

/** True when the name carries no namespace prefix or the SVG one. */
export function localName(name: string): string {
  const colon = name.indexOf(":");
  return colon === -1 ? name : name.slice(colon + 1);
}

/** Read one element, its attributes, and its children. */
function takeElement(scanner: Scanner): XmlElement {
  scanner.expect("<", "'<' to open an element");
  const name = takeName(scanner);
  const attributes: XmlAttribute[] = [];
  const children: XmlNode[] = [];
  for (;;) {
    skipWhitespace(scanner);
    const next = scanner.peek();
    if (next === ">") {
      scanner.take();
      break;
    }
    if (next === "/" && scanner.startsWith("/>")) {
      scanner.take();
      scanner.take();
      return { kind: "element", name: localName(name), attributes, children };
    }
    if (next === "") {
      fail(scanner.rest(), `the element "${name}" is not closed`);
    }
    const attributeName = takeName(scanner);
    skipWhitespace(scanner);
    scanner.expect("=", "'=' between an attribute name and its value");
    skipWhitespace(scanner);
    attributes.push({ name: attributeName, value: takeAttributeValue(scanner) });
  }

  for (;;) {
    if (scanner.startsWith("</")) {
      scanner.take();
      scanner.take();
      const closing = takeName(scanner);
      skipWhitespace(scanner);
      scanner.expect(">", "'>' to close the element");
      if (closing !== name) {
        fail("", `the element "${name}" closes as "${closing}"`);
      }
      return { kind: "element", name: localName(name), attributes, children };
    }
    if (scanner.atEnd()) {
      fail(scanner.rest(), `the element "${name}" is not closed`);
    }
    if (scanner.startsWith("<!--")) {
      scanner.skipThrough("-->");
      continue;
    }
    if (scanner.startsWith("<![CDATA[")) {
      throw new XmlReadError("CDATA sections are outside the grammar");
    }
    if (scanner.startsWith("<!")) {
      throw new XmlReadError(
        "declarations other than the XML declaration are outside the grammar",
      );
    }
    if (scanner.startsWith("<?")) {
      scanner.skipThrough("?>");
      continue;
    }
    if (scanner.peek() === "<") {
      children.push(takeElement(scanner));
      continue;
    }
    children.push({ kind: "text", content: takeText(scanner) });
  }
}

/**
 * Parse one XML document into its element tree.
 *
 * The result is the root element; the XML declaration, comments, and
 * processing instructions drop away. Blank text between elements stays in
 * the tree, so a caller that draws text can tell blank padding from real
 * characters.
 *
 * ```ts
 * const root = parseXml('<?xml version="1.0"?><svg width="4"><g /></svg>');
 * root.name; // "svg"
 * ```
 */
export function parseXml(source: string): XmlElement {
  if (typeof source !== "string" || source.length === 0) {
    throw new XmlReadError("the document is empty");
  }
  const scanner = new Scanner(source);
  skipWhitespace(scanner);
  if (scanner.startsWith("<?")) {
    scanner.skipThrough("?>");
    skipWhitespace(scanner);
  }
  if (scanner.startsWith("<!DOCTYPE")) {
    throw new XmlReadError(
      "a document type declaration is rejected: it opens external entities",
    );
  }
  if (!scanner.startsWith("<")) {
    fail(scanner.rest(), "the document carries no root element");
  }
  const root = takeElement(scanner);
  skipWhitespace(scanner);
  if (!scanner.atEnd()) {
    fail(scanner.rest(), "content follows the root element");
  }
  return root;
}

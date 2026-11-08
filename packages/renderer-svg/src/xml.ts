/**
 * A minimal, deterministic XML writer (specification sections 11 and 12).
 *
 * The renderer builds the whole document as one tree of {@link XmlElement}
 * nodes and serializes it once. Nothing here reads the DOM, spawns a
 * process, or clocks the time, so the same tree always serializes to the
 * same bytes (specification section 10).
 *
 * The writer covers the subset the renderer emits: elements, attributes,
 * and text. It knows no CDATA, comments, or namespaces beyond the attribute
 * values it is handed, which keeps escaping small enough to audit.
 */

import { formatNumber } from "./format.js";

/** One attribute value. Numbers format through the shared number writer. */
export type XmlAttributeValue = string | number;

/** One attribute of an element, written as `name="value"`. */
export interface XmlAttribute {
  /** Attribute name, for example `stroke-width`. */
  readonly name: string;
  /** Attribute value. Numbers format deterministically. */
  readonly value: XmlAttributeValue;
}

/** One text node inside an element. */
export interface XmlText {
  readonly kind: "text";
  readonly content: string;
}

/** One element with its attributes and children. */
export interface XmlElement {
  readonly kind: "element";
  /** Tag name, for example `path`. */
  readonly name: string;
  readonly attributes: readonly XmlAttribute[];
  readonly children: readonly XmlNode[];
}

/** Any node of the document tree. */
export type XmlNode = XmlElement | XmlText;

/**
 * Escape text content. The three markup delimiters are enough: quotes cannot
 * break out of text nodes.
 */
export function escapeXmlText(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/** Escape an attribute value. Quotes close attributes, so they escape too. */
export function escapeXmlAttribute(value: string): string {
  return escapeXmlText(value).replaceAll('"', "&quot;");
}

/** Build one text node. */
export function text(content: string): XmlText {
  return { kind: "text", content };
}

/** Build one element. */
export function element(
  name: string,
  attributes: readonly XmlAttribute[] = [],
  ...children: readonly XmlNode[]
): XmlElement {
  return { kind: "element", name, attributes, children };
}

/** Two spaces per nesting level, matching the project source layout. */
const INDENT = "  ";

/** Render the attribute list of one element, leading space included. */
function serializeAttributes(attributes: readonly XmlAttribute[]): string {
  return attributes
    .map((attribute) => {
      const value =
        typeof attribute.value === "number"
          ? formatNumber(attribute.value)
          : escapeXmlAttribute(attribute.value);
      return ` ${attribute.name}="${value}"`;
    })
    .join("");
}

/**
 * Serialize one node at the given depth.
 *
 * An element whose children are text only writes on one line. Every other
 * element writes one child per line, indented one level deeper.
 */
function serializeNode(node: XmlNode, depth: number): string {
  const indent = INDENT.repeat(depth);
  if (node.kind === "text") {
    return `${indent}${escapeXmlText(node.content)}`;
  }
  const open = `<${node.name}${serializeAttributes(node.attributes)}`;
  if (node.children.length === 0) {
    return `${indent}${open} />`;
  }
  const onlyText = node.children.every(
    (child) => child.kind === "text",
  );
  const inner = node.children
    .map((child) => serializeNode(child, depth + 1))
    .join("\n");
  if (onlyText) {
    return `${indent}${open}>${inner.trimStart()}</${node.name}>`;
  }
  return `${indent}${open}>\n${inner}\n${indent}</${node.name}>`;
}

/** Serialize one node tree as a complete document with a trailing newline. */
export function serializeXml(root: XmlNode): string {
  return `${serializeNode(root, 0)}\n`;
}

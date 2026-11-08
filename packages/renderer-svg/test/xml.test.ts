/**
 * Tests for the deterministic XML writer and number formatter.
 */

import { describe, expect, it } from "vitest";

import { formatNumber } from "../src/format.js";
import {
  element,
  escapeXmlAttribute,
  escapeXmlText,
  serializeXml,
  text,
} from "../src/xml.js";

import { assertWellFormedXml, xmlErrors } from "./xml-check.js";

describe("formatNumber", () => {
  it("writes integers without decoration", () => {
    expect(formatNumber(0)).toBe("0");
    expect(formatNumber(320)).toBe("320");
    expect(formatNumber(-12)).toBe("-12");
  });

  it("keeps three decimals and drops trailing zeros", () => {
    expect(formatNumber(1.5)).toBe("1.5");
    expect(formatNumber(10.25)).toBe("10.25");
    expect(formatNumber(1.234)).toBe("1.234");
    expect(formatNumber(1.2346)).toBe("1.235");
    expect(formatNumber(2.0004)).toBe("2");
  });

  it("rounds floating point noise away", () => {
    expect(formatNumber(0.1 + 0.2)).toBe("0.3");
  });

  it("collapses negative zero and tiny values to 0", () => {
    expect(formatNumber(-0)).toBe("0");
    expect(formatNumber(1e-7)).toBe("0");
    expect(formatNumber(-2e-5)).toBe("0");
  });

  it("refuses non-finite values", () => {
    expect(() => formatNumber(Number.NaN)).toThrow(/finite/);
    expect(() => formatNumber(Number.POSITIVE_INFINITY)).toThrow(/finite/);
  });
});

describe("xml escaping", () => {
  it("escapes the markup delimiters of text", () => {
    expect(escapeXmlText("a < b & c > d")).toBe("a &lt; b &amp; c &gt; d");
  });

  it("escapes the quote of attribute values", () => {
    expect(escapeXmlAttribute('say "hi" & <leave>')).toBe(
      'say &quot;hi&quot; &amp; &lt;leave&gt;',
    );
  });
});

describe("serializeXml", () => {
  it("writes empty elements self-closing on one line", () => {
    const markup = serializeXml(element("path", [{ name: "d", value: "M 0 0" }]));
    expect(markup).toBe('<path d="M 0 0" />\n');
  });

  it("writes text-only elements inline", () => {
    const markup = serializeXml(element("metadata", [], text("plain")));
    expect(markup).toBe("<metadata>plain</metadata>\n");
  });

  it("indents one level per nesting depth", () => {
    const markup = serializeXml(
      element("a", [], element("b", [], element("c", [], text("deep")))),
    );
    expect(markup).toBe("<a>\n  <b>\n    <c>deep</c>\n  </b>\n</a>\n");
  });

  it("writes escaped attribute values and formatted numbers", () => {
    const markup = serializeXml(
      element("rect", [
        { name: "width", value: 10.25 },
        { name: "fill", value: 'a"b&c' },
      ]),
    );
    expect(markup).toBe('<rect width="10.25" fill="a&quot;b&amp;c" />\n');
  });

  it("emits well-formed markup for a nested tree with text", () => {
    const markup = serializeXml(
      element(
        "svg",
        [],
        element("metadata", [], text('{"seed":1 & "<two>"}')),
        element("g", [], element("path", [{ name: "d", value: "M 0 0" }])),
      ),
    );
    expect(() => assertWellFormedXml(markup)).not.toThrow();
    expect(xmlErrors(markup)).toEqual([]);
  });
});

describe("the well-formedness check is not vacuous", () => {
  /** The errors of one markup string, joined for substring assertions. */
  const joined = (markup: string): string => xmlErrors(markup).join(" | ");

  it("catches a mismatched closing tag", () => {
    expect(joined("<a><b></a></b>")).toContain("closing tag </a> matches <b>");
  });

  it("catches an unclosed element", () => {
    expect(joined("<a><b /></a> <c>")).toContain("unclosed elements: c");
  });

  it("catches a stray angle bracket in text", () => {
    expect(joined("<a>1 < 2</a>")).toContain('stray "<" outside a tag');
  });

  it("catches a bare ampersand in text", () => {
    expect(joined("<a>fish &amp; chips & beer</a>")).toContain(
      "bare ampersand in text",
    );
  });

  it("catches a second root element", () => {
    expect(joined("<a /><b />")).toContain("more than one root element");
  });

  it("catches duplicate attributes", () => {
    expect(joined('<a b="1" b="2" />')).toContain('duplicate attribute "b"');
  });

  it("catches attribute text without a quoted value", () => {
    expect(joined('<a b="1" bare />')).toContain("unterminated tag");
  });
});

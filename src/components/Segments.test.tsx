import { render } from "@testing-library/react";
import type { Token } from "../lib/syntax";
import type { Cell } from "../types";
import { CellText, EolMarker, renderSegments } from "./Segments";

const cell = (...segments: [string, boolean?][]): Cell => ({
  line_no: 1,
  segments: segments.map(([text, changed]) => ({ text, changed: changed ?? false })),
});
const html = (node: React.ReactNode) => render(<div>{node}</div>).container.firstElementChild!.innerHTML;

describe("renderSegments", () => {
  it("renders plain text as before when there is nothing to decorate", () => {
    expect(html(renderSegments(cell(["a "], ["b", true]).segments))).toBe("<span>a </span><mark class=\"chg\">b</mark>");
  });

  it("colors tokens, splitting at token boundaries across segments", () => {
    // "const x" : const=keyword(0-5)。セグメントは "con" / "st x"（変更あり）
    const tokens: Token[] = [{ start: 0, end: 5, type: "keyword" }];
    const out = html(renderSegments(cell(["con"], ["st x", true]).segments, tokens));
    expect(out).toBe('<span><span class="tok-keyword">con</span></span><mark class="chg"><span class="tok-keyword">st</span> x</mark>');
  });

  it("ignores tokens outside the segment", () => {
    const tokens: Token[] = [{ start: 10, end: 12, type: "string" }];
    expect(html(renderSegments(cell(["abc"]).segments, tokens))).toBe("<span>abc</span>");
  });

  it("shows spaces, ideographic spaces and tabs as markers without losing the text", () => {
    const out = html(renderSegments(cell(["a  b\t\tc　d"]).segments, [], true));
    expect(out).toContain('<span class="ws">··</span>');
    expect(out).toContain('<span class="ws tab">\t\t</span>');
    expect(out).toContain('<span class="ws">□</span>');
    expect(out.replace(/<[^>]+>/g, "").replace(/·/g, " ").replace(/□/g, "　")).toBe("a  b\t\tc　d");
  });

  it("combines markers with token colors", () => {
    const tokens: Token[] = [{ start: 0, end: 3, type: "string" }];
    const out = html(renderSegments(cell(['" "x']).segments, tokens, true));
    expect(out).toContain('<span class="tok-string">"<span class="ws">·</span>"</span>');
  });
});

describe("CellText", () => {
  it("renders nothing for an empty cell", () => {
    expect(html(<CellText cell={null} />)).toBe("");
  });

  it("appends an end-of-line marker only when whitespace is shown", () => {
    expect(html(<CellText cell={cell(["x"])} />)).not.toContain("↵");
    expect(html(<CellText cell={cell(["x"])} showWs />)).toContain('<span class="ws eol" aria-hidden="true">↵</span>');
    expect(html(<EolMarker />)).toContain("↵");
  });
});

import { describe, expect, it } from "vitest";
import { eolOf, normalizeEol, withEol } from "./eol";

describe("eol helpers", () => {
  it("normalizes CRLF to LF and detects CRLF", () => {
    expect(normalizeEol("a\r\nb\r\n")).toBe("a\nb\n");
    expect(eolOf("a\r\nb")).toBe("\r\n");
    expect(eolOf("a\nb")).toBe("\n");
  });
  it("restores the original line ending", () => {
    expect(withEol("a\nb\n", "\r\n")).toBe("a\r\nb\r\n");
    expect(withEol("a\nb\n", "\n")).toBe("a\nb\n");
    expect(withEol(normalizeEol("a\r\nb\r\n"), "\r\n")).toBe("a\r\nb\r\n");
  });
});

import { findMatches, MAX_MATCHES, replaceAll, replaceMatch } from "./find";

describe("findMatches", () => {
  it("finds case-insensitive matches in line order", () => {
    expect(findMatches("Foo bar\nbaz FOO foo", "foo")).toEqual([
      { line: 1, start: 0, length: 3 },
      { line: 2, start: 4, length: 3 },
      { line: 2, start: 8, length: 3 },
    ]);
  });

  it("does not overlap matches and handles an empty query", () => {
    expect(findMatches("aaaa", "aa")).toHaveLength(2);
    expect(findMatches("abc", "")).toEqual([]);
    expect(findMatches("abc", "zzz")).toEqual([]);
  });

  it("caps the number of matches", () => {
    expect(findMatches("a\n".repeat(MAX_MATCHES + 10), "a")).toHaveLength(MAX_MATCHES);
  });
});

describe("replaceMatch / replaceAll", () => {
  const text = "one two\nTwo three\ntwo";

  it("replaces just the given match, wherever it is in the text", () => {
    const [first, second, third] = findMatches(text, "two");
    expect(replaceMatch(text, first, "2")).toBe("one 2\nTwo three\ntwo");
    expect(replaceMatch(text, second, "2")).toBe("one two\n2 three\ntwo");
    expect(replaceMatch(text, third, "22")).toBe("one two\nTwo three\n22");
  });

  it("replaces every match case-insensitively, including replacements that contain the query", () => {
    expect(replaceAll(text, "two", "2")).toBe("one 2\n2 three\n2");
    expect(replaceAll("a a", "a", "aa")).toBe("aa aa");
    expect(replaceAll("x", "y", "z")).toBe("x");
    expect(replaceAll("abc", "", "z")).toBe("abc");
    expect(replaceAll("a\nb", "\n", "|")).toBe("a|b");
  });
});

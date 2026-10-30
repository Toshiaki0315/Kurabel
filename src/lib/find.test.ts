import { findMatches, MAX_MATCHES } from "./find";

describe("findMatches", () => {
  it("finds case-insensitive matches in both texts, left first, in line order", () => {
    const m = findMatches("Foo bar\nbaz FOO foo", "x\nfoo", "foo");
    expect(m).toEqual([
      { side: "left", line: 1, start: 0, length: 3 },
      { side: "left", line: 2, start: 4, length: 3 },
      { side: "left", line: 2, start: 8, length: 3 },
      { side: "right", line: 2, start: 0, length: 3 },
    ]);
  });

  it("does not overlap matches and handles an empty query", () => {
    expect(findMatches("aaaa", "", "aa")).toHaveLength(2);
    expect(findMatches("abc", "abc", "")).toEqual([]);
    expect(findMatches("abc", "", "zzz")).toEqual([]);
  });

  it("caps the number of matches", () => {
    expect(findMatches("a\n".repeat(MAX_MATCHES + 10), "", "a")).toHaveLength(MAX_MATCHES);
  });
});

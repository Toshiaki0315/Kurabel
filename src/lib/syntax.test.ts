import { languageFor, tokenizeLines, type Language, type Token } from "./syntax";

const one = (line: string, lang: Language) => tokenizeLines([line], lang)[0];
const texts = (line: string, tokens: Token[]) => tokens.map((t) => `${t.type}:${line.slice(t.start, t.end)}`);

describe("languageFor", () => {
  it("maps extensions, case-insensitively and from full paths", () => {
    expect(languageFor("/a/b/main.rs")).toBe("rust");
    expect(languageFor("C:\\x\\App.TSX")).toBe("js");
    expect(languageFor("data.JSON")).toBe("json");
    expect(languageFor("index.html")).toBe("markup");
    expect(languageFor("style.scss")).toBe("css");
    expect(languageFor("config.yaml")).toBe("hash");
    expect(languageFor("Makefile")).toBe("hash");
    expect(languageFor("run.sh")).toBe("shell");
  });

  it("is null for unknown or missing names", () => {
    expect(languageFor("notes.txt")).toBeNull();
    expect(languageFor("README")).toBeNull();
    expect(languageFor(null)).toBeNull();
    expect(languageFor(undefined)).toBeNull();
    expect(languageFor("")).toBeNull();
  });
});

describe("code tokenizer", () => {
  it("finds keywords, strings, numbers and line comments", () => {
    const line = 'const x = "hi \\" there"; // note 42';
    expect(texts(line, one(line, "js"))).toEqual(["keyword:const", 'string:"hi \\" there"', "comment:// note 42"]);
    const n = "let a = 0x1F + 3.14e2 + 7;";
    expect(texts(n, one(n, "rust"))).toEqual(["keyword:let", "number:0x1F", "number:3.14e2", "number:7"]);
  });

  it("does not treat digits inside identifiers as numbers, nor identifiers as keywords", () => {
    const line = "var2 = if_x + 10";
    expect(texts(line, one(line, "js"))).toEqual(["number:10"]);
  });

  it("carries block comments across lines", () => {
    const t = tokenizeLines(["a /* start", "middle", "end */ b", "c"], "c");
    expect(t[0]).toEqual([{ start: 2, end: 10, type: "comment" }]);
    expect(t[1]).toEqual([{ start: 0, end: 6, type: "comment" }]);
    expect(t[2]).toEqual([{ start: 0, end: 6, type: "comment" }]);
    expect(t[3]).toEqual([]);
    // 1行で閉じるブロックコメントの後ろも続けて解析する
    const line = "/* x */ return 1";
    expect(texts(line, one(line, "c"))).toEqual(["comment:/* x */", "keyword:return", "number:1"]);
  });

  it("carries triple-quoted and template strings across lines", () => {
    const py = tokenizeLines(['x = """doc', "still doc", 'end""" + y', "z = 1"], "python");
    expect(py[0].map((t) => t.type)).toEqual(["string"]);
    expect(py[1]).toEqual([{ start: 0, end: 9, type: "string" }]);
    expect(py[2][0]).toEqual({ start: 0, end: 6, type: "string" });
    expect(py[3].map((t) => t.type)).toEqual(["number"]);
    const js = tokenizeLines(["const t = `a", "b`;", "let q = 1"], "js");
    expect(js[0].map((t) => t.type)).toEqual(["keyword", "string"]);
    expect(js[1]).toEqual([{ start: 0, end: 2, type: "string" }]);
    expect(js[2].map((t) => t.type)).toEqual(["keyword", "number"]);
    // 同じ行で閉じる三連引用符
    const line = "'''a''' + b";
    expect(texts(line, one(line, "python"))).toEqual(["string:'''a'''"]);
  });

  it("handles unterminated strings, SQL keywords in any case, and shell comments", () => {
    const line = 'x = "unterminated';
    expect(one(line, "js")).toEqual([{ start: 4, end: 17, type: "string" }]);
    const sql = "SeLeCt a FROM t -- why";
    expect(texts(sql, one(sql, "sql"))).toEqual(["keyword:SeLeCt", "keyword:FROM", "comment:-- why"]);
    const sh = 'echo "$x" # comment';
    expect(texts(sh, one(sh, "shell"))).toEqual(["keyword:echo", 'string:"$x"', "comment:# comment"]);
    expect(one("fn main() {}", "rust").map((t) => t.type)).toEqual(["keyword"]);
  });

  it("distinguishes JSON keys from values", () => {
    const line = '  "name": "kurabel", "n": 3, "ok": true';
    expect(texts(line, one(line, "json"))).toEqual(['attr:"name"', 'string:"kurabel"', 'attr:"n"', "number:3", 'attr:"ok"', "keyword:true"]);
  });

  it("recognizes CSS at-rules, hex colors and units", () => {
    const line = "@media (min-width: 10px) { a { color: #fff; } } /* c */";
    expect(texts(line, one(line, "css"))).toEqual(["keyword:@media", "number:10px", "number:#fff", "comment:/* c */"]);
    expect(one("a # b", "css")).toEqual([]); // 16進として読めない # は無視
    expect(one("@ 1", "css").map((t) => t.type)).toEqual(["number"]);
  });
});

describe("markup tokenizer", () => {
  it("finds tags, attributes, strings and comments", () => {
    const line = '<div class="a" id=b>text</div><!-- c -->';
    expect(texts(line, one(line, "markup"))).toEqual([
      "tag:<div", "attr:class", 'string:"a"', "attr:id", "attr:b", "tag:</div", "comment:<!-- c -->",
    ]);
  });

  it("carries multi-line tags and comments across lines", () => {
    const t = tokenizeLines(['<a href="x"', '   target="_b">', "<!-- one", "two -->", "<!DOCTYPE html>", "<?xml?>", "1 < 2"], "markup");
    expect(t[0].map((x) => x.type)).toEqual(["tag", "attr", "string"]);
    expect(t[1].map((x) => x.type)).toEqual(["attr", "string"]);
    expect(t[2].map((x) => x.type)).toEqual(["comment"]);
    expect(t[3].map((x) => x.type)).toEqual(["comment"]);
    expect(t[4].map((x) => x.type)).toEqual(["comment"]);
    expect(t[5].map((x) => x.type)).toEqual(["comment"]);
    expect(t[6]).toEqual([]);
    // 閉じていない引用符・宣言
    expect(tokenizeLines(['<a b="open'], "markup")[0].map((x) => x.type)).toEqual(["tag", "attr", "string"]);
    expect(tokenizeLines(["<!doctype"], "markup")[0].map((x) => x.type)).toEqual(["comment"]);
    expect(tokenizeLines(["<br />"], "markup")[0].map((x) => x.type)).toEqual(["tag"]);
  });
});

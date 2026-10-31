/** 軽量なシンタックスハイライト（外部ライブラリなし）。行ごとのトークン範囲を返す。 */

export type TokenType = "keyword" | "string" | "comment" | "number" | "tag" | "attr";

export interface Token {
  start: number;
  end: number;
  type: TokenType;
}

/** これを超える行数では、ハイライトを行わない（巨大なファイルで重くならないように） */
export const SYNTAX_MAX_LINES = 20_000;

const words = (s: string) => new Set(s.split(/\s+/).filter(Boolean));

interface Spec {
  /** 行コメントの開始文字列 */
  line: string[];
  block?: [string, string];
  /** 1行内で閉じる文字列の引用符 */
  quotes: string;
  /** 複数行にまたがる文字列の区切り（Python の三連引用符、JS のテンプレートリテラルなど） */
  multi?: string[];
  keywords: Set<string>;
  /** キーワードの大文字小文字を区別しない（SQL） */
  ci?: boolean;
  /** JSON: 文字列の直後に `:` があればキー（attr）として扱う */
  keys?: boolean;
  /** CSS: `@rule` をキーワード、`#fff` を数値として扱う */
  css?: boolean;
}

const CLIKE_COMMON =
  "if else for while do switch case default break continue return goto true false null new delete sizeof typeof void const static struct enum union typedef class public private protected this super try catch finally throw throws import package interface extends implements abstract final";
const JS_WORDS = words(
  "break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof let new null return super switch this throw true try typeof undefined var void while with yield async await of static get set interface type implements public private protected readonly namespace declare abstract as from",
);
const RUST_WORDS = words(
  "as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while",
);
const PYTHON_WORDS = words(
  "False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield self",
);
const C_WORDS = words(`${CLIKE_COMMON} int long short char float double unsigned signed bool auto register volatile extern inline NULL`);
const CPP_WORDS = words(`${CLIKE_COMMON} int long short char float double unsigned signed bool auto register volatile extern inline nullptr namespace template typename using virtual override constexpr noexcept operator friend explicit mutable`);
const JAVA_WORDS = words(`${CLIKE_COMMON} int long short char float double boolean byte synchronized volatile transient native instanceof var record`);
const GO_WORDS = words("break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var true false nil iota");
const CS_WORDS = words(`${CLIKE_COMMON} int long short char float double decimal bool byte string object var async await using namespace readonly sealed override virtual out ref params in is as lock event delegate`);
const SWIFT_WORDS = words("associatedtype class deinit enum extension fileprivate func import init inout internal let open operator private protocol public static struct subscript typealias var break case continue default defer do else fallthrough for guard if in repeat return switch where while as catch false is nil rethrows self super throw throws true try async await");
const KOTLIN_WORDS = words("as break class continue do else false for fun if in interface is null object package return super this throw true try typealias typeof val var when while by catch constructor delegate finally get import init set value where override open data sealed suspend");
const SHELL_WORDS = words("if then else elif fi for while until do done case esac in function select return exit break continue local export readonly declare unset echo cd source alias");
const SQL_WORDS = words("select from where and or not in is null like between join inner outer left right full on group by having order asc desc limit offset insert into values update set delete create table alter drop index view primary key foreign references unique default distinct as union all case when then else end exists count sum avg min max");
const CSS_WORDS = words("");
const RUBY_WORDS = words("alias and begin break case class def defined do else elsif end ensure false for if in module next nil not or redo rescue retry return self super then true undef unless until when while yield require include");
const HASH_WORDS = words("true false null yes no on off");

const SPECS: Record<string, Spec> = {
  js: { line: ["//"], block: ["/*", "*/"], quotes: "\"'", multi: ["`"], keywords: JS_WORDS },
  json: { line: [], quotes: '"', keywords: words("true false null"), keys: true },
  rust: { line: ["//"], block: ["/*", "*/"], quotes: '"', keywords: RUST_WORDS },
  python: { line: ["#"], quotes: "\"'", multi: ['"""', "'''"], keywords: PYTHON_WORDS },
  c: { line: ["//"], block: ["/*", "*/"], quotes: "\"'", keywords: C_WORDS },
  cpp: { line: ["//"], block: ["/*", "*/"], quotes: "\"'", keywords: CPP_WORDS },
  java: { line: ["//"], block: ["/*", "*/"], quotes: "\"'", keywords: JAVA_WORDS },
  go: { line: ["//"], block: ["/*", "*/"], quotes: "\"'", multi: ["`"], keywords: GO_WORDS },
  csharp: { line: ["//"], block: ["/*", "*/"], quotes: "\"'", keywords: CS_WORDS },
  swift: { line: ["//"], block: ["/*", "*/"], quotes: '"', keywords: SWIFT_WORDS },
  kotlin: { line: ["//"], block: ["/*", "*/"], quotes: "\"'", keywords: KOTLIN_WORDS },
  shell: { line: ["#"], quotes: "\"'", keywords: SHELL_WORDS },
  ruby: { line: ["#"], quotes: "\"'", keywords: RUBY_WORDS },
  sql: { line: ["--"], block: ["/*", "*/"], quotes: "'\"", keywords: SQL_WORDS, ci: true },
  css: { line: [], block: ["/*", "*/"], quotes: "\"'", keywords: CSS_WORDS, css: true },
  hash: { line: ["#"], quotes: "\"'", keywords: HASH_WORDS },
};

export type Language = keyof typeof SPECS | "markup";

const EXTENSIONS: Record<string, Language> = {
  js: "js", jsx: "js", mjs: "js", cjs: "js", ts: "js", tsx: "js", json: "json", jsonc: "json",
  rs: "rust", py: "python", c: "c", h: "c", cc: "cpp", cpp: "cpp", cxx: "cpp", hpp: "cpp", hh: "cpp",
  java: "java", go: "go", cs: "csharp", swift: "swift", kt: "kotlin", kts: "kotlin",
  sh: "shell", bash: "shell", zsh: "shell", rb: "ruby", sql: "sql", css: "css", scss: "css", less: "css",
  yml: "hash", yaml: "hash", toml: "hash", ini: "hash", conf: "hash", cfg: "hash", properties: "hash", pl: "hash", r: "hash",
  html: "markup", htm: "markup", xml: "markup", svg: "markup", xhtml: "markup", plist: "markup",
};

/** ファイル名（またはパス）から言語を判定する。不明なら null。 */
export function languageFor(path: string | null | undefined): Language | null {
  if (!path) return null;
  const name = path.split(/[\\/]/).pop() ?? "";
  if (name === "Makefile" || name === "Dockerfile") return "hash";
  const dot = name.lastIndexOf(".");
  return dot < 0 ? null : (EXTENSIONS[name.slice(dot + 1).toLowerCase()] ?? null);
}

const isDigit = (c: string | undefined) => c !== undefined && c >= "0" && c <= "9";
const isIdentStart = (c: string | undefined) => c !== undefined && /[A-Za-z_$]/.test(c);
const isIdent = (c: string | undefined) => c !== undefined && /[\w$]/.test(c);
const NUMBER = /0[xX][0-9a-fA-F_]+|0[bB][01_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?[A-Za-z%]*|\.\d+/y;
const HEX_COLOR = /#[0-9a-fA-F]{3,8}\b/y;

function scanCode(lines: string[], spec: Spec): Token[][] {
  const out: Token[][] = [];
  let inBlock = false;
  let multi: string | null = null;
  for (const line of lines) {
    const tokens: Token[] = [];
    const n = line.length;
    let i = 0;
    const push = (start: number, end: number, type: TokenType) => tokens.push({ start, end, type });
    if (inBlock) {
      const close = line.indexOf(spec.block![1]);
      const end = close < 0 ? n : close + spec.block![1].length;
      push(0, end, "comment");
      i = end;
      inBlock = close < 0;
    } else if (multi) {
      const close = line.indexOf(multi);
      const end = close < 0 ? n : close + multi.length;
      push(0, end, "string");
      i = end;
      if (close >= 0) multi = null;
    }
    while (i < n) {
      if (spec.line.some((p) => line.startsWith(p, i))) {
        push(i, n, "comment");
        break;
      }
      if (spec.block && line.startsWith(spec.block[0], i)) {
        const close = line.indexOf(spec.block[1], i + spec.block[0].length);
        const end = close < 0 ? n : close + spec.block[1].length;
        push(i, end, "comment");
        inBlock = close < 0;
        i = end;
        continue;
      }
      const opener = spec.multi?.find((d) => line.startsWith(d, i));
      if (opener) {
        const close = line.indexOf(opener, i + opener.length);
        const end = close < 0 ? n : close + opener.length;
        push(i, end, "string");
        if (close < 0) multi = opener;
        i = end;
        continue;
      }
      const ch = line[i];
      if (spec.quotes.includes(ch)) {
        let j = i + 1;
        while (j < n && line[j] !== ch) j += line[j] === "\\" ? 2 : 1;
        j = Math.min(j + 1, n);
        const isKey = spec.keys && /^\s*:/.test(line.slice(j));
        push(i, j, isKey ? "attr" : "string");
        i = j;
        continue;
      }
      if (spec.css && ch === "#") {
        HEX_COLOR.lastIndex = i;
        const m = HEX_COLOR.exec(line);
        if (m) {
          push(i, i + m[0].length, "number");
          i += m[0].length;
          continue;
        }
      }
      if (spec.css && ch === "@" && isIdentStart(line[i + 1])) {
        let j = i + 1;
        while (j < n && (isIdent(line[j]) || line[j] === "-")) j++;
        push(i, j, "keyword");
        i = j;
        continue;
      }
      if ((isDigit(ch) || (ch === "." && isDigit(line[i + 1]))) && !isIdent(line[i - 1])) {
        NUMBER.lastIndex = i;
        const m = NUMBER.exec(line);
        if (m) {
          push(i, i + m[0].length, "number");
          i += m[0].length;
          continue;
        }
      }
      if (isIdentStart(ch)) {
        let j = i + 1;
        while (j < n && isIdent(line[j])) j++;
        const word = line.slice(i, j);
        if (spec.keywords.has(spec.ci ? word.toLowerCase() : word)) push(i, j, "keyword");
        i = j;
        continue;
      }
      i++;
    }
    out.push(tokens);
  }
  return out;
}

const TAG_START = /<\/?[A-Za-z][\w:.-]*/y;

function scanMarkup(lines: string[]): Token[][] {
  const out: Token[][] = [];
  let inComment = false;
  let inTag = false;
  for (const line of lines) {
    const tokens: Token[] = [];
    const n = line.length;
    let i = 0;
    while (i < n) {
      if (inComment) {
        const close = line.indexOf("-->", i);
        const end = close < 0 ? n : close + 3;
        tokens.push({ start: i, end, type: "comment" });
        inComment = close < 0;
        i = end;
      } else if (inTag) {
        const ch = line[i];
        if (ch === ">") {
          inTag = false;
          i++;
        } else if (ch === '"' || ch === "'") {
          let j = i + 1;
          while (j < n && line[j] !== ch) j++;
          j = Math.min(j + 1, n);
          tokens.push({ start: i, end: j, type: "string" });
          i = j;
        } else if (/[^\s=>/"']/.test(ch)) {
          let j = i + 1;
          while (j < n && /[^\s=>/"']/.test(line[j])) j++;
          tokens.push({ start: i, end: j, type: "attr" });
          i = j;
        } else {
          i++;
        }
      } else if (line.startsWith("<!--", i)) {
        const close = line.indexOf("-->", i + 4);
        const end = close < 0 ? n : close + 3;
        tokens.push({ start: i, end, type: "comment" });
        inComment = close < 0;
        i = end;
      } else if (line.startsWith("<!", i) || line.startsWith("<?", i)) {
        const close = line.indexOf(">", i);
        const end = close < 0 ? n : close + 1;
        tokens.push({ start: i, end, type: "comment" });
        i = end;
      } else {
        TAG_START.lastIndex = i;
        const m = line[i] === "<" ? TAG_START.exec(line) : null;
        if (m) {
          tokens.push({ start: i, end: i + m[0].length, type: "tag" });
          i += m[0].length;
          inTag = true;
        } else {
          i++;
        }
      }
    }
    out.push(tokens);
  }
  return out;
}

/** 各行のトークン範囲を返す。複数行のコメント・文字列は、行をまたいで状態を引き継ぐ。 */
export function tokenizeLines(lines: string[], language: Language): Token[][] {
  return language === "markup" ? scanMarkup(lines) : scanCode(lines, SPECS[language]);
}

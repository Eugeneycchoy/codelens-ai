import { describe, it, expect } from "vitest";
import {
  CodeStructureDetector,
  type DocumentLike,
  type PositionLike,
  type ClassificationResult,
} from "./codeStructureDetector";

function makeDocument(
  lines: string[],
  languageId: string
): DocumentLike & { offsetAt: (position: PositionLike) => number } {
  return {
    languageId,
    lineCount: lines.length,
    lineAt(line: number) {
      if (line < 0 || line >= lines.length) {
        throw new Error(`Line ${line} out of range [0, ${lines.length})`);
      }
      return { text: lines[line] };
    },
    offsetAt(position: PositionLike) {
      let offset = 0;
      for (let i = 0; i < position.line && i < lines.length; i++) {
        offset += lines[i].length + 1;
      }
      const lineLen =
        position.line < lines.length ? lines[position.line].length : 0;
      return offset + Math.min(position.character, lineLen);
    },
  };
}

function pos(line: number, character: number): PositionLike {
  return { line, character };
}

describe("CodeStructureDetector.isComment", () => {
  const detector = new CodeStructureDetector();

  describe("TypeScript", () => {
    const lang = "typescript";

    it("returns true for single-line // comment", () => {
      const doc = makeDocument(["  // comment here", "const x = 1;"], lang);
      expect(detector.isComment(doc, pos(0, 0))).toBe(true);
      expect(detector.isComment(doc, pos(0, 4))).toBe(true);
      expect(detector.isComment(doc, pos(0, 15))).toBe(true);
    });

    it("returns false for code line", () => {
      const doc = makeDocument(["const x = 1;"], lang);
      expect(detector.isComment(doc, pos(0, 0))).toBe(false);
      expect(detector.isComment(doc, pos(0, 8))).toBe(false);
    });

    it("detects trailing inline // comment: false before marker, true at or after", () => {
      const doc = makeDocument(["const x = 1; // trailing comment"], lang);
      expect(detector.isComment(doc, pos(0, 0))).toBe(false);
      expect(detector.isComment(doc, pos(0, 12))).toBe(false);
      expect(detector.isComment(doc, pos(0, 13))).toBe(true);
      expect(detector.isComment(doc, pos(0, 15))).toBe(true);
      expect(detector.isComment(doc, pos(0, 31))).toBe(true);
    });

    it("returns true inside multi-line /* */ comment", () => {
      const doc = makeDocument(
        ["/*", "  block comment", "  more text", "*/", "const x = 1;"],
        lang
      );
      expect(detector.isComment(doc, pos(0, 0))).toBe(true);
      expect(detector.isComment(doc, pos(1, 2))).toBe(true);
      expect(detector.isComment(doc, pos(2, 5))).toBe(true);
      expect(detector.isComment(doc, pos(3, 0))).toBe(true);
    });

    it("returns false after multi-line comment closes", () => {
      const doc = makeDocument(["/* comment */", "const x = 1;"], lang);
      expect(detector.isComment(doc, pos(0, 0))).toBe(true);
      expect(detector.isComment(doc, pos(0, 12))).toBe(true);
      expect(detector.isComment(doc, pos(1, 0))).toBe(false);
    });

    it("returns true inside /** */ doc comment", () => {
      const doc = makeDocument(
        ["/**", " * JSDoc here", " * @param x", " */", "function foo() {}"],
        lang
      );
      expect(detector.isComment(doc, pos(0, 0))).toBe(true);
      expect(detector.isComment(doc, pos(1, 5))).toBe(true);
      expect(detector.isComment(doc, pos(3, 1))).toBe(true);
    });

    it("returns false on first code line after closed /** */ block", () => {
      const doc = makeDocument(
        ["/**", " * JSDoc", " */", "const x = 1;"],
        lang
      );
      expect(detector.isComment(doc, pos(3, 0))).toBe(false);
      expect(detector.isComment(doc, pos(3, 5))).toBe(false);
    });

    it("returns false for empty document", () => {
      const doc = makeDocument([], lang);
      expect(detector.isComment(doc, pos(0, 0))).toBe(false);
    });
  });

  describe("JavaScript", () => {
    const lang = "javascript";

    it("returns true for single-line // comment", () => {
      const doc = makeDocument(["// js comment", "let x = 0;"], lang);
      expect(detector.isComment(doc, pos(0, 0))).toBe(true);
      expect(detector.isComment(doc, pos(0, 10))).toBe(true);
    });

    it("returns true inside multi-line /* */ comment", () => {
      const doc = makeDocument(
        ["/*", " comment ", "*/", "console.log(1);"],
        lang
      );
      expect(detector.isComment(doc, pos(1, 1))).toBe(true);
    });

    it("returns true inside /** */ doc comment", () => {
      const doc = makeDocument(
        ["/**", " * Description", " */", "function bar() {}"],
        lang
      );
      expect(detector.isComment(doc, pos(2, 2))).toBe(true);
    });

    it("returns false on first code line after closed /** */ block", () => {
      const doc = makeDocument(
        ["/**", " * Description", " */", "let x = 0;"],
        lang
      );
      expect(detector.isComment(doc, pos(3, 0))).toBe(false);
      expect(detector.isComment(doc, pos(3, 4))).toBe(false);
    });

    it("returns false for code", () => {
      const doc = makeDocument(["const a = 1;"], lang);
      expect(detector.isComment(doc, pos(0, 0))).toBe(false);
    });

    it("detects trailing inline // comment: false before marker, true at or after", () => {
      const doc = makeDocument(["let a = 0; // js comment"], lang);
      expect(detector.isComment(doc, pos(0, 0))).toBe(false);
      expect(detector.isComment(doc, pos(0, 10))).toBe(false);
      expect(detector.isComment(doc, pos(0, 11))).toBe(true);
      expect(detector.isComment(doc, pos(0, 13))).toBe(true);
      expect(detector.isComment(doc, pos(0, 23))).toBe(true);
    });
  });

  describe("Python", () => {
    const lang = "python";

    it("returns true for single-line # comment", () => {
      const doc = makeDocument(["  # python comment", "x = 1"], lang);
      expect(detector.isComment(doc, pos(0, 0))).toBe(true);
      expect(detector.isComment(doc, pos(0, 5))).toBe(true);
    });

    it("returns false for code line", () => {
      const doc = makeDocument(["def foo():", "    return 1"], lang);
      expect(detector.isComment(doc, pos(0, 0))).toBe(false);
    });

    it("detects trailing inline # comment: false before marker, true at or after", () => {
      const doc = makeDocument(["x = 1  # inline comment"], lang);
      expect(detector.isComment(doc, pos(0, 0))).toBe(false);
      expect(detector.isComment(doc, pos(0, 6))).toBe(false);
      expect(detector.isComment(doc, pos(0, 7))).toBe(true);
      expect(detector.isComment(doc, pos(0, 9))).toBe(true);
      expect(detector.isComment(doc, pos(0, 22))).toBe(true);
    });

    it('returns true inside multi-line """ comment', () => {
      const doc = makeDocument(
        ['"""', "module docstring", "more lines", '"""', "def foo(): pass"],
        lang
      );
      expect(detector.isComment(doc, pos(0, 0))).toBe(true);
      expect(detector.isComment(doc, pos(1, 5))).toBe(true);
      expect(detector.isComment(doc, pos(2, 2))).toBe(true);
      expect(detector.isComment(doc, pos(3, 0))).toBe(true);
    });

    it('returns false after """ block closes', () => {
      const doc = makeDocument(['"""doc"""', "x = 1"], lang);
      expect(detector.isComment(doc, pos(0, 0))).toBe(true);
      expect(detector.isComment(doc, pos(1, 0))).toBe(false);
    });

    it('returns true inside """ docstring at line start', () => {
      const doc = makeDocument(
        ['"""', "Docstring line 1", "Line 2", '"""', "class A: pass"],
        lang
      );
      expect(detector.isComment(doc, pos(1, 0))).toBe(true);
      expect(detector.isComment(doc, pos(2, 3))).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("returns false when position.line is out of range", () => {
      const doc = makeDocument(["// comment"], "typescript");
      expect(detector.isComment(doc, pos(1, 0))).toBe(false);
    });

    it("returns false when position.line is negative", () => {
      const doc = makeDocument(["// comment"], "typescript");
      expect(detector.isComment(doc, pos(-1, 0))).toBe(false);
    });

    it("handles backward scan limit (multi-line start beyond 100 lines back)", () => {
      const lines = Array.from({ length: 105 }, (_, i) =>
        i === 0 ? "/*" : i === 104 ? "*/" : "  line"
      );
      const doc = makeDocument(lines, "typescript");
      expect(detector.isComment(doc, pos(104, 0))).toBe(false);
    });
  });
});

describe("CodeStructureDetector.classify", () => {
  const detector = new CodeStructureDetector();

  function expectClassify(
    lines: string[],
    lang: string,
    lineIndex: number,
    expected: ClassificationResult,
    character = 0
  ) {
    const doc = makeDocument(lines, lang);
    expect(detector.classify(doc, pos(lineIndex, character))).toBe(expected);
  }

  describe("TypeScript", () => {
    const lang = "typescript";

    it("classifies if as structural", () => {
      expectClassify(["if (x) {", "  foo();", "}"], lang, 0, "structural");
      expectClassify(["  if (condition) {"], lang, 0, "structural");
    });

    it("classifies for as structural", () => {
      expectClassify(["for (let i = 0; i < n; i++) {"], lang, 0, "structural");
    });

    it("classifies while as structural", () => {
      expectClassify(["while (running) {"], lang, 0, "structural");
    });

    it("classifies function as structural", () => {
      expectClassify(["function foo() {}"], lang, 0, "structural");
      expectClassify(["export function bar() {}"], lang, 0, "structural");
      expectClassify(["async function baz() {}"], lang, 0, "structural");
    });

    it("classifies class as structural", () => {
      expectClassify(["class A {}"], lang, 0, "structural");
      expectClassify(["export class B {}"], lang, 0, "structural");
      expectClassify(["abstract class C {}"], lang, 0, "structural");
    });

    it("classifies else/else if as structural", () => {
      expectClassify(["else {"], lang, 0, "structural");
      expectClassify(["else if (x) {"], lang, 0, "structural");
    });

    it("classifies try/catch/finally as structural", () => {
      expectClassify(["try {"], lang, 0, "structural");
      expectClassify(["catch (e) {"], lang, 0, "structural");
      expectClassify(["finally {"], lang, 0, "structural");
    });

    it("classifies switch as structural", () => {
      expectClassify(["switch (x) {"], lang, 0, "structural");
    });

    it("classifies const/let/var arrow assignments (parenthesized and short) as structural", () => {
      expectClassify(["const f = (a, b) => a + b;"], lang, 0, "structural");
      expectClassify(["const g = x => x;"], lang, 0, "structural");
      expectClassify(["let h = () => {};"], lang, 0, "structural");
    });

    it("classifies method-like signatures as structural", () => {
      expectClassify(["  foo(a, b) {"], lang, 0, "structural");
      expectClassify(["method(arg: string): void {"], lang, 0, "structural");
    });

    it("classifies React-style component declarations as structural", () => {
      expectClassify(["function MyComponent() {}"], lang, 0, "structural");
      expectClassify(["const Card = () => null;"], lang, 0, "structural");
    });

    it("classifies complex variable initializers as structural", () => {
      expectClassify(["const o = { a: 1 };"], lang, 0, "structural");
      expectClassify(["const arr = [1, 2, 3];"], lang, 0, "structural");
      expectClassify(["const c = new Foo();"], lang, 0, "structural");
    });

    it("classifies const/let/var as simple", () => {
      expectClassify(["const a = 1;"], lang, 0, "simple");
      expectClassify(["let b = 2;"], lang, 0, "simple");
      expectClassify(["var c = 3;"], lang, 0, "simple");
    });

    it("classifies return as simple", () => {
      expectClassify(["return x;"], lang, 0, "simple");
      expectClassify(["return;"], lang, 0, "simple");
    });

    it("classifies import as simple", () => {
      expectClassify(["import { x } from 'mod';"], lang, 0, "simple");
      expectClassify(["import fs from 'fs';"], lang, 0, "simple");
    });

    it("classifies export as simple", () => {
      expectClassify(["export { a };"], lang, 0, "simple");
      expectClassify(["export default foo;"], lang, 0, "simple");
    });
  });

  describe("JavaScript", () => {
    const lang = "javascript";

    it("classifies if/for/while as structural", () => {
      expectClassify(["if (x) {}"], lang, 0, "structural");
      expectClassify(["for (;;) {}"], lang, 0, "structural");
      expectClassify(["while (true) {}"], lang, 0, "structural");
    });

    it("classifies function/class as structural", () => {
      expectClassify(["function f() {}"], lang, 0, "structural");
      expectClassify(["class C {}"], lang, 0, "structural");
    });

    it("classifies try/catch/finally as structural", () => {
      expectClassify(["try {}"], lang, 0, "structural");
      expectClassify(["catch (e) {"], lang, 0, "structural");
      expectClassify(["finally {"], lang, 0, "structural");
    });

    it("classifies else/else if as structural", () => {
      expectClassify(["else {"], lang, 0, "structural");
      expectClassify(["else if (x) {"], lang, 0, "structural");
    });

    it("classifies switch as structural", () => {
      expectClassify(["switch (x) {"], lang, 0, "structural");
    });

    it("classifies const/let/var arrow assignments (parenthesized and short) as structural", () => {
      expectClassify(["const f = (a, b) => a + b;"], lang, 0, "structural");
      expectClassify(["const g = x => x;"], lang, 0, "structural");
    });

    it("classifies method-like signatures as structural", () => {
      expectClassify(["  bar(a, b) {"], lang, 0, "structural");
    });

    it("classifies React-style component declarations as structural", () => {
      expectClassify(["function App() {}"], lang, 0, "structural");
      expectClassify(["const Page = () => null;"], lang, 0, "structural");
    });

    it("classifies complex variable initializers as structural", () => {
      expectClassify(["const o = { a: 1 };"], lang, 0, "structural");
      expectClassify(["const arr = [1, 2];"], lang, 0, "structural");
      expectClassify(["const c = new Bar();"], lang, 0, "structural");
    });

    it("classifies const/let/var/return/import as simple", () => {
      expectClassify(["const x = 1;"], lang, 0, "simple");
      expectClassify(["let y = 2;"], lang, 0, "simple");
      expectClassify(["var z = 3;"], lang, 0, "simple");
      expectClassify(["return 0;"], lang, 0, "simple");
      expectClassify(["import m from 'm';"], lang, 0, "simple");
    });

    it("classifies export as simple", () => {
      expectClassify(["export { a };"], lang, 0, "simple");
      expectClassify(["export default fn;"], lang, 0, "simple");
    });
  });

  describe("Python", () => {
    const lang = "python";

    it("classifies if/elif/else as structural", () => {
      expectClassify(["if x:"], lang, 0, "structural");
      expectClassify(["elif y:"], lang, 0, "structural");
      expectClassify(["else:"], lang, 0, "structural");
    });

    it("classifies for/while as structural", () => {
      expectClassify(["for i in range(10):"], lang, 0, "structural");
      expectClassify(["while True:"], lang, 0, "structural");
    });

    it("classifies def/class as structural", () => {
      expectClassify(["def foo():"], lang, 0, "structural");
      expectClassify(["async def bar():"], lang, 0, "structural");
      expectClassify(["class A:"], lang, 0, "structural");
    });

    it("classifies try/except/finally as structural", () => {
      expectClassify(["try:"], lang, 0, "structural");
      expectClassify(["except Exception:"], lang, 0, "structural");
      expectClassify(["except:"], lang, 0, "structural");
      expectClassify(["finally:"], lang, 0, "structural");
    });

    it("classifies import/from/return as simple", () => {
      expectClassify(["import os"], lang, 0, "simple");
      expectClassify(["from x import y"], lang, 0, "simple");
      expectClassify(["return 42"], lang, 0, "simple");
      expectClassify(["return"], lang, 0, "simple");
    });
  });

  describe("indentation-based fallback", () => {
    it("classifies indented line after structural as structural", () => {
      const doc = makeDocument(
        ["if (x) {", "  doSomething();", "}"],
        "typescript"
      );
      expect(detector.classify(doc, pos(1, 0))).toBe("structural");
    });

    it("classifies indented line after def as structural (Python)", () => {
      const doc = makeDocument(["def foo():", "    x = 1"], "python");
      expect(detector.classify(doc, pos(1, 0))).toBe("structural");
    });

    it("returns unknown when line has same indent and no keyword", () => {
      const doc = makeDocument(
        ["function f() {}", "someCall();"],
        "typescript"
      );
      expect(detector.classify(doc, pos(1, 0))).toBe("unknown");
    });
  });

  describe("edge cases", () => {
    it("returns unknown for empty document or out-of-range line", () => {
      const doc = makeDocument([], "typescript");
      expect(detector.classify(doc, pos(0, 0))).toBe("unknown");
      const doc2 = makeDocument(["const x = 1;"], "typescript");
      expect(detector.classify(doc2, pos(1, 0))).toBe("unknown");
      expect(detector.classify(doc2, pos(-1, 0))).toBe("unknown");
    });

    it("returns unknown for blank line", () => {
      expectClassify(["", "const x = 1;"], "typescript", 0, "unknown");
      expectClassify(["  ", "def f():"], "python", 0, "unknown");
    });

    it("returns unknown for line with no matching pattern", () => {
      expectClassify(["foo.bar();"], "typescript", 0, "unknown");
      expectClassify(["x += 1"], "python", 0, "unknown");
    });

    it("structural wins over simple when line matches both (arrow assigned to const)", () => {
      expectClassify(["const f = () => {};"], "typescript", 0, "structural");
    });
  });
});

describe("CodeStructureDetector.isEmptyLineInBlock", () => {
  const detector = new CodeStructureDetector();

  function expectEmptyLineInBlock(
    lines: string[],
    lang: string,
    lineIndex: number,
    expected: boolean,
    character = 0
  ) {
    const doc = makeDocument(lines, lang);
    expect(detector.isEmptyLineInBlock(doc, pos(lineIndex, character))).toBe(
      expected
    );
  }

  describe("TypeScript/JavaScript", () => {
    const lang = "typescript";

    it("returns true for empty line inside function body", () => {
      const lines = [
        "function foo() {",
        "  const x = 1;",
        "",
        "  return x;",
        "}",
      ];
      expectEmptyLineInBlock(lines, lang, 2, true);
    });

    it("returns true for empty line after opening brace", () => {
      const lines = ["function foo() {", "", "  bar();", "}"];
      expectEmptyLineInBlock(lines, lang, 1, true);
    });

    it("returns true for empty line before closing brace", () => {
      const lines = ["function foo() {", "  bar();", "", "}"];
      expectEmptyLineInBlock(lines, lang, 2, true);
    });

    it("returns true for empty line in function with empty body (only braces)", () => {
      const lines = ["function foo() {", "", "}"];
      expectEmptyLineInBlock(lines, lang, 1, true);
    });

    it("returns true for empty line inside class method", () => {
      const lines = [
        "class A {",
        "  method() {",
        "    const a = 1;",
        "",
        "    return a;",
        "  }",
        "}",
      ];
      expectEmptyLineInBlock(lines, lang, 3, true);
    });

    it("returns true for empty line inside if block", () => {
      const lines = ["if (x) {", "  doSomething();", "", "  doMore();", "}"];
      expectEmptyLineInBlock(lines, lang, 2, true);
    });

    it("returns false for empty line between top-level statements", () => {
      const lines = ["const a = 1;", "", "const b = 2;"];
      expectEmptyLineInBlock(lines, lang, 1, false);
    });

    it("returns false when line is not empty", () => {
      const lines = ["function foo() {", "  const x = 1;", "  return x;", "}"];
      expectEmptyLineInBlock(lines, lang, 1, false);
      expectEmptyLineInBlock(lines, lang, 2, false);
    });
  });

  describe("nested blocks", () => {
    const lang = "typescript";

    it("returns true for empty line inside nested if within function", () => {
      const lines = [
        "function foo() {",
        "  if (x) {",
        "    bar();",
        "",
        "    baz();",
        "  }",
        "}",
      ];
      expectEmptyLineInBlock(lines, lang, 3, true);
    });

    it("returns true for empty line between outer and inner block", () => {
      const lines = [
        "function foo() {",
        "",
        "  if (x) {",
        "    bar();",
        "  }",
        "}",
      ];
      expectEmptyLineInBlock(lines, lang, 1, true);
    });

    it("returns true for multiple consecutive empty lines in block", () => {
      const lines = [
        "function foo() {",
        "  const a = 1;",
        "",
        "",
        "",
        "  const b = 2;",
        "}",
      ];
      expectEmptyLineInBlock(lines, lang, 2, true);
      expectEmptyLineInBlock(lines, lang, 3, true);
      expectEmptyLineInBlock(lines, lang, 4, true);
    });
  });

  describe("Python", () => {
    const lang = "python";

    it("returns true for empty line inside def body", () => {
      const lines = ["def foo():", "    x = 1", "", "    return x"];
      expectEmptyLineInBlock(lines, lang, 2, true);
    });

    it("returns true for empty line inside class method", () => {
      const lines = [
        "class A:",
        "    def method(self):",
        "        a = 1",
        "",
        "        return a",
      ];
      expectEmptyLineInBlock(lines, lang, 3, true);
    });

    it("returns false for empty line between top-level statements", () => {
      const lines = ["x = 1", "", "y = 2"];
      expectEmptyLineInBlock(lines, lang, 1, false);
    });

    it("returns true for empty line in nested try/except block", () => {
      const lines = [
        "def foo():",
        "    try:",
        "        bar()",
        "",
        "        baz()",
        "    except:",
        "        pass",
      ];
      expectEmptyLineInBlock(lines, lang, 3, true);
    });
  });

  describe("edge cases", () => {
    const lang = "typescript";

    it("returns false at start of file (no non-empty line above)", () => {
      const lines = ["", "const x = 1;"];
      expectEmptyLineInBlock(lines, lang, 0, false);
    });

    it("returns false at end of file (no non-empty line below)", () => {
      const lines = ["const x = 1;", ""];
      expectEmptyLineInBlock(lines, lang, 1, false);
    });

    it("returns false for empty document", () => {
      const doc = makeDocument([], lang);
      expect(detector.isEmptyLineInBlock(doc, pos(0, 0))).toBe(false);
    });

    it("returns false when position.line is out of range", () => {
      const doc = makeDocument(["", "const x = 1;"], lang);
      expect(detector.isEmptyLineInBlock(doc, pos(2, 0))).toBe(false);
      expect(detector.isEmptyLineInBlock(doc, pos(-1, 0))).toBe(false);
    });

    it("returns true for whitespace-only line in block", () => {
      const lines = ["function foo() {", "  ", "  bar();", "}"];
      expectEmptyLineInBlock(lines, lang, 1, true);
    });

    it("returns false for single empty line in single-line document", () => {
      const lines = [""];
      expectEmptyLineInBlock(lines, lang, 0, false);
    });
  });
});

describe("CodeStructureDetector integration", () => {
  const detector = new CodeStructureDetector();

  it("classify, isComment, and isEmptyLineInBlock agree on a TypeScript snippet", () => {
    const lines = [
      "// file header",
      "",
      "import { x } from 'mod';",
      "",
      "/**",
      " * JSDoc for foo",
      " */",
      "function foo() {",
      "  const a = 1;",
      "  if (a > 0) {",
      "    return a;",
      "  }",
      "  return 0;",
      "}",
      "",
      "const bar = () => {};",
    ];
    const doc = makeDocument(lines, "typescript");

    expect(detector.isComment(doc, pos(0, 0))).toBe(true);
    expect(detector.classify(doc, pos(0, 0))).toBe("unknown");

    expect(detector.isEmptyLineInBlock(doc, pos(1, 0))).toBe(false);

    expect(detector.classify(doc, pos(2, 0))).toBe("simple");
    expect(detector.isComment(doc, pos(2, 0))).toBe(false);

    expect(detector.isEmptyLineInBlock(doc, pos(3, 0))).toBe(false);

    expect(detector.isComment(doc, pos(4, 0))).toBe(true);
    expect(detector.isComment(doc, pos(5, 2))).toBe(true);
    expect(detector.isComment(doc, pos(6, 1))).toBe(true);
    expect(detector.isComment(doc, pos(7, 0))).toBe(false);

    expect(detector.classify(doc, pos(7, 0))).toBe("structural");
    expect(detector.classify(doc, pos(8, 0))).toBe("simple");
    expect(detector.classify(doc, pos(9, 0))).toBe("structural");
    expect(detector.classify(doc, pos(10, 0))).toBe("simple"); // return statement
    expect(detector.classify(doc, pos(11, 0))).toBe("unknown"); // closing brace
    expect(detector.classify(doc, pos(12, 0))).toBe("simple"); // return statement
    expect(detector.classify(doc, pos(13, 0))).toBe("unknown"); // closing brace

    expect(detector.isEmptyLineInBlock(doc, pos(15, 0))).toBe(false);
    expect(["structural", "unknown"]).toContain(
      detector.classify(doc, pos(16, 0))
    );
  });

  it("classify, isComment, and isEmptyLineInBlock agree on a Python snippet", () => {
    const lines = [
      "# module doc",
      "",
      "import os",
      "from pathlib import Path",
      "",
      "def main():",
      "    x = 1",
      "    if x:",
      "        return x",
      "    return None",
      "",
      "class Helper:",
      "    def run(self):",
      "        pass",
    ];
    const doc = makeDocument(lines, "python");

    expect(detector.isComment(doc, pos(0, 0))).toBe(true);
    expect(detector.classify(doc, pos(2, 0))).toBe("simple");
    expect(detector.classify(doc, pos(3, 0))).toBe("simple");
    expect(detector.isEmptyLineInBlock(doc, pos(4, 0))).toBe(false);

    expect(detector.classify(doc, pos(5, 0))).toBe("structural");
    expect(detector.classify(doc, pos(6, 0))).toBe("structural");
    expect(detector.classify(doc, pos(7, 0))).toBe("structural");
    expect(detector.classify(doc, pos(8, 0))).toBe("simple"); // return x
    expect(["simple", "unknown"]).toContain(detector.classify(doc, pos(10, 0)));
    expect(detector.classify(doc, pos(12, 0))).toBe("structural"); // class Helper
    expect(detector.classify(doc, pos(13, 0))).toBe("structural"); // def run
  });

  it("getLanguagePatterns returns same patterns as getPatterns and is cached", () => {
    const ts = detector.getLanguagePatterns("typescript");
    const ts2 = detector.getPatterns("typescript");
    expect(ts).toBe(ts2);
    expect(ts.comments.singleLine.test("  // x")).toBe(true);
    expect(ts.structural.function?.test("function f() {}")).toBe(true);

    const py = detector.getLanguagePatterns("python");
    expect(py.comments.singleLine.test("# y")).toBe(true);
    expect(py.structural.function?.test("def g():")).toBe(true);

    const unknown = detector.getLanguagePatterns("unknown");
    const fallback = detector.getPatterns("rust");
    expect(unknown).toBe(fallback);
    expect(detector.isSupported("unknown")).toBe(false);
    expect(detector.isSupported("typescript")).toBe(true);
  });

  it("all three detection methods work together on mixed comment/code lines", () => {
    const lines = [
      "/* block start */",
      "const x = 1; // inline",
      "  // indented comment",
      "function f() {",
      "  ",
      "  return 1;",
      "}",
    ];
    const doc = makeDocument(lines, "javascript");

    expect(detector.isComment(doc, pos(0, 5))).toBe(true);
    expect(detector.classify(doc, pos(1, 0))).toBe("simple");
    expect(detector.isComment(doc, pos(1, 14))).toBe(true);
    expect(detector.isComment(doc, pos(1, 0))).toBe(false);
    expect(detector.isComment(doc, pos(2, 2))).toBe(true);
    expect(detector.classify(doc, pos(3, 0))).toBe("structural");
    expect(detector.isEmptyLineInBlock(doc, pos(4, 0))).toBe(true);
    expect(detector.classify(doc, pos(5, 0))).toBe("simple");
  });
});

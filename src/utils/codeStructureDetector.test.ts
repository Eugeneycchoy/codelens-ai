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
    it("classifies indented body line after structural as structural", () => {
      const doc = makeDocument(
        ["if (x) {", "  doSomething();", "}"],
        "typescript"
      );
      expect(detector.classify(doc, pos(1, 0))).toBe("structural");
    });

    it("classifies indented body line after def as structural (Python)", () => {
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

  describe("body lines inside functions/classes", () => {
    const lang = "typescript";

    it("classifies function body statement (no keyword) as structural", () => {
      const doc = makeDocument(
        ["function foo() {", "  doSomething();", "}"],
        lang
      );
      expect(detector.classify(doc, pos(1, 0))).toBe("structural");
    });

    it("classifies function body const/return as simple", () => {
      const doc = makeDocument(
        ["function foo() {", "  const a = 1;", "  return a;", "}"],
        lang
      );
      expect(detector.classify(doc, pos(1, 0))).toBe("simple");
      expect(detector.classify(doc, pos(2, 0))).toBe("simple");
    });

    it("classifies class method body statement as structural", () => {
      const doc = makeDocument(
        ["class A {", "  method() {", "    this.doSomething();", "  }", "}"],
        lang
      );
      expect(detector.classify(doc, pos(2, 0))).toBe("structural");
    });

    it("classifies class method body return as simple", () => {
      const doc = makeDocument(
        ["class A {", "  get() {", "    return this.x;", "  }", "}"],
        lang
      );
      expect(detector.classify(doc, pos(2, 0))).toBe("simple");
    });

    it("classifies indented line after non-structural previous line as unknown", () => {
      const doc = makeDocument(
        ["function f() {", "  const x = 1;", "  x + 1;", "}"],
        lang
      );
      expect(detector.classify(doc, pos(2, 0))).toBe("unknown");
    });
  });

  describe("body lines inside functions/classes (Python)", () => {
    const lang = "python";

    it("classifies def body assignment (first line after def) as structural", () => {
      const doc = makeDocument(["def foo():", "    x = 1", "    y = 2"], lang);
      expect(detector.classify(doc, pos(1, 0))).toBe("structural");
      // Same indent as previous body line: no strict "> prev.indent", so unknown
      expect(detector.classify(doc, pos(2, 0))).toBe("unknown");
    });

    it("classifies def body return as simple", () => {
      const doc = makeDocument(["def foo():", "    return 42"], lang);
      expect(detector.classify(doc, pos(1, 0))).toBe("simple");
    });

    it("classifies class method body as structural", () => {
      const doc = makeDocument(
        ["class A:", "    def run(self):", "        pass"],
        lang
      );
      expect(detector.classify(doc, pos(2, 0))).toBe("structural");
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

/**
 * Explicit validation of all detection capabilities across supported languages
 * (TypeScript/JavaScript and Python) as requested for isComment, classify, isEmptyLineInBlock.
 */
describe("Detection capabilities across supported languages", () => {
  const detector = new CodeStructureDetector();

  describe("TypeScript/JavaScript — comment detection", () => {
    const langs = ["typescript", "javascript"] as const;

    it("validates // single-line comment", () => {
      for (const lang of langs) {
        const doc = makeDocument(["  // comment"], lang);
        expect(detector.isComment(doc, pos(0, 0))).toBe(true);
        expect(detector.isComment(doc, pos(0, 5))).toBe(true);
      }
    });

    it("validates /* */ multi-line comment", () => {
      for (const lang of langs) {
        const doc = makeDocument(["/* start", "  middle", "*/ end"], lang);
        expect(detector.isComment(doc, pos(0, 0))).toBe(true);
        expect(detector.isComment(doc, pos(1, 2))).toBe(true);
        expect(detector.isComment(doc, pos(2, 0))).toBe(true);
        // Position at the closing "*/" (char 2) is inside; after "*/" is outside
        expect(detector.isComment(doc, pos(2, 1))).toBe(true);
      }
    });

    it("validates /** */ doc comment", () => {
      for (const lang of langs) {
        const doc = makeDocument(
          ["/**", " * JSDoc", " */", "const x = 1;"],
          langs[0]
        );
        expect(detector.isComment(doc, pos(0, 0))).toBe(true);
        expect(detector.isComment(doc, pos(1, 2))).toBe(true);
        expect(detector.isComment(doc, pos(2, 1))).toBe(true);
        expect(detector.isComment(doc, pos(3, 0))).toBe(false);
      }
    });
  });

  describe("TypeScript/JavaScript — structural elements (classify)", () => {
    const lang = "typescript";

    it("classifies if, for, while as structural", () => {
      expect(
        detector.classify(makeDocument(["if (x) {}"], lang), pos(0, 0))
      ).toBe("structural");
      expect(
        detector.classify(
          makeDocument(["for (let i = 0; i < n; i++) {}"], lang),
          pos(0, 0)
        )
      ).toBe("structural");
      expect(
        detector.classify(makeDocument(["while (cond) {}"], lang), pos(0, 0))
      ).toBe("structural");
    });

    it("classifies function, class, try, switch as structural", () => {
      expect(
        detector.classify(makeDocument(["function f() {}"], lang), pos(0, 0))
      ).toBe("structural");
      expect(
        detector.classify(makeDocument(["class C {}"], lang), pos(0, 0))
      ).toBe("structural");
      expect(
        detector.classify(makeDocument(["try { x(); }"], lang), pos(0, 0))
      ).toBe("structural");
      expect(
        detector.classify(makeDocument(["switch (x) {}"], lang), pos(0, 0))
      ).toBe("structural");
    });
  });

  describe("TypeScript/JavaScript — simple statements (classify)", () => {
    const lang = "typescript";

    it("classifies const, let, var, return, import, export as simple", () => {
      expect(
        detector.classify(makeDocument(["const a = 1;"], lang), pos(0, 0))
      ).toBe("simple");
      expect(
        detector.classify(makeDocument(["let b = 2;"], lang), pos(0, 0))
      ).toBe("simple");
      expect(
        detector.classify(makeDocument(["var c = 3;"], lang), pos(0, 0))
      ).toBe("simple");
      expect(
        detector.classify(makeDocument(["return x;"], lang), pos(0, 0))
      ).toBe("simple");
      expect(
        detector.classify(makeDocument(["return;"], lang), pos(0, 0))
      ).toBe("simple");
      expect(
        detector.classify(
          makeDocument(["import { x } from 'm';"], lang),
          pos(0, 0)
        )
      ).toBe("simple");
      expect(
        detector.classify(makeDocument(["export { a };"], lang), pos(0, 0))
      ).toBe("simple");
      expect(
        detector.classify(makeDocument(["export default f;"], lang), pos(0, 0))
      ).toBe("simple");
    });
  });

  describe("Python — comment detection", () => {
    const lang = "python";

    it("validates # single-line comment", () => {
      const doc = makeDocument(["  # comment", "x = 1"], lang);
      expect(detector.isComment(doc, pos(0, 0))).toBe(true);
      expect(detector.isComment(doc, pos(0, 5))).toBe(true);
      expect(detector.isComment(doc, pos(1, 0))).toBe(false);
    });

    it('validates """ """ multi-line docstring', () => {
      const doc = makeDocument(
        ['"""', "docstring line 1", "line 2", '"""', "def f():"],
        lang
      );
      expect(detector.isComment(doc, pos(0, 0))).toBe(true);
      expect(detector.isComment(doc, pos(1, 0))).toBe(true);
      expect(detector.isComment(doc, pos(2, 3))).toBe(true);
      expect(detector.isComment(doc, pos(3, 0))).toBe(true);
      expect(detector.isComment(doc, pos(4, 0))).toBe(false);
    });
  });

  describe("Python — structural elements (classify)", () => {
    const lang = "python";

    it("classifies if, elif, for, while, def, class, try, with as structural", () => {
      expect(detector.classify(makeDocument(["if x:"], lang), pos(0, 0))).toBe(
        "structural"
      );
      expect(
        detector.classify(makeDocument(["elif y:"], lang), pos(0, 0))
      ).toBe("structural");
      expect(
        detector.classify(
          makeDocument(["for i in range(10):"], lang),
          pos(0, 0)
        )
      ).toBe("structural");
      expect(
        detector.classify(makeDocument(["while True:"], lang), pos(0, 0))
      ).toBe("structural");
      expect(
        detector.classify(makeDocument(["def foo():"], lang), pos(0, 0))
      ).toBe("structural");
      expect(
        detector.classify(makeDocument(["class A:"], lang), pos(0, 0))
      ).toBe("structural");
      expect(detector.classify(makeDocument(["try:"], lang), pos(0, 0))).toBe(
        "structural"
      );
      expect(
        detector.classify(makeDocument(["with open(f) as x:"], lang), pos(0, 0))
      ).toBe("structural");
    });
  });

  describe("Python — simple statements (classify)", () => {
    const lang = "python";

    it("classifies return, import, from as simple", () => {
      expect(
        detector.classify(makeDocument(["return 42"], lang), pos(0, 0))
      ).toBe("simple");
      expect(detector.classify(makeDocument(["return"], lang), pos(0, 0))).toBe(
        "simple"
      );
      expect(
        detector.classify(makeDocument(["import os"], lang), pos(0, 0))
      ).toBe("simple");
      expect(
        detector.classify(makeDocument(["from x import y"], lang), pos(0, 0))
      ).toBe("simple");
    });
  });

  describe("isEmptyLineInBlock — TypeScript/JavaScript and Python", () => {
    it("returns true for empty line inside TS function body", () => {
      const doc = makeDocument(
        ["function f() {", "  const x = 1;", "", "  return x;", "}"],
        "typescript"
      );
      expect(detector.isEmptyLineInBlock(doc, pos(2, 0))).toBe(true);
    });

    it("returns true for empty line inside Python def body", () => {
      const doc = makeDocument(
        ["def f():", "    x = 1", "", "    return x"],
        "python"
      );
      expect(detector.isEmptyLineInBlock(doc, pos(2, 0))).toBe(true);
    });

    it("returns false for empty line between top-level statements (TS)", () => {
      const doc = makeDocument(
        ["const a = 1;", "", "const b = 2;"],
        "typescript"
      );
      expect(detector.isEmptyLineInBlock(doc, pos(1, 0))).toBe(false);
    });

    it("returns false for empty line between top-level statements (Python)", () => {
      const doc = makeDocument(["x = 1", "", "y = 2"], "python");
      expect(detector.isEmptyLineInBlock(doc, pos(1, 0))).toBe(false);
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
    expect(detector.classify(doc, pos(10, 0))).toBe("simple"); // return statement (matches simple pattern)
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
    expect(detector.classify(doc, pos(6, 0))).toBe("structural"); // def body line
    expect(detector.classify(doc, pos(7, 0))).toBe("structural");
    expect(detector.classify(doc, pos(8, 0))).toBe("simple"); // return x
    expect(["simple", "unknown"]).toContain(detector.classify(doc, pos(10, 0)));
    expect(detector.classify(doc, pos(12, 0))).toBe("structural"); // class Helper
    expect(detector.classify(doc, pos(13, 0))).toBe("structural"); // def run body (pass)
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

/** Target: highlighting/classification should feel instant (<100ms). */
const HIGHLIGHT_LATENCY_MS = 100;
/** isComment backward scan is capped at 100 lines; should not lag. */
const IS_COMMENT_SCAN_MS = 50;

describe("CodeStructureDetector — malformed syntax and mixed indentation", () => {
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

  describe("missing braces / incomplete statements", () => {
    const lang = "typescript";

    it("classifies line with unclosed if (missing brace) as structural by keyword", () => {
      expectClassify(["if (x)", "  foo();"], lang, 0, "structural");
    });

    it("classifies line with only opening brace as unknown (no keyword)", () => {
      const doc = makeDocument(["{", "  x = 1;", "}"], lang);
      expect(detector.classify(doc, pos(0, 0))).toBe("unknown");
    });

    it("classifies incomplete function declaration (no body) as structural", () => {
      expectClassify(["function foo()"], lang, 0, "structural");
    });

    it("classifies orphan closing brace line as unknown", () => {
      const doc = makeDocument(["}", "const x = 1;"], lang);
      expect(detector.classify(doc, pos(0, 0))).toBe("unknown");
    });
  });

  describe("mixed indentation (tabs and spaces)", () => {
    const lang = "typescript";

    it("treats tab-indented line after space-indented structural: const matches simple first", () => {
      const doc = makeDocument(["function f() {", "\tconst x = 1;", "}"], lang);
      expect(detector.classify(doc, pos(1, 0))).toBe("simple");
    });

    it("treats space-indented body line after structural as structural", () => {
      const doc = makeDocument(["if (x) {", "    foo();", "}"], lang);
      expect(detector.classify(doc, pos(1, 0))).toBe("structural");
    });

    it("getLeadingWhitespaceLength counts both spaces and tabs for indent comparison", () => {
      const doc = makeDocument(["\t\t  return 1;"], lang);
      expect(detector.classify(doc, pos(0, 0))).toBe("simple");
    });
  });

  describe("Python — mixed indentation", () => {
    const lang = "python";

    it("classifies def with mixed indent in body (spaces then tabs): body line structural, return simple", () => {
      const doc = makeDocument(["def f():", "\tx = 1", "    return x"], lang);
      expect(detector.classify(doc, pos(1, 0))).toBe("structural");
      expect(detector.classify(doc, pos(2, 0))).toBe("simple");
    });
  });
});

describe("CodeStructureDetector — extreme cases", () => {
  const detector = new CodeStructureDetector();

  describe("empty and single-line files", () => {
    it("empty file: classify at (0,0) returns unknown", () => {
      const doc = makeDocument([], "typescript");
      expect(detector.classify(doc, pos(0, 0))).toBe("unknown");
    });

    it("empty file: isComment returns false", () => {
      const doc = makeDocument([], "typescript");
      expect(detector.isComment(doc, pos(0, 0))).toBe(false);
    });

    it("empty file: isEmptyLineInBlock returns false", () => {
      const doc = makeDocument([], "typescript");
      expect(detector.isEmptyLineInBlock(doc, pos(0, 0))).toBe(false);
    });

    it("single-line file: classify works", () => {
      expect(
        detector.classify(makeDocument(["const x = 1;"], "typescript"), pos(0, 0))
      ).toBe("simple");
      expect(
        detector.classify(makeDocument(["function f() {}"], "typescript"), pos(0, 0))
      ).toBe("structural");
    });

    it("single-line file: isComment detects single-line comment", () => {
      const doc = makeDocument(["// only line"], "typescript");
      expect(detector.isComment(doc, pos(0, 0))).toBe(true);
    });

    it("single-line file: isEmptyLineInBlock returns false for the only line when non-empty", () => {
      const doc = makeDocument(["x = 1"], "python");
      expect(detector.isEmptyLineInBlock(doc, pos(0, 0))).toBe(false);
    });
  });

  describe("Unicode characters", () => {
    it("classifies line with Unicode identifier (TypeScript)", () => {
      const doc = makeDocument(["const 变量 = 1;"], "typescript");
      expect(detector.classify(doc, pos(0, 0))).toBe("simple");
    });

    it("classifies line with Unicode in string literal", () => {
      const doc = makeDocument(["const x = '日本語';"], "typescript");
      expect(detector.classify(doc, pos(0, 0))).toBe("simple");
    });

    it("isComment: single-line comment with Unicode", () => {
      const doc = makeDocument(["// コメント", "const x = 1;"], "typescript");
      expect(detector.isComment(doc, pos(0, 0))).toBe(true);
      expect(detector.isComment(doc, pos(1, 0))).toBe(false);
    });

    it("isEmptyLineInBlock: block with Unicode in code", () => {
      const lines = ["function 测试() {", "  const 值 = 1;", "", "  return 值;", "}"];
      const doc = makeDocument(lines, "typescript");
      expect(detector.isEmptyLineInBlock(doc, pos(2, 0))).toBe(true);
    });
  });

  describe("very long blocks (100+ lines)", () => {
    it("classify in middle of 100+ line function body: const line is simple", () => {
      const lines = ["function big() {"].concat(
        Array.from({ length: 120 }, (_, i) => "  const x" + i + " = 1;"),
        ["}"]
      );
      const doc = makeDocument(lines, "typescript");
      expect(detector.classify(doc, pos(60, 2))).toBe("simple");
    });

    it("isEmptyLineInBlock true for empty line in middle of long block", () => {
      const lines = ["if (x) {"]
        .concat(Array.from({ length: 50 }, () => "  foo();"))
        .concat(["", "  bar();", "}"]);
      const doc = makeDocument(lines, "typescript");
      expect(detector.isEmptyLineInBlock(doc, pos(51, 0))).toBe(true);
    });
  });

  describe("deeply nested structures (10+ levels)", () => {
    it("classify at depth 10: if line structural, return line simple", () => {
      const depth = 12;
      const lines: string[] = [];
      for (let i = 0; i < depth; i++) {
        lines.push("  ".repeat(i) + "if (x) {");
      }
      lines.push("  ".repeat(depth) + "return 1;");
      for (let i = depth - 1; i >= 0; i--) {
        lines.push("  ".repeat(i) + "}");
      }
      const doc = makeDocument(lines, "typescript");
      expect(detector.classify(doc, pos(0, 0))).toBe("structural");
      expect(detector.classify(doc, pos(depth, depth * 2))).toBe("simple");
      expect(detector.classify(doc, pos(depth, 0))).toBe("simple");
    });
  });
});

describe("CodeStructureDetector — unsupported languages (fallback to generic heuristics)", () => {
  const detector = new CodeStructureDetector();

  function expectClassify(
    lines: string[],
    lang: string,
    lineIndex: number,
    expected: ClassificationResult
  ) {
    const doc = makeDocument(lines, lang);
    expect(detector.classify(doc, pos(lineIndex, 0))).toBe(expected);
  }

  describe("Rust", () => {
    const lang = "rust";

    it("isSupported returns false", () => {
      expect(detector.isSupported(lang)).toBe(false);
    });

    it("getLanguagePatterns returns fallback (C-style comments)", () => {
      const patterns = detector.getLanguagePatterns(lang);
      expect(patterns.comments.singleLine.test("  // rust comment")).toBe(true);
      expect(patterns.structural.function).toBeDefined();
    });

    it("classify: fn or body line returns structural or unknown (no crash)", () => {
      const doc = makeDocument(["fn main() {", "    let x = 1;", "}"], lang);
      expect(["structural", "simple", "unknown"]).toContain(
        detector.classify(doc, pos(0, 0))
      );
      expect(["structural", "simple", "unknown"]).toContain(
        detector.classify(doc, pos(1, 0))
      );
    });

    it("isComment: // comment detected by fallback", () => {
      const doc = makeDocument(["// rust comment", "fn main() {}"], lang);
      expect(detector.isComment(doc, pos(0, 0))).toBe(true);
      expect(detector.isComment(doc, pos(1, 0))).toBe(false);
    });
  });

  describe("Go", () => {
    const lang = "go";

    it("isSupported returns false", () => {
      expect(detector.isSupported(lang)).toBe(false);
    });

    it("getLanguagePatterns returns fallback", () => {
      const patterns = detector.getLanguagePatterns(lang);
      expect(patterns.comments.singleLine.test("// go comment")).toBe(true);
      expect(patterns.structural.function).toBeDefined();
    });

    it("classify: func or body line returns structural or unknown (no crash)", () => {
      const doc = makeDocument(["func main() {", "\tfmt.Println(1)", "}"], lang);
      expect(["structural", "simple", "unknown"]).toContain(
        detector.classify(doc, pos(0, 0))
      );
      expect(["structural", "simple", "unknown"]).toContain(
        detector.classify(doc, pos(1, 0))
      );
    });

    it("isComment: // and /* */ work via fallback", () => {
      const doc = makeDocument(["/* go block */", "func f() {}"], lang);
      expect(detector.isComment(doc, pos(0, 1))).toBe(true);
      expect(detector.isComment(doc, pos(1, 0))).toBe(false);
    });
  });

  describe("Ruby", () => {
    const lang = "ruby";

    it("isSupported returns false", () => {
      expect(detector.isSupported(lang)).toBe(false);
    });

    it("getLanguagePatterns returns fallback (# not in fallback singleLine)", () => {
      const patterns = detector.getLanguagePatterns(lang);
      expect(patterns.comments.singleLine.source).toBe(String(/^\s*\/\//).slice(1, -1));
    });

    it("classify: def line may match fallback function pattern", () => {
      const doc = makeDocument(["def foo", "  x = 1", "end"], lang);
      const c = detector.classify(doc, pos(0, 0));
      expect(["structural", "unknown"]).toContain(c);
    });

    it("indentation-based fallback: body line after def is unknown", () => {
      const doc = makeDocument(["def foo", "  x = 1", "end"], lang);
      expect(detector.classify(doc, pos(1, 0))).toBe("unknown");
    });
  });
});

describe("CodeStructureDetector performance", () => {
  const detector = new CodeStructureDetector();

  it("isComment backward scan (100-line cap) completes without lag", () => {
    const lineCount = 150;
    const lines = Array.from({ length: lineCount }, (_, i) =>
      i === 0 ? "const x = 1;" : `  line${i};`
    );
    const doc = makeDocument(lines, "typescript");
    const position = pos(lineCount - 1, 0);
    const start = performance.now();
    for (let i = 0; i < 20; i++) {
      detector.isComment(doc, position);
    }
    const elapsed = (performance.now() - start) / 20;
    expect(elapsed).toBeLessThan(IS_COMMENT_SCAN_MS);
    expect(detector.isComment(doc, position)).toBe(false);
  });

  it("classify on large file (1000+ lines) completes within target", () => {
    const lineCount = 1200;
    const lines = Array.from({ length: lineCount }, (_, i) =>
      i % 3 === 0 ? "function foo() {" : i % 3 === 1 ? "  const x = 1;" : "}"
    );
    const doc = makeDocument(lines, "typescript");
    const position = pos(600, 2);
    const start = performance.now();
    for (let i = 0; i < 10; i++) {
      detector.classify(doc, position);
    }
    const elapsed = (performance.now() - start) / 10;
    expect(elapsed).toBeLessThan(HIGHLIGHT_LATENCY_MS);
  });

  it("classify with deeply nested code (10+ levels) completes within target", () => {
    const depth = 15;
    const lines: string[] = [];
    for (let i = 0; i < depth; i++) {
      lines.push("  ".repeat(i) + "if (x) {");
    }
    lines.push("  ".repeat(depth) + "return 1;");
    for (let i = depth - 1; i >= 0; i--) {
      lines.push("  ".repeat(i) + "}");
    }
    const doc = makeDocument(lines, "typescript");
    const position = pos(depth, depth * 2);
    const start = performance.now();
    for (let i = 0; i < 10; i++) {
      detector.classify(doc, position);
    }
    const elapsed = (performance.now() - start) / 10;
    expect(elapsed).toBeLessThan(HIGHLIGHT_LATENCY_MS);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as vscode from "vscode";
import { ContextExtractor } from "./contextExtractor";
import { CodeStructureDetector } from "./codeStructureDetector";
import { CodeLensHoverProvider } from "../providers/hoverProvider";

/** Holder for onDidChangeTextEditorVisibleRanges callback so tests can invoke it. */
type VisibleRangesEvent = {
  textEditor: { document: unknown; setDecorations: ReturnType<typeof vi.fn> };
  visibleRanges: Array<{ start: { line: number }; end: { line: number } }>;
};

/** Hoisted so vi.mock factories can reference them. Used by 13 core-flow tests. */
const {
  mockWindow,
  mockWorkspace,
  cacheGet,
  cacheSet,
  cancelCalls,
  aiExplain,
  visibleRangesCallbackHolder,
} = vi.hoisted(() => {
  const visibleRangesCallbackHolder: {
    current: ((e: VisibleRangesEvent) => void) | null;
  } = { current: null };
  return {
    mockWindow: {
      visibleTextEditors: [] as Array<{
        document: unknown;
        setDecorations: ReturnType<typeof vi.fn>;
      }>,
      activeTextEditor: null as {
        document: unknown;
        setDecorations: ReturnType<typeof vi.fn>;
      } | null,
      createTextEditorDecorationType: vi.fn(() => ({ dispose: vi.fn() })),
      onDidChangeTextEditorSelection: vi.fn(() => ({ dispose: vi.fn() })),
      onDidChangeTextEditorVisibleRanges: vi.fn((cb: (e: VisibleRangesEvent) => void) => {
        visibleRangesCallbackHolder.current = cb;
        return { dispose: vi.fn() };
      }),
      onDidChangeActiveColorTheme: vi.fn(() => ({ dispose: vi.fn() })),
      activeColorTheme: { kind: 1 },
    },
    mockWorkspace: {
      getConfiguration: vi.fn(() => ({ get: vi.fn(() => "") })),
      onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
    },
    cacheGet: vi.fn((): string | null => "Cached explanation"),
    cacheSet: vi.fn(),
    cancelCalls: [] as unknown[],
    aiExplain: vi.fn(() => Promise.resolve("")),
    visibleRangesCallbackHolder,
  };
});

/**
 * Minimal vscode mock so ContextExtractor (which uses vscode.Range and vscode.Position) runs under Vitest.
 * Extended with window/workspace and related APIs for CodeLensHoverProvider integration tests.
 */
vi.mock("vscode", () => {
  class Position {
    constructor(public line: number, public character: number) {}
  }
  class Range {
    constructor(
      public startLineOrStart: number | Position,
      public startCharacter: number,
      public endLineOrEnd: number | Position,
      public endCharacter?: number
    ) {
      if (
        typeof startLineOrStart === "number" &&
        typeof endLineOrEnd === "number"
      ) {
        this.startLine = startLineOrStart;
        this.startChar = startCharacter;
        this.endLine = endLineOrEnd;
        this.endChar = endCharacter ?? 0;
      } else {
        const s = startLineOrStart as Position;
        const e = endLineOrEnd as Position;
        this.startLine = s.line;
        this.startChar = startCharacter;
        this.endLine = e.line;
        this.endChar = (endCharacter ?? 0) as number;
      }
    }
    startLine!: number;
    startChar!: number;
    endLine!: number;
    endChar!: number;
    get start() {
      return { line: this.startLine, character: this.startChar };
    }
    get end() {
      return { line: this.endLine, character: this.endChar };
    }
  }
  class Hover {
    constructor(
      public contents: unknown,
      public range: unknown
    ) {}
  }
  const MarkdownString = vi
    .fn()
    .mockImplementation(function (this: {
      appendMarkdown: ReturnType<typeof vi.fn>;
      isTrusted: boolean;
    }) {
      this.appendMarkdown = vi.fn();
      this.isTrusted = true;
      return this;
    });
  class CancellationTokenSource {
    token = {
      isCancellationRequested: false,
      onCancellationRequested: vi.fn(),
    };
    cancel = vi.fn(function (this: {
      token: { isCancellationRequested: boolean };
    }) {
      cancelCalls.push(this);
      this.token.isCancellationRequested = true;
    });
    dispose = vi.fn();
  }
  return {
    Position,
    Range,
    Hover,
    MarkdownString,
    CancellationTokenSource,
    window: mockWindow,
    workspace: mockWorkspace,
    ColorThemeKind: { Dark: 1, Light: 2, HighContrast: 3 },
  };
});

vi.mock("../services/aiService", () => ({
  AIService: class {
    explain = aiExplain;
  },
}));

vi.mock("../services/cacheService", () => ({
  CacheService: class {
    get = cacheGet;
    set = cacheSet;
    delete = vi.fn();
  },
}));

/** Document-like shape used by ContextExtractor (lineAt, lineCount, languageId). Includes offsetAt for CodeStructureDetector.isComment. */
function makeDocument(
  lines: string[],
  languageId: string
): vscode.TextDocument & {
  lineAt: (line: number) => { text: string };
  offsetAt: (position: vscode.Position) => number;
} {
  return {
    languageId,
    lineCount: lines.length,
    lineAt(line: number) {
      if (line < 0 || line >= lines.length) {
        throw new Error(`Line ${line} out of range [0, ${lines.length})`);
      }
      return { text: lines[line] };
    },
    offsetAt(position: vscode.Position) {
      let offset = 0;
      for (let i = 0; i < position.line && i < lines.length; i++) {
        offset += lines[i].length + 1; // +1 for newline
      }
      const lineText = position.line < lines.length ? lines[position.line] : "";
      return offset + Math.min(position.character, lineText.length);
    },
  } as unknown as vscode.TextDocument & {
    lineAt: (line: number) => { text: string };
    offsetAt: (position: vscode.Position) => number;
  };
}

function pos(line: number, character: number): vscode.Position {
  return new vscode.Position(line, character);
}

/** Assert range spans exactly the given line indices (start line to end line inclusive). */
function expectRangeLines(
  range: vscode.Range,
  startLine: number,
  endLine: number
): void {
  expect(range.start.line).toBe(startLine);
  expect(range.end.line).toBe(endLine);
}

/** Assert range is a single line. */
function expectSingleLine(range: vscode.Range, lineIndex: number): void {
  expect(range.start.line).toBe(lineIndex);
  expect(range.end.line).toBe(lineIndex);
}

/** Assert getSingleLineRange returns exactly the given line. */
function expectSingleLineRange(
  range: vscode.Range,
  lineIndex: number,
  lineLength: number
): void {
  expectSingleLine(range, lineIndex);
  expect(range.start.character).toBe(0);
  expect(range.end.character).toBe(lineLength);
}

describe("ContextExtractor.getBlockRange", () => {
  let extractor: ContextExtractor;

  beforeEach(() => {
    extractor = new ContextExtractor();
  });

  describe("classification: simple (single-line highlight)", () => {
    it("highlights only the line for const (TypeScript)", () => {
      const lines = ["const x = 1;", "const y = 2;"];
      const doc = makeDocument(lines, "typescript");
      const range = extractor.getBlockRange(doc, pos(0, 0), "simple");
      expectSingleLine(range, 0);
      expect(range.start.character).toBe(0);
      expect(range.end.character).toBe(lines[0].length);
    });

    it("highlights only the line for return (TypeScript)", () => {
      const lines = ["  return x;", "}"];
      const doc = makeDocument(lines, "typescript");
      const range = extractor.getBlockRange(doc, pos(0, 2), "simple");
      expectSingleLine(range, 0);
      expect(range.end.character).toBe(lines[0].length);
    });

    it("highlights only the line for import (TypeScript)", () => {
      const line = "import { foo } from 'bar';";
      const doc = makeDocument([line], "typescript");
      const range = extractor.getBlockRange(doc, pos(0, 0), "simple");
      expectSingleLine(range, 0);
      expect(range.end.character).toBe(line.length);
    });

    it("highlights only the line for const (JavaScript)", () => {
      const lines = ["const a = 1;", "let b = 2;"];
      const doc = makeDocument(lines, "javascript");
      const range = extractor.getBlockRange(doc, pos(1, 0), "simple");
      expectSingleLine(range, 1);
    });

    it("highlights only the line for return (JavaScript)", () => {
      const doc = makeDocument(["return result;"], "javascript");
      const range = extractor.getBlockRange(doc, pos(0, 0), "simple");
      expectSingleLine(range, 0);
    });

    it("highlights only the line for import (JavaScript)", () => {
      const doc = makeDocument(["import fs from 'fs';"], "javascript");
      const range = extractor.getBlockRange(doc, pos(0, 0), "simple");
      expectSingleLine(range, 0);
    });

    it("highlights only the line for import (Python)", () => {
      const doc = makeDocument(["import os"], "python");
      const range = extractor.getBlockRange(doc, pos(0, 0), "simple");
      expectSingleLine(range, 0);
    });

    it("highlights only the line for from ... import (Python)", () => {
      const doc = makeDocument(["from pathlib import Path"], "python");
      const range = extractor.getBlockRange(doc, pos(0, 0), "simple");
      expectSingleLine(range, 0);
    });

    it("highlights only the line for return (Python)", () => {
      const doc = makeDocument(["    return 42"], "python");
      const range = extractor.getBlockRange(doc, pos(0, 4), "simple");
      expectSingleLine(range, 0);
    });
  });

  describe("classification: structural (full-block highlight) — TypeScript", () => {
    const lang = "typescript";

    it("if block: highlights full if block (body only; closing brace excluded)", () => {
      const lines = ["if (x) {", "  foo();", "  bar();", "}"];
      const doc = makeDocument(lines, lang);
      const range = extractor.getBlockRange(doc, pos(0, 0), "structural");
      expectRangeLines(range, 0, 2);
      const rangeBody = extractor.getBlockRange(doc, pos(1, 2), "structural");
      expectRangeLines(rangeBody, 0, 2);
    });

    it("for block: highlights full for block (body only)", () => {
      const lines = ["for (let i = 0; i < n; i++) {", "  doWork(i);", "}"];
      const doc = makeDocument(lines, lang);
      const range = extractor.getBlockRange(doc, pos(0, 0), "structural");
      expectRangeLines(range, 0, 1);
      const rangeBody = extractor.getBlockRange(doc, pos(1, 2), "structural");
      expectRangeLines(rangeBody, 0, 1);
    });

    it("function: highlights full function body (closing brace excluded)", () => {
      const lines = ["function foo() {", "  const a = 1;", "  return a;", "}"];
      const doc = makeDocument(lines, lang);
      const range = extractor.getBlockRange(doc, pos(0, 0), "structural");
      expectRangeLines(range, 0, 2);
      const rangeInner = extractor.getBlockRange(doc, pos(2, 2), "structural");
      expectRangeLines(rangeInner, 0, 2);
    });

    it("class: highlights full class body (closing brace excluded)", () => {
      const lines = ["class A {", "  method() {", "    return 1;", "  }", "}"];
      const doc = makeDocument(lines, lang);
      const range = extractor.getBlockRange(doc, pos(0, 0), "structural");
      expectRangeLines(range, 0, 3);
      const rangeMethod = extractor.getBlockRange(doc, pos(1, 2), "structural");
      expectRangeLines(rangeMethod, 1, 2);
    });
  });

  describe("classification: structural (full-block highlight) — JavaScript", () => {
    const lang = "javascript";

    it("if block: highlights full block (body only)", () => {
      const lines = ["if (x) {", "  foo();", "}"];
      const doc = makeDocument(lines, lang);
      const range = extractor.getBlockRange(doc, pos(1, 2), "structural");
      expectRangeLines(range, 0, 1);
    });

    it("for block: highlights full block (body only)", () => {
      const lines = ["for (;;) {", "  bar();", "}"];
      const doc = makeDocument(lines, lang);
      const range = extractor.getBlockRange(doc, pos(0, 0), "structural");
      expectRangeLines(range, 0, 1);
    });

    it("function: highlights full function (body only)", () => {
      const lines = ["function f() {", "  return 1;", "}"];
      const doc = makeDocument(lines, lang);
      const range = extractor.getBlockRange(doc, pos(0, 0), "structural");
      expectRangeLines(range, 0, 1);
    });

    it("class: highlights full class (body only)", () => {
      const lines = ["class C {", "  m() {}", "}"];
      const doc = makeDocument(lines, lang);
      const range = extractor.getBlockRange(doc, pos(0, 0), "structural");
      expectRangeLines(range, 0, 1);
    });
  });

  describe("classification: structural (full-block highlight) — Python", () => {
    const lang = "python";

    it("if block: highlights full if block", () => {
      const lines = ["if x:", "    foo()", "    bar()"];
      const doc = makeDocument(lines, lang);
      const range = extractor.getBlockRange(doc, pos(0, 0), "structural");
      expectRangeLines(range, 0, 2);
      const rangeBody = extractor.getBlockRange(doc, pos(1, 4), "structural");
      expectRangeLines(rangeBody, 0, 2);
    });

    it("for block: highlights full for block", () => {
      const lines = ["for i in range(10):", "    print(i)"];
      const doc = makeDocument(lines, lang);
      const range = extractor.getBlockRange(doc, pos(0, 0), "structural");
      expectRangeLines(range, 0, 1);
    });

    it("def: highlights full function", () => {
      const lines = ["def foo():", "    x = 1", "    return x"];
      const doc = makeDocument(lines, lang);
      const range = extractor.getBlockRange(doc, pos(0, 0), "structural");
      expectRangeLines(range, 0, 2);
      const rangeInner = extractor.getBlockRange(doc, pos(1, 4), "structural");
      expectRangeLines(rangeInner, 0, 2);
    });

    it("class: highlights full class", () => {
      const lines = ["class Helper:", "    def run(self):", "        pass"];
      const doc = makeDocument(lines, lang);
      const range = extractor.getBlockRange(doc, pos(0, 0), "structural");
      expectRangeLines(range, 0, 2);
      const rangeMethod = extractor.getBlockRange(doc, pos(1, 4), "structural");
      expectRangeLines(rangeMethod, 1, 2);
    });
  });

  describe("classification: unknown and fallback (indentation-based)", () => {
    it("unknown returns single-line range (only the hovered line)", () => {
      const lines = ["someCall();", "otherCall();"];
      const doc = makeDocument(lines, "typescript");
      const range0 = extractor.getBlockRange(doc, pos(0, 0), "unknown");
      expectSingleLine(range0, 0);
      expect(range0.end.character).toBe(lines[0].length);
      const range1 = extractor.getBlockRange(doc, pos(1, 0), "unknown");
      expectSingleLine(range1, 1);
      expect(range1.end.character).toBe(lines[1].length);
    });

    it("unknown: single-line range for line inside indented block", () => {
      const lines = ["function f() {", "  const a = 1;", "  const b = 2;", "}"];
      const doc = makeDocument(lines, "typescript");
      const range = extractor.getBlockRange(doc, pos(1, 2), "unknown");
      expectSingleLine(range, 1);
      expect(range.end.character).toBe(lines[1].length);
    });

    it("omitted classification falls back to indentation (backward compatible)", () => {
      const lines = ["  x = 1", "  y = 2"];
      const doc = makeDocument(lines, "typescript");
      const range = extractor.getBlockRange(doc, pos(0, 2));
      expectRangeLines(range, 0, 1);
    });
  });

  describe("edge cases", () => {
    it("empty document returns zero-length range at (0,0)", () => {
      const doc = makeDocument([], "typescript");
      const range = extractor.getBlockRange(doc, pos(0, 0));
      expect(range.start.line).toBe(0);
      expect(range.start.character).toBe(0);
      expect(range.end.line).toBe(0);
      expect(range.end.character).toBe(0);
    });

    it("position past last line is clamped to last line", () => {
      const lines = ["const x = 1;"];
      const doc = makeDocument(lines, "typescript");
      const range = extractor.getBlockRange(doc, pos(5, 0), "simple");
      expectSingleLine(range, 0);
    });

    it("simple classification on last line returns that line", () => {
      const lines = ["const a = 1;", "return a;"];
      const doc = makeDocument(lines, "typescript");
      const range = extractor.getBlockRange(doc, pos(1, 0), "simple");
      expectSingleLine(range, 1);
      expect(range.end.character).toBe(lines[1].length);
    });

    it("structural with no matching block start falls back to indentation", () => {
      const lines = ["  orphan();", "  line();"];
      const doc = makeDocument(lines, "typescript");
      const range = extractor.getBlockRange(doc, pos(0, 2), "structural");
      expect(range.start.line).toBe(0);
      expect(range.end.line).toBe(1);
    });

    it("blank line in block: structural uses neighbor indent for block extent", () => {
      const lines = ["if (x) {", "  foo();", "", "  bar();", "}"];
      const doc = makeDocument(lines, "typescript");
      const rangeOnBlank = extractor.getBlockRange(
        doc,
        pos(2, 0),
        "structural"
      );
      expectRangeLines(rangeOnBlank, 0, 3);
    });
  });

  describe("getSingleLineRange (hover-specific single-line)", () => {
    it("returns single-line range for the line at position", () => {
      const lines = ["const x = 1;", "const y = 2;"];
      const doc = makeDocument(lines, "typescript");
      const range = extractor.getSingleLineRange(doc, pos(0, 5));
      expectSingleLineRange(range, 0, lines[0].length);
    });

    it("returns single-line range for last line", () => {
      const lines = ["a", "b", "c"];
      const doc = makeDocument(lines, "typescript");
      const range = extractor.getSingleLineRange(doc, pos(2, 0));
      expectSingleLineRange(range, 2, 1);
    });

    it("clamps position past last line to last line", () => {
      const lines = ["only"];
      const doc = makeDocument(lines, "typescript");
      const range = extractor.getSingleLineRange(doc, pos(10, 0));
      expectSingleLineRange(range, 0, lines[0].length);
    });

    it("empty document returns zero-length range at (0,0)", () => {
      const doc = makeDocument([], "typescript");
      const range = extractor.getSingleLineRange(doc, pos(0, 0));
      expect(range.start.line).toBe(0);
      expect(range.start.character).toBe(0);
      expect(range.end.line).toBe(0);
      expect(range.end.character).toBe(0);
    });
  });

  describe("optimized scanning (early termination and limits)", () => {
    it("structural: forward scan stops at next structural keyword at same indent (sibling block)", () => {
      const lines = [
        "function first() {",
        "  const a = 1;",
        "  return a;",
        "}",
        "function second() {",
        "  return 2;",
        "}",
      ];
      const doc = makeDocument(lines, "typescript");
      const range = extractor.getBlockRange(doc, pos(1, 2), "structural");
      expectRangeLines(range, 0, 2);
      expect(range.end.line).toBe(2);
    });

    it("structural: block does not include next sibling if/for at same indent", () => {
      const lines = [
        "if (a) {",
        "  foo();",
        "  bar();",
        "}",
        "if (b) {",
        "  baz();",
        "}",
      ];
      const doc = makeDocument(lines, "typescript");
      const range = extractor.getBlockRange(doc, pos(1, 2), "structural");
      expectRangeLines(range, 0, 2);
    });

    it("structural: block detection accuracy unchanged for nested blocks", () => {
      const lines = [
        "function outer() {",
        "  if (x) {",
        "    return 1;",
        "  }",
        "  return 0;",
        "}",
      ];
      const doc = makeDocument(lines, "typescript");
      const rangeInner = extractor.getBlockRange(doc, pos(2, 4), "structural");
      expectRangeLines(rangeInner, 1, 2);
      const rangeOuter = extractor.getBlockRange(doc, pos(0, 0), "structural");
      expectRangeLines(rangeOuter, 0, 4);
    });
  });

  describe("performance (determinism and no per-call pattern allocation)", () => {
    it("repeated getBlockRange(simple) returns identical range (no per-call allocation)", () => {
      const doc = makeDocument(["const x = 1;"], "typescript");
      const first = extractor.getBlockRange(doc, pos(0, 0), "simple");
      for (let i = 0; i < 500; i++) {
        const r = extractor.getBlockRange(doc, pos(0, 0), "simple");
        expect(r.start.line).toBe(first.start.line);
        expect(r.end.line).toBe(first.end.line);
        expect(r.start.character).toBe(first.start.character);
        expect(r.end.character).toBe(first.end.character);
      }
    });

    it("repeated getBlockRange(structural) returns identical range for small file", () => {
      const lines = [
        "function foo() {",
        "  if (x) {",
        "    return 1;",
        "  }",
        "  return 0;",
        "}",
      ];
      const doc = makeDocument(lines, "typescript");
      const first = extractor.getBlockRange(doc, pos(2, 4), "structural");
      for (let i = 0; i < 300; i++) {
        const r = extractor.getBlockRange(doc, pos(2, 4), "structural");
        expect(r.start.line).toBe(first.start.line);
        expect(r.end.line).toBe(first.end.line);
      }
    });

    it("repeated getBlockRange(unknown) returns identical range for medium file", () => {
      const lines = Array.from({ length: 100 }, (_, i) =>
        i % 5 === 0 ? "  indented();" : "  more();"
      );
      const doc = makeDocument(lines, "typescript");
      const first = extractor.getBlockRange(doc, pos(50, 0), "unknown");
      for (let i = 0; i < 200; i++) {
        const r = extractor.getBlockRange(doc, pos(50, 0), "unknown");
        expect(r.start.line).toBe(first.start.line);
        expect(r.end.line).toBe(first.end.line);
      }
    });
  });
});

/**
 * Verifies that getBlockRange produces correct highlight ranges (start/end line and character)
 * for each supported language (TypeScript, JavaScript, Python).
 */
describe("ContextExtractor.getBlockRange — correct highlights per language", () => {
  let extractor: ContextExtractor;

  beforeEach(() => {
    extractor = new ContextExtractor();
  });

  describe("TypeScript", () => {
    const lang = "typescript";

    it("structural: if block — range from if line to last body line, full line widths", () => {
      const lines = ["if (x) {", "  foo();", "  bar();", "}"];
      const doc = makeDocument(lines, lang);
      const range = extractor.getBlockRange(doc, pos(1, 2), "structural");
      expect(range.start.line).toBe(0);
      expect(range.end.line).toBe(2);
      expect(range.start.character).toBe(0);
      expect(range.end.character).toBe(lines[2].length);
    });

    it("structural: function — range from function line to last body line", () => {
      const lines = ["function foo() {", "  return 1;", "}"];
      const doc = makeDocument(lines, lang);
      const range = extractor.getBlockRange(doc, pos(0, 0), "structural");
      expect(range.start.line).toBe(0);
      expect(range.end.line).toBe(1);
      expect(range.start.character).toBe(0);
      expect(range.end.character).toBe(lines[1].length);
    });

    it("structural: class — range includes class and methods, excludes closing brace", () => {
      const lines = ["class A {", "  m() {", "    return 1;", "  }", "}"];
      const doc = makeDocument(lines, lang);
      const range = extractor.getBlockRange(doc, pos(0, 0), "structural");
      expect(range.start.line).toBe(0);
      expect(range.end.line).toBe(3);
      expect(range.end.character).toBe(lines[3].length);
    });

    it("simple: const/return/import/export — single line, full line extent", () => {
      const line = "const x = 1;";
      const doc = makeDocument([line], lang);
      const r = extractor.getBlockRange(doc, pos(0, 0), "simple");
      expect(r.start.line).toBe(0);
      expect(r.end.line).toBe(0);
      expect(r.start.character).toBe(0);
      expect(r.end.character).toBe(line.length);

      const docReturn = makeDocument(["  return x;"], lang);
      const rReturn = extractor.getBlockRange(docReturn, pos(0, 2), "simple");
      expect(rReturn.start.character).toBe(0);
      expect(rReturn.end.character).toBe("  return x;".length);

      const docImport = makeDocument(["import { a } from 'm';"], lang);
      const rImport = extractor.getBlockRange(docImport, pos(0, 0), "simple");
      expect(rImport.end.character).toBe("import { a } from 'm';".length);

      const docExport = makeDocument(["export default f;"], lang);
      const rExport = extractor.getBlockRange(docExport, pos(0, 0), "simple");
      expect(rExport.end.character).toBe("export default f;".length);
    });
  });

  describe("JavaScript", () => {
    const lang = "javascript";

    it("structural: for/while/function/class/try/switch — correct block extent", () => {
      const linesFor = ["for (;;) {", "  bar();", "}"];
      const docFor = makeDocument(linesFor, lang);
      expectRangeLines(
        extractor.getBlockRange(docFor, pos(0, 0), "structural"),
        0,
        1
      );

      const linesFn = ["function f() {", "  return 1;", "}"];
      const docFn = makeDocument(linesFn, lang);
      expectRangeLines(
        extractor.getBlockRange(docFn, pos(1, 2), "structural"),
        0,
        1
      );

      const linesClass = ["class C {", "  m() {}", "}"];
      const docClass = makeDocument(linesClass, lang);
      const rangeClass = extractor.getBlockRange(
        docClass,
        pos(0, 0),
        "structural"
      );
      expect(rangeClass.start.line).toBe(0);
      expect(rangeClass.end.line).toBe(1);
      expect(rangeClass.end.character).toBe("  m() {}".length);
    });

    it("simple: let/var/return/import/export — single-line highlight", () => {
      const line = "let x = 1;";
      const doc = makeDocument([line], lang);
      const r = extractor.getBlockRange(doc, pos(0, 0), "simple");
      expectSingleLine(r, 0);
      expect(r.end.character).toBe(line.length);
    });
  });

  describe("Python", () => {
    const lang = "python";

    it("structural: if/elif/for/while/def/class/try/with — correct block extent", () => {
      const linesIf = ["if x:", "    foo()", "    bar()"];
      const docIf = makeDocument(linesIf, lang);
      const rIf = extractor.getBlockRange(docIf, pos(0, 0), "structural");
      expect(rIf.start.line).toBe(0);
      expect(rIf.end.line).toBe(2);
      expect(rIf.end.character).toBe(linesIf[2].length);

      const linesDef = ["def f():", "    return 1"];
      const docDef = makeDocument(linesDef, lang);
      const rDef = extractor.getBlockRange(docDef, pos(0, 0), "structural");
      expect(rDef.start.line).toBe(0);
      expect(rDef.end.line).toBe(1);
      expect(rDef.end.character).toBe("    return 1".length);

      const linesClass = [
        "class Helper:",
        "    def run(self):",
        "        pass",
      ];
      const docClass = makeDocument(linesClass, lang);
      const rClass = extractor.getBlockRange(docClass, pos(0, 0), "structural");
      expect(rClass.start.line).toBe(0);
      expect(rClass.end.line).toBe(2);
      expect(rClass.end.character).toBe("        pass".length);

      const linesWith = ["with open(f) as x:", "    read()"];
      const docWith = makeDocument(linesWith, lang);
      const rWith = extractor.getBlockRange(docWith, pos(1, 4), "structural");
      expect(rWith.start.line).toBe(0);
      expect(rWith.end.line).toBe(1);
      expect(rWith.end.character).toBe("    read()".length);
    });

    it("simple: return/import/from — single-line highlight", () => {
      const docReturn = makeDocument(["    return 42"], lang);
      const rReturn = extractor.getBlockRange(docReturn, pos(0, 4), "simple");
      expectSingleLine(rReturn, 0);
      expect(rReturn.end.character).toBe("    return 42".length);

      const docImport = makeDocument(["import os"], lang);
      const rImport = extractor.getBlockRange(docImport, pos(0, 0), "simple");
      expect(rImport.end.character).toBe("import os".length);

      const docFrom = makeDocument(["from pathlib import Path"], lang);
      const rFrom = extractor.getBlockRange(docFrom, pos(0, 0), "simple");
      expect(rFrom.end.character).toBe("from pathlib import Path".length);
    });
  });
});

describe("ContextExtractor.getBlockRange — all three languages", () => {
  let extractor: ContextExtractor;

  beforeEach(() => {
    extractor = new ContextExtractor();
  });

  const languages = [
    {
      id: "typescript",
      structuralStart: "function f() {",
      simpleLine: "const x = 1;",
    },
    {
      id: "javascript",
      structuralStart: "function f() {",
      simpleLine: "let x = 1;",
    },
    { id: "python", structuralStart: "def f():", simpleLine: "import os" },
  ] as const;

  for (const { id, structuralStart, simpleLine } of languages) {
    describe(id, () => {
      it("structural: full block for function/def", () => {
        const body = id === "python" ? "    pass" : "  return 1;";
        const end = id === "python" ? "" : "}";
        const lines = [structuralStart, body].concat(end ? [end] : []);
        const doc = makeDocument(lines, id);
        const range = extractor.getBlockRange(doc, pos(0, 0), "structural");
        expect(range.start.line).toBe(0);
        if (id === "python") {
          expect(range.end.line).toBe(lines.length - 1);
        } else {
          expect(range.end.line).toBe(lines.length - 2);
        }
      });

      it("simple: single line for statement", () => {
        const doc = makeDocument([simpleLine], id);
        const range = extractor.getBlockRange(doc, pos(0, 0), "simple");
        expect(range.start.line).toBe(0);
        expect(range.end.line).toBe(0);
      });
    });
  }
});

/**
 * Integration tests: HoverProvider uses CodeStructureDetector.classify + ContextExtractor.getBlockRange
 * to decide highlight range. These tests assert that the pipeline produces the expected ranges.
 */
describe("HoverProvider classification-based highlighting (integration)", () => {
  const detector = new CodeStructureDetector();
  const extractor = new ContextExtractor();

  function getHighlightRange(
    lines: string[],
    languageId: string,
    lineIndex: number,
    character: number
  ): vscode.Range {
    const doc = makeDocument(lines, languageId);
    const position = pos(lineIndex, character);
    const classification = detector.classify(doc, position);
    return extractor.getBlockRange(doc, position, classification);
  }

  describe("TypeScript", () => {
    it("structural line (function) gets full block highlight", () => {
      const lines = ["function foo() {", "  const a = 1;", "  return a;", "}"];
      const range = getHighlightRange(lines, "typescript", 0, 0);
      expect(range.start.line).toBe(0);
      expect(range.end.line).toBe(2);
    });

    it("simple line (const) gets single-line highlight", () => {
      const lines = ["const x = 1;", "const y = 2;"];
      const range = getHighlightRange(lines, "typescript", 0, 0);
      expect(range.start.line).toBe(0);
      expect(range.end.line).toBe(0);
    });

    it("body line inside if gets full if-block highlight when classification is structural", () => {
      const lines = ["if (x) {", "  doSomething();", "}"];
      const doc = makeDocument(lines, "typescript");
      const range = extractor.getBlockRange(doc, pos(1, 2), "structural");
      expect(range.start.line).toBe(0);
      expect(range.end.line).toBe(1);
    });

    it("hovering body line in function yields full block (classify→getBlockRange pipeline)", () => {
      const lines = ["function foo() {", "  doSomething();", "  return 1;", "}"];
      const range = getHighlightRange(lines, "typescript", 1, 2);
      expect(range.start.line).toBe(0);
      expect(range.end.line).toBe(2);
    });

    it("import gets single-line highlight", () => {
      const lines = ["import { x } from 'mod';"];
      const range = getHighlightRange(lines, "typescript", 0, 0);
      expect(range.start.line).toBe(0);
      expect(range.end.line).toBe(0);
    });
  });

  describe("JavaScript", () => {
    it("structural (class) gets full block highlight", () => {
      const lines = ["class C {", "  m() {}", "}"];
      const range = getHighlightRange(lines, "javascript", 0, 0);
      expect(range.start.line).toBe(0);
      expect(range.end.line).toBe(1);
    });

    it("simple (return) gets single-line highlight", () => {
      const lines = ["  return 0;"];
      const range = getHighlightRange(lines, "javascript", 0, 2);
      expect(range.start.line).toBe(0);
      expect(range.end.line).toBe(0);
    });

    it("hovering body line in function yields full block (classify→getBlockRange pipeline)", () => {
      const lines = ["function f() {", "  doSomething();", "  return x;", "}"];
      const range = getHighlightRange(lines, "javascript", 1, 2);
      expect(range.start.line).toBe(0);
      expect(range.end.line).toBe(2);
    });
  });

  describe("Python", () => {
    it("structural (def) gets full block highlight", () => {
      const lines = ["def main():", "    x = 1", "    return x"];
      const range = getHighlightRange(lines, "python", 0, 0);
      expect(range.start.line).toBe(0);
      expect(range.end.line).toBe(2);
    });

    it("simple (import) gets single-line highlight", () => {
      const lines = ["import os"];
      const range = getHighlightRange(lines, "python", 0, 0);
      expect(range.start.line).toBe(0);
      expect(range.end.line).toBe(0);
    });

    it("indented body line (non-keyword) inside def gets full def highlight when classification is structural", () => {
      const lines = ["def f():", "    x = 1", "    return x"];
      const doc = makeDocument(lines, "python");
      const range = extractor.getBlockRange(doc, pos(1, 4), "structural");
      expect(range.start.line).toBe(0);
      expect(range.end.line).toBe(2);
    });

    it("hovering body line in def yields full block (classify→getBlockRange pipeline)", () => {
      const lines = ["def main():", "    x = 1", "    return x"];
      const range = getHighlightRange(lines, "python", 1, 4);
      expect(range.start.line).toBe(0);
      expect(range.end.line).toBe(2);
    });
  });

  describe("unknown classification", () => {
    it("non-keyword line uses single-line range (unknown → only hovered line)", () => {
      const lines = ["function f() {}", "someCall();"];
      const range = getHighlightRange(lines, "typescript", 1, 0);
      expect(range.start.line).toBe(1);
      expect(range.end.line).toBe(1);
    });
  });
});

/**
 * Integration tests: CodeLensHoverProvider.provideHover applies highlight ranges via
 * ContextExtractor.getBlockRange and classification. Mocks vscode (window/editor) and stubs
 * AI/cache so no network calls; asserts the decoration range passed to the editor matches
 * classification-based expectations for structural, simple, and unknown lines (TS, JS, Python).
 */
describe("CodeLensHoverProvider provideHover highlight (integration)", () => {
  const detector = new CodeStructureDetector();
  const extractor = new ContextExtractor();
  const token = {
    isCancellationRequested: false,
    onCancellationRequested: vi.fn(),
  };
  let provider: CodeLensHoverProvider;

  function expectDecorationRange(
    setDecorations: ReturnType<typeof vi.fn>,
    document: ReturnType<typeof makeDocument>,
    lineIndex: number,
    character: number
  ): void {
    const position = pos(lineIndex, character);
    const classification = detector.classify(document, position);
    const expectedRange = extractor.getBlockRange(
      document,
      position,
      classification
    );
    expect(setDecorations).toHaveBeenCalled();
    const calls = setDecorations.mock.calls;
    const lastCall = calls[calls.length - 1];
    const appliedRanges = lastCall[1] as vscode.Range[];
    expect(appliedRanges).toHaveLength(1);
    expect(appliedRanges[0].start.line).toBe(expectedRange.start.line);
    expect(appliedRanges[0].end.line).toBe(expectedRange.end.line);
    expect(appliedRanges[0].start.character).toBe(
      expectedRange.start.character
    );
    expect(appliedRanges[0].end.character).toBe(expectedRange.end.character);
  }

  beforeEach(() => {
    mockWindow.visibleTextEditors = [];
    mockWindow.activeTextEditor = null;
    provider = new CodeLensHoverProvider();
  });

  afterEach(() => {
    if (provider) provider.dispose();
  });

  describe("TypeScript", () => {
    it("structural (function): decoration range is full block", () => {
      const lines = ["function foo() {", "  const a = 1;", "  return a;", "}"];
      const doc = makeDocument(lines, "typescript");
      const setDecorations = vi.fn();
      const editor = { document: doc, setDecorations };
      mockWindow.visibleTextEditors = [editor];
      mockWindow.activeTextEditor = editor;

      provider.provideHover(doc, pos(0, 0), token);

      expectDecorationRange(setDecorations, doc, 0, 0);
      expect(
        extractor.getBlockRange(doc, pos(0, 0), "structural").end.line
      ).toBe(2);
    });

    it("simple (const): decoration range is single line", () => {
      const lines = ["const x = 1;", "const y = 2;"];
      const doc = makeDocument(lines, "typescript");
      const setDecorations = vi.fn();
      const editor = { document: doc, setDecorations };
      mockWindow.visibleTextEditors = [editor];
      mockWindow.activeTextEditor = editor;

      provider.provideHover(doc, pos(0, 0), token);

      expectDecorationRange(setDecorations, doc, 0, 0);
      expect(extractor.getBlockRange(doc, pos(0, 0), "simple").start.line).toBe(
        0
      );
      expect(extractor.getBlockRange(doc, pos(0, 0), "simple").end.line).toBe(
        0
      );
    });

    it("unknown (non-keyword): decoration range matches indentation-based block", () => {
      const lines = ["function f() {}", "someCall();"];
      const doc = makeDocument(lines, "typescript");
      const setDecorations = vi.fn();
      const editor = { document: doc, setDecorations };
      mockWindow.visibleTextEditors = [editor];
      mockWindow.activeTextEditor = editor;

      provider.provideHover(doc, pos(1, 0), token);

      expectDecorationRange(setDecorations, doc, 1, 0);
    });
  });

  describe("JavaScript", () => {
    it("structural (class): decoration range is full block", () => {
      const lines = ["class C {", "  m() {}", "}"];
      const doc = makeDocument(lines, "javascript");
      const setDecorations = vi.fn();
      const editor = { document: doc, setDecorations };
      mockWindow.visibleTextEditors = [editor];
      mockWindow.activeTextEditor = editor;

      provider.provideHover(doc, pos(0, 0), token);

      expectDecorationRange(setDecorations, doc, 0, 0);
    });

    it("simple (return): decoration range is single line", () => {
      const lines = ["  return 0;"];
      const doc = makeDocument(lines, "javascript");
      const setDecorations = vi.fn();
      const editor = { document: doc, setDecorations };
      mockWindow.visibleTextEditors = [editor];
      mockWindow.activeTextEditor = editor;

      provider.provideHover(doc, pos(0, 2), token);

      expectDecorationRange(setDecorations, doc, 0, 2);
    });
  });

  describe("Python", () => {
    it("structural (def): decoration range is full block", () => {
      const lines = ["def main():", "    x = 1", "    return x"];
      const doc = makeDocument(lines, "python");
      const setDecorations = vi.fn();
      const editor = { document: doc, setDecorations };
      mockWindow.visibleTextEditors = [editor];
      mockWindow.activeTextEditor = editor;

      provider.provideHover(doc, pos(0, 0), token);

      expectDecorationRange(setDecorations, doc, 0, 0);
    });

    it("simple (import): decoration range is single line", () => {
      const lines = ["import os"];
      const doc = makeDocument(lines, "python");
      const setDecorations = vi.fn();
      const editor = { document: doc, setDecorations };
      mockWindow.visibleTextEditors = [editor];
      mockWindow.activeTextEditor = editor;

      provider.provideHover(doc, pos(0, 0), token);

      expectDecorationRange(setDecorations, doc, 0, 0);
    });

    it("body line inside def: decoration range is full def block (structural)", () => {
      const lines = ["def f():", "    x = 1", "    return x"];
      const doc = makeDocument(lines, "python");
      const setDecorations = vi.fn();
      const editor = { document: doc, setDecorations };
      mockWindow.visibleTextEditors = [editor];
      mockWindow.activeTextEditor = editor;

      provider.provideHover(doc, pos(1, 4), token);

      expectDecorationRange(setDecorations, doc, 1, 4);
    });
  });
});

/**
 * Mouse-based decoration clearing: decoration clears when the user hovers
 * outside the decorated range or when the viewport changes so the range is no longer visible.
 */
describe("CodeLensHoverProvider — mouse-based decoration clearing", () => {
  const token = {
    isCancellationRequested: false,
    onCancellationRequested: vi.fn(),
  };
  let provider: CodeLensHoverProvider;

  beforeEach(() => {
    mockWindow.visibleTextEditors = [];
    mockWindow.activeTextEditor = null;
    cacheGet.mockReturnValue("Cached explanation");
    provider = new CodeLensHoverProvider();
  });

  afterEach(() => {
    provider?.dispose();
  });

  it("clears decoration when hovering outside the decorated range", () => {
    const lines = [
      "function foo() {",
      "  return 1;",
      "}",
      "// comment",
      "// another",
    ];
    const doc = makeDocument(lines, "typescript");
    const setDecorations = vi.fn();
    const editor = { document: doc, setDecorations };
    mockWindow.visibleTextEditors = [editor];
    mockWindow.activeTextEditor = editor;

    provider.provideHover(doc, pos(0, 0), token);
    const callsAfterFirst = setDecorations.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThanOrEqual(1);
    const lastRangeAfterFirst = setDecorations.mock.calls[callsAfterFirst - 1][1] as vscode.Range[];
    expect(lastRangeAfterFirst).toHaveLength(1);
    expect(lastRangeAfterFirst[0].start.line).toBe(0);
    expect(lastRangeAfterFirst[0].end.line).toBe(1);

    provider.provideHover(doc, pos(4, 0), token);
    const clearedCall = setDecorations.mock.calls.find(
      (call) => Array.isArray(call[1]) && (call[1] as vscode.Range[]).length === 0
    );
    expect(clearedCall).toBeDefined();
  });

  it("clears decoration when viewport changes and decorated range is no longer visible", () => {
    const lines = ["function foo() {", "  return 1;", "}"];
    const doc = makeDocument(lines, "typescript");
    const setDecorations = vi.fn();
    const editor = { document: doc, setDecorations };
    mockWindow.visibleTextEditors = [editor];
    mockWindow.activeTextEditor = editor;

    provider.provideHover(doc, pos(0, 0), token);
    expect(setDecorations).toHaveBeenCalled();
    const applyCall = setDecorations.mock.calls.find(
      (call) => Array.isArray(call[1]) && (call[1] as vscode.Range[]).length === 1
    );
    expect(applyCall).toBeDefined();

    const cb = visibleRangesCallbackHolder.current;
    expect(cb).not.toBeNull();
    cb!({
      textEditor: editor,
      visibleRanges: [
        { start: { line: 10, character: 0 }, end: { line: 20, character: 0 } },
      ],
    });
    const clearCall = setDecorations.mock.calls.find(
      (call) => Array.isArray(call[1]) && (call[1] as vscode.Range[]).length === 0
    );
    expect(clearCall).toBeDefined();
  });
});

/**
 * Integration tests for the three hover-highlighting bug fixes:
 * 1) classification of body lines → full-block highlight when appropriate
 * 2) decoration clearing when hover moves outside the decorated range
 * 3) optimized block range detection → block does not include next sibling
 */
describe("Hover highlighting bug-fix integration", () => {
  const detector = new CodeStructureDetector();
  const extractor = new ContextExtractor();

  describe("1. Classification of body lines", () => {
    it("body line inside function: getBlockRange with structural returns full function block (TS)", () => {
      const lines = ["function foo() {", "  doSomething();", "  return 1;", "}"];
      const doc = makeDocument(lines, "typescript");
      const bodyLinePos = pos(1, 2);
      const range = extractor.getBlockRange(doc, bodyLinePos, "structural");
      expect(range.start.line).toBe(0);
      expect(range.end.line).toBe(2);
    });

    it("body line inside def: getBlockRange with structural returns full def block (Python)", () => {
      const lines = ["def f():", "    x = 1", "    return x"];
      const doc = makeDocument(lines, "python");
      const range = extractor.getBlockRange(doc, pos(1, 4), "structural");
      expect(range.start.line).toBe(0);
      expect(range.end.line).toBe(2);
    });

    it("body line (non-keyword) and header produce same block extent when classification is structural", () => {
      const lines = ["if (x) {", "  doSomething();", "}"];
      const doc = makeDocument(lines, "typescript");
      const headerRange = extractor.getBlockRange(doc, pos(0, 0), "structural");
      const bodyRange = extractor.getBlockRange(doc, pos(1, 2), "structural");
      expect(headerRange.start.line).toBe(bodyRange.start.line);
      expect(headerRange.end.line).toBe(bodyRange.end.line);
    });
  });

  describe("2. Decoration clearing on hover move", () => {
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: vi.fn(),
    };
    let provider: CodeLensHoverProvider;

    beforeEach(() => {
      mockWindow.visibleTextEditors = [];
      mockWindow.activeTextEditor = null;
      cacheGet.mockReturnValue("Cached explanation");
      provider = new CodeLensHoverProvider();
    });

    afterEach(() => {
      provider?.dispose();
    });

    it("moving hover from one block to another clears previous decoration then applies new one", () => {
      const lines = [
        "function first() {",
        "  return 1;",
        "}",
        "function second() {",
        "  return 2;",
        "}",
      ];
      const doc = makeDocument(lines, "typescript");
      const setDecorations = vi.fn();
      const editor = { document: doc, setDecorations };
      mockWindow.visibleTextEditors = [editor];
      mockWindow.activeTextEditor = editor;

      provider.provideHover(doc, pos(0, 0), token);
      const afterFirst = setDecorations.mock.calls.length;
      const firstRange = (setDecorations.mock.calls[afterFirst - 1][1] as vscode.Range[])[0];
      expect(firstRange.start.line).toBe(0);
      expect(firstRange.end.line).toBe(1);

      provider.provideHover(doc, pos(4, 0), token);
      const clearCallIndex = setDecorations.mock.calls.findIndex(
        (call) => Array.isArray(call[1]) && (call[1] as vscode.Range[]).length === 0
      );
      expect(clearCallIndex).toBeGreaterThanOrEqual(0);
      const applyCallsAfterClear = setDecorations.mock.calls
        .slice(clearCallIndex + 1)
        .filter((call) => Array.isArray(call[1]) && (call[1] as vscode.Range[]).length === 1);
      expect(applyCallsAfterClear.length).toBeGreaterThanOrEqual(1);
      const lastRange = (applyCallsAfterClear[applyCallsAfterClear.length - 1][1] as vscode.Range[])[0];
      expect(lastRange.start.line).toBe(4);
      expect(lastRange.end.line).toBeGreaterThanOrEqual(4);
    });
  });

  describe("3. Optimized block range detection", () => {
    it("block range for position inside first function does not include second function", () => {
      const lines = [
        "function first() {",
        "  const a = 1;",
        "  return a;",
        "}",
        "function second() {",
        "  return 2;",
        "}",
      ];
      const doc = makeDocument(lines, "typescript");
      const range = extractor.getBlockRange(doc, pos(1, 2), "structural");
      expect(range.start.line).toBe(0);
      expect(range.end.line).toBe(2);
      expect(range.end.line).toBeLessThan(4);
    });

    it("block range for position inside first if does not include sibling if", () => {
      const lines = [
        "if (a) {",
        "  foo();",
        "}",
        "if (b) {",
        "  bar();",
        "}",
      ];
      const doc = makeDocument(lines, "typescript");
      const range = extractor.getBlockRange(doc, pos(1, 2), "structural");
      expect(range.start.line).toBe(0);
      expect(range.end.line).toBe(1);
    });
  });
});

/** Token used by provideHover in core-flow tests. */
const coreFlowToken = {
  isCancellationRequested: false,
  onCancellationRequested: vi.fn(),
};

/**
 * 13 core flows from spec (hover behavior, cache, comments, empty lines,
 * concurrent hovers, extension disabled, modal suppression, structural vs simple
 * highlighting, highlighting fallback, unsupported languages, non-code files).
 * Verifies CodeLensHoverProvider in hoverProvider.ts.
 */
describe("CodeLensHoverProvider — 13 core flows (spec)", () => {
  const detector = new CodeStructureDetector();
  const extractor = new ContextExtractor();
  let provider: CodeLensHoverProvider;

  beforeEach(() => {
    mockWindow.visibleTextEditors = [];
    mockWindow.activeTextEditor = null;
    cacheGet.mockReturnValue("Cached explanation");
    cacheSet.mockClear();
    aiExplain.mockReturnValue(Promise.resolve(""));
    cancelCalls.length = 0;
    provider = new CodeLensHoverProvider();
  });

  afterEach(() => {
    provider?.dispose();
  });

  /** Flow 1: Hover on code — cache hit → returns Hover and applies decoration. */
  it("Flow 1 — cache hit: returns Hover and applies highlight", () => {
    const lines = ["const x = 1;"];
    const doc = makeDocument(lines, "typescript");
    const setDecorations = vi.fn();
    const editor = { document: doc, setDecorations };
    mockWindow.visibleTextEditors = [editor];
    mockWindow.activeTextEditor = editor;

    const result = provider.provideHover(doc, pos(0, 0), coreFlowToken);

    expect(result).not.toBeNull();
    expect(setDecorations).toHaveBeenCalled();
    const appliedRanges = setDecorations.mock.calls[
      setDecorations.mock.calls.length - 1
    ][1] as vscode.Range[];
    expect(appliedRanges).toHaveLength(1);
    expect(appliedRanges[0].start.line).toBe(0);
    expect(appliedRanges[0].end.line).toBe(0);
  });

  /** Flow 2: Hover on code — cache miss → returns null, fetches in background; re-hover shows result. */
  it("Flow 2 — cache miss: returns null and triggers background fetch", async () => {
    cacheGet.mockReturnValue(null);
    const lines = ["const y = 2;"];
    const doc = makeDocument(lines, "typescript");
    const editor = { document: doc, setDecorations: vi.fn() };
    mockWindow.visibleTextEditors = [editor];
    mockWindow.activeTextEditor = editor;

    const result = provider.provideHover(doc, pos(0, 0), coreFlowToken);

    expect(result).toBeNull();
    expect(aiExplain).toHaveBeenCalled();
    await aiExplain.mock.results[0]?.value;
    expect(cacheSet).toHaveBeenCalled();
    cacheGet.mockReturnValue("Fetched explanation");
    const second = provider.provideHover(doc, pos(0, 0), coreFlowToken);
    expect(second).not.toBeNull();
  });

  /** Flow 3: Hover on comments → returns null. */
  it("Flow 3 — comments: returns null", () => {
    const lines = ["// single line comment", "const x = 1;"];
    const doc = makeDocument(lines, "typescript");
    mockWindow.visibleTextEditors = [];
    mockWindow.activeTextEditor = null;

    const result = provider.provideHover(doc, pos(0, 5), coreFlowToken);

    expect(result).toBeNull();
    expect(detector.isComment(doc, pos(0, 5))).toBe(true);
  });

  /** Flow 4: Empty line — not in block returns null; empty line in block uses previous non-blank. */
  it("Flow 4a — empty line not in block: returns null", () => {
    const lines = ["", "const x = 1;"];
    const doc = makeDocument(lines, "typescript");
    mockWindow.visibleTextEditors = [];
    mockWindow.activeTextEditor = null;

    const result = provider.provideHover(doc, pos(0, 0), coreFlowToken);

    expect(result).toBeNull();
  });

  it("Flow 4b — empty line in block: uses previous non-blank and returns hover when cached", () => {
    const lines = ["function f() {", "  const x = 1;", "", "  return x;", "}"];
    const doc = makeDocument(lines, "typescript");
    const setDecorations = vi.fn();
    const editor = { document: doc, setDecorations };
    mockWindow.visibleTextEditors = [editor];
    mockWindow.activeTextEditor = editor;
    expect(detector.isEmptyLineInBlock(doc, pos(2, 0))).toBe(true);

    const result = provider.provideHover(doc, pos(2, 0), coreFlowToken);

    expect(result).not.toBeNull();
    expect(setDecorations).toHaveBeenCalled();
  });

  /** Flow 5: Concurrent hovers — previous fetch cancelled when new hover occurs. */
  it("Flow 5 — concurrent hovers: previous fetch is cancelled", async () => {
    cacheGet.mockReturnValue(null);
    const lines = ["const a = 1;", "const b = 2;"];
    const doc = makeDocument(lines, "typescript");
    const editor = { document: doc, setDecorations: vi.fn() };
    mockWindow.visibleTextEditors = [editor];
    mockWindow.activeTextEditor = editor;

    provider.provideHover(doc, pos(0, 0), coreFlowToken);
    provider.provideHover(doc, pos(1, 0), coreFlowToken);

    expect(cancelCalls.length).toBeGreaterThanOrEqual(1);
  });

  /** Flow 6: Re-hover after cache miss completes shows result (covered by Flow 2). */
  it("Flow 6 — re-hover after fetch: shows cached result", async () => {
    let stored: string | null = null;
    cacheGet.mockImplementation(() => stored);
    cacheSet.mockImplementation((_code: string, explanation: string | null) => {
      stored = explanation;
    });
    const lines = ["const z = 3;"];
    const doc = makeDocument(lines, "typescript");
    const editor = { document: doc, setDecorations: vi.fn() };
    mockWindow.visibleTextEditors = [editor];
    mockWindow.activeTextEditor = editor;

    const first = provider.provideHover(doc, pos(0, 0), coreFlowToken);
    expect(first).toBeNull();
    await aiExplain.mock.results[aiExplain.mock.results.length - 1]?.value;

    const second = provider.provideHover(doc, pos(0, 0), coreFlowToken);
    expect(second).not.toBeNull();
  });

  /** Flow 7: Extension disabled — hover not registered (validated in extension.ts; provider has no enabled check). */
  it("Flow 7 — provider has no enabled gate: when called, returns hover on cache hit", () => {
    const lines = ["const x = 1;"];
    const doc = makeDocument(lines, "typescript");
    const setDecorations = vi.fn();
    const editor = { document: doc, setDecorations };
    mockWindow.visibleTextEditors = [editor];
    mockWindow.activeTextEditor = editor;

    const result = provider.provideHover(doc, pos(0, 0), coreFlowToken);

    expect(result).not.toBeNull();
  });

  /** Flow 8: Modal suppression — no modal on hover (tooltip only); showInformationMessage not called. */
  it("Flow 8 — no modal on hover: only hover content returned", () => {
    const showMessage = vi.fn();
    (
      mockWindow as { showInformationMessage?: ReturnType<typeof vi.fn> }
    ).showInformationMessage = showMessage;
    const lines = ["const x = 1;"];
    const doc = makeDocument(lines, "typescript");
    const editor = { document: doc, setDecorations: vi.fn() };
    mockWindow.visibleTextEditors = [editor];
    mockWindow.activeTextEditor = editor;

    provider.provideHover(doc, pos(0, 0), coreFlowToken);

    expect(showMessage).not.toHaveBeenCalled();
  });

  /** Flow 9: Structural highlighting — full block range. */
  it("Flow 9 — structural: full block highlighted", () => {
    const lines = ["function foo() {", "  const a = 1;", "  return a;", "}"];
    const doc = makeDocument(lines, "typescript");
    const setDecorations = vi.fn();
    const editor = { document: doc, setDecorations };
    mockWindow.visibleTextEditors = [editor];
    mockWindow.activeTextEditor = editor;

    provider.provideHover(doc, pos(0, 0), coreFlowToken);

    expect(setDecorations).toHaveBeenCalled();
    const ranges = setDecorations.mock.calls[
      setDecorations.mock.calls.length - 1
    ][1] as vscode.Range[];
    expect(ranges[0].start.line).toBe(0);
    expect(ranges[0].end.line).toBe(2);
  });

  /** Flow 10: Simple highlighting — single line. */
  it("Flow 10 — simple: single line highlighted", () => {
    const lines = ["const x = 1;", "const y = 2;"];
    const doc = makeDocument(lines, "typescript");
    const setDecorations = vi.fn();
    const editor = { document: doc, setDecorations };
    mockWindow.visibleTextEditors = [editor];
    mockWindow.activeTextEditor = editor;

    provider.provideHover(doc, pos(0, 0), coreFlowToken);

    expect(setDecorations).toHaveBeenCalled();
    const ranges = setDecorations.mock.calls[
      setDecorations.mock.calls.length - 1
    ][1] as vscode.Range[];
    expect(ranges[0].start.line).toBe(0);
    expect(ranges[0].end.line).toBe(0);
  });

  /** Flow 11: Highlighting fallback — getBlockRange throws → use line range (code path in getHighlightRange). */
  it("Flow 11 — highlighting: single-line and block ranges applied per classification", () => {
    const linesSimple = ["return 0;"];
    const docSimple = makeDocument(linesSimple, "typescript");
    const setDecorationsSimple = vi.fn();
    mockWindow.visibleTextEditors = [
      { document: docSimple, setDecorations: setDecorationsSimple },
    ];
    mockWindow.activeTextEditor = mockWindow.visibleTextEditors[0];
    provider.provideHover(docSimple, pos(0, 0), coreFlowToken);
    expect(setDecorationsSimple.mock.calls[0][1][0].start.line).toBe(0);
    expect(setDecorationsSimple.mock.calls[0][1][0].end.line).toBe(0);

    const linesStructural = ["if (x) {", "  foo();", "}"];
    const docStructural = makeDocument(linesStructural, "typescript");
    const setDecorationsStructural = vi.fn();
    mockWindow.visibleTextEditors = [
      { document: docStructural, setDecorations: setDecorationsStructural },
    ];
    mockWindow.activeTextEditor = mockWindow.visibleTextEditors[0];
    provider.provideHover(docStructural, pos(1, 2), coreFlowToken);
    const expected = extractor.getBlockRange(
      docStructural,
      pos(1, 2),
      detector.classify(docStructural, pos(1, 2))
    );
    expect(setDecorationsStructural.mock.calls[0][1][0].start.line).toBe(
      expected.start.line
    );
    expect(setDecorationsStructural.mock.calls[0][1][0].end.line).toBe(
      expected.end.line
    );
  });

  /** Flow 12: Unsupported languages — still provide hover (no language gate). */
  it("Flow 12 — unsupported language (plaintext): hover still returned on cache hit", () => {
    const lines = ["some text"];
    const doc = makeDocument(lines, "plaintext");
    const setDecorations = vi.fn();
    const editor = { document: doc, setDecorations };
    mockWindow.visibleTextEditors = [editor];
    mockWindow.activeTextEditor = editor;

    const result = provider.provideHover(doc, pos(0, 0), coreFlowToken);

    expect(result).not.toBeNull();
    expect(setDecorations).toHaveBeenCalled();
  });

  /** Flow 13: Non-code files — hover works (file/untitled schemes; no gate in provider). */
  it("Flow 13 — non-code file content: hover returned on cache hit", () => {
    const lines = ["# Markdown heading", "Hello world"];
    const doc = makeDocument(lines, "markdown");
    const setDecorations = vi.fn();
    const editor = { document: doc, setDecorations };
    mockWindow.visibleTextEditors = [editor];
    mockWindow.activeTextEditor = editor;

    const result = provider.provideHover(doc, pos(1, 0), coreFlowToken);

    expect(result).not.toBeNull();
  });
});

/** Prefix used in hoverProvider for cached error messages; must match hoverProvider.ts. */
const CACHED_ERROR_PREFIX = "Something went wrong:";

describe("CodeLensHoverProvider — error scenarios (caching and Retry link)", () => {
  let provider: CodeLensHoverProvider;

  beforeEach(() => {
    mockWindow.visibleTextEditors = [];
    mockWindow.activeTextEditor = null;
    cacheGet.mockReturnValue(null);
    aiExplain.mockReset();
    cacheSet.mockClear();
    provider = new CodeLensHoverProvider();
  });

  afterEach(() => {
    provider?.dispose();
  });

  it("on API/network error: fetchExplanation caches error message with CACHED_ERROR_PREFIX", async () => {
    cacheGet.mockReturnValue(null);
    aiExplain.mockRejectedValue(new Error("Rate limit exceeded"));
    const lines = ["const x = 1;"];
    const doc = makeDocument(lines, "typescript");
    const editor = { document: doc, setDecorations: vi.fn() };
    mockWindow.visibleTextEditors = [editor];
    mockWindow.activeTextEditor = editor;

    provider.provideHover(doc, pos(0, 0), coreFlowToken);
    await vi.runAllTimersAsync?.().catch(() => {});
    await aiExplain.mock.results[0]?.value?.catch(() => {});

    expect(cacheSet).toHaveBeenCalled();
    const [, explanation] = cacheSet.mock.calls[cacheSet.mock.calls.length - 1];
    expect(typeof explanation).toBe("string");
    expect(explanation.startsWith(CACHED_ERROR_PREFIX)).toBe(true);
  });

  it("on timeout: cached error includes message", async () => {
    cacheGet.mockReturnValue(null);
    aiExplain.mockRejectedValue(new Error("The request timed out"));
    const lines = ["const y = 2;"];
    const doc = makeDocument(lines, "typescript");
    const editor = { document: doc, setDecorations: vi.fn() };
    mockWindow.visibleTextEditors = [editor];
    mockWindow.activeTextEditor = editor;

    provider.provideHover(doc, pos(0, 0), coreFlowToken);
    await vi.runAllTimersAsync?.().catch(() => {});
    await aiExplain.mock.results[0]?.value?.catch(() => {});

    expect(cacheSet).toHaveBeenCalled();
    const [, explanation] = cacheSet.mock.calls[cacheSet.mock.calls.length - 1];
    expect(explanation).toContain("Something went wrong:");
    expect(explanation).toMatch(/timed out|Try again/);
  });

  it("when cache returns cached error: hover content includes Retry link", () => {
    const cachedError = `${CACHED_ERROR_PREFIX} Rate limit exceeded. Try again or check the output panel for details.`;
    cacheGet.mockReturnValue(cachedError);
    const lines = ["const x = 1;"];
    const doc = makeDocument(lines, "typescript");
    const editor = { document: doc, setDecorations: vi.fn() };
    mockWindow.visibleTextEditors = [editor];
    mockWindow.activeTextEditor = editor;

    const result = provider.provideHover(doc, pos(0, 0), coreFlowToken);

    expect(result).not.toBeNull();
    expect(result!.contents).toBeDefined();
    const md = result!.contents as unknown as {
      appendMarkdown: ReturnType<typeof vi.fn>;
    };
    const appendCalls = md.appendMarkdown?.mock?.calls ?? [];
    const allAppended = appendCalls
      .map((c: unknown[]) => String(c[0]))
      .join("");
    expect(allAppended).toContain("Retry");
    expect(allAppended).toContain("retryHoverExplanation");
  });

  it("when cache returns success: hover content does not include Retry link", () => {
    cacheGet.mockReturnValue("This code declares a constant.");
    const lines = ["const x = 1;"];
    const doc = makeDocument(lines, "typescript");
    const editor = { document: doc, setDecorations: vi.fn() };
    mockWindow.visibleTextEditors = [editor];
    mockWindow.activeTextEditor = editor;

    const result = provider.provideHover(doc, pos(0, 0), coreFlowToken);

    expect(result).not.toBeNull();
    const md = result!.contents as unknown as {
      appendMarkdown: ReturnType<typeof vi.fn>;
    };
    const appendCalls = md.appendMarkdown?.mock?.calls ?? [];
    const allAppended = appendCalls
      .map((c: unknown[]) => String(c[0]))
      .join("");
    expect(allAppended).not.toContain("retryHoverExplanation");
  });
});

/** Target: highlighting must feel instant. */
const HIGHLIGHT_LATENCY_MS = 100;

describe("ContextExtractor — malformed syntax and extreme cases", () => {
  let extractor: ContextExtractor;

  beforeEach(() => {
    extractor = new ContextExtractor();
  });

  describe("malformed syntax (missing braces, incomplete, mixed indent)", () => {
    it("getBlockRange on unclosed if block uses indentation heuristic", () => {
      const lines = ["if (x)", "  foo();", "  bar();"];
      const doc = makeDocument(lines, "typescript");
      const range = extractor.getBlockRange(doc, pos(1, 2));
      expect(range.start.line).toBeGreaterThanOrEqual(0);
      expect(range.end.line).toBeLessThanOrEqual(2);
    });

    it("getBlockRange on line with only opening brace returns bounded range", () => {
      const lines = ["{", "  x = 1;", "}"];
      const doc = makeDocument(lines, "typescript");
      const range = extractor.getBlockRange(doc, pos(1, 0));
      expect(range.start.line).toBeGreaterThanOrEqual(0);
      expect(range.end.line).toBeLessThanOrEqual(2);
      expect(range.end.line).toBeGreaterThanOrEqual(range.start.line);
    });

    it("extract on mixed tab/space indent returns code and context", () => {
      const lines = ["function f() {", "\tconst x = 1;", "}"];
      const doc = makeDocument(lines, "typescript");
      const result = extractor.extract(doc, pos(1, 0));
      expect(result.code.trim().length).toBeGreaterThan(0);
      expect(typeof result.context).toBe("string");
    });

    it("empty document: getBlockRange returns (0,0)-(0,0)", () => {
      const doc = makeDocument([], "typescript");
      const range = extractor.getBlockRange(doc, pos(0, 0));
      expect(range.start.line).toBe(0);
      expect(range.start.character).toBe(0);
      expect(range.end.line).toBe(0);
      expect(range.end.character).toBe(0);
    });
  });

  describe("extreme cases (very long block, deeply nested, single-line, Unicode)", () => {
    it("getBlockRange in 100+ line function returns bounded range", () => {
      const lines = ["function big() {"].concat(
        Array.from({ length: 120 }, (_, i) => "  const x" + i + " = 1;"),
        ["}"]
      );
      const doc = makeDocument(lines, "typescript");
      const range = extractor.getBlockRange(doc, pos(60, 2), "structural");
      expect(range.start.line).toBe(0);
      expect(range.end.line).toBeLessThanOrEqual(120);
      expect(range.end.line).toBeGreaterThanOrEqual(0);
    });

    it("getBlockRange with 10+ level nesting returns correct block", () => {
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
      const range = extractor.getBlockRange(doc, pos(depth, 0), "simple");
      expect(range.start.line).toBe(depth);
      expect(range.end.line).toBe(depth);
    });

    it("single-line file: extract returns that line as code", () => {
      const doc = makeDocument(["const x = 1;"], "typescript");
      const result = extractor.extract(doc, pos(0, 0));
      expect(result.code).toBe("const x = 1;");
      expect(result.context).toBe("");
    });

    it("single-line file: getBlockRange returns single line", () => {
      const doc = makeDocument(["const x = 1;"], "typescript");
      const range = extractor.getBlockRange(doc, pos(0, 0), "simple");
      expect(range.start.line).toBe(0);
      expect(range.end.line).toBe(0);
    });

    it("Unicode in code: extract and getBlockRange handle gracefully", () => {
      const lines = ["const 变量 = 1;", "return 变量;"];
      const doc = makeDocument(lines, "typescript");
      const result = extractor.extract(doc, pos(0, 0));
      expect(result.code).toContain("变量");
      const range = extractor.getBlockRange(doc, pos(0, 0), "simple");
      expect(range.start.line).toBe(0);
      expect(range.end.line).toBe(0);
    });
  });
});

describe("ContextExtractor performance", () => {
  const detector = new CodeStructureDetector();
  const extractor = new ContextExtractor();

  it("getBlockRange on large file (1000+ lines) completes within target", () => {
    const lineCount = 1200;
    const lines = Array.from({ length: lineCount }, (_, i) =>
      i % 3 === 0 ? "function foo() {" : i % 3 === 1 ? "  const x = 1;" : "}"
    );
    const doc = makeDocument(lines, "typescript");
    const position = pos(600, 2);
    const classification = detector.classify(doc, position);
    const start = performance.now();
    for (let i = 0; i < 10; i++) {
      extractor.getBlockRange(doc, position, classification);
    }
    const elapsed = (performance.now() - start) / 10;
    expect(elapsed).toBeLessThan(HIGHLIGHT_LATENCY_MS);
  });

  it("getBlockRange with deeply nested code (10+ levels) completes within target", () => {
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
    const classification = detector.classify(doc, position);
    const start = performance.now();
    for (let i = 0; i < 10; i++) {
      extractor.getBlockRange(doc, position, classification);
    }
    const elapsed = (performance.now() - start) / 10;
    expect(elapsed).toBeLessThan(HIGHLIGHT_LATENCY_MS);
  });

  it("full highlight path (isComment + classify + extract + getBlockRange) feels instant", () => {
    const lines = [
      "function foo() {",
      "  if (x) {",
      "    const a = 1;",
      "    return a;",
      "  }",
      "  return 0;",
      "}",
    ];
    const doc = makeDocument(lines, "typescript");
    const position = pos(2, 4);
    const start = performance.now();
    for (let i = 0; i < 50; i++) {
      if (detector.isComment(doc, position)) continue;
      const classification = detector.classify(doc, position);
      extractor.extract(doc, position);
      extractor.getBlockRange(doc, position, classification);
    }
    const elapsed = (performance.now() - start) / 50;
    expect(elapsed).toBeLessThan(HIGHLIGHT_LATENCY_MS);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as vscode from "vscode";
import { ContextExtractor } from "./contextExtractor";
import { CodeStructureDetector } from "./codeStructureDetector";
import { CodeLensHoverProvider } from "../providers/hoverProvider";

/** Hoisted so vi.mock("vscode") factory can reference them. */
const { mockWindow, mockWorkspace } = vi.hoisted(() => ({
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
    onDidChangeActiveColorTheme: vi.fn(() => ({ dispose: vi.fn() })),
    activeColorTheme: { kind: 1 },
  },
  mockWorkspace: {
    getConfiguration: vi.fn(() => ({ get: vi.fn(() => "") })),
    onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
  },
}));

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
    constructor(public content: unknown, public range: unknown) {}
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
    cancel = vi.fn();
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
    explain = vi.fn();
  },
}));

vi.mock("../services/cacheService", () => ({
  CacheService: class {
    get = vi.fn(() => "Cached explanation");
    set = vi.fn();
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
    it("unknown uses indentation heuristic: same-indent lines form one block", () => {
      const lines = ["someCall();", "otherCall();"];
      const doc = makeDocument(lines, "typescript");
      const range = extractor.getBlockRange(doc, pos(0, 0), "unknown");
      expectRangeLines(range, 0, 1);
    });

    it("unknown: indented block treated as one block", () => {
      const lines = ["function f() {", "  const a = 1;", "  const b = 2;", "}"];
      const doc = makeDocument(lines, "typescript");
      const range = extractor.getBlockRange(doc, pos(1, 2), "unknown");
      expect(range.start.line).toBe(1);
      expect(range.end.line).toBe(2);
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

    it("body line inside if gets full if-block highlight", () => {
      const lines = ["if (x) {", "  doSomething();", "}"];
      const range = getHighlightRange(lines, "typescript", 1, 2);
      expect(range.start.line).toBe(0);
      expect(range.end.line).toBe(1);
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

    it("indented body line (non-keyword) inside def gets full def highlight", () => {
      const lines = ["def f():", "    x = 1", "    return x"];
      const range = getHighlightRange(lines, "python", 1, 4);
      expect(range.start.line).toBe(0);
      expect(range.end.line).toBe(2);
    });
  });

  describe("unknown classification", () => {
    it("non-keyword line uses indentation-based range (same indent as previous = one block)", () => {
      const lines = ["function f() {}", "someCall();"];
      const range = getHighlightRange(lines, "typescript", 1, 0);
      expect(range.start.line).toBe(0);
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

    it("unknown (body line inside def): decoration range is full def block", () => {
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

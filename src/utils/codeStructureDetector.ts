/**
 * Code structure detection via pre-compiled regex patterns per language.
 * Used to identify comments, functions, classes, and other constructs
 * without re-compiling regex on each use.
 */

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/** Patterns for comment detection (single-line, multi-line, doc). */
export interface CommentPatterns {
  /** Matches the start of a single-line comment (e.g. // or #). */
  singleLine: RegExp;
  /** Matches the single-line comment marker anywhere on a line (e.g. // or #). */
  singleLineMarker?: RegExp;
  /** Multi-line comment open/close (e.g. /* and *\/). */
  multiLine: { start: RegExp; end: RegExp };
  /** Optional doc comment (e.g. /** and *\/). */
  doc?: { start: RegExp; end: RegExp };
  /**
   * Pre-compiled global variants for multi-line scanning (avoids creating RegExp at runtime).
   * When set, isComment uses these instead of compiling from multiLine/doc sources.
   */
  multiLineGlobal?: { start: RegExp; end: RegExp };
  /** Pre-compiled global variant for doc comment start. */
  docStartGlobal?: RegExp;
}

/** Patterns for structural constructs (function, class, method, etc.). */
export interface StructuralPatterns {
  function?: RegExp;
  class?: RegExp;
  method?: RegExp;
  [key: string]: RegExp | undefined;
}

/** Lightweight patterns (imports, exports, blank lines). */
export interface SimplePatterns {
  import?: RegExp;
  export?: RegExp;
  /** Line that is empty or only whitespace. */
  emptyOrWhitespace: RegExp;
  [key: string]: RegExp | undefined;
}

/** Result of classifying the line at a position: structural block, simple statement, or unknown. */
export type ClassificationResult = "structural" | "simple" | "unknown";

/** Line-start patterns used only for classify(). Structural = if/for/while/function/class/try etc. */
export interface ClassificationPatterns {
  /** Patterns that indicate a structural element (control flow, function, class, try). */
  structural: RegExp[];
  /** Patterns that indicate a simple statement (const, let, var, return, import). */
  simple: RegExp[];
}

/** Full pattern set for a single language. */
export interface LanguagePatterns {
  comments: CommentPatterns;
  structural: StructuralPatterns;
  simple: SimplePatterns;
  /** Optional patterns for classify(); used when present, otherwise fallback heuristics only. */
  classification?: ClassificationPatterns;
}

/** Minimal document interface for comment detection (vscode.TextDocument satisfies this). */
export interface DocumentLike {
  languageId: string;
  lineCount: number;
  lineAt(line: number): { text: string };
  offsetAt(position: PositionLike): number;
}

/** Minimal position interface (vscode.Position satisfies this). */
export interface PositionLike {
  line: number;
  character: number;
}

// ---------------------------------------------------------------------------
// Pre-compiled pattern builders (run once at init)
// ---------------------------------------------------------------------------

function buildTypeScriptPatterns(): LanguagePatterns {
  return {
    comments: {
      singleLine: /^\s*\/\//,
      singleLineMarker: /\/\//,
      multiLine: { start: /\/\*/, end: /\*\// },
      doc: { start: /^\s*\/\*\*/, end: /\*\// },
      multiLineGlobal: { start: /\/\*/g, end: /\*\//g },
      docStartGlobal: /^\s*\/\*\*/g,
    },
    structural: {
      function: /^\s*(export\s+)?(async\s+)?function\s+\w+/,
      arrowFunction:
        /^\s*(export\s+)?(const|let|var)\s+\w+\s*=\s*(async\s+)?\(/,
      arrowFunctionShort:
        /^\s*(export\s+)?(const|let|var)\s+\w+\s*=\s*(async\s+)?(\w+|\([^)]*\))\s*=>/,
      class: /^\s*(export\s+)?(abstract\s+)?class\s+\w+/,
      method:
        /^\s*(public|private|protected|static|async|\s)*\w+\s*\([^)]*\)\s*[:{]/,
      component: /^\s*(export\s+)?(const|function)\s+[A-Z]\w+/,
      complexVariable:
        /^\s*(export\s+)?(const|let|var)\s+\w+\s*=\s*(new\s+\w+|\{|\[|function|class)/,
    },
    simple: {
      import: /^\s*import\s+/,
      export: /^\s*export\s+/,
      emptyOrWhitespace: /^\s*$/,
    },
    classification: buildJsLikeClassificationPatterns(),
  };
}

function buildJavaScriptPatterns(): LanguagePatterns {
  return {
    comments: {
      singleLine: /^\s*\/\//,
      singleLineMarker: /\/\//,
      multiLine: { start: /\/\*/, end: /\*\// },
      doc: { start: /^\s*\/\*\*/, end: /\*\// },
      multiLineGlobal: { start: /\/\*/g, end: /\*\//g },
      docStartGlobal: /^\s*\/\*\*/g,
    },
    structural: {
      function: /^\s*(export\s+)?(async\s+)?function\s+\w+/,
      arrowFunction:
        /^\s*(export\s+)?(const|let|var)\s+\w+\s*=\s*(async\s+)?\(/,
      arrowFunctionShort:
        /^\s*(export\s+)?(const|let|var)\s+\w+\s*=\s*(async\s+)?(\w+|\([^)]*\))\s*=>/,
      class: /^\s*(export\s+)?class\s+\w+/,
      method: /^\s*(async\s+)?\w+\s*\([^)]*\)\s*\{/,
      component: /^\s*(export\s+)?(const|function)\s+[A-Z]\w+/,
      complexVariable:
        /^\s*(export\s+)?(const|let|var)\s+\w+\s*=\s*(new\s+\w+|\{|\[|function|class)/,
    },
    simple: {
      import: /^\s*import\s+/,
      export: /^\s*export\s+/,
      emptyOrWhitespace: /^\s*$/,
    },
    classification: buildJsLikeClassificationPatterns(),
  };
}

function buildPythonPatterns(): LanguagePatterns {
  return {
    comments: {
      singleLine: /^\s*#/,
      singleLineMarker: /#/,
      multiLine: { start: /"""/, end: /"""/ },
      doc: { start: /^\s*"""/, end: /"""/ },
      multiLineGlobal: { start: /"""/g, end: /"""/g },
      docStartGlobal: /^\s*"""/g,
    },
    structural: {
      function: /^\s*(async\s+)?def\s+\w+/,
      class: /^\s*class\s+\w+/,
      method: /^\s+def\s+\w+\s*\(/,
    },
    simple: {
      import: /^\s*import\s+|^\s*from\s+\S+\s+import/,
      emptyOrWhitespace: /^\s*$/,
    },
    classification: buildPythonClassificationPatterns(),
  };
}

/** Generic C-style patterns for languages without specific support. */
function buildFallbackPatterns(): LanguagePatterns {
  return {
    comments: {
      singleLine: /^\s*\/\//,
      multiLine: { start: /\/\*/, end: /\*\// },
      multiLineGlobal: { start: /\/\*/g, end: /\*\//g },
    },
    structural: {
      function: /^\s*function\s+\w+|^\s*\w+\s*\([^)]*\)\s*\{/,
      class: /^\s*class\s+\w+/,
    },
    simple: {
      emptyOrWhitespace: /^\s*$/,
    },
    classification: buildJsLikeClassificationPatterns(),
  };
}

/** Line-start patterns for structural (if/for/while/function/class/try) and simple (const/let/var/return/import) for JS/TS. */
function buildJsLikeClassificationPatterns(): ClassificationPatterns {
  return {
    structural: [
      /^\s*if\s*\(/,
      /^\s*for\s*\(/,
      /^\s*while\s*\(/,
      /^\s*(export\s+)?(async\s+)?function\s+\w+/,
      /^\s*(export\s+)?(abstract\s+)?class\s+\w+/,
      /^\s*try\s*\{/,
      /^\s*catch\s*\(/,
      /^\s*finally\s*\{/,
      /^\s*else\s*\{/,
      /^\s*else\s+if\s*\(/,
      /^\s*switch\s*\(/,
      /^\s*(export\s+)?(const|let|var)\s+\w+\s*=\s*(async\s+)?\(/,
      /^\s*(export\s+)?(const|let|var)\s+\w+\s*=\s*(async\s+)?(\w+|\([^)]*\))\s*=>/,
      /^\s*(public|private|protected|static|async|\s)*\w+\s*\([^)]*\)\s*[:{]/,
      /^\s*(export\s+)?(const|function)\s+[A-Z]\w+/,
      /^\s*(export\s+)?(const|let|var)\s+\w+\s*=\s*(new\s+\w+|\{|\[|function|class)/,
    ],
    simple: [
      /^\s*const\s+/,
      /^\s*let\s+/,
      /^\s*var\s+/,
      /^\s*return\s+/,
      /^\s*return\s*;/,
      /^\s*import\s+/,
      /^\s*export\s+/,
    ],
  };
}

/** Line-start patterns for Python (def/class/if/for/while/try, import/from/return). */
function buildPythonClassificationPatterns(): ClassificationPatterns {
  return {
    structural: [
      /^\s*if\s+/,
      /^\s*elif\s+/,
      /^\s*else\s*:/,
      /^\s*for\s+/,
      /^\s*while\s+/,
      /^\s*(async\s+)?def\s+\w+/,
      /^\s*class\s+\w+/,
      /^\s*try\s*:/,
      /^\s*except\s+/,
      /^\s*except\s*:/,
      /^\s*finally\s*:/,
      /^\s+def\s+\w+\s*\(/,
    ],
    simple: [
      /^\s*import\s+/,
      /^\s*from\s+\S+\s+import/,
      /^\s*return\s+/,
      /^\s*return\s*$/,
    ],
  };
}

// ---------------------------------------------------------------------------
// CodeStructureDetector
// ---------------------------------------------------------------------------

/** Language IDs that have dedicated pattern sets. */
const SUPPORTED_LANGUAGE_IDS = new Set([
  "typescript",
  "javascript",
  "typescriptreact",
  "javascriptreact",
  "python",
]);

/** Max lines to scan backward when detecting multi-line comments. */
const MAX_BACKWARD_SCAN_LINES = 100;

/**
 * Detector that provides pre-compiled regex patterns per language for
 * comments, structure (function/class/method), and simple line types.
 *
 * **Usage:** Create one instance (e.g. at extension activation), then call
 * `classify()`, `isComment()`, and `isEmptyLineInBlock()` with a document and
 * position. Use `getLanguagePatterns(languageId)` when you need direct access
 * to the pattern set for a language.
 *
 * **Performance:** All regex patterns are compiled once at construction and
 * cached. No regex are created at call time. Multi-line comment detection
 * scans backward up to {@link MAX_BACKWARD_SCAN_LINES} lines; other methods
 * are O(1) or O(lines scanned) with no allocation of pattern objects.
 *
 * **Supported languages:** TypeScript, JavaScript, TS/JS React, Python. Other
 * languages use a generic C-style fallback; see {@link isSupported}.
 */
export class CodeStructureDetector {
  private readonly registry: Map<string, LanguagePatterns>;
  private readonly fallback: LanguagePatterns;

  constructor() {
    this.registry = new Map<string, LanguagePatterns>();

    this.registry.set("typescript", buildTypeScriptPatterns());
    this.registry.set("javascript", buildJavaScriptPatterns());
    this.registry.set("typescriptreact", buildTypeScriptPatterns());
    this.registry.set("javascriptreact", buildJavaScriptPatterns());
    this.registry.set("python", buildPythonPatterns());

    this.fallback = buildFallbackPatterns();
  }

  /**
   * Returns the pattern set for the given language ID.
   * Use this when you need comment, structural, or simple patterns for a language.
   * Uses generic fallback when the language is not in the registry.
   *
   * @param languageId - VS Code language id (e.g. "typescript", "python"). Case-insensitive.
   * @returns The cached language patterns; never allocates new regex.
   */
  getLanguagePatterns(languageId: string): LanguagePatterns {
    return this.getPatterns(languageId);
  }

  /**
   * Returns the pattern set for the given language ID.
   * Uses generic fallback when the language is not in the registry.
   * @internal Prefer {@link getLanguagePatterns} for public API.
   */
  getPatterns(languageId: string): LanguagePatterns {
    const normalized = languageId.toLowerCase();
    return this.registry.get(normalized) ?? this.fallback;
  }

  /** Returns true if the language has dedicated (non-fallback) patterns. */
  isSupported(languageId: string): boolean {
    return SUPPORTED_LANGUAGE_IDS.has(languageId.toLowerCase());
  }

  /** Returns the length of leading whitespace on the line (spaces/tabs). */
  private getLeadingWhitespaceLength(text: string): number {
    const m = text.match(/^\s*/);
    return m ? m[0].length : 0;
  }

  /** Returns true if the line matches any of the given line-start patterns. */
  private matchAnyPattern(lineText: string, patterns: RegExp[]): boolean {
    for (const re of patterns) {
      if (re.test(lineText)) return true;
    }
    return false;
  }

  /**
   * Finds the nearest non-blank line at or above fromLine and returns its indent and index.
   * Returns null if no non-blank line exists above.
   */
  private getPreviousNonBlankLineInfo(
    document: DocumentLike,
    fromLine: number
  ): { indent: number; lineIndex: number } | null {
    let lineIndex = fromLine - 1;
    while (lineIndex >= 0) {
      const text = document.lineAt(lineIndex).text;
      if (text.trim().length > 0) {
        return {
          indent: this.getLeadingWhitespaceLength(text),
          lineIndex,
        };
      }
      lineIndex--;
    }
    return null;
  }

  /**
   * Finds the nearest non-blank line at or below fromLine and returns its indent and index.
   * Returns null if no non-blank line exists below.
   */
  private getNextNonBlankLineInfo(
    document: DocumentLike,
    fromLine: number,
    lineCount: number
  ): { indent: number; lineIndex: number } | null {
    let lineIndex = fromLine + 1;
    while (lineIndex < lineCount) {
      const text = document.lineAt(lineIndex).text;
      if (text.trim().length > 0) {
        return {
          indent: this.getLeadingWhitespaceLength(text),
          lineIndex,
        };
      }
      lineIndex++;
    }
    return null;
  }

  /**
   * Classifies the line at the given position as 'structural' (if/for/while/function/class/try etc.),
   * 'simple' (const/let/var/return/import), or 'unknown'. Uses keyword patterns first, then an
   * indentation-based fallback for ambiguous cases (e.g. indented body line with no keyword).
   */
  classify(
    document: DocumentLike,
    position: PositionLike
  ): ClassificationResult {
    const { lineCount } = document;
    if (lineCount === 0 || position.line < 0 || position.line >= lineCount) {
      return "unknown";
    }

    const patterns = this.getPatterns(document.languageId);
    const lineText = document.lineAt(position.line).text;
    if (lineText.trim().length === 0) {
      return "unknown";
    }

    const classification = patterns.classification;
    if (classification) {
      if (this.matchAnyPattern(lineText, classification.structural)) {
        return "structural";
      }
      if (this.matchAnyPattern(lineText, classification.simple)) {
        return "simple";
      }
    }

    const leadingSpaces = this.getLeadingWhitespaceLength(lineText);
    const prev = this.getPreviousNonBlankLineInfo(document, position.line);
    if (prev !== null && leadingSpaces > prev.indent) {
      return "structural";
    }
    return "unknown";
  }

  /**
   * Returns true if the given position is inside a comment (single-line,
   * multi-line, or doc comment). Uses language-specific patterns and
   * backward scanning (up to MAX_BACKWARD_SCAN_LINES) for multi-line blocks.
   */
  isComment(document: DocumentLike, position: PositionLike): boolean {
    const { lineCount } = document;
    if (lineCount === 0 || position.line < 0 || position.line >= lineCount) {
      return false;
    }

    const patterns = this.getPatterns(document.languageId);
    const lineText = document.lineAt(position.line).text;

    // Single-line comment: whole line or trailing inline (e.g. // or #)
    if (patterns.comments.singleLine.test(lineText)) {
      return true;
    }
    if (patterns.comments.singleLineMarker) {
      const m = patterns.comments.singleLineMarker.exec(lineText);
      if (m !== null) {
        return position.character >= m.index;
      }
    }

    // Multi-line and doc comments: backward scan and stack of open blocks
    const positionOffset = document.offsetAt(position);
    const startLine = Math.max(0, position.line - MAX_BACKWARD_SCAN_LINES);
    const events: { offset: number; type: "start" | "end" }[] = [];

    let offsetSoFar = 0;
    for (let i = 0; i < startLine; i++) {
      offsetSoFar += document.lineAt(i).text.length + 1;
    }

    const multiSame =
      patterns.comments.multiLine.start.source ===
      patterns.comments.multiLine.end.source;

    const multiStartG =
      patterns.comments.multiLineGlobal?.start ??
      new RegExp(patterns.comments.multiLine.start.source, "g");
    const multiEndG =
      patterns.comments.multiLineGlobal?.end ??
      new RegExp(patterns.comments.multiLine.end.source, "g");
    const docStartG = patterns.comments.doc
      ? patterns.comments.docStartGlobal ??
        new RegExp(patterns.comments.doc.start.source, "g")
      : null;

    const addMatchesFromGlobal = (
      lineText: string,
      lineStartOffset: number,
      g: RegExp,
      type: "start" | "end",
      endOffsetPlusLength: boolean,
      skipStartOffsets?: Set<number>
    ) => {
      g.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = g.exec(lineText)) !== null) {
        const offset = lineStartOffset + m.index;
        if (type === "start" && skipStartOffsets?.has(offset)) {
          continue;
        }
        const eventOffset =
          type === "end" && endOffsetPlusLength ? offset + m[0].length : offset;
        if (offset <= positionOffset) {
          events.push({ offset: eventOffset, type });
        }
      }
    };

    for (let i = startLine; i <= position.line; i++) {
      const text = document.lineAt(i).text;
      const lineStart = offsetSoFar;
      offsetSoFar += text.length + 1;

      const docStartOffsets = new Set<number>();
      if (docStartG) {
        docStartG.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = docStartG.exec(text)) !== null) {
          const offset = lineStart + m.index;
          if (offset <= positionOffset) docStartOffsets.add(offset);
        }
      }

      if (multiSame) {
        multiStartG.lastIndex = 0;
        const positions: { offset: number; len: number }[] = [];
        let m: RegExpExecArray | null;
        while ((m = multiStartG.exec(text)) !== null) {
          const offset = lineStart + m.index;
          if (offset <= positionOffset)
            positions.push({ offset, len: m[0].length });
        }
        positions.sort((a, b) => a.offset - b.offset);
        for (let k = 0; k < positions.length; k++) {
          const { offset, len } = positions[k];
          events.push({
            offset: k % 2 === 0 ? offset : offset + len,
            type: k % 2 === 0 ? "start" : "end",
          });
        }
      } else {
        addMatchesFromGlobal(
          text,
          lineStart,
          multiStartG,
          "start",
          false,
          docStartOffsets
        );
        addMatchesFromGlobal(text, lineStart, multiEndG, "end", true);
        if (docStartG) {
          addMatchesFromGlobal(text, lineStart, docStartG, "start", false);
        }
      }
    }

    events.sort((a, b) => a.offset - b.offset);
    let stack = 0;
    for (const e of events) {
      if (e.offset > positionOffset) break;
      if (e.type === "start") stack++;
      else stack--;
    }
    return stack > 0;
  }

  /**
   * Returns true if the line at the given position is empty (or whitespace-only)
   * and lies within a code block, i.e. between non-empty lines where at least one
   * has indentation (so we're not in a top-level gap between statements).
   * Scans upward and downward for the nearest non-empty lines and compares
   * indentation to decide. Returns false for start/end of file or when the line
   * is not empty.
   */
  isEmptyLineInBlock(document: DocumentLike, position: PositionLike): boolean {
    const { lineCount } = document;
    if (lineCount === 0 || position.line < 0 || position.line >= lineCount) {
      return false;
    }

    const lineText = document.lineAt(position.line).text;
    if (lineText.trim().length > 0) {
      return false;
    }

    const prev = this.getPreviousNonBlankLineInfo(document, position.line);
    const next = this.getNextNonBlankLineInfo(
      document,
      position.line,
      lineCount
    );
    if (prev === null || next === null) {
      return false;
    }

    if (prev.indent > 0 || next.indent > 0) {
      return true;
    }

    const prevTrimmed = document.lineAt(prev.lineIndex).text.trim();
    const nextTrimmed = document.lineAt(next.lineIndex).text.trim();
    const isOpeningBraceLine = prevTrimmed.endsWith("{");
    const isClosingBraceLine =
      nextTrimmed === "}" || nextTrimmed === "};" || nextTrimmed === "},";
    return isOpeningBraceLine && isClosingBraceLine;
  }
}

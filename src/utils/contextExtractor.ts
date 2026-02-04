import * as vscode from "vscode";
import {
  CodeStructureDetector,
  type ClassificationResult,
} from "./codeStructureDetector";

export interface ExtractResult {
  code: string;
  context: string;
}

/**
 * Extracts the hovered line and surrounding context for AI explanation.
 * Used by the hover provider to build the payload sent to the AI service.
 */
export class ContextExtractor {
  private readonly structureDetector = new CodeStructureDetector();
  /**
   * Returns the trimmed line at position plus surrounding lines as context.
   * Context excludes the hovered line so the AI can distinguish "this line" from "around it".
   */
  extract(
    document: vscode.TextDocument,
    position: vscode.Position,
    lineRange: number = 5
  ): ExtractResult {
    const lineIndex = position.line;
    const lineCount = document.lineCount;

    const hoveredLine = document.lineAt(lineIndex).text;
    const code = hoveredLine.trim();

    const startLine = Math.max(0, lineIndex - lineRange);
    const endLine = Math.min(lineCount - 1, lineIndex + lineRange);

    const contextLines: string[] = [];
    for (let i = startLine; i <= endLine; i++) {
      if (i !== lineIndex) {
        contextLines.push(document.lineAt(i).text);
      }
    }
    const context = contextLines.join("\n");

    return { code, context };
  }

  /**
   * Uses indentation or (when classification is provided) classification-based
   * logic to find the block containing the position and returns its full text.
   */
  extractBlock(
    document: vscode.TextDocument,
    position: vscode.Position,
    classification?: ClassificationResult
  ): string {
    if (document.lineCount === 0) {
      return "";
    }
    if (classification === "simple") {
      const lineIndex = Math.max(
        0,
        Math.min(position.line, document.lineCount - 1)
      );
      return document.lineAt(lineIndex).text.trimEnd();
    }
    const { start, end } = this.getBlockLineRange(
      document,
      position,
      classification
    );
    const lines: string[] = [];
    for (let i = start; i <= end; i++) {
      lines.push(document.lineAt(i).text);
    }
    return lines.join("\n");
  }

  /**
   * Returns the range of the block containing the position (same logic as extractBlock).
   * Use for decorations; fall back to single-line range if the document is empty.
   *
   * When classification is provided:
   * - 'structural' → full block range via language-aware detection
   * - 'simple' → single-line range
   * - 'unknown' or omitted → indentation heuristic (backward compatible)
   */
  getBlockRange(
    document: vscode.TextDocument,
    position: vscode.Position,
    classification?: ClassificationResult
  ): vscode.Range {
    const lineCount = document.lineCount;
    if (lineCount === 0) {
      return new vscode.Range(0, 0, 0, 0);
    }
    const lineIndex = Math.max(0, Math.min(position.line, lineCount - 1));
    const pos = new vscode.Position(lineIndex, 0);

    if (classification === "simple") {
      const line = document.lineAt(lineIndex);
      return new vscode.Range(lineIndex, 0, lineIndex, line.text.length);
    }

    const { start, end } =
      classification === "structural"
        ? this.getStructuralBlockLineRange(document, pos)
        : this.getBlockLineRange(document, pos, classification);

    const endLine = document.lineAt(end);
    return new vscode.Range(start, 0, end, endLine.text.length);
  }

  /**
   * Language-aware block range for structural elements (function, class, if, etc.).
   * Falls back to indentation heuristic when no structural start is found or language is unsupported.
   */
  private getStructuralBlockLineRange(
    document: vscode.TextDocument,
    position: vscode.Position
  ): { start: number; end: number } {
    const lineIndex = position.line;
    const lineCount = document.lineCount;
    if (lineCount === 0 || lineIndex < 0 || lineIndex >= lineCount) {
      return { start: 0, end: 0 };
    }

    const patterns = this.structureDetector.getLanguagePatterns(
      document.languageId
    );
    const structuralPatterns: RegExp[] = [];
    for (const key of Object.keys(patterns.structural)) {
      const re = patterns.structural[key];
      if (re instanceof RegExp) structuralPatterns.push(re);
    }
    if (patterns.classification?.structural) {
      structuralPatterns.push(...patterns.classification.structural);
    }

    const currentLineText = document.lineAt(lineIndex).text;
    const currentIndent = this.getIndentation(currentLineText);
    const effectiveIndent =
      currentLineText.trim().length > 0
        ? currentIndent
        : this.getIndentationFromNeighbor(document, lineIndex, lineCount);

    let blockStart: number | null = null;
    for (let i = lineIndex; i >= 0; i--) {
      const line = document.lineAt(i).text;
      if (line.trim().length === 0) continue;
      const indent = this.getIndentation(line);
      if (indent > effectiveIndent) continue;
      const matches = structuralPatterns.some((re) => re.test(line));
      if (matches) {
        blockStart = i;
        break;
      }
    }

    if (blockStart === null) {
      return this.getBlockLineRangeIndent(document, position);
    }

    const startLineText = document.lineAt(blockStart).text;
    const blockStartIndent = this.getIndentation(startLineText);

    let blockEnd = blockStart;
    for (let i = blockStart + 1; i < lineCount; i++) {
      const line = document.lineAt(i).text;
      if (line.trim().length === 0) {
        blockEnd = i;
        continue;
      }
      const indent = this.getIndentation(line);
      if (indent <= blockStartIndent) {
        break;
      }
      blockEnd = i;
    }
    return { start: blockStart, end: blockEnd };
  }

  /** Indentation of the nearest non-blank line above or below; used when position is on a blank line. */
  private getIndentationFromNeighbor(
    document: vscode.TextDocument,
    lineIndex: number,
    lineCount: number
  ): number {
    for (let i = lineIndex - 1; i >= 0; i--) {
      const t = document.lineAt(i).text;
      if (t.trim().length > 0) return this.getIndentation(t);
    }
    for (let i = lineIndex + 1; i < lineCount; i++) {
      const t = document.lineAt(i).text;
      if (t.trim().length > 0) return this.getIndentation(t);
    }
    return 0;
  }

  private getBlockLineRange(
    document: vscode.TextDocument,
    position: vscode.Position,
    classification?: ClassificationResult
  ): { start: number; end: number } {
    if (classification === "structural") {
      return this.getStructuralBlockLineRange(document, position);
    }
    return this.getBlockLineRangeIndent(document, position);
  }

  private getBlockLineRangeIndent(
    document: vscode.TextDocument,
    position: vscode.Position
  ): { start: number; end: number } {
    const lineIndex = position.line;
    const lineCount = document.lineCount;
    const currentLine = document.lineAt(lineIndex).text;
    const currentIndent = this.getIndentation(currentLine);

    let blockStart = 0;
    for (let i = lineIndex - 1; i >= 0; i--) {
      const line = document.lineAt(i).text;
      if (line.trim().length === 0) continue;
      const indent = this.getIndentation(line);
      if (indent < currentIndent) {
        blockStart = i + 1;
        break;
      }
    }

    let blockEnd = lineIndex;
    for (let i = lineIndex + 1; i < lineCount; i++) {
      const line = document.lineAt(i).text;
      if (line.trim().length === 0) {
        blockEnd = i;
        continue;
      }
      const indent = this.getIndentation(line);
      if (indent < currentIndent) {
        break;
      }
      blockEnd = i;
    }

    return { start: blockStart, end: blockEnd };
  }

  /** Returns the number of leading whitespace characters (spaces or tabs). */
  private getIndentation(line: string): number {
    let count = 0;
    for (const ch of line) {
      if (ch === " " || ch === "\t") count++;
      else break;
    }
    return count;
  }
}

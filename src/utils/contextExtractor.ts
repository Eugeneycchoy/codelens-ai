import * as vscode from "vscode";

export interface ExtractResult {
  code: string;
  context: string;
}

/**
 * Extracts the hovered line and surrounding context for AI explanation.
 * Used by the hover provider to build the payload sent to the AI service.
 */
export class ContextExtractor {
  /**
   * Returns the trimmed line at position plus surrounding lines as context.
   * Context excludes the hovered line so the AI can distinguish "this line" from "around it".
   */
  extract(
    document: vscode.TextDocument,
    position: vscode.Position,
    lineRange: number = 5,
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
   * Uses indentation to find the logical block containing the position
   * (e.g. function body, loop body, class body) and returns its full text.
   */
  extractBlock(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): string {
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

    const lines: string[] = [];
    for (let i = blockStart; i <= blockEnd; i++) {
      lines.push(document.lineAt(i).text);
    }
    return lines.join("\n");
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

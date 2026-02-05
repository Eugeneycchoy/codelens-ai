import * as vscode from "vscode";
import { AIService } from "../services/aiService";
import { CacheService } from "../services/cacheService";
import {
  CodeStructureDetector,
  type ClassificationResult,
} from "../utils/codeStructureDetector";
import { ContextExtractor } from "../utils/contextExtractor";

const THEME_HIGHLIGHT = {
  dark: "rgba(0, 128, 128, 0.15)",
  light: "rgba(0, 128, 128, 0.25)",
  highContrast: "rgba(255, 255, 255, 0.1)",
} as const;

/** Prefix for cached error messages so we can show a Retry link. */
const CACHED_ERROR_PREFIX = "Something went wrong:";

/** Line range for "Learn More" context (more surrounding lines than hover). */
const DETAILED_LINE_RANGE = 15;

/**
 * Provides hover tooltips with AI-generated code explanations.
 * Checks cache first; on cache miss returns no hover and fetches in the background.
 * User must re-hover to see the result after the fetch completes.
 * Applies a visual highlight to the hovered code block and clears it when the cursor moves away.
 */
export class CodeLensHoverProvider
  implements vscode.HoverProvider, vscode.Disposable
{
  private readonly aiService = new AIService();
  private readonly cacheService = new CacheService();
  private readonly contextExtractor = new ContextExtractor();
  private readonly detector = new CodeStructureDetector();

  /** Cancels the previous in-flight hover fetch when a new hover occurs or user moves away. */
  private hoverCancelSource: vscode.CancellationTokenSource | null = null;

  private decorationType: vscode.TextEditorDecorationType | null = null;
  private lastDecoratedEditor: vscode.TextEditor | null = null;
  private lastDecoratedRange: vscode.Range | null = null;
  private selectionListener: vscode.Disposable | null = null;
  private configListener: vscode.Disposable | null = null;
  private themeListener: vscode.Disposable | null = null;

  constructor() {
    this.updateDecorationType();
    this.selectionListener = vscode.window.onDidChangeTextEditorSelection(
      (e) => {
        if (
          !this.lastDecoratedRange ||
          e.textEditor !== this.lastDecoratedEditor
        )
          return;
        const line = e.selections[0]?.active.line ?? 0;
        if (
          line < this.lastDecoratedRange.start.line ||
          line > this.lastDecoratedRange.end.line
        ) {
          this.clearDecoration();
        }
      }
    );
    this.configListener = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("codelensAI.highlightColor"))
        this.updateDecorationType();
    });
    this.themeListener = vscode.window.onDidChangeActiveColorTheme(() =>
      this.updateDecorationType()
    );
  }

  private getHighlightColor(): string {
    const custom = vscode.workspace
      .getConfiguration("codelensAI")
      .get<string>("highlightColor");
    if (custom && custom.trim().length > 0) return custom.trim();
    const kind = vscode.window.activeColorTheme.kind;
    if (kind === vscode.ColorThemeKind.HighContrast)
      return THEME_HIGHLIGHT.highContrast;
    if (kind === vscode.ColorThemeKind.Light) return THEME_HIGHLIGHT.light;
    return THEME_HIGHLIGHT.dark;
  }

  private updateDecorationType(): void {
    if (this.decorationType) {
      this.decorationType.dispose();
      this.decorationType = null;
    }
    this.decorationType = vscode.window.createTextEditorDecorationType({
      backgroundColor: this.getHighlightColor(),
    });
  }

  /** Returns the line index of the previous non-blank line, or 0 if none. */
  private getPreviousNonBlankLine(
    document: vscode.TextDocument,
    fromLine: number
  ): number {
    for (let i = fromLine - 1; i >= 0; i--) {
      if (document.lineAt(i).text.trim().length > 0) return i;
    }
    return 0;
  }

  private clearDecoration(): void {
    if (this.lastDecoratedEditor && this.decorationType) {
      this.lastDecoratedEditor.setDecorations(this.decorationType, []);
    }
    this.lastDecoratedEditor = null;
    this.lastDecoratedRange = null;
  }

  private applyDecoration(
    editor: vscode.TextEditor,
    range: vscode.Range
  ): void {
    this.clearDecoration();
    if (!this.decorationType) return;
    this.lastDecoratedEditor = editor;
    this.lastDecoratedRange = range;
    editor.setDecorations(this.decorationType, [range]);
  }

  /**
   * Computes the highlight range from classification: structural → full block,
   * simple → single line, unknown → indentation-based block (handled by getBlockRange).
   * Caller should pass the same classification used for extraction so highlight and explanation match.
   */
  private getHighlightRange(
    document: vscode.TextDocument,
    position: vscode.Position,
    classification: ClassificationResult
  ): vscode.Range {
    try {
      return this.contextExtractor.getBlockRange(
        document,
        position,
        classification
      );
    } catch {
      return document.lineAt(position.line).range;
    }
  }

  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken
  ): vscode.Hover | null {
    this.cancelPreviousHoverFetch();
    if (this.detector.isComment(document, position)) return null;

    const lineText = document.lineAt(position.line).text;
    const isEmptyLine = lineText.trim().length === 0;

    if (isEmptyLine) {
      if (!this.detector.isEmptyLineInBlock(document, position)) return null;
    }

    const highlightPosition = isEmptyLine
      ? new vscode.Position(
          this.getPreviousNonBlankLine(document, position.line),
          0
        )
      : position;
    const classification = this.detector.classify(document, highlightPosition);

    let code: string;
    let context: string;
    if (classification === "structural") {
      code = this.contextExtractor.extractBlock(
        document,
        highlightPosition,
        classification
      );
      const extracted = this.contextExtractor.extract(
        document,
        highlightPosition
      );
      context = extracted.context;
    } else {
      const extracted = this.contextExtractor.extract(
        document,
        highlightPosition
      );
      code = extracted.code;
      context = extracted.context;
    }

    if (code.length === 0) return null;

    const range = document.lineAt(position.line).range;
    const cached = this.cacheService.get(code);
    if (cached !== null) {
      const editor =
        vscode.window.visibleTextEditors.find((e) => e.document === document) ??
        (vscode.window.activeTextEditor?.document === document
          ? vscode.window.activeTextEditor
          : undefined);
      if (editor) {
        const highlightRange = this.getHighlightRange(
          document,
          highlightPosition,
          classification
        );
        this.applyDecoration(editor, highlightRange);
      }
      return new vscode.Hover(
        this.createHoverContent(cached, code, context),
        range
      );
    }

    const highlightRange = this.getHighlightRange(
      document,
      highlightPosition,
      classification
    );

    const editor =
      vscode.window.visibleTextEditors.find((e) => e.document === document) ??
      (vscode.window.activeTextEditor?.document === document
        ? vscode.window.activeTextEditor
        : undefined);
    if (editor) {
      this.applyDecoration(editor, highlightRange);
    }

    const cancelSource = new vscode.CancellationTokenSource();
    this.hoverCancelSource = cancelSource;
    _token.onCancellationRequested(() => cancelSource.cancel());

    void this.fetchExplanation(
      document,
      position,
      code,
      context,
      cancelSource.token
    );
    return null;
  }

  private cancelPreviousHoverFetch(): void {
    if (this.hoverCancelSource) {
      this.hoverCancelSource.cancel();
      this.hoverCancelSource.dispose();
      this.hoverCancelSource = null;
    }
  }

  /**
   * Fetches explanation from AI in the background and caches on success.
   * When AIService throws (network/timeout/auth/rate-limit, etc.), caches the error with
   * CACHED_ERROR_PREFIX so the hover shows the Retry link. Uses the given cancellation
   * token (from hover or new-hover supersede). Does not cache when cancelled.
   */
  private async fetchExplanation(
    document: vscode.TextDocument,
    _position: vscode.Position,
    code: string,
    context: string,
    token?: vscode.CancellationToken
  ): Promise<void> {
    try {
      const lang = document.languageId || "plaintext";
      const explanation = await this.aiService.explain(
        code,
        lang,
        context,
        token
      );
      if (token?.isCancellationRequested) return;
      if (explanation === "Request was cancelled.") return;
      this.cacheService.set(code, explanation);
    } catch (err) {
      if (token?.isCancellationRequested) return;
      console.error("[CodeLens AI] fetchExplanation failed", err);
      const message = err instanceof Error ? err.message : String(err);
      this.cacheService.set(
        code,
        `${CACHED_ERROR_PREFIX} ${message}. Try again or check the output panel for details.`
      );
    }
  }

  private createHoverContent(
    explanation: string,
    code: string,
    context: string
  ): vscode.MarkdownString {
    const md = new vscode.MarkdownString(undefined, true);
    md.isTrusted = true;
    md.appendMarkdown("### 🧠 Dumbify\n\n");
    md.appendMarkdown(explanation);
    md.appendMarkdown("\n\n---\n\n");
    const args = encodeURIComponent(JSON.stringify([code, context]));
    md.appendMarkdown(`[Learn More](command:codelens-ai.explainCode?${args})`);
    if (explanation.startsWith(CACHED_ERROR_PREFIX)) {
      md.appendMarkdown(" | ");
      md.appendMarkdown(
        `[Retry](command:codelens-ai.retryHoverExplanation?${args})`
      );
    }
    return md;
  }

  /**
   * Clears the cached error for the given code and starts a new background fetch.
   * User must re-hover to see the result (Flow 4).
   */
  retryExplanation(code: string, context: string): void {
    const document = vscode.window.activeTextEditor?.document;
    if (!document) {
      void vscode.window.showWarningMessage(
        "No active editor. Re-hover over the code to retry."
      );
      return;
    }
    this.cacheService.delete(code);
    const position = new vscode.Position(0, 0);
    void this.fetchExplanation(document, position, code, context, undefined);
  }

  /**
   * Builds a short outline of the file (classes, functions, methods) for AI context.
   * Uses CodeStructureDetector patterns so the model can relate the code to the file layout.
   */
  private getFileStructureSummary(document: vscode.TextDocument): string {
    const patterns = this.detector.getLanguagePatterns(
      document.languageId
    ).structural;
    const outlineLines: string[] = [];
    const keys: (keyof typeof patterns)[] = [
      "class",
      "function",
      "method",
      "component",
      "arrowFunction",
      "arrowFunctionShort",
    ];
    for (let i = 0; i < document.lineCount; i++) {
      const line = document.lineAt(i).text;
      for (const key of keys) {
        const re = patterns[key];
        if (re?.test(line)) {
          outlineLines.push(`${i + 1}: ${line.trim()}`);
          break;
        }
      }
    }
    return outlineLines.length > 0 ? outlineLines.join("\n") : "";
  }

  /**
   * Tries to find a position in the document where the given code (or its first line) appears.
   * Returns null if not found so caller can fall back to passed context.
   */
  private findPositionForCode(
    document: vscode.TextDocument,
    code: string
  ): vscode.Position | null {
    const firstLine = code.split("\n")[0]?.trim() ?? "";
    if (firstLine.length === 0) return null;
    for (let i = 0; i < document.lineCount; i++) {
      if (document.lineAt(i).text.trim() === firstLine) {
        return new vscode.Position(i, 0);
      }
    }
    return null;
  }

  /**
   * Used by the explainCode command: shows a detailed explanation in a webview panel.
   * Uses more surrounding lines, file structure, and a detailed AI prompt. If code/context
   * are omitted, uses the active editor's selection.
   */
  async explainCode(code?: string, context?: string): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    let document: vscode.TextDocument | undefined = editor?.document;
    let position: vscode.Position | undefined;
    let resolvedCode: string;
    let resolvedContext: string;

    if (code === undefined || code === "") {
      if (!editor) {
        vscode.window.showWarningMessage(
          "No active editor. Select code or hover a line first."
        );
        return;
      }
      const selection = editor.selection;
      const doc = editor.document;
      document = doc;
      resolvedCode = doc.getText(selection).trim();
      if (resolvedCode.length === 0) {
        position = selection.active;
        const line = doc.lineAt(position.line);
        resolvedCode = line.text.trim();
        const extracted = this.contextExtractor.extract(
          doc,
          position,
          DETAILED_LINE_RANGE
        );
        resolvedContext = extracted.context;
      } else {
        position = selection.start;
        const extracted = this.contextExtractor.extract(
          doc,
          selection.active,
          DETAILED_LINE_RANGE
        );
        resolvedContext = extracted.context;
      }
    } else {
      resolvedCode = code;
      if (document) {
        const pos = this.findPositionForCode(document, code);
        if (pos !== null) {
          position = pos;
          const extracted = this.contextExtractor.extract(
            document,
            pos,
            DETAILED_LINE_RANGE
          );
          resolvedContext = extracted.context;
        } else {
          // Position not found; avoid regressing to the 5-line hover context.
          // Use a wider fallback so detailed flow still gets DETAILED_LINE_RANGE context.
          const fallbackPos = new vscode.Position(0, 0);
          const extracted = this.contextExtractor.extract(
            document,
            fallbackPos,
            DETAILED_LINE_RANGE
          );
          resolvedContext = extracted.context;
        }
      } else {
        resolvedContext = context ?? "";
      }
    }

    if (resolvedCode.length === 0) {
      vscode.window.showWarningMessage(
        "No code to explain. Select something or hover a line."
      );
      return;
    }

    const lang = document?.languageId ?? "plaintext";
    const fileStructure =
      document != null ? this.getFileStructureSummary(document) : "";

    let explanation: string;
    try {
      explanation = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Dumbify",
          cancellable: false,
        },
        async () =>
          this.aiService.explain(
            resolvedCode,
            lang,
            resolvedContext,
            undefined,
            {
              detailLevel: "detailed",
              fileStructure: fileStructure || undefined,
            }
          )
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Dumbify: ${message}`);
      return;
    }
    // Do not cache detailed explanation under the same key as hover; otherwise
    // the brief hover tooltip would be overwritten and show the long text on re-hover.
    this.showExplanationPanel(explanation);
  }

  private showExplanationPanel(explanation: string): void {
    const title = "Dumbify: Explanation";
    const panel = vscode.window.createWebviewPanel(
      "codelensAiExplain",
      title,
      vscode.ViewColumn.Beside,
      { enableScripts: false }
    );
    const escaped = escapeHtml(explanation);
    panel.webview.html = getExplanationHtml(escaped);
  }

  dispose(): void {
    this.cancelPreviousHoverFetch();
    this.clearDecoration();
    this.decorationType?.dispose();
    this.decorationType = null;
    this.selectionListener?.dispose();
    this.selectionListener = null;
    this.configListener?.dispose();
    this.configListener = null;
    this.themeListener?.dispose();
    this.themeListener = null;
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getExplanationHtml(body: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      padding: 1rem;
      line-height: 1.6;
      white-space: pre-wrap;
      word-wrap: break-word;
    }
    h2 { margin-top: 0; font-size: 1.1em; }
  </style>
</head>
<body>
  <h2>🧠 Dumbify</h2>
  <div>${body}</div>
</body>
</html>`;
}

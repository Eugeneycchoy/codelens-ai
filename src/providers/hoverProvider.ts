import * as vscode from "vscode";
import { AIService } from "../services/aiService";
import { CacheService } from "../services/cacheService";
import { ContextExtractor } from "../utils/contextExtractor";

const LOADING_MESSAGE = "⏳ Loading explanation…";

const THEME_HIGHLIGHT = {
  dark: "rgba(0, 128, 128, 0.15)",
  light: "rgba(0, 128, 128, 0.25)",
  highContrast: "rgba(255, 255, 255, 0.1)",
} as const;

/**
 * Provides hover tooltips with AI-generated code explanations.
 * Checks cache first, shows loading state, then fetches async and caches for next hover.
 * Applies a visual highlight to the hovered code block and clears it when the cursor moves away.
 */
export class CodeLensHoverProvider
  implements vscode.HoverProvider, vscode.Disposable
{
  private readonly aiService = new AIService();
  private readonly cacheService = new CacheService();
  private readonly contextExtractor = new ContextExtractor();
  private isProcessing = false;

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
      },
    );
    this.configListener = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("codelensAI.highlightColor"))
        this.updateDecorationType();
    });
    this.themeListener = vscode.window.onDidChangeActiveColorTheme(() =>
      this.updateDecorationType(),
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

  private clearDecoration(): void {
    if (this.lastDecoratedEditor && this.decorationType) {
      this.lastDecoratedEditor.setDecorations(this.decorationType, []);
    }
    this.lastDecoratedEditor = null;
    this.lastDecoratedRange = null;
  }

  private applyDecoration(
    editor: vscode.TextEditor,
    range: vscode.Range,
  ): void {
    this.clearDecoration();
    if (!this.decorationType) return;
    this.lastDecoratedEditor = editor;
    this.lastDecoratedRange = range;
    editor.setDecorations(this.decorationType, [range]);
  }

  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken,
  ): vscode.Hover | null {
    const lineText = document.lineAt(position.line).text;
    if (lineText.trim().length === 0) return null;
    if (this.isProcessing) return null;

    const { code, context } = this.contextExtractor.extract(document, position);
    if (code.length === 0) return null;

    let highlightRange: vscode.Range;
    try {
      const blockText = this.contextExtractor.extractBlock(document, position);
      const blockLineCount = blockText.split("\n").length;
      if (blockText.trim().length === 0 || blockLineCount > 15) {
        highlightRange = document.lineAt(position.line).range;
      } else {
        highlightRange = this.contextExtractor.getBlockRange(
          document,
          position,
        );
      }
    } catch {
      highlightRange = document.lineAt(position.line).range;
    }

    const editor =
      vscode.window.visibleTextEditors.find((e) => e.document === document) ??
      (vscode.window.activeTextEditor?.document === document
        ? vscode.window.activeTextEditor
        : undefined);
    if (editor) {
      this.applyDecoration(editor, highlightRange);
    }

    const range = document.lineAt(position.line).range;
    const cached = this.cacheService.get(code);
    if (cached !== null) {
      return new vscode.Hover(
        this.createHoverContent(cached, code, context),
        range,
      );
    }

    void this.fetchExplanation(document, position, code, context, _token);
    return new vscode.Hover(
      this.createHoverContent(LOADING_MESSAGE, code, context),
      range,
    );
  }

  /**
   * Fetches explanation from AI, caches it, and avoids overlapping requests.
   * Passes cancellation token so the request is aborted when hover is dismissed.
   */
  private async fetchExplanation(
    document: vscode.TextDocument,
    position: vscode.Position,
    code: string,
    context: string,
    token?: vscode.CancellationToken,
  ): Promise<void> {
    this.isProcessing = true;
    try {
      const lang = document.languageId || "plaintext";
      const explanation = await this.aiService.explain(
        code,
        lang,
        context,
        token,
      );
      if (token?.isCancellationRequested) return;
      if (explanation === "Request was cancelled.") return;
      this.cacheService.set(code, explanation);
    } catch (err) {
      console.error("[CodeLens AI] fetchExplanation failed", err);
      const message = err instanceof Error ? err.message : String(err);
      this.cacheService.set(
        code,
        `Something went wrong: ${message}. Try again or check the output panel for details.`,
      );
    } finally {
      this.isProcessing = false;
    }
  }

  private createHoverContent(
    explanation: string,
    code: string,
    context: string,
  ): vscode.MarkdownString {
    const md = new vscode.MarkdownString(undefined, true);
    md.isTrusted = true;
    md.appendMarkdown("### 🧠 CodeLens AI\n\n");
    md.appendMarkdown(explanation);
    md.appendMarkdown("\n\n---\n\n");
    const args = encodeURIComponent(JSON.stringify([code, context]));
    md.appendMarkdown(`[Learn More](command:codelens-ai.explainCode?${args})`);
    return md;
  }

  /**
   * Used by the explainCode command: shows explanation in a webview panel with progress.
   * If code/context are omitted, uses the active editor's selection.
   */
  async explainCode(code?: string, context?: string): Promise<void> {
    if (code === undefined || code === "") {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage(
          "No active editor. Select code or hover a line first.",
        );
        return;
      }
      const selection = editor.selection;
      const document = editor.document;
      code = document.getText(selection).trim();
      if (code.length === 0) {
        const line = document.lineAt(selection.active.line);
        code = line.text.trim();
        const { context: ctx } = this.contextExtractor.extract(
          document,
          selection.active,
        );
        context = ctx;
      } else {
        context = context ?? "";
      }
    }
    if (code.length === 0) {
      vscode.window.showWarningMessage(
        "No code to explain. Select something or hover a line.",
      );
      return;
    }

    const lang =
      vscode.window.activeTextEditor?.document.languageId ?? "plaintext";
    let explanation: string;
    try {
      explanation = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "CodeLens AI",
          cancellable: false,
        },
        async () => this.aiService.explain(code!, lang, context),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`CodeLens AI: ${message}`);
      return;
    }
    this.cacheService.set(code, explanation);
    this.showExplanationPanel(explanation);
  }

  private showExplanationPanel(explanation: string): void {
    const title = "CodeLens AI: Explanation";
    const panel = vscode.window.createWebviewPanel(
      "codelensAiExplain",
      title,
      vscode.ViewColumn.Beside,
      { enableScripts: false },
    );
    const escaped = escapeHtml(explanation);
    panel.webview.html = getExplanationHtml(escaped);
  }

  dispose(): void {
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
  <h2>🧠 CodeLens AI</h2>
  <div>${body}</div>
</body>
</html>`;
}

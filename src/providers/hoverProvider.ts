import * as vscode from "vscode";
import { AIService } from "../services/aiService";
import { CacheService } from "../services/cacheService";
import { ContextExtractor } from "../utils/contextExtractor";

const LOADING_MESSAGE = "⏳ Loading explanation…";

/**
 * Provides hover tooltips with AI-generated code explanations.
 * Checks cache first, shows loading state, then fetches async and caches for next hover.
 */
export class CodeLensHoverProvider implements vscode.HoverProvider {
  private readonly aiService = new AIService();
  private readonly cacheService = new CacheService();
  private readonly contextExtractor = new ContextExtractor();
  private isProcessing = false;

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

    const cached = this.cacheService.get(code);
    if (cached !== null) {
      const range = document.lineAt(position.line).range;
      return new vscode.Hover(
        this.createHoverContent(cached, code, context),
        range,
      );
    }

    const range = document.lineAt(position.line).range;
    void this.fetchExplanation(document, position, code, context);
    return new vscode.Hover(
      this.createHoverContent(LOADING_MESSAGE, code, context),
      range,
    );
  }

  /**
   * Fetches explanation from AI, caches it, and avoids overlapping requests.
   */
  private async fetchExplanation(
    document: vscode.TextDocument,
    position: vscode.Position,
    code: string,
    context: string,
  ): Promise<void> {
    this.isProcessing = true;
    try {
      const lang = document.languageId || "plaintext";
      const explanation = await this.aiService.explain(code, lang, context);
      this.cacheService.set(code, explanation);
    } catch (err) {
      console.error("[CodeLens AI] fetchExplanation failed", err);
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

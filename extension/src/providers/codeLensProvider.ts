import * as vscode from "vscode";
import { AIService } from "../services/aiService";
import { CacheService } from "../services/cacheService";
import { ContextExtractor } from "../utils/contextExtractor";

/**
 * Custom CodeLens that carries extra data for the explain command.
 * Stores the code snippet and context so we don't need to re-extract on click.
 */
class ExplainCodeLens extends vscode.CodeLens {
  constructor(
    range: vscode.Range,
    public readonly code: string,
    public readonly context: string,
    public readonly languageId: string
  ) {
    super(range);
  }
}

/**
 * Detects code constructs (functions, classes, etc.) and determines
 * where to place CodeLens annotations.
 */
interface CodeConstruct {
  type: "function" | "class" | "method" | "variable" | "block";
  name: string;
  range: vscode.Range;
  code: string;
  context: string;
}

/**
 * CodeLens provider that shows "Explain" links above significant code constructs.
 *
 * **Advantages over hover:**
 * - Exclusive control: CodeLens content is not merged with other providers
 * - Always visible: Shows inline hints without requiring hover
 * - Clickable: Clear call-to-action that triggers explanation
 * - Familiar pattern: Developers know CodeLens from "Run Test", "References" etc.
 *
 * **Trade-offs:**
 * - Requires a click (not instant like hover)
 * - Limited to code constructs (not arbitrary lines)
 * - Takes vertical space in the editor
 */
export class CodeLensExplainProvider
  implements vscode.CodeLensProvider, vscode.Disposable
{
  private readonly aiService = new AIService();
  private readonly cacheService = new CacheService();
  private readonly contextExtractor = new ContextExtractor();

  private readonly _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

  // Track pending explanations to show loading state
  private pendingExplanations = new Set<string>();

  // Patterns to detect code constructs worth explaining
  private readonly patterns = {
    // Function declarations and expressions
    function: /^\s*(export\s+)?(async\s+)?function\s+(\w+)/,
    arrowFunction:
      /^\s*(export\s+)?(const|let|var)\s+(\w+)\s*=\s*(async\s+)?\(/,
    arrowFunctionShort:
      /^\s*(export\s+)?(const|let|var)\s+(\w+)\s*=\s*(async\s+)?(\w+|\([^)]*\))\s*=>/,

    // Class and method declarations
    class: /^\s*(export\s+)?(abstract\s+)?class\s+(\w+)/,
    method:
      /^\s*(public|private|protected|static|async|\s)*(\w+)\s*\([^)]*\)\s*[:{]/,

    // React/JSX components
    component: /^\s*(export\s+)?(const|function)\s+([A-Z]\w+)/,

    // Variable declarations with complex values
    complexVariable:
      /^\s*(export\s+)?(const|let|var)\s+(\w+)\s*=\s*(new\s+\w+|\{|\[|function|class)/,

    // Python patterns
    pythonFunction: /^\s*(async\s+)?def\s+(\w+)/,
    pythonClass: /^\s*class\s+(\w+)/,

    // Go patterns
    goFunction: /^\s*func\s+(\([^)]+\)\s*)?(\w+)/,
    goStruct: /^\s*type\s+(\w+)\s+struct/,

    // Rust patterns
    rustFunction: /^\s*(pub\s+)?(async\s+)?fn\s+(\w+)/,
    rustStruct: /^\s*(pub\s+)?struct\s+(\w+)/,
    rustImpl: /^\s*impl\s+(<[^>]+>\s+)?(\w+)/,
  };

  provideCodeLenses(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken
  ): vscode.CodeLens[] {
    const constructs = this.detectConstructs(document);
    return constructs.map(
      (c) =>
        new ExplainCodeLens(c.range, c.code, c.context, document.languageId)
    );
  }

  resolveCodeLens(
    codeLens: vscode.CodeLens,
    _token: vscode.CancellationToken
  ): vscode.CodeLens {
    if (!(codeLens instanceof ExplainCodeLens)) {
      return codeLens;
    }

    const key = this.getKey(codeLens.code);
    const cached = this.cacheService.get(codeLens.code);
    const isPending = this.pendingExplanations.has(key);

    if (isPending) {
      codeLens.command = {
        title: "$(loading~spin) Explaining...",
        command: "",
      };
    } else if (cached) {
      // Show a preview of the cached explanation (truncated)
      const preview =
        cached.length > 50 ? `${cached.substring(0, 47)}...` : cached;
      codeLens.command = {
        title: `$(lightbulb) ${preview}`,
        command: "codelens-ai.showExplanation",
        arguments: [cached, codeLens.code],
      };
    } else {
      codeLens.command = {
        title: "$(comment-discussion) Explain this code",
        command: "codelens-ai.explainCodeLens",
        arguments: [codeLens.code, codeLens.context, codeLens.languageId],
      };
    }

    return codeLens;
  }

  /**
   * Called when user clicks "Explain this code" CodeLens.
   * Fetches explanation and updates the CodeLens to show the result.
   */
  async handleExplainClick(
    code: string,
    context: string,
    languageId: string
  ): Promise<void> {
    const key = this.getKey(code);

    // Show loading state
    this.pendingExplanations.add(key);
    this._onDidChangeCodeLenses.fire();

    try {
      const explanation = await this.aiService.explain(
        code,
        languageId,
        context
      );
      this.cacheService.set(code, explanation);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.cacheService.set(code, `Error: ${message}`);
    } finally {
      this.pendingExplanations.delete(key);
      this._onDidChangeCodeLenses.fire();
    }
  }

  /**
   * Shows a quick pick with the full explanation when user clicks a resolved CodeLens.
   */
  async showExplanation(explanation: string, code: string): Promise<void> {
    const codePreview = code.length > 60 ? `${code.substring(0, 57)}...` : code;

    await vscode.window
      .showInformationMessage(
        explanation,
        { modal: false, detail: `Code: ${codePreview}` },
        "Copy",
        "Open in Panel"
      )
      .then((selection) => {
        if (selection === "Copy") {
          vscode.env.clipboard.writeText(explanation);
          vscode.window.showInformationMessage(
            "Explanation copied to clipboard"
          );
        } else if (selection === "Open in Panel") {
          vscode.commands.executeCommand("codelens-ai.explainCode", code, "");
        }
      });
  }

  /**
   * Detects code constructs in the document that are worth explaining.
   * Uses regex patterns for different languages.
   */
  private detectConstructs(document: vscode.TextDocument): CodeConstruct[] {
    const constructs: CodeConstruct[] = [];
    const lineCount = document.lineCount;
    const languageId = document.languageId;

    for (let i = 0; i < lineCount; i++) {
      const line = document.lineAt(i);
      const text = line.text;

      // Skip empty lines and comments
      if (text.trim().length === 0) continue;
      if (this.isCommentLine(text, languageId)) continue;

      const construct = this.matchConstruct(text, i, document);
      if (construct) {
        constructs.push(construct);
      }
    }

    return constructs;
  }

  private matchConstruct(
    text: string,
    lineIndex: number,
    document: vscode.TextDocument
  ): CodeConstruct | null {
    const position = new vscode.Position(lineIndex, 0);
    const range = new vscode.Range(lineIndex, 0, lineIndex, text.length);

    // Try each pattern
    for (const [patternName, pattern] of Object.entries(this.patterns)) {
      const match = text.match(pattern);
      if (match) {
        const name = this.extractName(match, patternName);
        const type = this.getConstructType(patternName);

        // Get context and code block
        const { code, context } = this.contextExtractor.extract(
          document,
          position,
          10
        );
        const blockCode = this.contextExtractor.extractBlock(
          document,
          position
        );

        return {
          type,
          name,
          range,
          code: blockCode.length < 500 ? blockCode : code,
          context,
        };
      }
    }

    return null;
  }

  private extractName(match: RegExpMatchArray, patternName: string): string {
    // Different patterns have the name in different capture groups
    const groups = match.filter(
      (g) => g && !g.includes("export") && !g.includes("const")
    );
    return groups[groups.length - 1] || "unnamed";
  }

  private getConstructType(patternName: string): CodeConstruct["type"] {
    if (patternName.includes("class") || patternName.includes("struct")) {
      return "class";
    }
    if (patternName.includes("method")) {
      return "method";
    }
    if (patternName.includes("function") || patternName.includes("Function")) {
      return "function";
    }
    if (patternName.includes("Variable")) {
      return "variable";
    }
    return "block";
  }

  private isCommentLine(text: string, languageId: string): boolean {
    const trimmed = text.trim();

    // Common comment patterns
    if (trimmed.startsWith("//")) return true;
    if (trimmed.startsWith("/*")) return true;
    if (trimmed.startsWith("*")) return true;
    if (trimmed.startsWith("#") && languageId !== "csharp") return true;
    if (trimmed.startsWith("--") && languageId === "lua") return true;

    return false;
  }

  private getKey(code: string): string {
    let hash = 0;
    for (let i = 0; i < code.length; i++) {
      hash = (hash << 5) - hash + code.charCodeAt(i);
      hash = hash & hash;
    }
    return String(hash);
  }

  dispose(): void {
    this._onDidChangeCodeLenses.dispose();
  }
}

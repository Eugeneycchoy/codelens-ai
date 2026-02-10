import * as vscode from "vscode";
import { AIService } from "../services/aiService";
import { CacheService } from "../services/cacheService";
import { ContextExtractor } from "../utils/contextExtractor";

/**
 * URI scheme for explanation virtual documents.
 * Virtual documents live in memory, not on disk.
 */
const EXPLAIN_SCHEME = "codelens-explain";

/**
 * Stores explanation content keyed by a unique ID for virtual document retrieval.
 */
const explanationStore = new Map<string, ExplanationData>();

interface ExplanationData {
  explanation: string;
  code: string;
  languageId: string;
  timestamp: number;
}

/**
 * Provides content for virtual explanation documents.
 * When VS Code needs to display a `codelens-explain://` URI, this provider
 * returns the formatted explanation content.
 */
export class ExplanationDocumentProvider
  implements vscode.TextDocumentContentProvider
{
  private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;

  provideTextDocumentContent(uri: vscode.Uri): string {
    const id = uri.path;
    const data = explanationStore.get(id);

    if (!data) {
      return "// No explanation available. Try triggering the explain command again.";
    }

    return this.formatExplanation(data);
  }

  /**
   * Formats the explanation as a readable document with metadata.
   * Uses the target language for syntax highlighting in code blocks.
   */
  private formatExplanation(data: ExplanationData): string {
    const header = `// 🧠 Dumbify Explanation
// Generated: ${new Date(data.timestamp).toLocaleString()}
// ────────────────────────────────────────────────────────────

`;

    const explanation = `/*
 * ${data.explanation.split("\n").join("\n * ")}
 */

`;

    const codeSection = `// Original Code:
// ────────────────────────────────────────────────────────────
${data.code}
`;

    return header + explanation + codeSection;
  }

  /**
   * Notifies VS Code that a document's content has changed.
   */
  update(uri: vscode.Uri): void {
    this._onDidChange.fire(uri);
  }

  dispose(): void {
    this._onDidChange.dispose();
    explanationStore.clear();
  }
}

/**
 * Provides AI explanations via VS Code's peek view.
 *
 * Exposes peek via an explicit command rather than intercepting Go to Definition,
 * so default navigation remains untouched.
 *
 * When triggered via command, it:
 * 1. Gets or fetches the AI explanation
 * 2. Stores it in the explanation store
 * 3. Opens the virtual document in peek view
 *
 * **Advantages over hover:**
 * - Exclusive control: Peek view content is completely controlled by us
 * - Rich formatting: Can include code blocks, sections, metadata
 * - Persistent: User can keep the peek open while coding
 * - Familiar UX: Developers know peek from "Peek Definition" (Alt+F12)
 *
 * **Trade-offs:**
 * - Requires explicit command invocation (not automatic)
 * - Takes up editor space when open
 */
export class PeekExplanationProvider implements vscode.Disposable {
  private readonly aiService = new AIService();
  private readonly cacheService = new CacheService();
  private readonly contextExtractor = new ContextExtractor();
  private readonly documentProvider: ExplanationDocumentProvider;
  private disposables: vscode.Disposable[] = [];

  constructor() {
    this.documentProvider = new ExplanationDocumentProvider();

    // Register the virtual document provider
    const registration = vscode.workspace.registerTextDocumentContentProvider(
      EXPLAIN_SCHEME,
      this.documentProvider
    );
    this.disposables.push(registration);
  }

  /**
   * Shows AI explanation in a peek view for the current cursor position.
   * Call this via a command to avoid intercepting Go to Definition.
   */
  async showPeekExplanation(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage("No active editor");
      return;
    }

    const document = editor.document;
    const position = editor.selection.active;
    const lineText = document.lineAt(position.line).text;

    if (lineText.trim().length === 0) {
      vscode.window.showInformationMessage("Place cursor on a line with code");
      return;
    }

    // Extract code and context
    const { code, context } = this.contextExtractor.extract(document, position);
    if (code.length === 0) {
      vscode.window.showInformationMessage("No code found at cursor position");
      return;
    }

    // Check cache first
    let explanation = this.cacheService.get(code);

    if (!explanation) {
      // Show progress while fetching
      explanation = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Dumbify: Generating explanation...",
          cancellable: true,
        },
        async (_progress, token) => {
          return this.aiService.explain(
            code,
            document.languageId,
            context,
            token
          );
        }
      );

      if (!explanation) return;

      // Cache the result
      this.cacheService.set(code, explanation);
    }

    // Create unique ID for this explanation
    const id = this.generateId(code);

    // Store explanation data
    explanationStore.set(id, {
      explanation,
      code,
      languageId: document.languageId,
      timestamp: Date.now(),
    });

    // Create URI for virtual document
    const uri = vscode.Uri.parse(`${EXPLAIN_SCHEME}:${id}`);

    // Update the document content
    this.documentProvider.update(uri);

    // Open the virtual document in peek view using VS Code's peek command
    await vscode.commands.executeCommand(
      "editor.action.peekLocations",
      editor.document.uri,
      position,
      [new vscode.Location(uri, new vscode.Position(0, 0))],
      "peek"
    );
  }

  private generateId(code: string): string {
    let hash = 0;
    for (let i = 0; i < code.length; i++) {
      hash = (hash << 5) - hash + code.charCodeAt(i);
      hash = hash & hash;
    }
    return `explain-${Math.abs(hash)}-${Date.now()}`;
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this.documentProvider.dispose();
  }
}

/**
 * Alternative: Quick Peek using Quick Pick.
 * Shows explanation in a modal-style quick pick that's lightweight and fast.
 *
 * **Advantages:**
 * - Very fast to show/dismiss
 * - No screen real estate taken
 * - Keyboard-friendly
 *
 * **Trade-offs:**
 * - Less rich formatting than peek view
 * - Modal - blocks other interactions
 */
export class QuickPeekProvider implements vscode.Disposable {
  private readonly aiService = new AIService();
  private readonly cacheService = new CacheService();
  private readonly contextExtractor = new ContextExtractor();

  /**
   * Shows a quick peek explanation for the current cursor position.
   */
  async showQuickPeek(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage("No active editor");
      return;
    }

    const document = editor.document;
    const position = editor.selection.active;
    const lineText = document.lineAt(position.line).text;

    if (lineText.trim().length === 0) {
      vscode.window.showInformationMessage("Place cursor on a line with code");
      return;
    }

    const { code, context } = this.contextExtractor.extract(document, position);

    // Check cache
    let explanation = this.cacheService.get(code);

    if (!explanation) {
      // Show loading quick pick
      const loadingPick = vscode.window.createQuickPick();
      loadingPick.title = "🧠 Dumbify";
      loadingPick.placeholder = "Generating explanation...";
      loadingPick.busy = true;
      loadingPick.show();

      try {
        explanation = await this.aiService.explain(
          code,
          document.languageId,
          context
        );
        this.cacheService.set(code, explanation);
      } catch (err) {
        explanation = `Error: ${
          err instanceof Error ? err.message : String(err)
        }`;
      } finally {
        loadingPick.hide();
        loadingPick.dispose();
      }
    }

    // Show result in quick pick
    const items: vscode.QuickPickItem[] = [
      {
        label: "$(lightbulb) Explanation",
        description: explanation,
        detail: `Code: ${
          code.length > 50 ? code.substring(0, 47) + "..." : code
        }`,
      },
      {
        label: "$(clippy) Copy to Clipboard",
        description: "Copy the explanation text",
      },
      {
        label: "$(open-preview) Open in Panel",
        description: "View in side panel with full formatting",
      },
    ];

    const selection = await vscode.window.showQuickPick(items, {
      title: "🧠 Dumbify Quick Peek",
      placeHolder: explanation,
    });

    if (selection?.label.includes("Copy")) {
      await vscode.env.clipboard.writeText(explanation);
      vscode.window.showInformationMessage("Copied to clipboard");
    } else if (selection?.label.includes("Panel")) {
      vscode.commands.executeCommand("codelens-ai.explainCode", code, context);
    }
  }

  dispose(): void {
    // No resources to clean up
  }
}

/**
 * Inline Peek - Shows explanation directly in the editor as a "peek zone".
 * Uses the editor decorations API to create an inline annotation zone.
 *
 * This simulates the peek view UI by inserting an inline widget below the code.
 */
export class InlinePeekProvider implements vscode.Disposable {
  private readonly aiService = new AIService();
  private readonly cacheService = new CacheService();
  private readonly contextExtractor = new ContextExtractor();

  // Decoration types for the inline peek zone
  private peekZoneDecoration: vscode.TextEditorDecorationType | null = null;
  private currentEditor: vscode.TextEditor | null = null;
  private disposables: vscode.Disposable[] = [];

  constructor() {
    // Listen for cursor changes to dismiss peek
    this.disposables.push(
      vscode.window.onDidChangeTextEditorSelection((e) => {
        if (e.textEditor === this.currentEditor) {
          this.dismissPeek();
        }
      })
    );
  }

  /**
   * Shows an inline peek for the code at the current cursor position.
   */
  async showInlinePeek(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    this.dismissPeek();
    this.currentEditor = editor;

    const document = editor.document;
    const position = editor.selection.active;
    const lineText = document.lineAt(position.line).text;

    if (lineText.trim().length === 0) return;

    const { code, context } = this.contextExtractor.extract(document, position);

    // Check cache
    let explanation = this.cacheService.get(code);

    if (!explanation) {
      // Show loading state
      this.showPeekDecoration(
        editor,
        position.line,
        "⏳ Loading explanation..."
      );

      try {
        explanation = await this.aiService.explain(
          code,
          document.languageId,
          context
        );
        this.cacheService.set(code, explanation);
      } catch (err) {
        explanation = `Error: ${
          err instanceof Error ? err.message : String(err)
        }`;
      }
    }

    // Show the explanation
    this.showPeekDecoration(editor, position.line, explanation);
  }

  /**
   * Creates a decoration that appears below the target line,
   * simulating a peek view zone.
   */
  private showPeekDecoration(
    editor: vscode.TextEditor,
    line: number,
    content: string
  ): void {
    this.dismissPeek();

    // Create decoration type with "after" content to show below the line
    this.peekZoneDecoration = vscode.window.createTextEditorDecorationType({
      after: {
        contentText: ` 💡 ${content}`,
        color: new vscode.ThemeColor("editorCodeLens.foreground"),
        fontStyle: "italic",
        margin: "0 0 0 2em",
      },
      isWholeLine: true,
      backgroundColor: new vscode.ThemeColor("editor.hoverHighlightBackground"),
    });

    const range = new vscode.Range(line, 0, line, 0);
    editor.setDecorations(this.peekZoneDecoration, [range]);
  }

  dismissPeek(): void {
    if (this.peekZoneDecoration) {
      this.peekZoneDecoration.dispose();
      this.peekZoneDecoration = null;
    }
    this.currentEditor = null;
  }

  dispose(): void {
    this.dismissPeek();
    this.disposables.forEach((d) => d.dispose());
  }
}

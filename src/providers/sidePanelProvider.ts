import * as vscode from "vscode";
import { AIService } from "../services/aiService";
import { CacheService } from "../services/cacheService";
import { ContextExtractor } from "../utils/contextExtractor";

/**
 * Data structure for explanation history entries.
 */
interface HistoryEntry {
  id: string;
  code: string;
  explanation: string;
  languageId: string;
  fileName: string;
  lineNumber: number;
  timestamp: number;
}

/**
 * Enhanced Side Panel Provider using VS Code's Webview API.
 *
 * **Advantages over hover:**
 * - Complete UI control: Custom HTML/CSS/JS
 * - Persistent: Stays open while coding
 * - Rich formatting: Syntax highlighting, expandable sections, history
 * - No conflicts: Completely separate from hover system
 * - Interactive: Buttons, forms, navigation
 *
 * **Trade-offs:**
 * - Takes screen real estate
 * - Requires explicit action to open
 * - More complex implementation
 *
 * This is the recommended approach for detailed explanations.
 */
export class SidePanelProvider
  implements vscode.WebviewViewProvider, vscode.Disposable
{
  public static readonly viewType = "codelens-ai.explanationPanel";

  private readonly aiService = new AIService();
  private readonly cacheService = new CacheService();
  private readonly contextExtractor = new ContextExtractor();

  private view?: vscode.WebviewView;
  private history: HistoryEntry[] = [];
  private disposables: vscode.Disposable[] = [];

  // Track current explanation being displayed with full context for refresh
  private currentExplanation: {
    code: string;
    explanation: string;
    isLoading: boolean;
    languageId: string;
    context: string;
  } | null = null;

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.html = this.getHtml();

    // Handle messages from webview
    webviewView.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          case "copy":
            if (this.currentExplanation) {
              await vscode.env.clipboard.writeText(
                this.currentExplanation.explanation
              );
              vscode.window.showInformationMessage("Copied to clipboard");
            }
            break;
          case "refresh":
            await this.refreshExplanation();
            break;
          case "loadHistory":
            this.loadHistoryEntry(message.id);
            break;
          case "clearHistory":
            this.history = [];
            this.updateView();
            break;
          case "explainSelection":
            await this.explainCurrentSelection();
            break;
        }
      },
      null,
      this.disposables
    );

    // Initial render
    this.updateView();
  }

  /**
   * Explains the currently selected or cursor-adjacent code.
   */
  async explainCurrentSelection(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      this.showMessage("No active editor. Open a file first.");
      return;
    }

    const document = editor.document;
    const selection = editor.selection;

    let code: string;
    let context: string;
    let lineNumber: number;

    if (!selection.isEmpty) {
      // Use selected text
      code = document.getText(selection).trim();
      context = "";
      lineNumber = selection.start.line + 1;
    } else {
      // Use cursor line
      const position = selection.active;
      const extracted = this.contextExtractor.extract(document, position);
      code = extracted.code;
      context = extracted.context;
      lineNumber = position.line + 1;
    }

    if (code.length === 0) {
      this.showMessage("Select some code or place cursor on a non-empty line.");
      return;
    }

    await this.explainCode(
      code,
      context,
      document.languageId,
      document.fileName,
      lineNumber
    );
  }

  /**
   * Main method to explain code and display in the panel.
   */
  async explainCode(
    code: string,
    context: string,
    languageId: string,
    fileName: string,
    lineNumber: number
  ): Promise<void> {
    // Reveal the panel if it exists
    if (this.view) {
      this.view.show(true);
    }

    // Set loading state with full context for potential refresh
    this.currentExplanation = {
      code,
      explanation: "",
      isLoading: true,
      languageId,
      context,
    };
    this.updateView();

    // Check cache first
    let explanation = this.cacheService.get(code);

    if (!explanation) {
      try {
        explanation = await this.aiService.explain(code, languageId, context);
        this.cacheService.set(code, explanation);
      } catch (err) {
        explanation = `Error: ${
          err instanceof Error ? err.message : String(err)
        }`;
      }
    }

    // Update state preserving languageId and context for refresh
    this.currentExplanation = {
      code,
      explanation,
      isLoading: false,
      languageId,
      context,
    };

    // Add to history
    const historyEntry: HistoryEntry = {
      id: this.generateId(),
      code,
      explanation,
      languageId,
      fileName: fileName.split("/").pop() || fileName,
      lineNumber,
      timestamp: Date.now(),
    };
    this.history.unshift(historyEntry);

    // Keep history limited to 20 entries
    if (this.history.length > 20) {
      this.history = this.history.slice(0, 20);
    }

    this.updateView();
  }

  /**
   * Refreshes the current explanation by fetching again from AI.
   * Uses stored languageId and context for accurate re-fetch.
   */
  private async refreshExplanation(): Promise<void> {
    if (!this.currentExplanation) return;

    const { code, languageId, context } = this.currentExplanation;

    // Delete only the current entry from cache instead of clearing all
    this.cacheService.delete(code);

    this.currentExplanation.isLoading = true;
    this.updateView();

    try {
      const explanation = await this.aiService.explain(
        code,
        languageId,
        context
      );
      this.cacheService.set(code, explanation);
      this.currentExplanation.explanation = explanation;
    } catch (err) {
      this.currentExplanation.explanation = `Error: ${
        err instanceof Error ? err.message : String(err)
      }`;
    }

    this.currentExplanation.isLoading = false;
    this.updateView();
  }

  /**
   * Loads a history entry as the current explanation.
   */
  private loadHistoryEntry(id: string): void {
    const entry = this.history.find((h) => h.id === id);
    if (entry) {
      this.currentExplanation = {
        code: entry.code,
        explanation: entry.explanation,
        isLoading: false,
        languageId: entry.languageId,
        context: "", // History doesn't store context, but languageId is preserved
      };
      this.updateView();
    }
  }

  /**
   * Shows a message in the panel.
   */
  private showMessage(message: string): void {
    this.currentExplanation = {
      code: "",
      explanation: message,
      isLoading: false,
      languageId: "plaintext",
      context: "",
    };
    this.updateView();
  }

  /**
   * Updates the webview content.
   */
  private updateView(): void {
    if (this.view) {
      this.view.webview.postMessage({
        type: "update",
        explanation: this.currentExplanation,
        history: this.history.slice(0, 10),
      });
    }
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Returns the HTML for the webview panel.
   * Includes modern styling and interactive features.
   */
  private getHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
  <title>CodeLens AI</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
      padding: 12px;
      line-height: 1.5;
    }
    
    .header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 16px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    
    .header h1 {
      font-size: 14px;
      font-weight: 600;
      flex: 1;
    }
    
    .btn {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border: none;
      padding: 4px 8px;
      border-radius: 3px;
      cursor: pointer;
      font-size: 12px;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    
    .btn:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }
    
    .btn-primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    
    .btn-primary:hover {
      background: var(--vscode-button-hoverBackground);
    }
    
    .section {
      margin-bottom: 16px;
    }
    
    .section-title {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 8px;
    }
    
    .explanation-card {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      padding: 12px;
      margin-bottom: 12px;
    }
    
    .explanation-text {
      font-size: 13px;
      line-height: 1.6;
      white-space: pre-wrap;
      word-wrap: break-word;
    }
    
    .code-preview {
      background: var(--vscode-textBlockQuote-background);
      border-left: 3px solid var(--vscode-textLink-foreground);
      padding: 8px 12px;
      margin-top: 12px;
      font-family: var(--vscode-editor-font-family);
      font-size: 12px;
      overflow-x: auto;
      white-space: pre;
      max-height: 150px;
      overflow-y: auto;
    }
    
    .actions {
      display: flex;
      gap: 8px;
      margin-top: 12px;
    }
    
    .loading {
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--vscode-descriptionForeground);
    }
    
    .spinner {
      width: 16px;
      height: 16px;
      border: 2px solid var(--vscode-progressBar-background);
      border-top: 2px solid var(--vscode-textLink-foreground);
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }
    
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    
    .empty-state {
      text-align: center;
      padding: 24px;
      color: var(--vscode-descriptionForeground);
    }
    
    .empty-state-icon {
      font-size: 32px;
      margin-bottom: 12px;
    }
    
    .history-list {
      list-style: none;
    }
    
    .history-item {
      padding: 8px;
      border-radius: 4px;
      cursor: pointer;
      margin-bottom: 4px;
      border: 1px solid transparent;
    }
    
    .history-item:hover {
      background: var(--vscode-list-hoverBackground);
      border-color: var(--vscode-panel-border);
    }
    
    .history-item-code {
      font-family: var(--vscode-editor-font-family);
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    
    .history-item-meta {
      font-size: 10px;
      color: var(--vscode-descriptionForeground);
      margin-top: 2px;
    }
    
    .collapsible {
      cursor: pointer;
      user-select: none;
    }
    
    .collapsible::before {
      content: "▶";
      display: inline-block;
      margin-right: 6px;
      font-size: 10px;
      transition: transform 0.2s;
    }
    
    .collapsible.open::before {
      transform: rotate(90deg);
    }
    
    .collapsible-content {
      display: none;
      margin-top: 8px;
    }
    
    .collapsible.open + .collapsible-content {
      display: block;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>🧠 CodeLens AI</h1>
    <button class="btn btn-primary" onclick="explainSelection()">Explain Selection</button>
  </div>
  
  <div id="content">
    <div class="empty-state">
      <div class="empty-state-icon">💡</div>
      <p>Select code and click "Explain Selection"<br>or use the keyboard shortcut.</p>
    </div>
  </div>
  
  <div class="section" id="history-section" style="display: none;">
    <h3 class="section-title collapsible" onclick="toggleHistory()">Recent Explanations</h3>
    <div class="collapsible-content" id="history-content">
      <ul class="history-list" id="history-list"></ul>
      <button class="btn" onclick="clearHistory()" style="margin-top: 8px;">Clear History</button>
    </div>
  </div>
  
  <script>
    const vscode = acquireVsCodeApi();
    
    function explainSelection() {
      vscode.postMessage({ command: 'explainSelection' });
    }
    
    function copyExplanation() {
      vscode.postMessage({ command: 'copy' });
    }
    
    function refreshExplanation() {
      vscode.postMessage({ command: 'refresh' });
    }
    
    function loadHistory(id) {
      vscode.postMessage({ command: 'loadHistory', id });
    }
    
    function clearHistory() {
      vscode.postMessage({ command: 'clearHistory' });
    }
    
    function toggleHistory() {
      const el = document.querySelector('#history-section .section-title');
      el.classList.toggle('open');
    }
    
    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }
    
    function formatTime(timestamp) {
      const date = new Date(timestamp);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    
    window.addEventListener('message', event => {
      const message = event.data;
      
      if (message.type === 'update') {
        const { explanation, history } = message;
        const content = document.getElementById('content');
        const historySection = document.getElementById('history-section');
        const historyList = document.getElementById('history-list');
        
        if (explanation && (explanation.explanation || explanation.isLoading)) {
          if (explanation.isLoading) {
            content.innerHTML = \`
              <div class="explanation-card">
                <div class="loading">
                  <div class="spinner"></div>
                  <span>Generating explanation...</span>
                </div>
              </div>
            \`;
          } else {
            const codePreview = explanation.code 
              ? \`<div class="code-preview">\${escapeHtml(explanation.code)}</div>\`
              : '';
            
            content.innerHTML = \`
              <div class="explanation-card">
                <div class="explanation-text">\${escapeHtml(explanation.explanation)}</div>
                \${codePreview}
                <div class="actions">
                  <button class="btn" onclick="copyExplanation()">📋 Copy</button>
                  <button class="btn" onclick="refreshExplanation()">🔄 Refresh</button>
                </div>
              </div>
            \`;
          }
        }
        
        if (history && history.length > 0) {
          historySection.style.display = 'block';
          historyList.innerHTML = history.map(entry => \`
            <li class="history-item" onclick="loadHistory('\${entry.id}')">
              <div class="history-item-code">\${escapeHtml(entry.code.substring(0, 60))}</div>
              <div class="history-item-meta">\${entry.fileName}:\${entry.lineNumber} • \${formatTime(entry.timestamp)}</div>
            </li>
          \`).join('');
        } else {
          historySection.style.display = 'none';
        }
      }
    });
  </script>
</body>
</html>`;
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }
}

/**
 * Alternative: Floating Webview Panel.
 * Creates a webview panel that appears beside the editor (like "Learn More" does now).
 * Use this when you want a standalone panel rather than a sidebar view.
 */
export class FloatingPanelProvider implements vscode.Disposable {
  private readonly aiService = new AIService();
  private readonly cacheService = new CacheService();
  private readonly contextExtractor = new ContextExtractor();

  private panel: vscode.WebviewPanel | null = null;
  private disposables: vscode.Disposable[] = [];

  constructor(private readonly extensionUri: vscode.Uri) {}

  /**
   * Shows explanation in a floating webview panel beside the editor.
   */
  async showExplanation(code?: string, context?: string): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor && !code) {
      vscode.window.showWarningMessage("No code to explain");
      return;
    }

    // Get code if not provided
    if (!code) {
      const document = editor!.document;
      const selection = editor!.selection;

      if (!selection.isEmpty) {
        code = document.getText(selection).trim();
        context = "";
      } else {
        const extracted = this.contextExtractor.extract(
          document,
          selection.active
        );
        code = extracted.code;
        context = extracted.context;
      }
    }

    if (!code || code.length === 0) {
      vscode.window.showWarningMessage("No code selected");
      return;
    }

    // Create or reveal panel
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
    } else {
      this.panel = vscode.window.createWebviewPanel(
        "codelens-ai.floatingPanel",
        "🧠 CodeLens AI",
        vscode.ViewColumn.Beside,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
        }
      );

      this.panel.onDidDispose(
        () => {
          this.panel = null;
        },
        null,
        this.disposables
      );

      this.panel.webview.onDidReceiveMessage(
        async (message) => {
          if (message.command === "copy" && message.text) {
            await vscode.env.clipboard.writeText(message.text);
            vscode.window.showInformationMessage("Copied to clipboard");
          }
        },
        null,
        this.disposables
      );
    }

    // Show loading state
    this.panel.webview.html = this.getLoadingHtml(code);

    // Get explanation
    const languageId = editor?.document.languageId ?? "plaintext";
    let explanation = this.cacheService.get(code);

    if (!explanation) {
      try {
        explanation = await this.aiService.explain(
          code,
          languageId,
          context ?? ""
        );
        this.cacheService.set(code, explanation);
      } catch (err) {
        explanation = `Error: ${
          err instanceof Error ? err.message : String(err)
        }`;
      }
    }

    // Update with result
    this.panel.webview.html = this.getResultHtml(code, explanation, languageId);
  }

  private getLoadingHtml(code: string): string {
    return `<!DOCTYPE html>
<html>
<head>
  <style>
    body {
      font-family: var(--vscode-font-family);
      padding: 20px;
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
    }
    .loading {
      display: flex;
      align-items: center;
      gap: 12px;
      margin: 20px 0;
    }
    .spinner {
      width: 20px;
      height: 20px;
      border: 2px solid var(--vscode-progressBar-background);
      border-top: 2px solid var(--vscode-textLink-foreground);
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    .code-preview {
      background: var(--vscode-textBlockQuote-background);
      padding: 12px;
      border-radius: 4px;
      font-family: var(--vscode-editor-font-family);
      font-size: 12px;
      overflow-x: auto;
      white-space: pre;
    }
  </style>
</head>
<body>
  <h2>🧠 CodeLens AI</h2>
  <div class="loading">
    <div class="spinner"></div>
    <span>Generating explanation...</span>
  </div>
  <h3>Code</h3>
  <pre class="code-preview">${this.escapeHtml(code)}</pre>
</body>
</html>`;
  }

  private getResultHtml(
    code: string,
    explanation: string,
    languageId: string
  ): string {
    // JSON.stringify safely encodes the raw string for JS without HTML escaping
    const rawExplanationJson = JSON.stringify(explanation);

    return `<!DOCTYPE html>
<html>
<head>
  <style>
    body {
      font-family: var(--vscode-font-family);
      padding: 20px;
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      line-height: 1.6;
    }
    h2 {
      margin-top: 0;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .explanation {
      background: var(--vscode-textBlockQuote-background);
      border-left: 3px solid var(--vscode-textLink-foreground);
      padding: 16px;
      margin: 16px 0;
      border-radius: 0 4px 4px 0;
    }
    .code-preview {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      padding: 12px;
      border-radius: 4px;
      font-family: var(--vscode-editor-font-family);
      font-size: 12px;
      overflow-x: auto;
      white-space: pre;
      max-height: 200px;
      overflow-y: auto;
    }
    .btn {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 8px 16px;
      border-radius: 4px;
      cursor: pointer;
      margin-right: 8px;
    }
    .btn:hover {
      background: var(--vscode-button-hoverBackground);
    }
    .meta {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      margin-top: 16px;
    }
  </style>
</head>
<body>
  <h2>🧠 CodeLens AI</h2>
  
  <div class="explanation">${this.escapeHtml(explanation)}</div>
  
  <button class="btn" onclick="copyExplanation()">📋 Copy Explanation</button>
  
  <h3>Code</h3>
  <pre class="code-preview">${this.escapeHtml(code)}</pre>
  
  <p class="meta">Language: ${languageId}</p>
  
  <script>
    const vscode = acquireVsCodeApi();
    // Store raw explanation in JS variable to avoid HTML-escaping issues when copying
    const rawExplanation = ${rawExplanationJson};
    
    function copyExplanation() {
      vscode.postMessage({ command: 'copy', text: rawExplanation });
    }
  </script>
</body>
</html>`;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  dispose(): void {
    this.panel?.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}

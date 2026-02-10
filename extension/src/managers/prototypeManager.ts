import * as vscode from "vscode";
import { CodeLensExplainProvider } from "../providers/codeLensProvider";
import {
  PeekExplanationProvider,
  QuickPeekProvider,
  InlinePeekProvider,
} from "../providers/peekViewProvider";
import {
  SidePanelProvider,
  FloatingPanelProvider,
} from "../providers/sidePanelProvider";

/**
 * Available UI modes for displaying AI explanations.
 * Each mode provides a different UX trade-off.
 */
export type UIMode =
  | "hover" // Original hover provider (merged with other hovers)
  | "codelens" // Inline clickable annotations above code
  | "peek" // Peek definition-style overlay
  | "quickpeek" // Quick pick modal for fast explanations
  | "inlinepeek" // Inline decoration below code
  | "sidepanel" // Persistent sidebar webview
  | "floatingpanel" // Floating webview beside editor
  | "hybrid"; // Combination of multiple approaches

/**
 * Configuration for the prototype manager.
 */
interface PrototypeConfig {
  activeMode: UIMode;
  enableCodeLens: boolean;
  enableHover: boolean;
  enableSidePanel: boolean;
}

/**
 * Manages UI prototypes and allows switching between different display modes.
 *
 * This manager coordinates all the alternative UI approaches:
 * - CodeLens Provider: Clickable inline annotations
 * - Peek View Provider: Definition-style peek overlay
 * - Side Panel Provider: Persistent webview sidebar
 * - Floating Panel: Webview panel beside editor
 *
 * Users can switch between modes via commands or configuration.
 */
export class PrototypeManager implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];

  // Provider instances
  private codeLensProvider: CodeLensExplainProvider | null = null;
  private peekProvider: PeekExplanationProvider | null = null;
  private quickPeekProvider: QuickPeekProvider | null = null;
  private inlinePeekProvider: InlinePeekProvider | null = null;
  private sidePanelProvider: SidePanelProvider | null = null;
  private floatingPanelProvider: FloatingPanelProvider | null = null;

  // Registration disposables (for toggling providers)
  private codeLensRegistration: vscode.Disposable | null = null;

  // Current active mode
  private currentMode: UIMode = "hover";

  // Status bar item for showing current mode
  private statusBarItem: vscode.StatusBarItem;

  constructor(private readonly context: vscode.ExtensionContext) {
    // Enable Side Panel visibility by setting the context key
    // This makes the "when": "codelensAI.prototype.sidePanelEnabled" condition true
    void vscode.commands.executeCommand(
      "setContext",
      "codelensAI.prototype.sidePanelEnabled",
      true
    );

    // Create status bar item
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      99
    );
    this.statusBarItem.command = "codelens-ai.prototype.selectMode";
    this.disposables.push(this.statusBarItem);

    // Initialize providers
    this.initializeProviders();

    // Register commands
    this.registerCommands();

    // Load initial mode from configuration
    this.loadConfiguration();

    // Listen for configuration changes
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("codelensAI.prototype")) {
          this.loadConfiguration();
        }
      })
    );
  }

  /**
   * Initializes all provider instances.
   */
  private initializeProviders(): void {
    this.codeLensProvider = new CodeLensExplainProvider();
    this.peekProvider = new PeekExplanationProvider();
    this.quickPeekProvider = new QuickPeekProvider();
    this.inlinePeekProvider = new InlinePeekProvider();
    this.sidePanelProvider = new SidePanelProvider(this.context.extensionUri);
    this.floatingPanelProvider = new FloatingPanelProvider(
      this.context.extensionUri
    );

    // Register side panel view (always available)
    const sidePanelRegistration = vscode.window.registerWebviewViewProvider(
      SidePanelProvider.viewType,
      this.sidePanelProvider
    );
    this.disposables.push(sidePanelRegistration);

    // Track disposables
    this.disposables.push(
      this.codeLensProvider,
      this.peekProvider,
      this.quickPeekProvider,
      this.inlinePeekProvider,
      this.sidePanelProvider,
      this.floatingPanelProvider
    );
  }

  /**
   * Registers all commands for the prototype manager.
   */
  private registerCommands(): void {
    const commands = [
      // Mode selection
      vscode.commands.registerCommand("codelens-ai.prototype.selectMode", () =>
        this.showModeSelector()
      ),
      vscode.commands.registerCommand(
        "codelens-ai.prototype.setMode",
        (mode: UIMode) => this.setMode(mode)
      ),

      // CodeLens commands
      vscode.commands.registerCommand(
        "codelens-ai.explainCodeLens",
        (code: string, context: string, languageId: string) =>
          this.codeLensProvider?.handleExplainClick(code, context, languageId)
      ),
      vscode.commands.registerCommand(
        "codelens-ai.showExplanation",
        (explanation: string, code: string) =>
          this.codeLensProvider?.showExplanation(explanation, code)
      ),

      // Peek explanation command (opens in VS Code peek view)
      vscode.commands.registerCommand("codelens-ai.peekExplanation", () =>
        this.peekProvider?.showPeekExplanation()
      ),

      // Quick peek command
      vscode.commands.registerCommand("codelens-ai.quickPeek", () =>
        this.quickPeekProvider?.showQuickPeek()
      ),

      // Inline peek command
      vscode.commands.registerCommand("codelens-ai.inlinePeek", () =>
        this.inlinePeekProvider?.showInlinePeek()
      ),

      // Side panel command
      vscode.commands.registerCommand("codelens-ai.explainInPanel", () =>
        this.sidePanelProvider?.explainCurrentSelection()
      ),

      // Floating panel command
      vscode.commands.registerCommand(
        "codelens-ai.explainFloating",
        (code?: string, context?: string) =>
          this.floatingPanelProvider?.showExplanation(code, context)
      ),

      // Toggle commands
      vscode.commands.registerCommand(
        "codelens-ai.prototype.toggleCodeLens",
        () => this.toggleCodeLens()
      ),
    ];

    this.disposables.push(...commands);
  }

  /**
   * Loads configuration and applies the active mode.
   * Only reads config - does not write back to avoid recursive change events.
   */
  private loadConfiguration(): void {
    const config = vscode.workspace.getConfiguration("codelensAI.prototype");
    const mode = config.get<UIMode>("mode", "hover");
    // Apply mode without persisting - loadConfiguration is for reading only
    this.applyMode(mode);
  }

  /**
   * Shows a quick pick to select the UI mode.
   */
  async showModeSelector(): Promise<void> {
    const items: (vscode.QuickPickItem & { mode: UIMode })[] = [
      {
        label: "$(comment-discussion) Hover",
        description: "Original hover tooltips (merged with VS Code)",
        detail:
          "Shows explanations in native VS Code hover. May conflict with other hovers.",
        mode: "hover",
        picked: this.currentMode === "hover",
      },
      {
        label: "$(symbol-method) CodeLens",
        description: "Inline clickable annotations",
        detail:
          "Shows 'Explain' links above functions/classes. Click to see explanation.",
        mode: "codelens",
        picked: this.currentMode === "codelens",
      },
      {
        label: "$(eye) Peek View",
        description: "Peek definition-style overlay",
        detail:
          "Opens explanation in VS Code's peek view. Use Go to Definition shortcut.",
        mode: "peek",
        picked: this.currentMode === "peek",
      },
      {
        label: "$(zap) Quick Peek",
        description: "Fast modal explanation",
        detail:
          "Shows explanation in a quick pick modal. Fast and keyboard-friendly.",
        mode: "quickpeek",
        picked: this.currentMode === "quickpeek",
      },
      {
        label: "$(lightbulb) Inline Peek",
        description: "Inline decoration below code",
        detail: "Shows explanation as inline text below the hovered line.",
        mode: "inlinepeek",
        picked: this.currentMode === "inlinepeek",
      },
      {
        label: "$(layout-sidebar-right) Side Panel",
        description: "Persistent sidebar webview",
        detail:
          "Rich UI in the sidebar with history. Best for detailed exploration.",
        mode: "sidepanel",
        picked: this.currentMode === "sidepanel",
      },
      {
        label: "$(window) Floating Panel",
        description: "Webview panel beside editor",
        detail: "Opens explanation in a panel next to your code.",
        mode: "floatingpanel",
        picked: this.currentMode === "floatingpanel",
      },
      {
        label: "$(layers) Hybrid",
        description: "CodeLens + Side Panel",
        detail:
          "Combines CodeLens annotations with the side panel for detailed views.",
        mode: "hybrid",
        picked: this.currentMode === "hybrid",
      },
    ];

    const selection = await vscode.window.showQuickPick(items, {
      title: "🧠 Dumbify - Select UI Mode",
      placeHolder: `Current mode: ${this.currentMode}`,
    });

    if (selection) {
      await this.setMode(selection.mode);
      vscode.window.showInformationMessage(
        `Dumbify mode set to: ${selection.label.replace(/\$\([^)]+\)\s*/, "")}`
      );
    }
  }

  /**
   * Sets the active UI mode and persists to configuration.
   * Call this for user-initiated mode changes only.
   */
  async setMode(mode: UIMode): Promise<void> {
    // Guard: skip config update if mode hasn't changed
    const config = vscode.workspace.getConfiguration("codelensAI.prototype");
    const storedMode = config.get<UIMode>("mode");

    // Apply the mode (UI changes)
    this.applyMode(mode);

    // Only persist if mode actually changed
    if (storedMode !== mode) {
      // Use Global target to avoid workspace config churn
      await config.update("mode", mode, vscode.ConfigurationTarget.Global);
    }
  }

  /**
   * Applies the UI mode without persisting to configuration.
   * Used internally for both loading config and user-initiated changes.
   */
  private applyMode(mode: UIMode): void {
    // Clean up current registrations
    this.cleanupRegistrations();

    this.currentMode = mode;

    switch (mode) {
      case "hover":
        // Original hover mode - no additional providers
        this.updateStatusBar("$(comment-discussion)", "Hover Mode");
        break;

      case "codelens":
        this.enableCodeLensMode();
        this.updateStatusBar("$(symbol-method)", "CodeLens Mode");
        break;

      case "peek":
        this.enablePeekMode();
        this.updateStatusBar("$(eye)", "Peek Mode");
        break;

      case "quickpeek":
        this.updateStatusBar("$(zap)", "Quick Peek Mode");
        // Quick peek is command-based, no provider registration needed
        break;

      case "inlinepeek":
        this.updateStatusBar("$(lightbulb)", "Inline Peek Mode");
        // Inline peek is command-based
        break;

      case "sidepanel":
        this.updateStatusBar("$(layout-sidebar-right)", "Side Panel Mode");
        // Side panel is always registered, just focus it
        vscode.commands.executeCommand("codelens-ai.explanationPanel.focus");
        break;

      case "floatingpanel":
        this.updateStatusBar("$(window)", "Floating Panel Mode");
        // Floating panel is command-based
        break;

      case "hybrid":
        this.enableCodeLensMode();
        this.updateStatusBar("$(layers)", "Hybrid Mode");
        break;
    }
  }

  /**
   * Enables CodeLens mode by registering the CodeLens provider.
   */
  private enableCodeLensMode(): void {
    if (!this.codeLensProvider) return;

    this.codeLensRegistration = vscode.languages.registerCodeLensProvider(
      [{ scheme: "file" }, { scheme: "untitled" }],
      this.codeLensProvider
    );
  }

  /**
   * Enables Peek mode.
   * Peek is now command-based (codelens-ai.peekExplanation) to avoid
   * intercepting Go to Definition. No provider registration needed.
   */
  private enablePeekMode(): void {
    // Peek mode is command-based - no definition provider registration
    // Users invoke via the codelens-ai.peekExplanation command
  }

  /**
   * Toggles CodeLens on/off regardless of current mode.
   */
  private toggleCodeLens(): void {
    if (this.codeLensRegistration) {
      this.codeLensRegistration.dispose();
      this.codeLensRegistration = null;
      vscode.window.showInformationMessage("Dumbify explanations disabled");
    } else {
      this.enableCodeLensMode();
      vscode.window.showInformationMessage("Dumbify explanations enabled");
    }
  }

  /**
   * Cleans up all provider registrations.
   */
  private cleanupRegistrations(): void {
    this.codeLensRegistration?.dispose();
    this.codeLensRegistration = null;
  }

  /**
   * Updates the status bar item.
   */
  private updateStatusBar(icon: string, tooltip: string): void {
    this.statusBarItem.text = `${icon} AI Mode`;
    this.statusBarItem.tooltip = `Dumbify: ${tooltip}\nClick to change mode`;
    this.statusBarItem.show();
  }

  /**
   * Gets the current active mode.
   */
  getMode(): UIMode {
    return this.currentMode;
  }

  /**
   * Triggers explanation based on current mode.
   */
  async explain(): Promise<void> {
    switch (this.currentMode) {
      case "quickpeek":
        await this.quickPeekProvider?.showQuickPeek();
        break;
      case "inlinepeek":
        await this.inlinePeekProvider?.showInlinePeek();
        break;
      case "sidepanel":
        await this.sidePanelProvider?.explainCurrentSelection();
        break;
      case "floatingpanel":
        await this.floatingPanelProvider?.showExplanation();
        break;
      case "hybrid":
        // In hybrid mode, use the side panel for detailed explanations
        await this.sidePanelProvider?.explainCurrentSelection();
        break;
      default:
        // For hover, codelens, and peek modes, the explanation happens
        // automatically through the registered providers
        vscode.window.showInformationMessage(
          `In ${this.currentMode} mode, hover over code or use the CodeLens links.`
        );
    }
  }

  dispose(): void {
    this.cleanupRegistrations();
    this.disposables.forEach((d) => d.dispose());
  }
}

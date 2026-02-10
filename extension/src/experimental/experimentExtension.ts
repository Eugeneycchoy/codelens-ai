import * as vscode from "vscode";
import {
  getExperimentalProviders,
  ExperimentMode,
} from "./experimentalHoverProviders";

// Re-export for use in extension.ts
export { ExperimentMode };

/**
 * Experimental extension entry point for testing hover provider behavior.
 *
 * This module provides commands to switch between different experiment modes
 * and observe how VS Code handles various hover provider implementations.
 */

const HOVER_SELECTOR: vscode.DocumentSelector = [
  { scheme: "file" },
  { scheme: "untitled" },
];

let experimentDisposables: vscode.Disposable[] = [];
let currentMode: ExperimentMode | null = null;
let statusBarItem: vscode.StatusBarItem | null = null;

/**
 * Clears all currently registered experimental hover providers.
 */
export function clearExperiments(): void {
  experimentDisposables.forEach((d) => d.dispose());
  experimentDisposables = [];
  currentMode = null;
  updateStatusBar();
  console.log("[Experiment] All experimental providers cleared");
}

/**
 * Registers hover providers for a specific experiment mode.
 */
export function runExperiment(mode: ExperimentMode): void {
  clearExperiments();

  const providers = getExperimentalProviders(mode);

  providers.forEach((provider, index) => {
    const disposable = vscode.languages.registerHoverProvider(
      HOVER_SELECTOR,
      provider
    );
    experimentDisposables.push(disposable);
    console.log(
      `[Experiment] Registered provider ${index + 1} for mode: ${mode}`
    );
  });

  currentMode = mode;
  updateStatusBar();

  vscode.window.showInformationMessage(
    `🧪 Experiment "${mode}" active with ${providers.length} provider(s). Check console for logs.`
  );
}

/**
 * Updates the status bar to show current experiment mode.
 */
function updateStatusBar(): void {
  if (!statusBarItem) return;

  if (currentMode) {
    statusBarItem.text = `$(beaker) Exp: ${currentMode}`;
    statusBarItem.tooltip = `Hover Experiment Mode: ${currentMode}\nClick to change or stop`;
    statusBarItem.backgroundColor = new vscode.ThemeColor(
      "statusBarItem.warningBackground"
    );
  } else {
    statusBarItem.text = "$(beaker) No Experiment";
    statusBarItem.tooltip = "No hover experiment running. Click to start one.";
    statusBarItem.backgroundColor = undefined;
  }
}

/**
 * Shows a quick pick menu to select experiment mode.
 */
export async function showExperimentMenu(): Promise<void> {
  const items: vscode.QuickPickItem[] = [
    {
      label: "$(circle-slash) Stop Experiment",
      description: "Clear all experimental providers",
      detail:
        "Removes all experimental hover providers, allowing only VS Code defaults",
    },
    { kind: vscode.QuickPickItemKind.Separator, label: "Experiments" },
    {
      label: "1. Null Returning",
      description: "Test: Does returning null allow VS Code defaults?",
      detail: "Always returns null from provideHover()",
    },
    {
      label: "2. Always Return Hover",
      description: "Test: Does returning Hover suppress defaults?",
      detail: "Always returns a Hover object for non-empty lines",
    },
    {
      label: "3. Conditional Hover",
      description: "Test: Selective hover on patterns",
      detail: "Returns Hover for function/const/class/export, null otherwise",
    },
    {
      label: "4. Multi-Provider",
      description: "Test: Are multiple hover providers additive?",
      detail: "Registers 3 providers to see if hovers combine",
    },
    {
      label: "5a. Registration Order (High First)",
      description: "Test: High → First → Second",
      detail: "High priority provider registered first",
    },
    {
      label: "5b. Registration Order (High Last)",
      description: "Test: First → Second → High",
      detail: "High priority provider registered last",
    },
    {
      label: "5c. Registration Order (Mixed)",
      description: "Test: First → High → Second",
      detail: "High priority provider in the middle",
    },
    {
      label: "6. Async Provider",
      description: "Test: How does VS Code handle async providers?",
      detail: "Includes a 500ms delay provider in the chain",
    },
    {
      label: "7. Undefined Return",
      description: "Test: undefined vs null behavior",
      detail: "Returns undefined instead of null",
    },
    {
      label: "8. Empty Content",
      description: "Test: Hover with empty markdown",
      detail: "Returns Hover with empty MarkdownString",
    },
  ];

  const selection = await vscode.window.showQuickPick(items, {
    placeHolder: "Select an experiment to run",
    title: "🧪 Hover Provider Experiments",
  });

  if (!selection) return;

  if (selection.label.includes("Stop Experiment")) {
    clearExperiments();
    vscode.window.showInformationMessage(
      "🧪 Experiment stopped. Only VS Code defaults active."
    );
    return;
  }

  // Parse experiment number from label (handles "5a", "5b", "5c" etc.)
  const match = selection.label.match(/^(\d+[a-z]?)\./);
  if (!match) return;

  const modeMap: Record<string, ExperimentMode> = {
    "1": "null-returning",
    "2": "always-return",
    "3": "conditional",
    "4": "multi-provider",
    "5a": "registration-order-high-first",
    "5b": "registration-order-high-last",
    "5c": "registration-order-first-second-high",
    "6": "async",
    "7": "undefined",
    "8": "empty-content",
  };

  const mode = modeMap[match[1]];
  if (mode) {
    runExperiment(mode);
  }
}

/**
 * Logs current experiment status to console.
 */
export function logExperimentStatus(): void {
  console.log("=== Hover Experiment Status ===");
  console.log(`Mode: ${currentMode ?? "None"}`);
  console.log(`Active providers: ${experimentDisposables.length}`);
  console.log("===============================");

  vscode.window.showInformationMessage(
    `Current experiment: ${currentMode ?? "None"} (${
      experimentDisposables.length
    } providers)`
  );
}

/**
 * Activates the experimental hover provider testing module.
 * Commands are registered in extension.ts; this only sets up the status bar and cleanup.
 */
export function activateExperiments(context: vscode.ExtensionContext): void {
  // Create status bar item (only shown when experiments are enabled)
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );
  statusBarItem.command = "codelens-ai.experiment.menu";
  updateStatusBar();
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Cleanup on deactivation
  context.subscriptions.push({
    dispose: () => clearExperiments(),
  });

  console.log("[Experiment] Hover experiment module activated");
}

/**
 * Deactivates the experimental module.
 */
export function deactivateExperiments(): void {
  clearExperiments();
  statusBarItem?.dispose();
  statusBarItem = null;
}

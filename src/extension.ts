import * as vscode from "vscode";
import { CodeLensHoverProvider } from "./providers/hoverProvider";
import { StateManager } from "./managers/stateManager";
import { MenuManager } from "./managers/menuManager";
import { StatusBarManager } from "./managers/statusBarManager";
import { PrototypeManager } from "./managers/prototypeManager";
import {
  activateExperiments,
  deactivateExperiments,
  showExperimentMenu,
  clearExperiments,
  logExperimentStatus,
  runExperiment,
  ExperimentMode,
} from "./experimental/experimentExtension";

const HOVER_SELECTOR = [{ scheme: "file" }, { scheme: "untitled" }];

let stateManager: StateManager | undefined;
let menuManager: MenuManager | undefined;
let statusBarManager: StatusBarManager | undefined;
let prototypeManager: PrototypeManager | undefined;
let hoverRegistrationDisposable: vscode.Disposable | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const hoverProvider = new CodeLensHoverProvider();
  const sm = new StateManager(context);
  const mm = new MenuManager(sm, context);
  const sbm = new StatusBarManager(sm, mm);

  stateManager = sm;
  menuManager = mm;
  statusBarManager = sbm;

  context.subscriptions.push(sm, mm, sbm, hoverProvider);

  function registerHover(): vscode.Disposable {
    return vscode.languages.registerHoverProvider(
      HOVER_SELECTOR,
      hoverProvider
    );
  }

  if (sm.getEnabled()) {
    hoverRegistrationDisposable = registerHover();
    context.subscriptions.push(hoverRegistrationDisposable);
  }

  const stateChangeSubscription = sm.onDidChangeEnabled((enabled) => {
    if (enabled) {
      if (!hoverRegistrationDisposable) {
        hoverRegistrationDisposable = registerHover();
        context.subscriptions.push(hoverRegistrationDisposable);
      }
    } else {
      if (hoverRegistrationDisposable) {
        hoverRegistrationDisposable.dispose();
        hoverRegistrationDisposable = undefined;
      }
    }
  });
  context.subscriptions.push(stateChangeSubscription);

  sbm.registerClickHandler(context);
  sbm.show();

  const commandDisposable = vscode.commands.registerCommand(
    "codelens-ai.explainCode",
    (code?: string, ctx?: string) => {
      void hoverProvider.explainCode(code, ctx);
    }
  );
  context.subscriptions.push(commandDisposable);

  const welcomeSubscription = vscode.workspace.onDidOpenTextDocument(() => {
    if (sm.hasShownWelcome()) return;
    const message =
      "👋 Welcome to CodeLens AI! Click the icon in the status bar to configure your AI provider and get started.";
    void vscode.window
      .showInformationMessage(message, "Configure Now")
      .then((selection) => {
        void sm.markWelcomeShown();
        if (selection === "Configure Now") {
          mm.showMainMenu();
        }
      });
  });
  context.subscriptions.push(welcomeSubscription);

  // Only activate experiments UI (status bar) when explicitly enabled via configuration
  // This prevents the experimental status bar from showing to production users
  const config = vscode.workspace.getConfiguration("codelensAI");
  const experimentsEnabled = config.get<boolean>("enableExperiments", false);
  if (experimentsEnabled) {
    activateExperiments(context);
  }

  // Always register experiment commands so they don't cause "command not found" errors
  // Handlers check config at runtime and show info message if experiments are disabled
  const experimentDisabledMessage =
    'Experiments are disabled. Enable them in settings: "codelensAI.enableExperiments": true';

  function isExperimentsEnabled(): boolean {
    return vscode.workspace
      .getConfiguration("codelensAI")
      .get<boolean>("enableExperiments", false);
  }

  const experimentMenuCommand = vscode.commands.registerCommand(
    "codelens-ai.experiment.menu",
    () => {
      if (!isExperimentsEnabled()) {
        void vscode.window.showInformationMessage(experimentDisabledMessage);
        return;
      }
      void showExperimentMenu();
    }
  );

  const experimentStopCommand = vscode.commands.registerCommand(
    "codelens-ai.experiment.stop",
    () => {
      if (!isExperimentsEnabled()) {
        void vscode.window.showInformationMessage(experimentDisabledMessage);
        return;
      }
      clearExperiments();
      void vscode.window.showInformationMessage("🧪 Experiment stopped.");
    }
  );

  const experimentStatusCommand = vscode.commands.registerCommand(
    "codelens-ai.experiment.status",
    () => {
      if (!isExperimentsEnabled()) {
        void vscode.window.showInformationMessage(experimentDisabledMessage);
        return;
      }
      logExperimentStatus();
    }
  );

  // Register shortcut commands for each experiment mode
  const experimentModes: ExperimentMode[] = [
    "null-returning",
    "always-return",
    "conditional",
    "multi-provider",
    "registration-order-high-first",
    "registration-order-high-last",
    "registration-order-first-second-high",
    "async",
    "undefined",
    "empty-content",
  ];

  const experimentRunCommands = experimentModes.map((mode) =>
    vscode.commands.registerCommand(
      `codelens-ai.experiment.run.${mode}`,
      () => {
        if (!isExperimentsEnabled()) {
          void vscode.window.showInformationMessage(experimentDisabledMessage);
          return;
        }
        runExperiment(mode);
      }
    )
  );

  context.subscriptions.push(
    experimentMenuCommand,
    experimentStopCommand,
    experimentStatusCommand,
    ...experimentRunCommands
  );

  // Activate UI prototypes by default (Hybrid mode: CodeLens + Side Panel)
  // User can explicitly disable via codelensAI.prototype.enablePrototypes = false
  const prototypesEnabled = config.get<boolean>(
    "prototype.enablePrototypes",
    true
  );
  if (prototypesEnabled) {
    prototypeManager = new PrototypeManager(context);
    context.subscriptions.push(prototypeManager);
  }
}

export function deactivate(): void {
  deactivateExperiments();
  if (hoverRegistrationDisposable) {
    hoverRegistrationDisposable.dispose();
    hoverRegistrationDisposable = undefined;
  }
  prototypeManager?.dispose();
  prototypeManager = undefined;
  statusBarManager?.dispose();
  statusBarManager = undefined;
  menuManager?.dispose();
  menuManager = undefined;
  stateManager?.dispose();
  stateManager = undefined;
}

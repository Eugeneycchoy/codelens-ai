import * as vscode from "vscode";
import { CodeLensHoverProvider } from "./providers/hoverProvider";
import { StateManager } from "./managers/stateManager";
import { MenuManager } from "./managers/menuManager";
import { StatusBarManager } from "./managers/statusBarManager";

const HOVER_SELECTOR = [{ scheme: "file" }, { scheme: "untitled" }];

let stateManager: StateManager | undefined;
let menuManager: MenuManager | undefined;
let statusBarManager: StatusBarManager | undefined;
let hoverRegistrationDisposable: vscode.Disposable | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const hoverProvider = new CodeLensHoverProvider();
  const sm = new StateManager(context);
  const mm = new MenuManager(sm, context);
  const sbm = new StatusBarManager(sm, mm);

  stateManager = sm;
  menuManager = mm;
  statusBarManager = sbm;

  context.subscriptions.push(sm, mm, sbm);

  function registerHover(): vscode.Disposable {
    return vscode.languages.registerHoverProvider(
      HOVER_SELECTOR,
      hoverProvider,
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
    },
  );
  context.subscriptions.push(commandDisposable);
}

export function deactivate(): void {
  if (hoverRegistrationDisposable) {
    hoverRegistrationDisposable.dispose();
    hoverRegistrationDisposable = undefined;
  }
  statusBarManager?.dispose();
  statusBarManager = undefined;
  menuManager?.dispose();
  menuManager = undefined;
  stateManager?.dispose();
  stateManager = undefined;
}

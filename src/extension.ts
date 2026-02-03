import * as vscode from "vscode";
import { CodeLensHoverProvider } from "./providers/hoverProvider";

export function activate(context: vscode.ExtensionContext): void {
  const hoverProvider = new CodeLensHoverProvider();

  const hoverDisposable = vscode.languages.registerHoverProvider(
    [{ scheme: "file" }, { scheme: "untitled" }],
    hoverProvider,
  );
  context.subscriptions.push(hoverDisposable);

  const commandDisposable = vscode.commands.registerCommand(
    "codelens-ai.explainCode",
    (code?: string, context?: string) => {
      void hoverProvider.explainCode(code, context);
    },
  );
  context.subscriptions.push(commandDisposable);
}

export function deactivate(): void {}

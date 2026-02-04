import * as vscode from "vscode";

const ENABLED_KEY = "codelensAI.enabled";

/**
 * Holds extension enabled/disabled state and notifies subscribers when it changes.
 * Used by StatusBarManager to keep the status bar icon in sync.
 */
export class StateManager {
  private _enabled: boolean;
  private readonly _onDidChangeEnabled = new vscode.EventEmitter<boolean>();
  readonly onDidChangeEnabled: vscode.Event<boolean> =
    this._onDidChangeEnabled.event;

  constructor(private readonly context: vscode.ExtensionContext) {
    const stored = context.globalState.get<boolean>(ENABLED_KEY);
    this._enabled = stored ?? true;
  }

  getEnabled(): boolean {
    return this._enabled;
  }

  async setEnabled(enabled: boolean): Promise<void> {
    if (this._enabled === enabled) return;
    this._enabled = enabled;
    await this.context.globalState.update(ENABLED_KEY, enabled);
    this._onDidChangeEnabled.fire(this._enabled);
  }

  dispose(): void {
    this._onDidChangeEnabled.dispose();
  }
}

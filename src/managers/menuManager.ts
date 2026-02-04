import * as vscode from "vscode";
import { StateManager } from "./stateManager";

const CONFIG_NS = "codelensAI";
const ACTION_PREFIX = "action:";

/** Default model per provider when switching (per tech spec / UX requirements). */
const DEFAULT_MODELS: Record<ProviderId, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-sonnet-20241022",
  ollama: "llama3",
};

/** Predefined model options per provider (from tech spec and common usage). */
const OPENAI_MODELS = ["gpt-4o-mini", "gpt-4o", "gpt-4-turbo", "gpt-3.5-turbo"];
const ANTHROPIC_MODELS = [
  "claude-3-5-sonnet-20241022",
  "claude-3-5-haiku-20241022",
  "claude-3-opus-20240229",
  "claude-3-sonnet-20240229",
];
const OLLAMA_MODELS = ["llama3", "llama3.2", "codellama", "mistral", "phi3"];

type ProviderId = "openai" | "anthropic" | "ollama";
type MenuAction =
  | "toggle"
  | "openSettings"
  | "showProviderMenu"
  | "showModelMenu";

interface ActionableQuickPickItem extends vscode.QuickPickItem {
  readonly action?: MenuAction;
}

interface MenuConfig {
  provider: ProviderId;
  apiKey: string;
  model: string;
  ollamaEndpoint: string;
}

/**
 * Shows the CodeLens AI status-bar menu via createQuickPick. Supports grouped
 * sections (Control / Configuration), toggle with checkmark, Open Settings,
 * config watcher refresh, and stays open for multiple selections.
 */
export class MenuManager {
  private quickPick: vscode.QuickPick<ActionableQuickPickItem> | undefined;
  private submenuQuickPick: vscode.QuickPick<vscode.QuickPickItem> | undefined;
  private configWatcherDisposable: vscode.Disposable | undefined;

  constructor(
    private readonly stateManager: StateManager,
    private readonly context: vscode.ExtensionContext,
  ) {
    this.configWatcherDisposable = vscode.workspace.onDidChangeConfiguration(
      (e) => {
        if (e.affectsConfiguration("codelensAI") && this.quickPick?.visible) {
          this.quickPick.items = this.buildItems();
        }
      },
    );
    context.subscriptions.push(this.configWatcherDisposable);
  }

  private getConfig(): MenuConfig {
    const config = vscode.workspace.getConfiguration(CONFIG_NS);
    return {
      provider: (config.get("provider") as ProviderId) ?? "openai",
      apiKey: config.get("apiKey") ?? "",
      model: config.get("model") ?? "gpt-4o-mini",
      ollamaEndpoint: config.get("ollamaEndpoint") ?? "http://localhost:11434",
    };
  }

  /**
   * Checks Ollama connectivity via HTTP GET to /api/tags. Returns true if
   * the endpoint responds successfully.
   */
  async checkOllamaConnectivity(): Promise<boolean> {
    const { ollamaEndpoint } = this.getConfig();
    const url = `${ollamaEndpoint.replace(/\/$/, "")}/api/tags`;
    try {
      const res = await fetch(url, { method: "GET" });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Builds the main menu items: Control (toggle with checkmark) and
   * Configuration (Open Settings), with separators.
   */
  private buildItems(): ActionableQuickPickItem[] {
    const enabled = this.stateManager.getEnabled();
    const toggleLabel = enabled
      ? "$(check) CodeLens AI enabled"
      : "CodeLens AI disabled";
    const toggleDescription = enabled
      ? "Click to disable hover explanations"
      : "Click to enable hover explanations";

    return [
      {
        label: "Control",
        kind: vscode.QuickPickItemKind.Separator,
      },
      {
        label: toggleLabel,
        description: toggleDescription,
        detail: `${ACTION_PREFIX}toggle`,
        action: "toggle",
      },
      {
        label: "Configuration",
        kind: vscode.QuickPickItemKind.Separator,
      },
      {
        label: "$(key) Change provider",
        description: "OpenAI, Anthropic, or Ollama",
        detail: `${ACTION_PREFIX}showProviderMenu`,
        action: "showProviderMenu",
      },
      {
        label: "$(symbol-misc) Change model",
        description: "Model for the current provider",
        detail: `${ACTION_PREFIX}showModelMenu`,
        action: "showModelMenu",
      },
      {
        label: "$(settings-gear) Open Settings",
        description: "Configure provider, API key, and model",
        detail: `${ACTION_PREFIX}openSettings`,
        action: "openSettings",
      },
    ];
  }

  private getAction(item: ActionableQuickPickItem): MenuAction | undefined {
    return (
      item.action ??
      (item.detail?.startsWith(ACTION_PREFIX)
        ? (item.detail.slice(ACTION_PREFIX.length) as MenuAction)
        : undefined)
    );
  }

  private async runAction(action: MenuAction): Promise<void> {
    if (action === "toggle") {
      await this.stateManager.setEnabled(!this.stateManager.getEnabled());
    } else if (action === "openSettings") {
      await vscode.commands.executeCommand(
        "workbench.action.openSettings",
        CONFIG_NS,
      );
    } else if (action === "showProviderMenu") {
      this.quickPick?.hide();
      void this.showProviderMenu();
    } else if (action === "showModelMenu") {
      this.quickPick?.hide();
      this.showModelMenu();
    }
  }

  /**
   * Shows provider selection menu with self-contained navigation. Displays
   * OpenAI, Anthropic, Ollama with status (API key warning, Ollama connectivity).
   * Checkmark indicates current provider. On selection, updates config with
   * provider and default model, then returns to main menu.
   */
  async showProviderMenu(): Promise<void> {
    const config = this.getConfig();
    const ollamaOk = await this.checkOllamaConnectivity();

    const providers: { id: ProviderId; label: string; status: string }[] = [
      {
        id: "openai",
        label: "OpenAI",
        status: config.apiKey?.trim()
          ? "API key set"
          : "$(warning) Set API key in settings",
      },
      {
        id: "anthropic",
        label: "Anthropic",
        status: config.apiKey?.trim()
          ? "API key set"
          : "$(warning) Set API key in settings",
      },
      {
        id: "ollama",
        label: "Ollama",
        status: ollamaOk
          ? "Connected"
          : "$(warning) Cannot reach Ollama; check endpoint",
      },
    ];

    const items: vscode.QuickPickItem[] = providers.map((p) => ({
      label: config.provider === p.id ? `$(check) ${p.label}` : p.label,
      description: p.status,
      detail: p.id,
    }));

    if (!this.submenuQuickPick) {
      this.submenuQuickPick =
        vscode.window.createQuickPick<vscode.QuickPickItem>();
      this.submenuQuickPick.canSelectMany = false;
      this.submenuQuickPick.onDidHide(() => {
        this.submenuQuickPick!.selectedItems = [];
      });
      this.context.subscriptions.push(this.submenuQuickPick);
    }

    this.submenuQuickPick.title = "Select provider";
    this.submenuQuickPick.placeholder =
      "Choose AI provider (sets default model)";
    this.submenuQuickPick.items = items;
    this.submenuQuickPick.selectedItems = [];
    this.submenuQuickPick.show();

    const acceptDisposable = this.submenuQuickPick.onDidAccept(() => {
      const selected = this.submenuQuickPick!.selectedItems[0];
      if (!selected?.detail) return;
      const provider = selected.detail as ProviderId;
      const configTarget = vscode.ConfigurationTarget.Global;
      const c = vscode.workspace.getConfiguration(CONFIG_NS);
      void c.update("provider", provider, configTarget);
      void c.update("model", DEFAULT_MODELS[provider], configTarget);
      this.submenuQuickPick!.hide();
    });

    const hideDisposable = this.submenuQuickPick.onDidHide(() => {
      acceptDisposable.dispose();
      hideDisposable.dispose();
      this.showMainMenu();
    });
  }

  /**
   * Shows model selection menu for the current provider. Checkmark indicates
   * current model. On selection, updates config and returns to main menu.
   */
  showModelMenu(): void {
    const config = this.getConfig();
    const models =
      config.provider === "openai"
        ? OPENAI_MODELS
        : config.provider === "anthropic"
        ? ANTHROPIC_MODELS
        : OLLAMA_MODELS;

    const items: vscode.QuickPickItem[] = models.map((model) => ({
      label: config.model === model ? `$(check) ${model}` : model,
      detail: model,
    }));

    if (!this.submenuQuickPick) {
      this.submenuQuickPick =
        vscode.window.createQuickPick<vscode.QuickPickItem>();
      this.submenuQuickPick.canSelectMany = false;
      this.submenuQuickPick.onDidHide(() => {
        this.submenuQuickPick!.selectedItems = [];
      });
      this.context.subscriptions.push(this.submenuQuickPick);
    }

    this.submenuQuickPick.title = "Select model";
    this.submenuQuickPick.placeholder = `Model for ${config.provider}`;
    this.submenuQuickPick.items = items;
    this.submenuQuickPick.selectedItems = [];
    this.submenuQuickPick.show();

    const acceptDisposable = this.submenuQuickPick.onDidAccept(() => {
      const selected = this.submenuQuickPick!.selectedItems[0];
      if (!selected?.detail) return;
      const model = selected.detail;
      const configTarget = vscode.ConfigurationTarget.Global;
      void vscode.workspace
        .getConfiguration(CONFIG_NS)
        .update("model", model, configTarget);
      this.submenuQuickPick!.hide();
    });

    const hideDisposable = this.submenuQuickPick.onDidHide(() => {
      acceptDisposable.dispose();
      hideDisposable.dispose();
      this.showMainMenu();
    });
  }

  /**
   * Shows the main menu using createQuickPick. Menu stays open after each
   * accept so the user can perform multiple actions; config changes refresh
   * items in real time.
   */
  showMainMenu(): void {
    if (!this.quickPick) {
      this.quickPick = vscode.window.createQuickPick<ActionableQuickPickItem>();
      this.quickPick.title = "CodeLens AI";
      this.quickPick.placeholder = "Choose an action (multiple allowed)";
      this.quickPick.matchOnDescription = true;
      this.quickPick.canSelectMany = true;

      this.quickPick.onDidAccept(() => {
        const selected = this.quickPick!.selectedItems;
        const actions = new Set<MenuAction>();
        for (const item of selected) {
          const action = this.getAction(item);
          if (action) actions.add(action);
        }
        void (async () => {
          for (const action of actions) {
            await this.runAction(action);
          }
          this.quickPick!.selectedItems = [];
          this.quickPick!.items = this.buildItems();
        })();
      });

      this.quickPick.onDidHide(() => {
        this.quickPick!.selectedItems = [];
      });
    }

    this.quickPick.items = this.buildItems();
    this.quickPick.selectedItems = [];
    this.quickPick.show();
  }

  /**
   * Alias for status bar click handler. Opens the main menu.
   */
  show(): void {
    this.showMainMenu();
  }

  dispose(): void {
    this.configWatcherDisposable?.dispose();
    this.submenuQuickPick?.dispose();
    this.submenuQuickPick = undefined;
    this.quickPick?.dispose();
    this.quickPick = undefined;
  }
}

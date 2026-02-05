# CodeLens AI

[![VS Code](https://img.shields.io/badge/VS%20Code-1.85+-blue.svg)](https://code.visualstudio.com/)
[![Marketplace](https://img.shields.io/vscode-marketplace/v/c29ce4d7-9ced-651f-8c88-edff7e3d057a.codelens-ai.svg)](https://marketplace.visualstudio.com/items?itemName=c29ce4d7-9ced-651f-8c88-edff7e3d057a.codelens-ai)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

AI-powered code explanations inline with your code. Clickable CodeLens annotations appear above functions and code blocks; hover for quick tooltips or open the Side Panel for detailed explanations with history.

---

## Description

CodeLens AI is a VS Code / Cursor extension that helps you understand unfamiliar code without leaving the editor. Click an inline **Explain** link above any function or block to get a short AI explanation right where you are. For deeper exploration, the **Side Panel** shows full explanations with rich formatting and a history of past explanations. No switching windows, no broken focus—explanations live where your eyes already are.

**Ideal for:** AI-generated code, inherited codebases, and library code. The extension works with any file type and supports **OpenAI**, **Anthropic**, and **Ollama** (local).

---

## Features

### Hybrid mode (recommended)

The default **Hybrid** mode combines **CodeLens** and **Side Panel** so you get inline links and a dedicated place for full explanations. You stay in control: no fighting with VS Code’s built-in hovers, and no accidental triggers—explanations appear when you click.

### CodeLens

- **Inline “Explain” links** above functions, classes, and methods.
- **Click** to fetch or show a cached explanation.
- **Inline preview** for cached results; **“More”** opens the full explanation in the Side Panel.
- **Loading state** (e.g. “Loading explanation…”) while the AI responds; re-hover or re-click after the request completes to see the result.

### Side Panel

- **Persistent panel** in the Explorer sidebar under **CodeLens AI**.
- **Full AI explanation** with formatted content.
- **History** of past explanations to review.
- **Actions:** Copy, Refresh, Clear history.

### Multiple AI providers

- **OpenAI** (e.g. `gpt-4o-mini`, `gpt-4o`) — set `codelensAI.provider` to `openai` and add your API key.
- **Anthropic** (e.g. Claude) — set provider to `anthropic` and add your API key.
- **Ollama** (local) — set provider to `ollama`; uses `http://localhost:11434` by default (no API key).

You can switch providers and models in VS Code settings.

---

## Installation

1. Open **VS Code** or **Cursor** (1.85 or newer).
2. Open the **Extensions** view (`Ctrl+Shift+X` / `Cmd+Shift+X`).
3. Search for **CodeLens AI** and click **Install**.

**Or** install directly from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=c29ce4d7-9ced-651f-8c88-edff7e3d057a.codelens-ai).

---

## Configuration (API key setup)

1. Open **Settings** (`Ctrl+,` / `Cmd+,`) and search for **CodeLens AI**, or run **Preferences: Open User Settings (JSON)** and add entries under a `codelensAI` section.
2. Set your **AI provider** and **API key**:

| Setting                     | Description                                           |
| --------------------------- | ----------------------------------------------------- |
| `codelensAI.provider`       | `openai`, `anthropic`, or `ollama`                    |
| `codelensAI.apiKey`         | API key for OpenAI or Anthropic (not used for Ollama) |
| `codelensAI.model`          | Model name (default: `gpt-4o-mini` for OpenAI)        |
| `codelensAI.ollamaEndpoint` | For Ollama only (default: `http://localhost:11434`)   |

**Example (OpenAI):**

```json
"codelensAI.provider": "openai",
"codelensAI.apiKey": "sk-your-openai-key",
"codelensAI.model": "gpt-4o-mini"
```

**Example (Ollama, local):**

```json
"codelensAI.provider": "ollama",
"codelensAI.ollamaEndpoint": "http://localhost:11434",
"codelensAI.model": "llama2"
```

Optional: adjust **UI mode** (`codelensAI.prototype.mode`), **CodeLens** on/off, **Side Panel** on/off, and **highlight color** in settings.

---

## Usage

### Basic flow

1. Open a file (e.g. TypeScript, JavaScript, Python). **CodeLens** “Explain” links appear above functions and other constructs.
2. **Click “Explain”** (or the inline link). If the explanation is cached, a short preview appears inline; otherwise a loading state is shown and the request runs in the background.
3. After the request completes, **click again** or **re-hover** to see the explanation. Click the preview or **“More”** to open the **Side Panel** for the full explanation and history.

### Commands

- **CodeLens AI: Explain Selected Code** — Select code, run the command → explanation in the Side Panel.
- **CodeLens AI: Quick Peek Explanation** — `Ctrl+Shift+E` / `Cmd+Shift+E` for a quick modal explanation.
- **CodeLens AI: Explain in Side Panel** — `Ctrl+Shift+Alt+E` / `Cmd+Shift+Alt+E` to open the panel.
- **CodeLens AI: Select UI Mode** — Switch between Hybrid, CodeLens only, Side Panel, etc.
- **CodeLens AI: Show Menu** — Open the status bar menu (Configure, Enable/Disable).

### Screenshots and recordings

- **CodeLens “Explain” above a function**  
  [SCREENSHOT: Editor with “Explain” CodeLens above a function and optional inline preview.]

- **Hover tooltip with explanation and “Learn More”**  
  [SCREENSHOT: Hover over a line showing merged tooltip with short explanation and “Learn More” link.]

- **Side Panel with full explanation and history**  
  [SCREENSHOT: CodeLens AI panel in Explorer sidebar with explanation and history list.]

- **Accurate highlighting (function body vs single line)**

  - Structural (function/class): full block highlighted.  
    ![Structural highlight](docs/test-report-assets/screenshots/flow-09-structural-highlight.png)
  - Simple (e.g. `const` / `return`): single line highlighted.  
    ![Simple highlight](docs/test-report-assets/screenshots/flow-10-simple-highlight.png)

- **Cache hit: instant tooltip**  
  ![Cache hit](docs/test-report-assets/screenshots/flow-01-cache-hit.png)

- **Re-hover after cache miss**  
  First hover shows no tooltip while fetching; re-hover shows the explanation.  
  ![Cache miss / re-hover](docs/test-report-assets/screenshots/flow-02-cache-miss.png)

Optional: add a short **GIF** of the full flow (click Explain → loading → preview → open Side Panel) for the marketplace listing.

---

## Requirements

- **VS Code** or **Cursor** version **1.85.0** or higher.
- For **OpenAI** or **Anthropic**: an API key and network access.
- For **Ollama**: Ollama running locally (default `http://localhost:11434`).

---

## Known issues

| Issue                             | Impact                                                                                        | Notes                                                   |
| --------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| **Re-hover for uncached code**    | First hover shows no tooltip; you must re-hover or re-click after the request finishes.       | By design to keep the UI non-blocking.                  |
| **Hover merged with VS Code**     | TypeScript/linter hovers appear in the same tooltip; we can’t show only our content in hover. | Use CodeLens + Side Panel for an explanation-only view. |
| **Cache is in-memory**            | Cache is cleared when the editor or extension is reloaded; 30-minute TTL.                     | No persistent cache in this release.                    |
| **Very long blocks (>500 lines)** | Highlight may be truncated for performance.                                                   | Extraction still returns bounded content.               |

No known critical bugs. See [FINAL_UAT_REPORT.md](docs/FINAL_UAT_REPORT.md) for full UAT and limitations.

---

## Contributing

Contributions are welcome. Please open an issue to discuss larger changes, and ensure tests pass (`npm run test -- --run`) and the extension builds (`npm run build`) before submitting.

---

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history and release notes.

---

## License

Licensed under the [MIT License](LICENSE).

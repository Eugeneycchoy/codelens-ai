# Changelog

All notable changes to CodeLens AI are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.1.0] - 2025-02-05

**Early preview release.** This version is suitable for trying the extension and giving feedback; some behavior and defaults may change in future releases.

### Added

- **Hybrid mode (default)** — CodeLens annotations plus Side Panel for inline “Explain” links and detailed explanations with exclusive control over the explanation UI (no conflict with VS Code’s built-in hovers).
- **CodeLens provider** — Inline “Explain” links above functions, classes, and methods; click to show cached preview or trigger fetch; loading state and “More” to open Side Panel.
- **Side Panel** — Persistent webview in the Explorer sidebar (“CodeLens AI”) with full AI explanation, history, and actions (Copy, Refresh, Clear history).
- **Multiple AI providers** — OpenAI, Anthropic, and Ollama; configurable in settings with API key (OpenAI/Anthropic) or local endpoint (Ollama).
- **Hover provider (supplementary)** — Brief explanations in the merged VS Code hover tooltip; “Learn More” opens the Side Panel.
- **Quick Peek** — Command and keybinding (`Ctrl+Shift+E` / `Cmd+Shift+E`) for fast modal explanation.
- **Explain command** — “CodeLens AI: Explain Selected Code” to get an explanation for the current selection in the Side Panel.
- **Accurate highlighting** — Structural (full block) vs simple (single line) highlighting; theme-aware (dark/light/high-contrast).
- **In-memory cache** — 30-minute TTL to avoid repeat AI calls for the same code; cache hits show explanations immediately.
- **Status bar and menu** — Configure, enable/disable, and select UI mode from the status bar.
- **Configuration** — Provider, API key, model, Ollama endpoint, UI mode, CodeLens on/off, Side Panel on/off, highlight color.

### Known limitations

- First hover on uncached code shows no tooltip; re-hover after the request completes to see the result.
- Hover content is merged with other VS Code hover providers (TypeScript, linters); cannot be suppressed.
- Cache is in-memory only and cleared on reload.

### Packaging & verification (0.1.0)

Build and package were re-run and console output captured as follows.

**`npm run build`** (exit 0):

```
> codelens-ai@0.1.0 build
> node esbuild.config.js
```

No warnings or errors.

**`vsce package`** (exit 0):

```
 INFO  Files included in the VSIX:
codelens-ai-0.1.0.vsix
├─ [Content_Types].xml
├─ extension.vsixmanifest
└─ extension/
   ├─ LICENSE.txt [1.04 KB]
   ├─ changelog.md [2.34 KB]
   ├─ icon.png [0.83 KB]
   ├─ package.json [7.92 KB]
   ├─ readme.md [7.93 KB]
   └─ dist/
      ├─ extension.js [997.05 KB]
      └─ extension.js.map [2.71 MB]

 DONE  Packaged: /Users/eugeneycchoy/projects/codelens-ai/codelens-ai-0.1.0.vsix (9 files, 678.09 KB)
```

**Post-packaging verification:** After packaging, install the VSIX locally and verify: icon renders, README displays in Extensions view, and core functionality passes smoke tests. Note here that verification passed, or document any issues found.

[0.1.0]: https://github.com/Eugeneycchoy/codelens-ai/releases/tag/v0.1.0

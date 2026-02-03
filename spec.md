```markdown
# CodeLens AI — Project Specification

## Product Overview

CodeLens AI is a VS Code/Cursor extension that provides AI-powered code explanations on hover. When a developer hovers over any line or code block, a modal appears next to the cursor explaining what that code does, why it exists, and how it connects to surrounding code.

## Problem Statement

Developers working with unfamiliar code—whether AI-generated, inherited from teammates, or from libraries—constantly context-switch between reading code and searching for explanations elsewhere. They lose flow, open browser tabs, ask ChatGPT in a separate window, or just guess and move on.

## Solution

Hover over any line or code block, and a sleek modal appears right next to the cursor explaining the code. No switching windows, no breaking focus. The explanation lives exactly where the developer's eyes already are.

## Core Interaction

User hovers over code → Extension extracts the line/block plus surrounding context → Checks cache → If cache miss, sends to AI → Renders response in modal → Caches result for future use.

---

## Architecture

```

┌─────────────────────────────────────────────────────────────┐

│                    VS Code Extension Host                    │

├─────────────────────────────────────────────────────────────┤

│  UI Layer                                                    │

│  └── Hover Provider (renders modal near cursor)             │

├─────────────────────────────────────────────────────────────┤

│  Extension Core                                              │

│  ├── Hover Detection (line/block selection logic)           │

│  ├── Context Extractor (grabs surrounding code for AI)      │

│  └── State Manager (loading states, user preferences)       │

├─────────────────────────────────────────────────────────────┤

│  Services                                                    │

│  ├── AI Service (LLM calls, prompt engineering)             │

│  └── Cache Service (avoid repeat calls for same code)       │

├─────────────────────────────────────────────────────────────┤

│  Storage                                                     │

│  ├── In-Memory Cache (session-based)                        │

│  └── VS Code Settings (API keys, preferences)               │

└─────────────────────────────────────────────────────────────┘

```

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Language | TypeScript |
| Extension API | VS Code Extension API (Hover Provider) |
| AI Integration | OpenAI SDK, Anthropic SDK, Ollama REST API |
| Caching | In-memory Map keyed by code hash |
| Bundler | esbuild |
| UI | VS Code MarkdownString for hover content |

---

## Project Structure

```

codelens-ai/

├── src/

│   ├── extension.ts              # Entry point, activation, command registration

│   ├── providers/

│   │   └── hoverProvider.ts      # Hover detection and modal rendering

│   ├── services/

│   │   ├── aiService.ts          # LLM abstraction (OpenAI, Anthropic, Ollama)

│   │   └── cacheService.ts       # In-memory cache with TTL

│   └── utils/

│       └── contextExtractor.ts   # Extracts code line/block and surrounding context

├── package.json                  # Extension manifest and dependencies

├── tsconfig.json                 # TypeScript configuration

└── README.md                     # User-facing documentation

```

---

## File Specifications

### package.json

The extension manifest must include:

- Extension metadata: name as "codelens-ai", displayName as "CodeLens AI", version starting at "0.0.1"
- Engine compatibility: vscode "^1.85.0"
- Activation event: "onStartupFinished"
- Main entry: "./dist/extension.js"
- Commands: one command "codelens-ai.explainCode" with title "CodeLens AI: Explain Selected Code"
- Configuration properties under "codelensAI" namespace: provider (enum: openai, anthropic, ollama), apiKey (string), ollamaEndpoint (string, default "http://localhost:11434"), model (string, default "gpt-4o-mini")
- Scripts: build using esbuild bundling src/extension.ts to dist/extension.js with vscode as external, watch mode, package using vsce
- Dependencies: ai, openai, @anthropic-ai/sdk
- DevDependencies: typescript, @types/node, @types/vscode, esbuild

### tsconfig.json

- Module: commonjs
- Target: ES2022
- Lib: ES2022
- OutDir: dist
- RootDir: src
- Strict: true
- esModuleInterop: true
- skipLibCheck: true
- Include src directory, exclude node_modules and dist

### src/extension.ts

This is the entry point. It must:

- Export an activate function that receives ExtensionContext
- Instantiate CodeLensHoverProvider
- Register the hover provider for all file schemes using vscode.languages.registerHoverProvider
- Register the explainCode command that gets selected text from active editor and calls the hover provider's explainCode method
- Push all disposables to context.subscriptions
- Export an empty deactivate function

### src/services/cacheService.ts

Implements CacheService class with:

- Private cache as Map<string, CacheEntry> where CacheEntry has explanation string and timestamp number
- Private ttl set to 30 minutes in milliseconds
- Private generateKey method that creates a simple hash from code string
- Public get method that checks cache, validates TTL, returns explanation or null
- Public set method that stores explanation with current timestamp
- Public clear method that empties the cache

### src/services/aiService.ts

Implements AIService class with:

- Private getConfig method that reads from vscode.workspace.getConfiguration('codelensAI') and returns provider, apiKey, model, ollamaEndpoint
- Public async explain method that takes code, language, optional context, builds prompt, routes to appropriate provider method
- Private buildPrompt method that constructs a prompt instructing the AI to explain the code concisely, focusing on what it does, why it exists, and notable patterns
- Private async callOpenAI method using OpenAI SDK chat.completions.create
- Private async callAnthropic method using Anthropic SDK messages.create
- Private async callOllama method using fetch to POST to ollama endpoint /api/generate

Prompt template should instruct the AI to:
- Explain what the code does in 1-2 sentences
- Explain why it might exist / its purpose
- Note any patterns or techniques used
- Keep explanation brief but insightful
- Not repeat the code back

### src/utils/contextExtractor.ts

Implements ContextExtractor class with:

- Public extract method that takes document, position, optional lineRange (default 5), returns object with code (the hovered line trimmed) and context (surrounding lines excluding the hovered line)
- Public extractBlock method that takes document and position, uses indentation-based heuristics to find the containing block, returns the full block as code
- Private getIndentation helper that returns the number of leading whitespace characters

### src/providers/hoverProvider.ts

Implements CodeLensHoverProvider class that implements vscode.HoverProvider with:

- Private instances of AIService, CacheService, ContextExtractor
- Private isProcessing flag to prevent concurrent requests
- Public provideHover method that:
  - Returns null for empty lines or if already processing
  - Extracts code and context using contextExtractor
  - Checks cache first, returns cached hover if available
  - Returns a loading hover and triggers async fetchExplanation
- Private async fetchExplanation method that calls aiService.explain and stores result in cache
- Public async explainCode method for the command that shows explanation in a webview panel with progress notification
- Private createHover method that builds a MarkdownString with the explanation, header, and "Learn More" link
- Private showExplanationPanel method that creates a webview panel with basic HTML displaying the explanation

---

## Configuration Schema

Users configure the extension through VS Code settings:

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| codelensAI.provider | enum | "openai" | AI provider: openai, anthropic, or ollama |
| codelensAI.apiKey | string | "" | API key for OpenAI or Anthropic |
| codelensAI.ollamaEndpoint | string | "http://localhost:11434" | Ollama API endpoint |
| codelensAI.model | string | "gpt-4o-mini" | Model identifier |

---

## User Experience Details

### Hover Behavior

When user hovers over a non-empty line, the extension extracts that line plus 5 lines above and below for context. If the explanation is cached, it displays immediately in a hover tooltip. If not cached, a loading indicator appears and the explanation is fetched asynchronously. On subsequent hovers over the same code, the cached explanation appears instantly.

### Hover Modal Content

The hover displays:
- Header: "🧠 CodeLens AI"
- Body: The AI-generated explanation
- Footer: A "Learn More" link that triggers the explainCode command

### Explanation Panel

When "Learn More" is clicked or the command is invoked on selected code, a side panel opens with a more detailed view of the explanation.

---

## Development Commands

| Command | Purpose |
|---------|---------|
| npm run build | Bundle extension with esbuild |
| npm run watch | Bundle with watch mode for development |
| F5 in VS Code | Launch Extension Development Host for testing |

---

## Implementation Notes

- Use simple hash function for cache keys, not cryptographic
- TTL for cache entries is 30 minutes
- Hover provider should not block on AI calls; show loading state and fetch async
- Keep prompts concise to minimize token usage and latency
- Handle API errors gracefully, log to console, do not crash extension
- The extension should work with any file type, not just specific languages
```

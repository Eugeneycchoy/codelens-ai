import * as vscode from "vscode";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

export interface AIConfig {
  provider: "openai" | "anthropic" | "ollama";
  apiKey: string;
  model: string;
  apiBase: string;
  ollamaEndpoint: string;
}

/** Maximum time to wait for an AI request before aborting (ms). */
const AI_REQUEST_TIMEOUT_MS = 30_000;

/**
 * Converts VS Code's CancellationToken and a timeout into a single AbortSignal
 * so underlying fetch/API calls are aborted on user cancel or after 30 seconds.
 * Returns { signal, cleanup } so caller can clear the timeout when the request settles.
 */
function createAbortSignalWithTimeout(token?: vscode.CancellationToken): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS);
  const cleanup = () => clearTimeout(timeoutId);
  if (token) {
    if (token.isCancellationRequested) {
      cleanup();
      return { signal: AbortSignal.abort(), cleanup: () => {} };
    }
    token.onCancellationRequested(() => {
      cleanup();
      controller.abort();
    });
  }
  return { signal: controller.signal, cleanup };
}

/**
 * Abstraction over OpenAI, Anthropic, and Ollama for code explanations.
 * Reads VS Code config and routes requests to the selected provider.
 */
export class AIService {
  private getConfig(): AIConfig {
    const config = vscode.workspace.getConfiguration("codelensAI");
    return {
      provider: (config.get("provider") as AIConfig["provider"]) ?? "openai",
      apiKey: config.get("apiKey") ?? "",
      model: config.get("model") ?? "gpt-4o-mini",
      apiBase: config.get("apiBase") ?? "",
      ollamaEndpoint: config.get("ollamaEndpoint") ?? "http://localhost:11434",
    };
  }

  /**
   * Request an explanation for the given code. Routes to the configured provider.
   * Throws an Error with a user-friendly message on failure (network, timeout, auth, rate-limit, etc.)
   * so callers can show a Retry option. Returns only on success or user cancellation.
   * Optional cancellationToken aborts the request when cancelled (e.g. hover dismissed).
   * Use explainOptions.detailLevel "detailed" and fileStructure for richer "Learn More" explanations.
   */
  async explain(
    code: string,
    lang: string,
    context?: string,
    cancellationToken?: vscode.CancellationToken,
    explainOptions?: {
      detailLevel?: "brief" | "detailed";
      fileStructure?: string;
    }
  ): Promise<string> {
    const cfg = this.getConfig();

    if (
      (cfg.provider === "openai" || cfg.provider === "anthropic") &&
      !cfg.apiKey
    ) {
      const apiKeyHint = cfg.apiBase
        ? "Please set `codelensAI.apiKey` and verify `codelensAI.apiBase` in settings for the selected provider."
        : "Please set `codelensAI.apiKey` in settings for the selected provider.";
      throw new Error(apiKeyHint);
    }

    const prompt = this.buildPrompt(code, lang, context, explainOptions);
    const { signal, cleanup } = createAbortSignalWithTimeout(cancellationToken);

    try {
      let result: string;
      switch (cfg.provider) {
        case "openai":
          result = await this.callOpenAI(prompt, cfg.model, cfg.apiKey, signal);
          break;
        case "anthropic":
          result = await this.callAnthropic(
            prompt,
            cfg.model,
            cfg.apiKey,
            cfg.apiBase,
            signal
          );
          break;
        case "ollama":
          result = await this.callOllama(
            prompt,
            cfg.model,
            cfg.ollamaEndpoint,
            signal
          );
          break;
        default:
          cleanup();
          throw new Error(
            `Unknown provider: ${cfg.provider}. Use openai, anthropic, or ollama.`
          );
      }
      cleanup();
      return result;
    } catch (err) {
      cleanup();
      if (this.isAbortError(err)) {
        return "Request was cancelled.";
      }
      const hasApiBase =
        cfg.provider === "anthropic" && Boolean(cfg.apiBase?.trim());
      const message = this.analyzeError(err, hasApiBase);
      console.error("[CodeLens AI]", err);
      throw new Error(message);
    }
  }

  private isAbortError(error: unknown): boolean {
    if (error instanceof Error) {
      if (error.name === "AbortError") return true;
      if (error.message?.toLowerCase().includes("aborted")) return true;
    }
    if (
      typeof error === "object" &&
      error !== null &&
      "name" in error &&
      (error as { name: string }).name === "AbortError"
    ) {
      return true;
    }
    return false;
  }

  /**
   * Classifies the error and returns a user-friendly message using
   * error type, status code (when present), and message patterns.
   */
  private analyzeError(error: unknown, hasApiBase: boolean): string {
    const status = this.getStatusCode(error);
    const message = error instanceof Error ? error.message : String(error);
    const msgLower = message.toLowerCase();

    // 1. Status-code-based detection (API responses)
    if (status !== undefined) {
      if (status === 401 || status === 403) {
        return hasApiBase
          ? "Authentication failed (401/403). Check `codelensAI.apiKey` and that `codelensAI.apiBase` points to a valid endpoint that accepts your key."
          : "Authentication failed (401/403). Check `codelensAI.apiKey` in settings.";
      }
      if (status >= 500) {
        return "The API server is temporarily unavailable. Try again in a few minutes.";
      }
      if (status === 429) {
        return "Rate limit exceeded. Wait a moment and try again.";
      }
      if (status >= 400 && status < 500) {
        return `Request was rejected (${status}). Check your model name and request format.`;
      }
    }

    // 2. Message-pattern detection (network, timeout, DNS, etc.)
    if (
      /econnrefused|econnreset|enotfound|network|fetch failed|failed to fetch/i.test(
        msgLower
      ) ||
      (error instanceof TypeError && msgLower.includes("fetch"))
    ) {
      return hasApiBase
        ? "Could not reach the API. Check `codelensAI.apiBase`, your network, and that the service is running."
        : "Could not reach the API. Check your network and that the provider service is available.";
    }
    if (/timeout|etimedout|timed out/i.test(msgLower)) {
      return "The request timed out. Check your network or try again.";
    }
    if (
      /unauthorized|invalid.*api.*key|authentication|invalid key|401|403/i.test(
        msgLower
      )
    ) {
      return hasApiBase
        ? "Invalid or missing API key. Check `codelensAI.apiKey` and `codelensAI.apiBase`."
        : "Invalid or missing API key. Check `codelensAI.apiKey` in settings.";
    }

    // 3. Generic fallback
    const shortMessage =
      message.length > 120 ? `${message.slice(0, 117)}...` : message;
    return `Explanation failed: ${shortMessage}. Check your API key and network.`;
  }

  private getStatusCode(error: unknown): number | undefined {
    if (error == null || typeof error !== "object") return undefined;
    const o = error as Record<string, unknown>;
    if (typeof o.status === "number") return o.status;
    const res = o.response as Record<string, unknown> | undefined;
    if (res != null && typeof res.status === "number") return res.status;
    return undefined;
  }

  /**
   * Builds a prompt for the AI. When detailLevel is "detailed", asks for an in-depth
   * explanation with step-by-step breakdown, edge cases, and file-structure context.
   */
  private buildPrompt(
    code: string,
    lang: string,
    context?: string,
    options?: {
      detailLevel?: "brief" | "detailed";
      fileStructure?: string;
    }
  ): string {
    const contextBlock = context
      ? `\n\nSurrounding context (for reference only):\n\`\`\`\n${context}\n\`\`\``
      : "";
    const fileStructureBlock =
      options?.fileStructure?.trim() && options.detailLevel === "detailed"
        ? `\n\nFile structure (outline of top-level declarations in this file):\n\`\`\`\n${options.fileStructure.trim()}\n\`\`\``
        : "";

    if (options?.detailLevel === "detailed") {
      return `Explain the following ${lang} code in detail for a developer who wants to understand it deeply.

Your explanation should include:
- **What**: Clear description of what the code does (2–3 sentences)
- **Why**: Purpose and rationale; why it might be written this way
- **Step-by-step**: How the code achieves its goal (key steps or control flow)
- **Patterns & techniques**: Notable patterns, conventions, or language features used
- **Edge cases / caveats**: Any gotchas, assumptions, or things to watch for
- **Context**: How this fits with the surrounding code or file structure (use the file outline if provided)

Be thorough but organized. Use short paragraphs or bullet points. Do not repeat the code verbatim.

\`\`\`${lang}
${code}
\`\`\`${contextBlock}${fileStructureBlock}`;
    }

    return `Explain the following ${lang} code concisely.

Your explanation should:
- What: Describe what the code does in 1-2 sentences
- Why: Explain why it might exist or its purpose
- Patterns: Note any notable patterns or techniques used

Keep your explanation brief but insightful. Do not repeat the code back.

\`\`\`${lang}
${code}
\`\`\`${contextBlock}`;
  }

  private async callOpenAI(
    prompt: string,
    model: string,
    apiKey: string,
    signal?: AbortSignal
  ): Promise<string> {
    const client = new OpenAI({ apiKey });
    const completion = await client.chat.completions.create(
      {
        model,
        messages: [{ role: "user", content: prompt }],
      },
      { signal: signal ?? undefined }
    );
    const content = completion.choices[0]?.message?.content;
    if (content == null || content === "") {
      throw new Error("No explanation was returned from the provider.");
    }
    return content.trim();
  }

  private async callAnthropic(
    prompt: string,
    model: string,
    apiKey: string,
    apiBase: string,
    signal?: AbortSignal
  ): Promise<string> {
    const client = new Anthropic({
      apiKey,
      ...(apiBase ? { baseURL: apiBase } : {}),
    });
    const message = await client.messages.create(
      {
        model,
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      },
      { signal: signal ?? undefined }
    );
    for (const block of message.content) {
      if (
        block.type === "text" &&
        "text" in block &&
        typeof block.text === "string"
      ) {
        return block.text.trim();
      }
    }
    throw new Error("No explanation was returned from the provider.");
  }

  private async callOllama(
    prompt: string,
    model: string,
    endpoint: string,
    signal?: AbortSignal
  ): Promise<string> {
    const base = endpoint.replace(/\/$/, "");
    const url = `${base}/api/generate`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt, stream: false }),
      signal: signal ?? undefined,
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Ollama ${res.status}: ${body || res.statusText}`);
    }
    const data = (await res.json()) as { response?: string };
    const response = data.response;
    if (response == null || response === "") {
      throw new Error("No explanation was returned from the provider.");
    }
    return response.trim();
  }
}

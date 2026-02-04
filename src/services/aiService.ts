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
   * Returns a user-friendly error message on failure instead of throwing.
   */
  async explain(code: string, lang: string, context?: string): Promise<string> {
    const cfg = this.getConfig();

    if (
      (cfg.provider === "openai" || cfg.provider === "anthropic") &&
      !cfg.apiKey
    ) {
      const apiKeyHint = cfg.apiBase
        ? "Please set `codelensAI.apiKey` and verify `codelensAI.apiBase` in settings for the selected provider."
        : "Please set `codelensAI.apiKey` in settings for the selected provider.";
      return apiKeyHint;
    }

    const prompt = this.buildPrompt(code, lang, context);

    try {
      switch (cfg.provider) {
        case "openai":
          return await this.callOpenAI(prompt, cfg.model, cfg.apiKey);
        case "anthropic":
          return await this.callAnthropic(
            prompt,
            cfg.model,
            cfg.apiKey,
            cfg.apiBase,
          );
        case "ollama":
          return await this.callOllama(prompt, cfg.model, cfg.ollamaEndpoint);
        default:
          return `Unknown provider: ${cfg.provider}. Use openai, anthropic, or ollama.`;
      }
    } catch (err) {
      const hasApiBase =
        cfg.provider === "anthropic" && Boolean(cfg.apiBase?.trim());
      const message = this.analyzeError(err, hasApiBase);
      console.error("[CodeLens AI]", err);
      return message;
    }
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
        msgLower,
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
        msgLower,
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
   * Builds a prompt that asks for what/why/patterns, concise, without repeating the code.
   */
  private buildPrompt(code: string, lang: string, context?: string): string {
    const contextBlock = context
      ? `\n\nSurrounding context (for reference only):\n\`\`\`\n${context}\n\`\`\``
      : "";
    return `You explain code to complete beginners who are just learning to program. Your style is:
- Super simple words (explain like they're 12)
- Short (2-3 sentences max)
- Friendly and slightly playful
- No jargon, no technical terms without explanation

Format: Just a casual explanation. No bullet points, no numbered lists, no headers.

Example input: \`const sum = (a, b) => a + b;\`
Example output: This creates a little helper called "sum" that adds two numbers together. Give it 2 and 3, it gives you back 5. Pretty handy when you're too lazy to do math yourself.

Now explain this ${lang} code:
\`\`\`
${code}
\`\`\`${contextBlock}`;
  }

  private async callOpenAI(
    prompt: string,
    model: string,
    apiKey: string,
  ): Promise<string> {
    const client = new OpenAI({ apiKey });
    const completion = await client.chat.completions.create({
      model,
      messages: [{ role: "user", content: prompt }],
    });
    const content = completion.choices[0]?.message?.content;
    if (content == null || content === "") {
      return "No explanation was returned from the provider.";
    }
    return content.trim();
  }

  private async callAnthropic(
    prompt: string,
    model: string,
    apiKey: string,
    apiBase: string,
  ): Promise<string> {
    const client = new Anthropic({
      apiKey,
      ...(apiBase ? { baseURL: apiBase } : {}),
    });
    const message = await client.messages.create({
      model,
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });
    for (const block of message.content) {
      if (
        block.type === "text" &&
        "text" in block &&
        typeof block.text === "string"
      ) {
        return block.text.trim();
      }
    }
    return "No explanation was returned from the provider.";
  }

  private async callOllama(
    prompt: string,
    model: string,
    endpoint: string,
  ): Promise<string> {
    const base = endpoint.replace(/\/$/, "");
    const url = `${base}/api/generate`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt, stream: false }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Ollama ${res.status}: ${body || res.statusText}`);
    }
    const data = (await res.json()) as { response?: string };
    const response = data.response;
    if (response == null || response === "") {
      return "No explanation was returned from Ollama.";
    }
    return response.trim();
  }
}

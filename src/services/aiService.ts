import * as vscode from "vscode";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

export interface AIConfig {
  provider: "openai" | "anthropic" | "ollama";
  apiKey: string;
  model: string;
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
      return "Please set `codelensAI.apiKey` in settings for the selected provider.";
    }

    const prompt = this.buildPrompt(code, lang, context);

    try {
      switch (cfg.provider) {
        case "openai":
          return await this.callOpenAI(prompt, cfg.model, cfg.apiKey);
        case "anthropic":
          return await this.callAnthropic(prompt, cfg.model, cfg.apiKey);
        case "ollama":
          return await this.callOllama(prompt, cfg.model, cfg.ollamaEndpoint);
        default:
          return `Unknown provider: ${cfg.provider}. Use openai, anthropic, or ollama.`;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[CodeLens AI]", err);
      return `Explanation failed: ${message}. Check your API key and network.`;
    }
  }

  /**
   * Builds a prompt that asks for what/why/patterns, concise, without repeating the code.
   */
  private buildPrompt(code: string, lang: string, context?: string): string {
    const contextBlock = context
      ? `\n\nSurrounding context (for reference only):\n\`\`\`\n${context}\n\`\`\``
      : "";
    return `You are a concise code explainer. For the following ${lang} code, respond with:
1. What it does (1–2 sentences).
2. Why it might exist or its purpose.
3. Any notable patterns or techniques.

Keep the explanation brief and insightful. Do not repeat the code.

Code to explain:
\`\`\`${lang}
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
  ): Promise<string> {
    const client = new Anthropic({ apiKey });
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

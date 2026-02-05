import { describe, it, expect, vi, beforeEach } from "vitest";
import { AIService } from "./aiService";

const mockGet = vi.fn();

vi.mock("vscode", () => ({
  workspace: {
    getConfiguration: () => ({
      get: (key: string) => mockGet(key),
    }),
  },
}));

/** Error to reject from mocked OpenAI create(); set per test. */
let openAIRejectError: unknown = null;

vi.mock("openai", () => ({
  default: class MockOpenAI {
    chat = {
      completions: {
        create: vi.fn().mockImplementation(() =>
          openAIRejectError !== null
            ? Promise.reject(openAIRejectError)
            : Promise.resolve({
                choices: [{ message: { content: "Explanation" } }],
              })
        ),
      },
    };
  },
}));

/** Default config for tests that need a valid provider. */
function setOpenAIConfig(overrides: Record<string, unknown> = {}) {
  mockGet.mockImplementation((key: string) => {
    const config: Record<string, unknown> = {
      provider: "openai",
      apiKey: "test-key",
      model: "gpt-4o-mini",
      apiBase: "",
      ollamaEndpoint: "http://localhost:11434",
      ...overrides,
    };
    return config[key];
  });
}

describe("AIService — error scenarios", () => {
  beforeEach(() => {
    openAIRejectError = null;
    setOpenAIConfig();
  });

  it("missing API key throws with hint message", async () => {
    mockGet.mockImplementation((key: string) => {
      if (key === "apiKey") return "";
      if (key === "provider") return "openai";
      if (key === "apiBase") return "";
      return key === "model" ? "gpt-4o-mini" : undefined;
    });
    const service = new AIService();
    await expect(service.explain("const x = 1;", "typescript")).rejects.toThrow(
      /codelensAI\.apiKey/
    );
  });

  it("unknown provider throws with clear message", async () => {
    mockGet.mockImplementation((key: string) => {
      if (key === "provider") return "unknown";
      if (key === "apiKey") return "key";
      return key === "model" ? "gpt-4o-mini" : undefined;
    });
    const service = new AIService();
    await expect(service.explain("const x = 1;", "typescript")).rejects.toThrow(
      /Unknown provider.*openai, anthropic, or ollama/
    );
  });

  it("network error throws with user-friendly message", async () => {
    openAIRejectError = new Error("fetch failed");
    const service = new AIService();
    await expect(service.explain("const x = 1;", "typescript")).rejects.toThrow(
      /Could not reach|network|API/i
    );
  });

  it("timeout error throws with timeout message", async () => {
    openAIRejectError = new Error("The request timed out");
    const service = new AIService();
    await expect(service.explain("const x = 1;", "typescript")).rejects.toThrow(
      /timed out|try again/i
    );
  });

  it("429 rate limit throws with rate limit message", async () => {
    const err = new Error("Rate limit exceeded") as Error & { status?: number };
    err.status = 429;
    openAIRejectError = err;
    const service = new AIService();
    await expect(service.explain("const x = 1;", "typescript")).rejects.toThrow(
      /Rate limit|wait|try again/i
    );
  });

  it("401/403 throws with auth message", async () => {
    const err = new Error("Unauthorized") as Error & { status?: number };
    err.status = 401;
    openAIRejectError = err;
    const service = new AIService();
    await expect(service.explain("const x = 1;", "typescript")).rejects.toThrow(
      /API key|Authentication|401|403/i
    );
  });

  it("abort/cancel returns cancellation message (no throw)", async () => {
    const abortErr = new Error("Aborted");
    abortErr.name = "AbortError";
    openAIRejectError = abortErr;
    const service = new AIService();
    const result = await service.explain("const x = 1;", "typescript");
    expect(result).toBe("Request was cancelled.");
  });
});

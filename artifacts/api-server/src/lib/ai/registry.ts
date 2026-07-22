import { AiProviderError } from "./errors.js";
import { readAiRuntimeConfig, type AiRuntimeConfig } from "./config.js";
import { GeminiAiProvider } from "./gemini-provider.js";
import { MockAiProvider } from "./mock-provider.js";
import type { AiProvider } from "./provider.js";

export function createAiProvider(config: AiRuntimeConfig = readAiRuntimeConfig()): AiProvider {
  if (!config.enabled) {
    throw new AiProviderError({
      code: "AI_DISABLED",
      status: 503,
      message: "AI ozelligi devre disi",
    });
  }
  if (config.providerConfigured !== config.provider) {
    throw new AiProviderError({
      code: "AI_NOT_CONFIGURED",
      status: 503,
      message: "AI provider yapilandirmasi gecersiz",
    });
  }
  if (config.provider === "mock") {
    if (!config.allowMockProvider) {
      throw new AiProviderError({
        code: "AI_NOT_CONFIGURED",
        status: 503,
        message: "Mock AI provider production icin etkin degil",
      });
    }
    return new MockAiProvider(config.mockMode);
  }
  if (config.provider === "gemini") {
    return new GeminiAiProvider(config.gemini);
  }
  throw new AiProviderError({
    code: "AI_NOT_CONFIGURED",
    status: 503,
    message: "AI provider yapilandirmasi gecersiz",
  });
}

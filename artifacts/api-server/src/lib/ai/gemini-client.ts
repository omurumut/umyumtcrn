import { GoogleGenAI } from "@google/genai";
import type { GeminiRuntimeConfig } from "./config.js";

export type GeminiClientUsageMetadata = {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  cachedContentTokenCount?: number;
  totalTokenCount?: number;
};

export type GeminiStructuredRequest = {
  model: string;
  systemInstruction: string;
  contents: string;
  responseJsonSchema: unknown;
  maxOutputTokens: number;
  temperature: number;
  signal?: AbortSignal;
};

export type GeminiTextRequest = {
  model: string;
  contents: string;
  temperature: number;
  signal?: AbortSignal;
};

export type GeminiStructuredResponse = {
  text: string | null;
  responseId: string | null;
  usageMetadata: GeminiClientUsageMetadata | null;
};

export interface GeminiClientAdapter {
  generateStructuredContent(request: GeminiStructuredRequest): Promise<GeminiStructuredResponse>;
}

export class GoogleGenAiClientAdapter implements GeminiClientAdapter {
  private readonly client: GoogleGenAI;

  constructor(config: GeminiRuntimeConfig) {
    this.client = new GoogleGenAI({
      apiKey: config.apiKey ?? undefined,
      ...(config.apiVersion ? { httpOptions: { apiVersion: config.apiVersion } } : {}),
    });
  }

  async generateStructuredContent(request: GeminiStructuredRequest): Promise<GeminiStructuredResponse> {
    const response = await this.client.models.generateContent({
      model: request.model,
      contents: request.contents,
      config: {
        systemInstruction: request.systemInstruction,
        responseMimeType: "application/json",
        responseJsonSchema: request.responseJsonSchema,
        maxOutputTokens: request.maxOutputTokens,
        temperature: request.temperature,
        candidateCount: 1,
        abortSignal: request.signal,
      },
    });
    return {
      text: response.text ?? null,
      responseId: response.responseId ?? null,
      usageMetadata: response.usageMetadata ?? null,
    };
  }

  async generateTextContent(request: GeminiTextRequest): Promise<GeminiStructuredResponse> {
    const response = await this.client.models.generateContent({
      model: request.model,
      contents: request.contents,
      config: {
        temperature: request.temperature,
        maxOutputTokens: 64,
        abortSignal: request.signal,
      },
    });
    return {
      text: response.text ?? null,
      responseId: response.responseId ?? null,
      usageMetadata: response.usageMetadata ?? null,
    };
  }
}

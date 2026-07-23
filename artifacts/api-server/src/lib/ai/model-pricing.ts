import type { AiProviderUsage } from "./provider.js";

export const AI_MODEL_PRICING_CATALOG_VERSION = "gemini-pricing-2026-07-23";

type PriceEntry = {
  provider: "gemini";
  model: string;
  aliases: string[];
  currency: "USD";
  inputPerMillionTokens: string;
  cachedInputPerMillionTokens: string | null;
  outputPerMillionTokens: string;
  thinkingPerMillionTokens: string | null;
};

type CostEstimate = {
  estimatedCost: string | null;
  currency: string | null;
  costCalculationVersion: string | null;
  pricingCatalogVersion: string | null;
};

const NON_BILLABLE_COST: CostEstimate = {
  estimatedCost: "0.000000",
  currency: "USD",
  costCalculationVersion: "non-billable-provider-v1",
  pricingCatalogVersion: "non-billable-provider-v1",
};

const GEMINI_PRICES: PriceEntry[] = [
  {
    provider: "gemini",
    model: "gemini-2.5-flash",
    aliases: ["gemini-2.5-flash-latest"],
    currency: "USD",
    inputPerMillionTokens: "0.300000",
    cachedInputPerMillionTokens: "0.030000",
    outputPerMillionTokens: "2.500000",
    thinkingPerMillionTokens: "2.500000",
  },
  {
    provider: "gemini",
    model: "gemini-2.5-flash-lite",
    aliases: ["gemini-2.5-flash-lite-latest"],
    currency: "USD",
    inputPerMillionTokens: "0.100000",
    cachedInputPerMillionTokens: "0.010000",
    outputPerMillionTokens: "0.400000",
    thinkingPerMillionTokens: "0.400000",
  },
];

export function estimateModelUsageCost(provider: string, model: string, usage: AiProviderUsage): CostEstimate {
  if (provider === "mock" || provider === "rule_based") return NON_BILLABLE_COST;
  if (provider !== "gemini") return unknownCost();
  const price = GEMINI_PRICES.find((entry) => entry.model === model || entry.aliases.includes(model));
  if (!price) return unknownCost();

  const parts = [
    estimateTokenPart(usage.inputTokens, price.inputPerMillionTokens),
    estimateTokenPart(usage.cachedTokens, price.cachedInputPerMillionTokens),
    estimateTokenPart(usage.outputTokens, price.outputPerMillionTokens),
    estimateTokenPart(usage.thinkingTokens, price.thinkingPerMillionTokens),
  ];
  if (parts.some((part) => part === null)) return unknownCost();
  const total = (parts as bigint[]).reduce((sum, part) => sum + part, 0n);
  return {
    estimatedCost: formatMicroUsd(total),
    currency: price.currency,
    costCalculationVersion: AI_MODEL_PRICING_CATALOG_VERSION,
    pricingCatalogVersion: AI_MODEL_PRICING_CATALOG_VERSION,
  };
}

function unknownCost(): CostEstimate {
  return { estimatedCost: null, currency: null, costCalculationVersion: null, pricingCatalogVersion: null };
}

function estimateTokenPart(tokens: number | null, perMillionTokens: string | null) {
  if (tokens === null) return 0n;
  if (!Number.isSafeInteger(tokens) || tokens < 0 || perMillionTokens === null) return null;
  return (BigInt(tokens) * parseUsdToMicrousd(perMillionTokens)) / 1_000_000n;
}

function parseUsdToMicrousd(value: string) {
  const [whole = "0", fraction = ""] = value.split(".");
  const normalized = `${fraction}000000`.slice(0, 6);
  return BigInt(whole) * 1_000_000n + BigInt(normalized);
}

function formatMicroUsd(value: bigint) {
  const whole = value / 1_000_000n;
  const fraction = (value % 1_000_000n).toString().padStart(6, "0");
  return `${whole}.${fraction}`;
}

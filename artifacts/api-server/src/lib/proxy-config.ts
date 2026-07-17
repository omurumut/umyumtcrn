import type { Express } from "express";

export type TrustProxyMode = "none" | "loopback" | "hops";

export type TrustProxyConfig = {
  mode: TrustProxyMode;
  hops?: number;
  expressValue: false | "loopback" | number;
};

const MAX_TRUST_PROXY_HOPS = 3;

function production(): boolean {
  return process.env.NODE_ENV === "production";
}

function failOrDefault(message: string): TrustProxyConfig {
  if (production()) throw new Error(message);
  return { mode: "none", expressValue: false };
}

function parsePositiveInteger(value: string | undefined): number | null {
  if (value === undefined || !/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function resolveTrustProxyConfig(env: NodeJS.ProcessEnv = process.env): TrustProxyConfig {
  const mode = env.TRUST_PROXY_MODE ?? "none";

  if (mode === "none") return { mode: "none", expressValue: false };
  if (mode === "loopback") return { mode: "loopback", expressValue: "loopback" };
  if (mode === "hops") {
    const hops = parsePositiveInteger(env.TRUST_PROXY_HOPS);
    if (hops === null || hops < 1 || hops > MAX_TRUST_PROXY_HOPS) {
      return failOrDefault("TRUST_PROXY_HOPS must be a positive integer between 1 and 3.");
    }
    return { mode: "hops", hops, expressValue: hops };
  }

  return failOrDefault("TRUST_PROXY_MODE must be one of: none, loopback, hops.");
}

export function applyTrustProxy(app: Express): TrustProxyConfig {
  const config = resolveTrustProxyConfig();
  app.set("trust proxy", config.expressValue);
  return config;
}


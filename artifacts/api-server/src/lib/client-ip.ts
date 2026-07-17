import { isIP } from "node:net";
import type { Request } from "express";

export const UNKNOWN_CLIENT_IP = "unknown";

export function normalizeIpAddress(value: unknown): string {
  if (typeof value !== "string") return UNKNOWN_CLIENT_IP;
  let candidate = value.trim();
  if (!candidate) return UNKNOWN_CLIENT_IP;

  if (candidate.startsWith("[") && candidate.endsWith("]")) {
    candidate = candidate.slice(1, -1);
  }
  if (candidate.toLowerCase().startsWith("::ffff:")) {
    const mapped = candidate.slice(7);
    if (isIP(mapped) === 4) return mapped;
  }

  return isIP(candidate) ? candidate.toLowerCase() : UNKNOWN_CLIENT_IP;
}

export function resolveClientIp(req: Request): string {
  return normalizeIpAddress(req.ip);
}


import type { RequestHandler } from "express";

const ALLOWED_METHODS = ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"] as const;
const ALLOWED_HEADERS = ["authorization", "content-type"] as const;
const EXPOSED_HEADERS = "Content-Disposition, Retry-After";
const DEVELOPMENT_ORIGINS = new Set([
  "http://localhost:5000",
  "http://127.0.0.1:5000",
]);

const PRODUCTION_CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "form-action 'self'",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
].join("; ");

function parseProductionOrigins(rawValue: string | undefined): Set<string> {
  if (rawValue === undefined || rawValue.trim() === "") return new Set();

  const origins = new Set<string>();
  for (const rawEntry of rawValue.split(",")) {
    const entry = rawEntry.trim();
    if (!entry || entry === "*") {
      throw new Error("CORS_ALLOWED_ORIGINS contains an invalid origin.");
    }

    let url: URL;
    try {
      url = new URL(entry);
    } catch {
      throw new Error("CORS_ALLOWED_ORIGINS contains an invalid origin.");
    }
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username !== "" ||
      url.password !== "" ||
      url.pathname !== "/" ||
      url.search !== "" ||
      url.hash !== "" ||
      url.origin !== entry
    ) {
      throw new Error("CORS_ALLOWED_ORIGINS contains an invalid origin.");
    }
    origins.add(url.origin);
  }
  return origins;
}

export function allowedCorsOrigins(): ReadonlySet<string> {
  if (process.env.NODE_ENV === "production") {
    return parseProductionOrigins(process.env.CORS_ALLOWED_ORIGINS);
  }

  const origins = new Set(DEVELOPMENT_ORIGINS);
  const testOrigin = process.env.TEST_CORS_ALLOWED_ORIGIN;
  if (
    process.env.NODE_ENV === "test" &&
    process.env.TEST_DB_DISPOSABLE === "true" &&
    testOrigin
  ) {
    const url = new URL(testOrigin);
    if (
      url.protocol !== "http:" ||
      url.hostname !== "127.0.0.1" ||
      url.pathname !== "/" ||
      url.search !== "" ||
      url.hash !== "" ||
      url.origin !== testOrigin ||
      url.port === ""
    ) {
      throw new Error("TEST_CORS_ALLOWED_ORIGIN is invalid.");
    }
    origins.add(testOrigin);
  }
  return origins;
}

export const securityHeaders: RequestHandler = (_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  );

  if (process.env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    res.setHeader("Content-Security-Policy", PRODUCTION_CSP);
  }
  next();
};

function isSameHostOrigin(origin: string, requestHost: string | undefined): boolean {
  if (!requestHost) return false;
  try {
    const url = new URL(origin);
    return (url.protocol === "http:" || url.protocol === "https:") && url.host === requestHost;
  } catch {
    return false;
  }
}

export function createCorsMiddleware(origins = allowedCorsOrigins()): RequestHandler {
  const allowedMethods = new Set<string>(ALLOWED_METHODS);
  const allowedHeaders = new Set<string>(ALLOWED_HEADERS);

  return (req, res, next) => {
    const origin = req.get("Origin");
    if (!origin) {
      next();
      return;
    }
    if (!origins.has(origin) && !isSameHostOrigin(origin, req.get("Host"))) {
      res.status(403).json({ error: "Origin izinli değil" });
      return;
    }

    res.vary("Origin");
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Expose-Headers", EXPOSED_HEADERS);

    if (req.method !== "OPTIONS") {
      next();
      return;
    }

    const requestedMethod = req.get("Access-Control-Request-Method")?.toUpperCase();
    const requestedHeaders = (req.get("Access-Control-Request-Headers") ?? "")
      .split(",")
      .map((header) => header.trim().toLowerCase())
      .filter(Boolean);
    if (
      !requestedMethod ||
      !allowedMethods.has(requestedMethod) ||
      requestedHeaders.some((header) => !allowedHeaders.has(header))
    ) {
      res.removeHeader("Access-Control-Allow-Origin");
      res.removeHeader("Access-Control-Expose-Headers");
      res.status(403).json({ error: "CORS preflight izinli değil" });
      return;
    }

    res.setHeader("Access-Control-Allow-Methods", ALLOWED_METHODS.join(", "));
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Max-Age", "600");
    res.status(204).send();
  };
}

import type { NextFunction, Request, Response } from "express";
import { decActiveHttpRequest, incActiveHttpRequest, observeHttpRequest } from "../lib/metrics.js";

function normalizedRoute(req: Request): string {
  const route = req.route as { path?: unknown } | undefined;
  const routePath = typeof route?.path === "string" ? route.path : null;
  if (!routePath) return "unknown";
  return `${req.baseUrl || ""}${routePath}` || "unknown";
}

export function httpMetricsMiddleware(req: Request, res: Response, next: NextFunction) {
  const start = process.hrtime.bigint();
  let completed = false;
  incActiveHttpRequest();

  const complete = () => {
    if (completed) return;
    completed = true;
    decActiveHttpRequest();
    const durationSeconds = Number(process.hrtime.bigint() - start) / 1_000_000_000;
    observeHttpRequest({
      method: req.method,
      route: normalizedRoute(req),
      statusCode: res.statusCode,
      durationSeconds,
    });
  };

  res.once("finish", complete);
  res.once("close", complete);
  next();
}

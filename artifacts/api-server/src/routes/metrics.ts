import { timingSafeEqual } from "node:crypto";
import { Router, type IRouter } from "express";
import { metrics } from "../lib/metrics.js";

const router: IRouter = Router();

function metricsEnabled(): boolean {
  return process.env.ENABLE_METRICS_ENDPOINT === "true" && typeof process.env.METRICS_ACCESS_TOKEN === "string" && process.env.METRICS_ACCESS_TOKEN.length >= 16;
}

function bearerToken(header: unknown): string | null {
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return null;
  const token = header.slice(7);
  return token.length > 0 ? token : null;
}

function tokenMatches(candidate: string, expected: string): boolean {
  const left = Buffer.from(candidate, "utf8");
  const right = Buffer.from(expected, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

router.get("/metrics", async (req, res) => {
  if (!metricsEnabled()) {
    res.status(404).json({ error: "Endpoint bulunamadı" });
    return;
  }

  const token = bearerToken(req.headers.authorization);
  if (!token) {
    res.status(401).json({ error: "Metrics erişimi için token gerekli" });
    return;
  }
  if (!tokenMatches(token, process.env.METRICS_ACCESS_TOKEN!)) {
    res.status(403).json({ error: "Metrics erişimi reddedildi" });
    return;
  }

  res.type(metrics.registry.contentType);
  res.send(await metrics.registry.metrics());
});

export default router;

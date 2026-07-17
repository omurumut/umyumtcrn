import type { Request, Response, NextFunction } from "express";
import {
  authenticateSessionToken,
  runAuthStoreOperation,
  type AuthenticatedSessionUser,
} from "../lib/auth-session-store.js";
import { observeAuthEvent } from "../lib/metrics.js";

export type SessionUser = AuthenticatedSessionUser;

declare global {
  namespace Express {
    interface Request {
      user?: SessionUser | null;
    }
  }
}

export function getBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;

  const token = header.slice(7);
  return token.length > 0 ? token : null;
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  if (req.path === "/api/metrics") {
    req.user = null;
    next();
    return;
  }

  const token = getBearerToken(req);
  if (!token) {
    req.user = null;
    next();
    return;
  }

  try {
    req.user = await runAuthStoreOperation(authenticateSessionToken(token));
    if (!req.user) observeAuthEvent("session_validation_failure", "invalid_or_expired");
    next();
  } catch (error) {
    req.user = null;
    observeAuthEvent("session_store_unavailable", "store_unavailable");
    req.log.error(error);
    res.status(503).json({ error: "Kimlik doğrulama hizmeti geçici olarak kullanılamıyor" });
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: "Giriş yapmalısınız" });
    return;
  }
  next();
}

// Tenant-level company administration.
export function requireCompanyAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: "Giriş yapmalısınız" });
    return;
  }
  if (req.user.role !== "admin" && req.user.role !== "kontrol_admin" && req.user.role !== "superadmin") {
    res.status(403).json({ error: "Bu işlem için yetkiniz yok" });
    return;
  }
  next();
}

// Platform administration.
export function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user || req.user.role !== "superadmin") {
    res.status(403).json({ error: "Bu işlem için sistem yöneticisi yetkisi gereklidir" });
    return;
  }
  next();
}

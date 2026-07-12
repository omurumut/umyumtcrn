import type { Request, Response, NextFunction } from "express";

export interface SessionUser {
  userId: number;
  username: string;
  name: string;
  role: string;
  unitId: number | null;
  companyId: number;
}

declare global {
  namespace Express {
    interface Request {
      user?: SessionUser | null;
    }
  }
}

export const sessions = new Map<string, SessionUser>();

export function authMiddleware(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (header && header.startsWith("Bearer ")) {
    const token = header.slice(7);
    const user = sessions.get(token);
    req.user = user ?? null;
  } else {
    req.user = null;
  }
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: "Giriş yapmalısınız" });
    return;
  }
  next();
}

// Legacy/ambiguous guard: admin + superadmin.
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user || (req.user.role !== "admin" && req.user.role !== "superadmin")) {
    res.status(403).json({ error: "Bu işlem için yetkiniz yok" });
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

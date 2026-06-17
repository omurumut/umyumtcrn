import type { Request, Response, NextFunction } from "express";

export interface SessionUser {
  userId: number;
  username: string;
  name: string;
  role: string;
  unitId: number | null;
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

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user || req.user.role !== "admin") {
    res.status(403).json({ error: "Bu işlem için yetkiniz yok" });
    return;
  }
  next();
}

import type { Request, Response, NextFunction } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

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

function getBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;

  const token = header.slice(7);
  return token.length > 0 ? token : null;
}

function parseSessionUserId(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

function destroyRequestSession(req: Request, token: string | null) {
  if (token) sessions.delete(token);
  req.user = null;
}

function sessionUserChanged(current: SessionUser, next: SessionUser) {
  return current.userId !== next.userId
    || current.username !== next.username
    || current.name !== next.name
    || current.role !== next.role
    || current.unitId !== next.unitId
    || current.companyId !== next.companyId;
}

export function authMiddleware(req: Request, _res: Response, next: NextFunction) {
  const token = getBearerToken(req);
  if (token) {
    const user = sessions.get(token);
    req.user = user ?? null;
  } else {
    req.user = null;
  }
  next();
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = getBearerToken(req);
  const sessionUser = req.user;
  const userId = parseSessionUserId(sessionUser?.userId);

  if (!token || !sessionUser || userId === null) {
    destroyRequestSession(req, token);
    res.status(401).json({ error: "Giriş yapmalısınız" });
    return;
  }

  try {
    const [currentUser] = await db.select({
      id: usersTable.id,
      username: usersTable.username,
      name: usersTable.name,
      role: usersTable.role,
      unitId: usersTable.unitId,
      companyId: usersTable.companyId,
      active: usersTable.active,
    }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);

    if (!currentUser || !currentUser.active) {
      destroyRequestSession(req, token);
      res.status(401).json({ error: "Giriş yapmalısınız" });
      return;
    }

    const refreshedUser: SessionUser = {
      userId: currentUser.id,
      username: currentUser.username,
      name: currentUser.name,
      role: currentUser.role,
      unitId: currentUser.unitId,
      companyId: currentUser.companyId,
    };

    if (sessionUserChanged(sessionUser, refreshedUser)) {
      sessions.set(token, refreshedUser);
    }
    req.user = refreshedUser;
    next();
  } catch (err) {
    req.user = null;
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
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

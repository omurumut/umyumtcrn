import { Router } from "express";
import { createHash, randomUUID } from "crypto";
import { db } from "@workspace/db";
import { usersTable, unitsTable, companiesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { sessions, requireAuth } from "../middlewares/auth.js";
import { hashPassword, needsPasswordRehash, verifyPassword } from "../security/passwords.js";

const router = Router();

const COMPANY_ADMIN_ROLES = new Set(["user", "admin", "kontrol_admin"]);
const SUPERADMIN_ROLES = new Set([...COMPANY_ADMIN_ROLES, "superadmin"]);
const LOGIN_RATE_LIMIT_WINDOW_MS = readPositiveSafeIntegerEnv("LOGIN_RATE_LIMIT_WINDOW_MS", 15 * 60 * 1000);
const LOGIN_RATE_LIMIT_MAX_PER_IP = readPositiveSafeIntegerEnv("LOGIN_RATE_LIMIT_MAX_PER_IP", 20);
const LOGIN_RATE_LIMIT_MAX_PER_USERNAME = readPositiveSafeIntegerEnv("LOGIN_RATE_LIMIT_MAX_PER_USERNAME", 8);
const LOGIN_RATE_LIMIT_MAX_ENTRIES = 10_000;
const LOGIN_RATE_LIMIT_EVICTION_COUNT = 1_000;

type LoginAttempt = {
  count: number;
  windowStartedAt: number;
  expiresAt: number;
};

const loginAttemptsByIp = new Map<string, LoginAttempt>();
const loginAttemptsByUsername = new Map<string, LoginAttempt>();

function readPositiveSafeIntegerEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || !/^[1-9]\d*$/.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : fallback;
}

function getLoginUsernameKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) return null;
  return `username:${createHash("sha256").update(normalized).digest("base64url")}`;
}

function cleanupExpiredLoginAttempts(attempts: Map<string, LoginAttempt>, now: number): void {
  for (const [key, attempt] of attempts) {
    if (attempt.expiresAt <= now) attempts.delete(key);
  }
}

function ensureLoginAttemptCapacity(attempts: Map<string, LoginAttempt>, now: number): void {
  if (attempts.size < LOGIN_RATE_LIMIT_MAX_ENTRIES) return;
  cleanupExpiredLoginAttempts(attempts, now);
  if (attempts.size < LOGIN_RATE_LIMIT_MAX_ENTRIES) return;

  let deleted = 0;
  for (const key of attempts.keys()) {
    attempts.delete(key);
    deleted += 1;
    if (deleted >= LOGIN_RATE_LIMIT_EVICTION_COUNT) break;
  }
}

function checkLoginRateLimit(
  attempts: Map<string, LoginAttempt>,
  key: string,
  maxAttempts: number,
  now: number,
): number | null {
  const attempt = attempts.get(key);
  if (!attempt) return null;
  if (attempt.expiresAt <= now) {
    attempts.delete(key);
    return null;
  }
  if (attempt.count < maxAttempts) return null;
  return Math.max(1, Math.ceil((attempt.expiresAt - now) / 1000));
}

function registerFailedLogin(
  attempts: Map<string, LoginAttempt>,
  key: string,
  now: number,
): void {
  const existing = attempts.get(key);
  if (existing && existing.expiresAt > now) {
    existing.count += 1;
    return;
  }

  if (existing) attempts.delete(key);
  ensureLoginAttemptCapacity(attempts, now);
  attempts.set(key, {
    count: 1,
    windowStartedAt: now,
    expiresAt: now + LOGIN_RATE_LIMIT_WINDOW_MS,
  });
}

function isCompanyAdmin(role: string) {
  return role === "admin" || role === "kontrol_admin";
}

function parsePositiveInteger(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^[1-9]\d*$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return undefined;
}

function hasInvalidPositiveInteger(value: unknown) {
  return value !== undefined && value !== null && parsePositiveInteger(value) === undefined;
}

function normalizeRequiredText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

async function companyExists(companyId: number) {
  const [company] = await db.select({ id: companiesTable.id })
    .from(companiesTable).where(eq(companiesTable.id, companyId));
  return !!company;
}

async function unitBelongsToCompany(unitId: number, companyId: number) {
  const [unit] = await db.select({ id: unitsTable.id })
    .from(unitsTable)
    .where(and(eq(unitsTable.id, unitId), eq(unitsTable.companyId, companyId)));
  return !!unit;
}

export class SuperAdminBootstrapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SuperAdminBootstrapError";
  }
}

export async function bootstrapSuperAdminIfEnabled() {
  if (process.env["ENABLE_SUPERADMIN_BOOTSTRAP"] !== "true") return;

  const username = process.env["BOOTSTRAP_SUPERADMIN_USERNAME"]?.trim();
  const password = process.env["BOOTSTRAP_SUPERADMIN_PASSWORD"];
  const displayName = process.env["BOOTSTRAP_SUPERADMIN_NAME"]?.trim() || "Sistem Yöneticisi";

  if (!username) {
    throw new SuperAdminBootstrapError(
      "Superadmin bootstrap yapılandırması geçersiz: BOOTSTRAP_SUPERADMIN_USERNAME zorunludur.",
    );
  }
  if (password === undefined || password.trim().length === 0) {
    throw new SuperAdminBootstrapError(
      "Superadmin bootstrap yapılandırması geçersiz: BOOTSTRAP_SUPERADMIN_PASSWORD zorunludur.",
    );
  }
  if (password.length < 12) {
    throw new SuperAdminBootstrapError(
      "Superadmin bootstrap yapılandırması geçersiz: bootstrap parolası en az 12 karakter olmalıdır.",
    );
  }

  const [existingSuperAdmin] = await db.select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.role, "superadmin"))
    .limit(1);
  if (existingSuperAdmin) {
    console.info("Superadmin bootstrap atlandı: sistemde superadmin mevcut.");
    return;
  }

  const [usernameOwner] = await db.select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.username, username))
    .limit(1);
  if (usernameOwner) {
    throw new SuperAdminBootstrapError("Bootstrap kullanıcı adı zaten kullanımda.");
  }

  const companyId = parsePositiveInteger(process.env["BOOTSTRAP_SUPERADMIN_COMPANY_ID"]);
  if (companyId === undefined) {
    throw new SuperAdminBootstrapError(
      "Superadmin bootstrap yapılandırması geçersiz: geçerli BOOTSTRAP_SUPERADMIN_COMPANY_ID zorunludur.",
    );
  }
  if (!await companyExists(companyId)) {
    throw new SuperAdminBootstrapError("Superadmin bootstrap şirketi bulunamadı.");
  }

  await db.insert(usersTable).values({
    companyId,
    username,
    passwordHash: await hashPassword(password),
    name: displayName,
    role: "superadmin",
    unitId: null,
    active: true,
  });
  console.info("İlk superadmin hesabı oluşturuldu. Bootstrap environment ayarlarını devre dışı bırakın.");
}

// POST /api/auth/login
router.post("/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body ?? {};
    const ipKey = `ip:${req.ip || "unknown"}`;
    const usernameKey = getLoginUsernameKey(username);
    const now = Date.now();
    const ipRetryAfter = checkLoginRateLimit(loginAttemptsByIp, ipKey, LOGIN_RATE_LIMIT_MAX_PER_IP, now);
    const usernameRetryAfter = usernameKey
      ? checkLoginRateLimit(loginAttemptsByUsername, usernameKey, LOGIN_RATE_LIMIT_MAX_PER_USERNAME, now)
      : null;
    const retryAfter = Math.max(ipRetryAfter ?? 0, usernameRetryAfter ?? 0);
    if (retryAfter > 0) {
      res.set("Retry-After", String(retryAfter));
      res.status(429).json({ error: "Çok fazla giriş denemesi yapıldı. Lütfen daha sonra tekrar deneyin." });
      return;
    }

    const registerFailedAttempt = () => {
      const failedAt = Date.now();
      registerFailedLogin(loginAttemptsByIp, ipKey, failedAt);
      if (usernameKey) registerFailedLogin(loginAttemptsByUsername, usernameKey, failedAt);
    };

    if (!username || typeof password !== "string" || password.length === 0) {
      registerFailedAttempt();
      res.status(400).json({ error: "Kullanıcı adı ve şifre gerekli" });
      return;
    }

    const [user] = await db.select().from(usersTable).where(eq(usersTable.username, username));
    if (!user || !user.active) {
      registerFailedAttempt();
      res.status(401).json({ error: "Kullanıcı adı veya şifre hatalı" });
      return;
    }

    if (!await verifyPassword(password, user.passwordHash)) {
      registerFailedAttempt();
      res.status(401).json({ error: "Kullanıcı adı veya şifre hatalı" });
      return;
    }

    const [company] = await db.select({ isActive: companiesTable.isActive })
      .from(companiesTable)
      .where(eq(companiesTable.id, user.companyId))
      .limit(1);
    if (!company || company.isActive !== true) {
      registerFailedAttempt();
      res.status(401).json({ error: "Kullanıcı adı veya şifre hatalı" });
      return;
    }

    if (needsPasswordRehash(user.passwordHash)) {
      try {
        const upgradedHash = await hashPassword(password);
        await db.update(usersTable)
          .set({ passwordHash: upgradedHash })
          .where(and(eq(usersTable.id, user.id), eq(usersTable.passwordHash, user.passwordHash)));
      } catch {
        req.log.warn("Legacy parola hash yükseltmesi başarısız oldu");
      }
    }

    if (usernameKey) loginAttemptsByUsername.delete(usernameKey);

    const token = randomUUID();
    sessions.set(token, {
      userId: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      unitId: user.unitId,
      companyId: user.companyId,
    });

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        unitId: user.unitId,
        companyId: user.companyId,
      },
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// GET /api/auth/me
router.get("/auth/me", requireAuth, async (req, res) => {
  res.json(req.user);
});

// POST /api/auth/logout
router.post("/auth/logout", (req, res) => {
  const header = req.headers.authorization;
  if (header && header.startsWith("Bearer ")) {
    sessions.delete(header.slice(7));
  }
  res.status(204).send();
});

// GET /api/users — admin: kendi firması; superadmin: tümü veya companyId filtresiyle
router.get("/users", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId } = req.user!;
    if (!isCompanyAdmin(role) && role !== "superadmin") {
      res.status(403).json({ error: "Yetki yok" });
      return;
    }

    if (hasInvalidPositiveInteger(req.query.companyId)) {
      res.status(400).json({ error: "Geçersiz companyId" }); return;
    }

    const base = db.select({
      id: usersTable.id,
      username: usersTable.username,
      name: usersTable.name,
      role: usersTable.role,
      unitId: usersTable.unitId,
      companyId: usersTable.companyId,
      active: usersTable.active,
      createdAt: usersTable.createdAt,
    }).from(usersTable);

    if (role === "superadmin") {
      const queryCompanyId = parsePositiveInteger(req.query.companyId);
      const users = queryCompanyId !== undefined
        ? await base.where(eq(usersTable.companyId, queryCompanyId)).orderBy(usersTable.name)
        : await base.orderBy(usersTable.name);
      res.json(users);
      return;
    }

    // admin: sadece kendi firması
    const users = await base.where(eq(usersTable.companyId, sessionCompanyId)).orderBy(usersTable.name);
    res.json(users);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// POST /api/users — admin: sadece kendi firmasına kullanıcı ekleyebilir
router.post("/users", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId } = req.user!;
    if (!isCompanyAdmin(role) && role !== "superadmin") {
      res.status(403).json({ error: "Yetki yok" });
      return;
    }

    const { username, password, name, role: newRole, unitId, companyId: bodyCompanyId } = req.body;
    const normalizedUsername = normalizeRequiredText(username);
    const normalizedName = normalizeRequiredText(name);
    if (normalizedUsername === undefined || typeof password !== "string" || password.length === 0 || normalizedName === undefined) {
      res.status(400).json({ error: "Zorunlu alanlar eksik" });
      return;
    }

    // admin kendi firmasına ekleyebilir; superadmin body'deki companyId'yi kullanır
    if (hasInvalidPositiveInteger(bodyCompanyId)) {
      res.status(400).json({ error: "Geçersiz companyId" }); return;
    }
    if (hasInvalidPositiveInteger(unitId)) {
      res.status(400).json({ error: "Geçersiz unitId" }); return;
    }

    const requestedCompanyId = parsePositiveInteger(bodyCompanyId);
    const targetCompanyId = role === "superadmin" ? (requestedCompanyId ?? sessionCompanyId) : sessionCompanyId;
    if (!await companyExists(targetCompanyId)) {
      res.status(400).json({ error: "Geçersiz companyId" }); return;
    }

    const targetRole = newRole ?? "user";
    const allowedRoles = role === "superadmin" ? SUPERADMIN_ROLES : COMPANY_ADMIN_ROLES;
    if (typeof targetRole !== "string" || !allowedRoles.has(targetRole)) {
      res.status(400).json({ error: "Geçersiz rol" }); return;
    }

    const targetUnitId = parsePositiveInteger(unitId) ?? null;
    if (targetUnitId !== null && !await unitBelongsToCompany(targetUnitId, targetCompanyId)) {
      res.status(400).json({ error: "Birim seçilen şirkete ait değil" }); return;
    }

    const [existing] = await db.select().from(usersTable).where(eq(usersTable.username, normalizedUsername));
    if (existing) {
      res.status(400).json({ error: "Bu kullanıcı adı zaten kullanılıyor" });
      return;
    }

    const [user] = await db.insert(usersTable).values({
      username: normalizedUsername,
      passwordHash: await hashPassword(password),
      name: normalizedName,
      role: targetRole,
      unitId: targetUnitId,
      companyId: targetCompanyId,
      active: true,
    }).returning();

    res.status(201).json({
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      unitId: user.unitId,
      companyId: user.companyId,
      active: user.active,
      createdAt: user.createdAt,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// PATCH /api/users/:id — admin: sadece kendi firmasındaki kullanıcıyı güncelleyebilir
router.patch("/users/:id", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId } = req.user!;
    if (!isCompanyAdmin(role) && role !== "superadmin") {
      res.status(403).json({ error: "Yetki yok" });
      return;
    }

    const id = parsePositiveInteger(req.params.id);
    if (id === undefined) {
      res.status(400).json({ error: "Geçersiz userId" }); return;
    }

    // Hedef kullanıcının firmasını kontrol et
    const targetConditions = [eq(usersTable.id, id)];
    if (role !== "superadmin") targetConditions.push(eq(usersTable.companyId, sessionCompanyId));
    const [target] = await db.select({ companyId: usersTable.companyId, unitId: usersTable.unitId, role: usersTable.role })
      .from(usersTable).where(and(...targetConditions));
    if (!target) {
      res.status(404).json({ error: "Kullanıcı bulunamadı" });
      return;
    }
    if (role !== "superadmin" && target.role === "superadmin") {
      res.status(403).json({ error: "Superadmin kullanıcısı düzenlenemez" }); return;
    }

    const { name, password, role: newRole, unitId, companyId: bodyCompanyId, active } = req.body;
    const normalizedName = name === undefined ? undefined : normalizeRequiredText(name);
    if (name !== undefined && normalizedName === undefined) {
      res.status(400).json({ error: "Ad boş olamaz" }); return;
    }
    if (password !== undefined && password !== null && typeof password !== "string") {
      res.status(400).json({ error: "Geçersiz parola" }); return;
    }
    if (hasInvalidPositiveInteger(bodyCompanyId)) {
      res.status(400).json({ error: "Geçersiz companyId" }); return;
    }
    if (hasInvalidPositiveInteger(unitId)) {
      res.status(400).json({ error: "Geçersiz unitId" }); return;
    }

    const requestedCompanyId = parsePositiveInteger(bodyCompanyId);
    const effectiveCompanyId = role === "superadmin" ? (requestedCompanyId ?? target.companyId) : sessionCompanyId;
    if (!await companyExists(effectiveCompanyId)) {
      res.status(400).json({ error: "Geçersiz companyId" }); return;
    }

    const allowedRoles = role === "superadmin" ? SUPERADMIN_ROLES : COMPANY_ADMIN_ROLES;
    if (newRole !== undefined && (typeof newRole !== "string" || !allowedRoles.has(newRole))) {
      res.status(400).json({ error: "Geçersiz rol" }); return;
    }

    const effectiveUnitId = unitId === undefined ? target.unitId : (parsePositiveInteger(unitId) ?? null);
    if (effectiveUnitId !== null && !await unitBelongsToCompany(effectiveUnitId, effectiveCompanyId)) {
      res.status(400).json({ error: "Birim seçilen şirkete ait değil" }); return;
    }

    const updates: Record<string, unknown> = {};
    if (normalizedName !== undefined) updates.name = normalizedName;
    if (password) updates.passwordHash = await hashPassword(password);
    if (newRole !== undefined) updates.role = newRole;
    if (unitId !== undefined) updates.unitId = effectiveUnitId;
    if (role === "superadmin" && requestedCompanyId !== undefined) updates.companyId = effectiveCompanyId;
    if (active !== undefined) updates.active = Boolean(active);

    const mutationConditions = [eq(usersTable.id, id)];
    if (role !== "superadmin") mutationConditions.push(eq(usersTable.companyId, sessionCompanyId));
    const [user] = await db.update(usersTable).set(updates).where(and(...mutationConditions)).returning();
    if (!user) {
      res.status(404).json({ error: "Kullanıcı bulunamadı" });
      return;
    }
    res.json({ id: user.id, username: user.username, name: user.name, role: user.role, unitId: user.unitId, companyId: user.companyId, active: user.active });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// DELETE /api/users/:id — admin: sadece kendi firmasındaki kullanıcıyı silebilir
router.delete("/users/:id", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId } = req.user!;
    if (!isCompanyAdmin(role) && role !== "superadmin") {
      res.status(403).json({ error: "Yetki yok" });
      return;
    }

    const id = parsePositiveInteger(req.params.id);
    if (id === undefined) {
      res.status(400).json({ error: "Geçersiz userId" }); return;
    }

    if (id === req.user!.userId) {
      res.status(400).json({ error: "Kendinizi silemezsiniz" });
      return;
    }

    // Hedef kullanıcının firmasını kontrol et
    const targetConditions = [eq(usersTable.id, id)];
    if (role !== "superadmin") targetConditions.push(eq(usersTable.companyId, sessionCompanyId));
    const [target] = await db.select({ companyId: usersTable.companyId, role: usersTable.role })
      .from(usersTable).where(and(...targetConditions));
    if (!target) {
      res.status(404).json({ error: "Kullanıcı bulunamadı" });
      return;
    }
    if (role !== "superadmin" && target.role === "superadmin") {
      res.status(403).json({ error: "Superadmin kullanıcısı silinemez" }); return;
    }

    const mutationConditions = [eq(usersTable.id, id)];
    if (role !== "superadmin") mutationConditions.push(eq(usersTable.companyId, sessionCompanyId));
    await db.delete(usersTable).where(and(...mutationConditions));
    res.status(204).send();
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

export default router;

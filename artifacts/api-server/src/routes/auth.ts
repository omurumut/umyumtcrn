import { Router } from "express";
import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "crypto";
import { db } from "@workspace/db";
import { usersTable, unitsTable, companiesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { sessions, requireAuth } from "../middlewares/auth.js";

const router = Router();

const COMPANY_ADMIN_ROLES = new Set(["user", "admin", "kontrol_admin"]);
const SUPERADMIN_ROLES = new Set([...COMPANY_ADMIN_ROLES, "superadmin"]);
const SCRYPT_VERSION = 1;
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_SALT_LENGTH = 16;
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_MAX_MEMORY = 64 * 1024 * 1024;

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

// Legacy SHA-256 compatibility only; never use this helper for new hashes.
function hashLegacyPassword(password: string): string {
  return createHash("sha256").update(password + "eys_salt_2024").digest("hex");
}

function deriveScryptKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, SCRYPT_KEY_LENGTH, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
      maxmem: SCRYPT_MAX_MEMORY,
    }, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

function decodeCanonicalBase64(value: string): Buffer | null {
  if (value.length === 0 || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  const decoded = Buffer.from(value, "base64");
  return decoded.toString("base64") === value ? decoded : null;
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SCRYPT_SALT_LENGTH);
  const derivedKey = await deriveScryptKey(password, salt);
  return [
    "scrypt",
    `v=${SCRYPT_VERSION}`,
    `N=${SCRYPT_N}`,
    `r=${SCRYPT_R}`,
    `p=${SCRYPT_P}`,
    salt.toString("base64"),
    derivedKey.toString("base64"),
  ].join("$");
}

function isLegacyPasswordHash(storedHash: string): boolean {
  return /^[a-f0-9]{64}$/i.test(storedHash);
}

function needsPasswordRehash(storedHash: string): boolean {
  return isLegacyPasswordHash(storedHash);
}

async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  try {
    if (isLegacyPasswordHash(storedHash)) {
      const expected = Buffer.from(storedHash, "hex");
      const actual = Buffer.from(hashLegacyPassword(password), "hex");
      return expected.length === actual.length && timingSafeEqual(expected, actual);
    }

    const parts = storedHash.split("$");
    if (parts.length !== 7 ||
        parts[0] !== "scrypt" ||
        parts[1] !== `v=${SCRYPT_VERSION}` ||
        parts[2] !== `N=${SCRYPT_N}` ||
        parts[3] !== `r=${SCRYPT_R}` ||
        parts[4] !== `p=${SCRYPT_P}`) {
      return false;
    }

    const salt = decodeCanonicalBase64(parts[5]);
    const expected = decodeCanonicalBase64(parts[6]);
    if (!salt || salt.length !== SCRYPT_SALT_LENGTH || !expected || expected.length !== SCRYPT_KEY_LENGTH) {
      return false;
    }

    const actual = await deriveScryptKey(password, salt);
    return timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
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
    const { username, password } = req.body;
    if (!username || typeof password !== "string" || password.length === 0) {
      res.status(400).json({ error: "Kullanıcı adı ve şifre gerekli" });
      return;
    }

    const [user] = await db.select().from(usersTable).where(eq(usersTable.username, username));
    if (!user || !user.active) {
      res.status(401).json({ error: "Kullanıcı adı veya şifre hatalı" });
      return;
    }

    if (!await verifyPassword(password, user.passwordHash)) {
      res.status(401).json({ error: "Kullanıcı adı veya şifre hatalı" });
      return;
    }

    const [company] = await db.select({ isActive: companiesTable.isActive })
      .from(companiesTable)
      .where(eq(companiesTable.id, user.companyId))
      .limit(1);
    if (!company || company.isActive !== true) {
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
    if (!username || typeof password !== "string" || password.length === 0 || !name) {
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

    const [existing] = await db.select().from(usersTable).where(eq(usersTable.username, username));
    if (existing) {
      res.status(400).json({ error: "Bu kullanıcı adı zaten kullanılıyor" });
      return;
    }

    const [user] = await db.insert(usersTable).values({
      username,
      passwordHash: await hashPassword(password),
      name,
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
    if (name !== undefined) updates.name = name;
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

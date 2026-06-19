import { Router } from "express";
import { createHash, randomUUID } from "crypto";
import { db } from "@workspace/db";
import { usersTable, unitsTable, companiesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { sessions, requireAuth } from "../middlewares/auth.js";

const router = Router();

function hashPassword(password: string): string {
  return createHash("sha256").update(password + "eys_salt_2024").digest("hex");
}

export async function seedAdminUser() {
  try {
    const [existingCompany] = await db.select().from(companiesTable).where(eq(companiesTable.id, 1));
    if (!existingCompany) {
      await db.insert(companiesTable).values({
        name: "Varsayılan Şirket",
        subdomain: "default",
        isActive: true,
      });
      console.log("[Auth] Varsayılan şirket oluşturuldu");
    }

    const [existing] = await db.select().from(usersTable).where(eq(usersTable.username, "admin"));
    if (!existing) {
      await db.insert(usersTable).values({
        username: "admin",
        passwordHash: hashPassword("admin123"),
        name: "Sistem Yöneticisi",
        role: "superadmin",
        unitId: null,
        active: true,
      });
      console.log("[Auth] Admin kullanıcı oluşturuldu: admin / admin123");
    } else if (existing.role === "admin") {
      await db.update(usersTable).set({ role: "superadmin" }).where(eq(usersTable.username, "admin"));
      console.log("[Auth] Admin kullanıcı rolü superadmin'e güncellendi");
    }
  } catch (err) {
    console.error("[Auth] Admin seed hatası:", err);
  }
}

// POST /api/auth/login
router.post("/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      res.status(400).json({ error: "Kullanıcı adı ve şifre gerekli" });
      return;
    }

    const [user] = await db.select().from(usersTable).where(eq(usersTable.username, username));
    if (!user || !user.active) {
      res.status(401).json({ error: "Kullanıcı adı veya şifre hatalı" });
      return;
    }

    const hash = hashPassword(password);
    if (user.passwordHash !== hash) {
      res.status(401).json({ error: "Kullanıcı adı veya şifre hatalı" });
      return;
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
    if (role !== "admin" && role !== "superadmin") {
      res.status(403).json({ error: "Yetki yok" });
      return;
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
      const queryCompanyId = req.query.companyId ? parseInt(req.query.companyId as string) : undefined;
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
    if (role !== "admin" && role !== "superadmin") {
      res.status(403).json({ error: "Yetki yok" });
      return;
    }

    const { username, password, name, role: newRole, unitId, companyId: bodyCompanyId } = req.body;
    if (!username || !password || !name) {
      res.status(400).json({ error: "Zorunlu alanlar eksik" });
      return;
    }

    // admin kendi firmasına ekleyebilir; superadmin body'deki companyId'yi kullanır
    const targetCompanyId = role === "superadmin"
      ? (bodyCompanyId ? parseInt(bodyCompanyId) : sessionCompanyId)
      : sessionCompanyId;

    const [existing] = await db.select().from(usersTable).where(eq(usersTable.username, username));
    if (existing) {
      res.status(400).json({ error: "Bu kullanıcı adı zaten kullanılıyor" });
      return;
    }

    const [user] = await db.insert(usersTable).values({
      username,
      passwordHash: hashPassword(password),
      name,
      role: newRole || "user",
      unitId: unitId ? parseInt(unitId) : null,
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
    if (role !== "admin" && role !== "superadmin") {
      res.status(403).json({ error: "Yetki yok" });
      return;
    }

    const id = parseInt(req.params.id as string);

    // Hedef kullanıcının firmasını kontrol et
    const [target] = await db.select({ companyId: usersTable.companyId })
      .from(usersTable).where(eq(usersTable.id, id));
    if (!target) {
      res.status(404).json({ error: "Kullanıcı bulunamadı" });
      return;
    }
    if (role === "admin" && target.companyId !== sessionCompanyId) {
      res.status(403).json({ error: "Bu kullanıcıyı düzenleme yetkiniz yok" });
      return;
    }

    const { name, password, role: newRole, unitId, active } = req.body;
    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (password) updates.passwordHash = hashPassword(password);
    if (newRole !== undefined) updates.role = newRole;
    if (unitId !== undefined) updates.unitId = unitId ? parseInt(unitId) : null;
    if (active !== undefined) updates.active = Boolean(active);

    const [user] = await db.update(usersTable).set(updates).where(eq(usersTable.id, id)).returning();
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
    if (role !== "admin" && role !== "superadmin") {
      res.status(403).json({ error: "Yetki yok" });
      return;
    }

    const id = parseInt(req.params.id as string);

    if (id === req.user!.userId) {
      res.status(400).json({ error: "Kendinizi silemezsiniz" });
      return;
    }

    // Hedef kullanıcının firmasını kontrol et
    const [target] = await db.select({ companyId: usersTable.companyId })
      .from(usersTable).where(eq(usersTable.id, id));
    if (!target) {
      res.status(404).json({ error: "Kullanıcı bulunamadı" });
      return;
    }
    if (role === "admin" && target.companyId !== sessionCompanyId) {
      res.status(403).json({ error: "Bu kullanıcıyı silme yetkiniz yok" });
      return;
    }

    await db.delete(usersTable).where(eq(usersTable.id, id));
    res.status(204).send();
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

export default router;

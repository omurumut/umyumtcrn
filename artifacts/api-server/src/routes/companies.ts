import { Router } from "express";
import { db, companiesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, requireSuperAdmin } from "../middlewares/auth.js";

const router = Router();

router.get("/companies", requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const companies = await db.select().from(companiesTable).orderBy(companiesTable.id);
    res.json(companies);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

router.post("/companies", requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const { name, subdomain, isActive } = req.body;
    if (!name || !subdomain) {
      res.status(400).json({ error: "Firma adı ve subdomain zorunludur" });
      return;
    }
    const [company] = await db.insert(companiesTable).values({
      name,
      subdomain: (subdomain as string).toLowerCase().trim(),
      isActive: isActive !== false,
    }).returning();
    res.status(201).json(company);
  } catch (err: any) {
    if (err.code === "23505") {
      res.status(400).json({ error: "Bu subdomain zaten kullanılıyor" });
      return;
    }
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

router.patch("/companies/:id", requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id as string);
    const { name, subdomain, isActive } = req.body;
    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (subdomain !== undefined) updates.subdomain = (subdomain as string).toLowerCase().trim();
    if (isActive !== undefined) updates.isActive = Boolean(isActive);
    const [company] = await db.update(companiesTable).set(updates).where(eq(companiesTable.id, id)).returning();
    if (!company) {
      res.status(404).json({ error: "Firma bulunamadı" });
      return;
    }
    res.json(company);
  } catch (err: any) {
    if (err.code === "23505") {
      res.status(400).json({ error: "Bu subdomain zaten kullanılıyor" });
      return;
    }
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

router.delete("/companies/:id", requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id as string);
    if (id === 1) {
      res.status(400).json({ error: "Varsayılan firma silinemez" });
      return;
    }
    await db.delete(companiesTable).where(eq(companiesTable.id, id));
    res.status(204).send();
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

export default router;

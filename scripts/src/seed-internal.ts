/**
 * Internal Demo Seed Script
 *
 * Şirket: "ISO 50001 Kontrol Demo"
 * Amaç: Kişisel/internal test verilerinin ayrı bir şirket altında
 *       güvenli biçimde yüklenmesi.
 *
 * Özellikler:
 * - Tamamen idempotent: aynı veri varsa atlar, yoksa ekler.
 * - Mevcut public demo (companyId: 1) verilerine hiç dokunmaz.
 * - DATABASE_URL env değişkeni ile çalışır.
 *
 * Çalıştırma:
 *   pnpm --filter scripts seed:internal
 */

import { createHash } from "crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { eq, and } from "drizzle-orm";
import {
  companiesTable,
  usersTable,
  unitsTable,
  subUnitsTable,
  energySourcesTable,
  metersTable,
  consumptionTable,
} from "@workspace/db/schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL env değişkeni tanımlı değil.");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

function hashPassword(password: string): string {
  return createHash("sha256").update(password + "eys_salt_2024").digest("hex");
}

async function findOrCreate<T extends { id: number }>(
  label: string,
  finder: () => Promise<T[]>,
  creator: () => Promise<T[]>
): Promise<T> {
  const existing = await finder();
  if (existing.length > 0) {
    console.log(`  ↩  ${label} zaten mevcut (id: ${existing[0].id})`);
    return existing[0];
  }
  const created = await creator();
  console.log(`  ✅ ${label} oluşturuldu (id: ${created[0].id})`);
  return created[0];
}

async function seed() {
  console.log("\n🌱 Internal demo seed başlatılıyor...");
  console.log("─────────────────────────────────────────────────────");

  // ── 1. Şirket ─────────────────────────────────────────────────────────────
  console.log("\n[1/7] Şirket");
  const company = await findOrCreate(
    "ISO 50001 Kontrol Demo şirketi",
    () => db.select().from(companiesTable).where(eq(companiesTable.name, "ISO 50001 Kontrol Demo")),
    () => db.insert(companiesTable).values({
      name: "ISO 50001 Kontrol Demo",
      subdomain: "iso50001-kontrol-demo",
      isActive: true,
    }).returning()
  );

  const companyId = company.id;

  // ── 2. Admin kullanıcı ────────────────────────────────────────────────────
  console.log("\n[2/7] Admin kullanıcı");
  const ADMIN_USERNAME = "kontrol_admin";
  await findOrCreate(
    `Kullanıcı: ${ADMIN_USERNAME}`,
    () => db.select().from(usersTable).where(eq(usersTable.username, ADMIN_USERNAME)),
    () => db.insert(usersTable).values({
      companyId,
      username: ADMIN_USERNAME,
      passwordHash: hashPassword("admin123"),
      name: "Kontrol Yöneticisi",
      role: "admin",
      unitId: null,
      active: true,
      isDemo: false,
    }).returning()
  );

  // ── 3. Birim ──────────────────────────────────────────────────────────────
  console.log("\n[3/7] Birim");
  const UNIT_NAME = "Kontrol Fabrikası";
  const unit = await findOrCreate(
    `Birim: ${UNIT_NAME}`,
    () => db.select().from(unitsTable).where(
      and(eq(unitsTable.name, UNIT_NAME), eq(unitsTable.companyId, companyId))
    ),
    () => db.insert(unitsTable).values({
      companyId,
      name: UNIT_NAME,
      location: "Ostim OSB, Ankara",
      type: "fabrika",
      city: "Ankara",
      responsible: "Kontrol Yöneticisi",
      description: "Internal demo için iskelet fabrika birimi",
      active: true,
      isDemo: false,
    }).returning()
  );

  // ── 4. Alt birim ──────────────────────────────────────────────────────────
  console.log("\n[4/7] Alt birim");
  const SUB_UNIT_NAME = "Üretim Bölümü";
  const subUnit = await findOrCreate(
    `Alt birim: ${SUB_UNIT_NAME}`,
    () => db.select().from(subUnitsTable).where(
      and(eq(subUnitsTable.name, SUB_UNIT_NAME), eq(subUnitsTable.unitId, unit.id))
    ),
    () => db.insert(subUnitsTable).values({
      companyId,
      unitId: unit.id,
      name: SUB_UNIT_NAME,
      city: "Ankara",
      description: "Ana üretim bölümü",
      active: true,
    }).returning()
  );

  // ── 5. Enerji kaynağı ─────────────────────────────────────────────────────
  console.log("\n[5/7] Enerji kaynağı");
  const SOURCE_NAME = "Ana Elektrik Panosu";
  const energySource = await findOrCreate(
    `Enerji kaynağı: ${SOURCE_NAME}`,
    () => db.select().from(energySourcesTable).where(
      and(eq(energySourcesTable.name, SOURCE_NAME), eq(energySourcesTable.unitId, unit.id))
    ),
    () => db.insert(energySourcesTable).values({
      companyId,
      unitId: unit.id,
      type: "elektrik",
      name: SOURCE_NAME,
      unit: "kWh",
      active: true,
    }).returning()
  );

  // ── 6. Sayaç ──────────────────────────────────────────────────────────────
  console.log("\n[6/7] Sayaç");
  const METER_NAME = "Ana Elektrik Sayacı";
  const meter = await findOrCreate(
    `Sayaç: ${METER_NAME}`,
    () => db.select().from(metersTable).where(
      and(eq(metersTable.name, METER_NAME), eq(metersTable.subUnitId, subUnit.id))
    ),
    () => db.insert(metersTable).values({
      companyId,
      unitId: unit.id,
      subUnitId: subUnit.id,
      energySourceId: energySource.id,
      name: METER_NAME,
      type: "elektrik",
      recordType: "physical_meter",
      location: "Üretim Bölümü Ana Pano",
      city: "Ankara",
      unit: "kWh",
      description: "İskelet sayaç — gerçek veriler uygulama üzerinden girilecek",
    }).returning()
  );

  // ── 7. Tüketim verileri (2 aylık iskelet) ─────────────────────────────────
  console.log("\n[7/7] Tüketim verileri");

  const skeletonConsumption = [
    { year: 2025, month: 1, kwh: 0, tep: 0, co2: 0, hdd: 420, cdd: 0 },
    { year: 2025, month: 2, kwh: 0, tep: 0, co2: 0, hdd: 380, cdd: 0 },
  ];

  let inserted = 0;
  let skipped = 0;

  for (const row of skeletonConsumption) {
    const existing = await db.select({ id: consumptionTable.id })
      .from(consumptionTable)
      .where(
        and(
          eq(consumptionTable.meterId, meter.id),
          eq(consumptionTable.year, row.year),
          eq(consumptionTable.month, row.month)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      console.log(`  ↩  Tüketim ${row.year}/${String(row.month).padStart(2, "0")} zaten mevcut — atlandı`);
      skipped++;
    } else {
      await db.insert(consumptionTable).values({
        companyId,
        meterId: meter.id,
        year: row.year,
        month: row.month,
        kwh: row.kwh,
        tep: row.tep,
        co2: row.co2,
        hdd: row.hdd,
        cdd: row.cdd,
        notes: "İskelet kayıt — gerçek değer girilecek",
      });
      console.log(`  ✅ Tüketim ${row.year}/${String(row.month).padStart(2, "0")} oluşturuldu`);
      inserted++;
    }
  }

  console.log(`\n─────────────────────────────────────────────────────`);
  console.log(`🎉 Internal demo seed tamamlandı.`);
  console.log(`\n  Şirket    : ${company.name} (id: ${companyId})`);
  console.log(`  Birim     : ${unit.name} (id: ${unit.id})`);
  console.log(`  Sayaç     : ${meter.name} (id: ${meter.id})`);
  console.log(`  Tüketim   : ${inserted} eklendi, ${skipped} atlandı`);
  console.log(`\n  Giriş bilgileri:`);
  console.log(`    Kullanıcı: ${ADMIN_USERNAME}`);
  console.log(`    Şifre    : admin123`);
  console.log(`─────────────────────────────────────────────────────\n`);

  await pool.end();
}

seed().catch((err) => {
  console.error("❌ Seed hatası:", err);
  pool.end().finally(() => process.exit(1));
});

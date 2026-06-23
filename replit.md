# Enerji Yönetim Sistemi (EnYS)

ISO 50001 uyumlu çok birimli enerji yönetim sistemi — sayaç bazlı tüketim takibi, regresyon analizi, SWOT/Risk/ÖEK, PDF raporlar ve AI önerileri.

---

# Replit Agent Import Instructions

This project is already configured for Replit.

During GitHub import, do not migrate, refactor, rewrite, or explore the entire codebase unless there is a real startup error.

## Import Goal

Only verify that the existing project installs, builds, and starts on Replit.

## Allowed Import Commands

Use only these commands during Replit import:

```bash
pnpm install --frozen-lockfile=false
pnpm run replit:check
pnpm run replit:start
```

If `replit:*` scripts are not available yet, use:

```bash
pnpm install --frozen-lockfile=false
pnpm run build
pnpm --filter @workspace/api-server run dev
```

## Required Replit Secrets

The following secret must exist in Replit Secrets:

```env
DATABASE_URL=
```

Do not create a new database unless the user explicitly asks.

## Database Rules

Never run these during Replit import:

```bash
pnpm --filter @workspace/db run push
pnpm --filter @workspace/db run push-force
drizzle-kit push
drizzle-kit generate
drizzle-kit migrate
```

Do not reset the database.

Do not create tables manually.

Do not edit migration files.

Do not create new migration files during import.

Do not mark migrations as applied manually unless the user explicitly asks.

If the app fails because tables already exist, stop and ask the user before changing database or migration state.

## Code Change Rules

During import:

* Do not refactor.
* Do not change architecture.
* Do not change package manager.
* Do not replace pnpm.
* Do not edit generated files.
* Do not edit OpenAPI generated client files.
* Do not change business logic.
* Do not modify authentication logic.
* Do not modify database schema.
* Do not add new dependencies unless the user explicitly asks.

## Success Criteria

The import is successful when:

* dependencies install,
* the API server starts,
* the frontend starts,
* the login page is reachable.

Default test users:

```text
admin / admin123
kontrol_admin / admin123
```

---

# Run & Operate

## Replit import / Replit run

Use this first:

```bash
pnpm run replit:check
pnpm run replit:start
```

Do not run database push commands during Replit import.

## Local development

```bash
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/ems-dashboard run dev
pnpm run typecheck
pnpm run build
pnpm --filter @workspace/api-spec run codegen
```

## Database development only

These commands are for local/dev use only.

Do not run these during Replit import unless the user explicitly asks:

```bash
pnpm --filter @workspace/db run push
pnpm --filter @workspace/db run push-force
```

Required env:

```env
DATABASE_URL=
```

---

# Stack

* pnpm workspaces
* Node.js 24
* TypeScript 5.9
* API: Express 5
* DB: PostgreSQL + Drizzle ORM
* Validation: Zod, drizzle-zod
* API codegen: Orval
* Frontend: React + Vite + Recharts + shadcn/ui
* Build: esbuild

---

# Where things live

* `lib/db/src/schema/energy.ts` — Kaynak DB şema: `usersTable`, `subUnitsTable`, `energySourcesTable`, `unitsTable`, `metersTable`, `consumptionTable`, ...
* `lib/api-spec/openapi.yaml` — OpenAPI kontrat
* `lib/api-client-react/src/generated/` — Orval üretimi, dokunma
* `artifacts/api-server/src/routes/` — Express route'ları

  * `auth.ts` — Giriş/çıkış, kullanıcı CRUD, admin seed
  * `sub-units.ts` — Alt birim/lokasyon CRUD
  * `energy-sources.ts` — Enerji kaynağı CRUD
* `artifacts/api-server/src/middlewares/auth.ts` — Bearer token auth
* `artifacts/ems-dashboard/src/` — React frontend

  * `context/AuthContext.tsx` — Login/logout, token localStorage
  * `context/UnitContext.tsx` — Aktif birim state
  * `context/YearContext.tsx` — Aktif yıl state
  * `pages/Units.tsx` — Birim + alt birim + enerji kaynağı + kullanıcı yönetimi
  * `pages/Meters.tsx` — Alt birim & enerji kaynağı filtreli sayaç yönetimi
  * `pages/Consumption.tsx` — Kaynak → alt birim → sayaç akışlı tüketim girişi
  * `components/units/` — SubUnitsTab, EnergySourcesTab, UsersTab

---

# Architecture decisions

* Rol tabanlı erişim: admin tüm birimleri görür, user yalnızca kendi `unitId`'sini.
* Token localStorage'da saklanır.
* `setAuthTokenGetter` API client'a enjekte edilir.
* `authMiddleware` app.ts'te globaldir.
* `requireAuth` / `requireAdmin` route bazlıdır.
* Tüm veri route'ları `requireAuth` gerektirir.
* Tüketim akışı: enerji kaynağı seç → alt birim filtrele → sayaç seç.
* HDD/CDD sayacın şehrine göre meteoroloji API'dan otomatik çekilir.
* `metersTable` artık `subUnitId`, `energySourceId`, `city` alanlarına sahiptir.
* Çok birimli izolasyon `UnitContext` ile tutulur.
* `unitId !== null` ise filtreli, `null` ise "Tüm Birimler" görünümü.
* Orval hook kalıbı: `useHookName(params, { query: { queryKey: getHookNameQueryKey(params) } })`
* TS7030 anti-pattern: `return toast()` kullanma; `{ toast(); return; }` kullan.
* Express 5 params tipi: `req.params.id` türü `string | string[]`; `parseInt(req.params.id as string)` ile cast gerekli.

---

# Product

* Giriş: bearer token
* Varsayılan admin: `admin / admin123`
* Alternatif demo kullanıcı: `kontrol_admin / admin123`
* Anasayfa: KPI kartları, aylık trend, CO₂ & HDD/CDD grafikler
* Birim Yönetimi: Birimler + Alt Birimler + Enerji Kaynakları + Kullanıcılar
* Çok Birimli Özet: Tüm birimler karşılaştırmalı grafik + detay tablo
* Sayaç Yönetimi: Alt birim & enerji kaynağı filtreli CRUD
* Tüketim Verileri: Kaynak → alt birim → sayaç 3 adımlı akış
* Meteoroloji: Şehir bazlı HDD/CDD çekimi
* Regresyon Analizi: Enerji–HDD korelasyonu, R², EnPG, EEI metrikleri
* SWOT, Risk & Fırsat, ÖEK: ISO 50001 uyumluluk modülleri
* AI Önerileri: Kural tabanlı enerji iyileştirme önerileri
* Raporlar: PDF rapor üretimi

---

# Gotchas

* API server yeniden başlatılmadan yeni route'lar 404 döner.
* DB schema güncellendiğinde `lib/db` package declarations rebuild edilmelidir.
* DB schema değişikliği sadece lokal/dev geliştirme içindir.
* Replit import sırasında DB push, push-force veya drizzle-kit push çalıştırma.
* `unitsTable` → `subUnitsTable` / `energySourcesTable` → `metersTable` sırasıyla tanımlanmalı.
* Birim filtreli hook çağrısında `unitParam = undefined` kullanılmalı, `null` değil.
* Express 5'te `req.params.id` türü `string | string[]`; `as string` cast gerekli.

---

# Pointers

* See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

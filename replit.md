# Enerji Yönetim Sistemi (EnYS)

ISO 50001 uyumlu çok birimli enerji yönetim sistemi — ~40 lokasyon için sayaç bazlı tüketim takibi, regresyon analizi, SWOT/Risk/ÖEK, PDF raporlar ve AI önerileri.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — API server çalıştır (port 8080)
- `pnpm --filter @workspace/ems-dashboard run dev` — Frontend çalıştır
- `pnpm run typecheck` — Tüm paketlerde typecheck
- `pnpm run build` — Typecheck + build
- `pnpm --filter @workspace/api-spec run codegen` — OpenAPI'dan hook ve Zod şemalarını yeniden üret
- `pnpm --filter @workspace/db run push` — DB şema değişikliklerini yolla (sadece dev)
- Required env: `DATABASE_URL` — Postgres bağlantı dizesi

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM (`lib/db/src/schema/energy.ts`)
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (OpenAPI spec → `lib/api-client-react/`)
- Frontend: React + Vite + Recharts + shadcn/ui (dark mode)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/db/src/schema/energy.ts` — Kaynak DB şema: `usersTable`, `subUnitsTable`, `energySourcesTable`, `unitsTable`, `metersTable`, `consumptionTable`, ...
- `lib/api-spec/openapi.yaml` — OpenAPI kontrat (kaynak gerçek)
- `lib/api-client-react/src/generated/` — Orval üretimi (dokunma)
- `artifacts/api-server/src/routes/` — Express route'ları
  - `auth.ts` — Giriş/çıkış, kullanıcı CRUD, admin seed
  - `sub-units.ts` — Alt birim/lokasyon CRUD
  - `energy-sources.ts` — Enerji kaynağı CRUD
- `artifacts/api-server/src/middlewares/auth.ts` — Bearer token auth (in-memory sessions Map)
- `artifacts/ems-dashboard/src/` — React frontend
  - `context/AuthContext.tsx` — Login/logout, token localStorage
  - `context/UnitContext.tsx` — Aktif birim state
  - `context/YearContext.tsx` — Aktif yıl state
  - `pages/Units.tsx` — Birim + alt birim + enerji kaynağı + kullanıcı yönetimi (tab'lı)
  - `pages/Meters.tsx` — Alt birim & enerji kaynağı filtreli sayaç yönetimi
  - `pages/Consumption.tsx` — Kaynak → alt birim → sayaç akışlı tüketim girişi
  - `components/units/` — SubUnitsTab, EnergySourcesTab, UsersTab

## Architecture decisions

- **Rol tabanlı erişim:** admin tüm birimleri görür, user yalnızca kendi `unitId`'sini. Token localStorage'da saklanır, `setAuthTokenGetter` API client'a enjekte edilir.
- **Auth middleware sırası:** `authMiddleware` (token parse) app.ts'te global, `requireAuth`/`requireAdmin` route bazlı. Tüm veri route'ları `requireAuth` gerektirir.
- **Tüketim akışı:** Enerji kaynağı seç → alt birim filtrele → sayaç seç. HDD/CDD sayacın şehrine göre meteoroloji API'dan otomatik çekilir.
- **Sayaç şema:** `metersTable` artık `subUnitId`, `energySourceId`, `city` alanlarına sahip.
- **DB schema değişikliği sonrası:** `pnpm --filter @workspace/db exec tsc -p tsconfig.json` ile declarations rebuild; ardından `pnpm --filter @workspace/db run push-force`.
- **Çok birimli izolasyon:** Birim seçimi global `UnitContext` ile tutulur. `unitId !== null` ise filtreli, `null` ise "Tüm Birimler" görünümü.
- **Orval hook kalıbı:** `useHookName(params, { query: { queryKey: getHookNameQueryKey(params) } })` — params ve options ayrı argüman.
- **TS7030 anti-pattern:** `return toast()` kullanma; `{ toast(); return; }` kullan (toast() non-void döner).
- **Express 5 params tipi:** `req.params.id` türü `string | string[]`; `parseInt(req.params.id as string)` ile cast gerekli.

## Product

- **Giriş:** JWT-benzeri bearer token, varsayılan admin: `admin / admin123`
- **Anasayfa:** KPI kartları, aylık trend, CO₂ & HDD/CDD grafikler
- **Birim Yönetimi:** Birimler + Alt Birimler + Enerji Kaynakları + Kullanıcılar (tab'lı)
- **Çok Birimli Özet:** Tüm birimler karşılaştırmalı bar chart + detay tablo
- **Sayaç Yönetimi:** Alt birim & enerji kaynağı filtreli CRUD
- **Tüketim Verileri:** Kaynak → alt birim → sayaç 3 adımlı akış, HDD/CDD otomatik
- **Meteoroloji:** Şehir bazlı HDD/CDD çekimi
- **Regresyon Analizi:** Enerji–HDD korelasyonu, R², EnPG, EEI metrikleri
- **SWOT, Risk & Fırsat, ÖEK:** ISO 50001 uyumluluk modülleri
- **AI Önerileri:** Kural tabanlı enerji iyileştirme önerileri
- **Raporlar:** PDF rapor üretimi

## User preferences

_(doldurmak için kullanıcıdan gelen tercihler)_

## Gotchas

- API server yeniden başlatılmadan yeni route'lar 404 döner — workflow yeniden başlat.
- DB schema güncellendiğinde `lib/db` package'ının TypeScript declarations da rebuild edilmeli (`tsc -p tsconfig.json`), yoksa api-server typecheck eski tipleri görür.
- `unitsTable` → `subUnitsTable`/`energySourcesTable` → `metersTable` sırasıyla tanımlanmalı (FK bağımlılığı).
- Birim filtreli hook çağrısında `unitParam = undefined` (null değil) kullanılmalı.
- Express 5'te `req.params.id` türü `string | string[]` — `as string` cast gerekli.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details

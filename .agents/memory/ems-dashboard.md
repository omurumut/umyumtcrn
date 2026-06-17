---
name: EMS Dashboard Architecture
description: Key decisions and conventions for the ISO 50001 Enerji Yönetim Sistemi full-stack app.
---

# EMS Dashboard — Key Decisions

## Stack
- React+Vite frontend: `artifacts/ems-dashboard` → preview path `/`
- Express 5 API: `artifacts/api-server` → path prefix `/api`, port 8080
- PostgreSQL + Drizzle ORM, schema in `lib/db/src/schema/energy.ts`
- API hooks from `@workspace/api-client-react` — never relative imports
- Recharts for all data visualization

## DB Tables
`units`, `users`, `meters`, `consumption`, `weather`, `swot_items`, `risks`, `seu_items`, `reports` — all in `lib/db/src/schema/energy.ts`, exported via `lib/db/src/schema/index.ts`

## Auto-migration on startup
API server runs `runMigrations()` (from `lib/db/src/index.ts`) before listening. Build script copies `lib/db/drizzle/` → `dist/drizzle/`. Any schema change: run `drizzle-kit generate` in `lib/db/`, commit the SQL file, restart API Server.
**Why:** Ensures fresh imports work without manual setup steps.

## is_demo flag
`units` and `users` tables have `is_demo boolean default false`. Demo seed (`POST /api/admin/seed`) sets `isDemo: true` on all demo rows. Reset route (`POST /api/admin/reset`) uses `where(eq(table.isDemo, true))` for demo-only deletion — never hardcoded names.
**Why:** Name-based matching breaks if demo set changes; flag is always reliable.

## Demo reset endpoint
`POST /api/admin/reset` body: `{ mode: "demo" | "all" }` in `artifacts/api-server/src/routes/seed.ts`.
- `demo`: deletes users where isDemo=true, finds units where isDemo=true, explicitly deletes their meters (no cascade on meters.unitId), then deletes those units (cascade handles sub_units, energy_sources, swot, risks, seu).
- `all`: deletes everything except admin user.

## AI Integration
OpenAI integration requires account upgrade — implemented rule-based suggestion system in `artifacts/api-server/src/routes/ai.ts`. 8 predefined Turkish energy suggestions filtered by focus (genel/seu/co2/maliyet).

## Weather Simulation
No external API — baseline HDD/CDD lookup tables per Turkish city in `artifacts/api-server/src/routes/weather.ts`. POST `/api/weather` with `{location, year}` upserts 12 monthly records.

## TEP/CO2 Auto-calculation
Backend auto-calculates if not supplied: TEP = kWh × 0.000086, CO₂ = kWh × 0.4 ton.
**Why:** Reduces data entry burden for energy engineers entering raw meter readings.

## Report Format
HTML reports stored as base64 data URLs in the `download_url` column. Frontend triggers browser download with a synthetic anchor click. No file storage needed.

## Auth
Sessions stored in-memory Map (not persisted across restarts). Password hash: SHA-256 + static salt `eys_salt_2024`. Admin seeded on startup if missing: `admin` / `admin123`.

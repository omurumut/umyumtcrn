---
name: EMS MGM Bootstrap
description: How MGM official reference data is bootstrapped on every fresh database startup
---

## Rule
`bootstrapMgmReferenceData()` in `artifacts/api-server/src/services/mgm-bootstrap.ts` must run after migrations and BEFORE `app.listen()`. It is idempotent and uses threshold checks — not a simple "at least 1 row" check.

## Thresholds
- `mgm_station_mappings`: minimum 200 rows (Excel has 254)
- `weather_degree_days` (is_official=true, period_type='monthly'): minimum 20 000 rows (Excel has ~31 745)

## Startup order in index.ts
```
migrations → bootstrapMgmReferenceData() → app.listen → seedStationsIfEmpty → seedDegreeDataIfEmpty → startMgmDailyScheduler
```
`seedOfficialWeatherData()` (Van 2024 test seed) was neutralized to a no-op.

**Why:** On a fresh Replit DB, `mgm_station_mappings` and `weather_degree_days` are empty, causing every HDD/CDD lookup to return "veri yok". The bootstrap fills both tables from Excel files bundled in `artifacts/api-server/data/mgm-import/`.

## How to apply
- Any change to startup order must preserve this sequence.
- `getMgmBootstrapStatus()` is imported in `routes/mgm.ts` and returned as `bootstrapStatus` in all "no data" lookup responses, allowing clients to distinguish missing data from bootstrap failures.
- The function does NOT call `process.exit()` — a bootstrap failure logs a critical error but the API continues starting.

## Data source
Excel files at `artifacts/api-server/data/mgm-import/`:
- `mgm_station_mapping_checked.xlsx` — 254 station mappings
- `mgm_degree_days_last_10_years_final.xlsx` — ~31 745 official monthly records (2016–2026)

## Verification (logged on every startup)
- 254 mappings, 31745 official monthly records, year range 2016–2026, 254 stations
- Van 2024 Ocak HDD=528, Şubat HDD=498

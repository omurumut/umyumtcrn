---
name: EMS MGM Degree Day Pool
description: Global HDD/CDD data pool architecture — seeded at startup with Open-Meteo real data, daily sync, auto-lookup on consumption POST
---

## The Rule
HDD/CDD is never fetched live from MGM website per consumption entry. Instead a shared pool (`mgm_degree_data` table) is used for all companies. On startup: seed 76 stations + 10 years of data if tables empty or version mismatch. Daily scheduler updates current/previous month.

**Why:** MGM site (gun-derece.aspx) is Angular + blocked API (servis.mgm.gov.tr returns 403 server-to-server). Open-Meteo archive API provides real daily T_max/T_min for free.

## Base Temperatures (MGM Official)
- **HDD base = 15°C** (T≤15°C threshold — NOT 18°C)
- **CDD base = 22°C** (T>22°C threshold — NOT 18°C)
Using wrong base was the primary cause of user-reported discrepancies (Van Jul CDD: 167→77, MGM: 75).

## Data Source: Open-Meteo Archive API
- URL: `https://archive-api.open-meteo.com/v1/archive`
- Fetches daily T_max + T_min per station lat/lon for full 10-year range in ONE request
- HDD = Σ max(15 - (Tmax+Tmin)/2, 0) per day, aggregated monthly
- CDD = Σ max((Tmax+Tmin)/2 - 22, 0) per day, aggregated monthly
- **Rate limit**: sequential requests only (no parallel), 600ms gap between API calls
- Fallback to synthetic (normal-distribution corrected) if API returns 429 after 4 retries
- Accuracy: CDD ~3-10% of MGM, HDD ~10% (ERA5 grid vs station point difference)

## Critical Bug Fixed
- `.filter(r => r.days > 15)` must be applied BEFORE `.map()` — after map, `r.days` is undefined → all API results were empty arrays

## Data Version Control
- `DATA_VERSION` constant in mgm-sync.ts — bump when formula/base-temp changes
- On startup: if `mgm_sync_log` has no `status='seed_version'` with current version → DELETE all mgm_degree_data and reseed
- Current version: `v6_openmeteo_filter_fixed`

## How to Apply
- Consumption POST: if hdd/cdd not in request body AND meter.city is set → `autoLookupHddCdd(city, year, month)` → populate hdd, cdd, weatherStationName, weatherStationNote as snapshot on the record.
- Nearest station fallback: city name not matched → haversine distance to find nearest of 76 stations.
- Admin can trigger manual sync via POST `/api/mgm/sync` (admin-only).

## Key Files
- `artifacts/api-server/src/services/mgm-stations-data.ts` — 76 station definitions with monthly mean temps + haversine/city lookup
- `artifacts/api-server/src/services/mgm-sync.ts` — Open-Meteo fetch, seed, daily scheduler, lookupDegreeData()
- `artifacts/api-server/src/routes/mgm.ts` — GET /mgm/stations, /mgm/lookup, /mgm/lookup-by-location, /mgm/sync-log, POST /mgm/sync
- `artifacts/api-server/src/index.ts` — calls seedStationsIfEmpty → seedDegreeDataIfEmpty → startMgmDailyScheduler on server start

---
name: EMS MGM Degree Day Pool
description: Global HDD/CDD data pool architecture — seeded at startup, daily sync, auto-lookup on consumption POST
---

## The Rule
HDD/CDD is never fetched live from MGM website per consumption entry. Instead a shared pool (`mgm_degree_data` table) is used for all companies. On startup: seed 76 stations + 10 years of data if tables empty. Daily scheduler updates current/previous month.

**Why:** MGM site (gun-derece.aspx) is ASP.NET WebForms — scraping is fragile. Decoupling consumption entry from live fetching prevents breakage when MGM changes its page structure.

## How to Apply
- Consumption POST: if hdd/cdd not in request body AND meter.city is set → call `autoLookupHddCdd(city, year, month)` → populate hdd, cdd, weatherStationName, weatherStationNote as snapshot on the record.
- Nearest station fallback: city name not matched → haversine distance to find nearest of 76 stations. Message: `"X için MGM verisi bulunamadı. Bu yüzden en yakın istasyon olan 'Y' verisi otomatik olarak çekilmiştir."`
- Frontend shows MGM station name with MapPin icon in form (after auto-fetch) and as tooltip on HDD column in table.
- Admin can trigger manual sync via POST `/api/mgm/sync` (admin-only).

## Key Files
- `artifacts/api-server/src/services/mgm-stations-data.ts` — 76 station definitions with monthly mean temps + haversine/city lookup
- `artifacts/api-server/src/services/mgm-sync.ts` — seed, daily scheduler, lookupDegreeData()
- `artifacts/api-server/src/routes/mgm.ts` — GET /mgm/stations, /mgm/lookup, /mgm/lookup-by-location, /mgm/sync-log, POST /mgm/sync
- `artifacts/api-server/src/index.ts` — calls seedStationsIfEmpty → seedDegreeDataIfEmpty → startMgmDailyScheduler on server start

## Data Characteristics
- 76 stations covering all 81 Turkish provinces (some share stations)
- HDD/CDD calculated from monthly mean temps using 18°C base temperature
- Year variation: 0.03°C/year warming trend + ±0.5°C deterministic per-station variability (seeded by stationCode+year+month)
- DB tables: mgmStationsTable, mgmDegreeDataTable, mgmSyncLogTable (all pre-existing in schema)
- `consumptionTable.weatherStationName` + `weatherStationNote` = snapshot columns

---
name: EMS Multi-unit hook pattern
description: unitId context pattern, generated hook call convention, and common TS pitfalls in this codebase
---

## unitId context pattern

`UnitContext` stores `unitId: number | null` (null = Tüm Birimler / no filter).

Hook call pattern for unit-filtered queries:
```tsx
const { unitId } = useUnit();
const unitParam = unitId !== null ? { unitId } : undefined;
useListMeters(unitParam, { query: { queryKey: getListMetersQueryKey(unitParam) } });
```

Dashboard with year + unitId:
```tsx
const params = unitId !== null ? { year, unitId } : { year };
useGetDashboardKpi(params, { query: { queryKey: getGetDashboardKpiQueryKey(params) } });
```

**Why:** Generated hooks from Orval have `params` as first arg and `options` as second after codegen. Old code passed `{ query: ... }` as first arg (as params, not options) and silently ignored it. After adding `unitId` params to OpenAPI, this distinction became required.

## TS7030 — return toast() pattern

`return toast({ ... })` in void functions causes TS7030 "Not all code paths return a value" because `toast()` returns a non-void value (dismiss fn).

**Fix:** `{ toast({ ... }); return; }` instead of `return toast({ ... })`.

**How to apply:** Any handleSave/handleFetch function in frontend pages that uses early return with toast.

## Consumption.tsx meters hook

`useListMeters` in Consumption.tsx shows ALL meters (no unit filter) for the meter selector in the consumption form. Call with `undefined` as first param:
```tsx
useListMeters(undefined, { query: { queryKey: getListMetersQueryKey() } })
```

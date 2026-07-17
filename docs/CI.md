# CI Quality Gate

Bu doküman, GitHub Actions üzerinde çalışan EnYS CI kalite kapısını ve release öncesi otomasyon sözleşmesini tanımlar.

## Workflow

Workflow dosyası:

```text
.github/workflows/ci.yml
```

Workflow adı:

```text
CI Quality Gate
```

Branch protection için required check olarak şu job seçilmelidir:

```text
CI Quality Gate / verify
```

## Trigger

Workflow yalnız şu durumlarda çalışır:

- Pull request
- `main` branch push
- Manual `workflow_dispatch`

`pull_request_target` kullanılmaz. Fork PR kodu repository secretlarına erişmez.

## Permissions

Workflow minimum permission ile çalışır:

```yaml
permissions:
  contents: read
```

Production deploy, package publish veya GitHub write izni yoktur.

## Runtime

| Kontrol              | Komut                                | DB gerekli | Browser gerekli | Tahmini süre |
| -------------------- | ------------------------------------ | ---------: | --------------: | -----------: |
| Frozen install       | `pnpm install --frozen-lockfile`     |      Hayır |           Hayır |       1-3 dk |
| Typecheck            | `pnpm run typecheck`                 |      Hayır |           Hayır |         1 dk |
| Build                | `pnpm run build`                     |      Hayır |           Hayır |       1-2 dk |
| DB smoke             | `pnpm run test:db:smoke`             |       Evet |           Hayır |        <1 dk |
| Fixture              | `pnpm run test:fixtures`             |       Evet |           Hayır |        <1 dk |
| Audit                | `pnpm run test:audit`                |       Evet |           Hayır |        <1 dk |
| Audit restore        | `pnpm run test:audit-restore`        |       Evet |           Hayır |        <1 dk |
| E2E                  | `pnpm run test:e2e`                  |       Evet |            Evet |       3-6 dk |
| Production readiness | `pnpm run test:production-readiness` |       Evet |            Evet |       1-3 dk |

Job timeout: 40 dakika.

## Node, pnpm ve cache

- Node.js: `22`
- pnpm: `11.10.0`
- Dependency cache: pnpm store, `pnpm-lock.yaml` bazlı
- Browser cache: `.cache/ms-playwright`, `pnpm-lock.yaml` bazlı

`package.json` içindeki `packageManager` alanı pnpm sürümünü sabitler.

## Database izolasyonu

Workflow bir PostgreSQL service container tanımlar:

- image: `postgres:16`
- localhost port: `5432`
- test-only credential
- health check: `pg_isready`

Mevcut test altyapısı ayrıca her test komutu için kendi Docker tabanlı disposable PostgreSQL containerını oluşturur. Bu containerlar:

- `127.0.0.1` üzerinde rastgele port kullanır
- persistent volume kullanmaz
- `tmpfs` PostgreSQL data path kullanır
- label ve run id ile sahiplik doğrular
- cleanup sonunda silinir

CI hiçbir zaman production veya Neon `DATABASE_URL` kullanmamalıdır.

## Browser provisioning

Chromium deterministik olarak şu adımda kurulur:

```bash
pnpm exec playwright install --with-deps chromium
```

Workflow şu izolasyonu kullanır:

```text
PLAYWRIGHT_BROWSERS_PATH=.cache/ms-playwright
```

Bu değer production secret değildir ve readiness/PDF kontrolleri için gereklidir.

## Artifact politikası

Yalnız failure durumunda artifact upload edilir:

- `test-results`
- `playwright-report`

Retention: 7 gün.

Yüklenmemesi gerekenler:

- `.env`
- DB dump
- raw token
- browser user profile
- production secret

## Log güvenliği

Workflow `set -x` kullanmaz. Test credentialları production secret değildir ancak yine de tam connection string veya bearer token loglanmamalıdır.

Audit testleri password/token/hash redaction davranışını DB seviyesinde de doğrular.

## Local parity

Local tam kalite kapısı:

```bash
pnpm run verify:ci
```

Production readiness için local ortamda Chromium path gerekir. Örnek:

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH="C:\Users\CerenUmut\AppData\Local\ms-playwright"
pnpm.cmd run verify:ci
```

Linux/CI örneği:

```bash
export PLAYWRIGHT_BROWSERS_PATH=.cache/ms-playwright
pnpm run verify:ci
```

## Release öncesi karar

Production deployment otomatik yapılmaz. Release öncesi minimum kapılar:

1. `CI Quality Gate / verify` yeşil.
2. `main` güncel.
3. Production backup alındı.
4. Migration preflight tamamlandı.
5. Deployment sonrası `/health`, `/ready`, login, dashboard, audit ve PDF/export smoke doğrulandı.

## Migration preflight

CI production DB’ye bağlanmaz. Deployment öncesi production DB’de şu tüketim duplicate precheck ayrıca çalıştırılmalıdır:

```sql
SELECT meter_id, year, month, COUNT(*)
FROM consumption
GROUP BY meter_id, year, month
HAVING COUNT(*) > 1;
```

`0024_audit_events` migration’ı yeni audit tablosu ve index/FK ekler; mevcut business tablolarda destructive/data-loss işlem yapmaz.

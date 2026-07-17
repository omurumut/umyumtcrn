# ISO 50001 EMS Monitoring

Bu doküman API sunucusunun Prometheus uyumlu operasyon metriklerini ve güvenli scrape politikasını açıklar.

## Endpoint ve erişim

Metrics endpointi:

```text
GET /api/metrics
```

Endpoint varsayılan olarak kapalıdır. Açmak için iki environment değişkeni birlikte verilmelidir:

```text
ENABLE_METRICS_ENDPOINT=true
METRICS_ACCESS_TOKEN=<operations-token>
```

`METRICS_ACCESS_TOKEN` en az 16 karakter olmalıdır. Eksik veya geçersiz config durumunda endpoint açık fallback yapmaz ve `404` döner.

Erişim modeli:

- Feature flag kapalı: `404`
- Token yok: `401`
- Yanlış token: `403`
- Doğru operations token: `200`
- Normal uygulama bearer session tokenı metrics erişimi sağlamaz

Token response’a veya loglara yazılmamalıdır. Scrape trafiği uygulama session store’una bağımlı değildir.

## Prometheus scrape örneği

```yaml
scrape_configs:
  - job_name: iso50001-api
    scheme: https
    metrics_path: /api/metrics
    bearer_token: ${ISO50001_METRICS_ACCESS_TOKEN}
    static_configs:
      - targets:
          - api-instance-1.example.internal
          - api-instance-2.example.internal
```

## Metric listesi

Tüm uygulama metrikleri `iso50001_` prefix’i taşır.

| Metric | Tür | Açıklama |
| --- | --- | --- |
| `iso50001_http_requests_total` | counter | Method, normalize route ve status class bazında HTTP istek sayısı |
| `iso50001_http_request_duration_seconds` | histogram | HTTP request latency dağılımı |
| `iso50001_http_requests_active` | gauge | Aktif HTTP istek sayısı |
| `iso50001_auth_events_total` | counter | Login/logout/session/rate-limit olayları |
| `iso50001_db_events_total` | counter | Readiness, DB pool, migration ve DB lifecycle olayları |
| `iso50001_db_pool_connections` | gauge | `total`, `idle`, `waiting` pool bağlantıları |
| `iso50001_pdf_renders_total` | counter | PDF render başarı/hata sayısı |
| `iso50001_pdf_render_duration_seconds` | histogram | PDF render süresi |
| `iso50001_pdf_render_active` | gauge | Aktif PDF render sayısı |
| `iso50001_import_attempts_total` | counter | Import denemeleri |
| `iso50001_import_rows_total` | counter | Import satır özetleri |
| `iso50001_mgm_sync_total` | counter | MGM sync denemeleri |
| `iso50001_audit_events_total` | counter | Yazılan audit event sayısı |
| `iso50001_audit_write_failures_total` | counter | Audit yazma hataları |

Prometheus default process metrikleri de aynı prefix ile yayınlanır; örnekler:

- `iso50001_process_resident_memory_bytes`
- `iso50001_process_cpu_seconds_total`
- `iso50001_nodejs_eventloop_lag_seconds`
- `iso50001_nodejs_heap_size_used_bytes`

## Label politikası

Label’lar düşük cardinality olacak şekilde sınırlıdır:

- HTTP: `method`, normalized `route`, `status_class`
- Auth: bounded `event`, bounded `reason`
- DB: bounded `event`, `outcome`
- PDF: allowlist `report_type`, `outcome`
- Import: bounded `kind`, `outcome` veya `result`
- MGM: bounded `trigger`, `outcome`
- Audit: bounded `action`, `outcome`

Şunlar metric label veya metric output içinde kullanılmamalıdır:

- `companyId`, `unitId`, `userId`, `meterId`
- email, username, IP
- raw URL, query string, request body
- token, password, cookie, authorization header
- DB URL, host, user veya database adı
- entity/report/audit/request ID

Route normalize edilemediğinde `route="unknown"` kullanılır. 404 path’leri tek tek time-series oluşturmaz.

## Multi-instance davranışı

Her API instance kendi process-local registry’sini yayınlar. Shared PostgreSQL session store metrics’i shared yapmaz.

Prometheus her instance’ı ayrı scrape etmelidir. Toplam counter değerleri Grafana/Prometheus sorgu katmanında aggregate edilmelidir:

```promql
sum(rate(iso50001_http_requests_total[5m])) by (status_class)
```

Autoscale kullanılıyorsa instance discovery monitoring altyapısında çözülmelidir. Bu paket shared metrics tablosu veya merkezi metrics DB eklemez.

## Grafana panel önerileri

- Request rate: `sum(rate(iso50001_http_requests_total[5m])) by (route, status_class)`
- 5xx oranı: `sum(rate(iso50001_http_requests_total{status_class="5xx"}[5m])) / sum(rate(iso50001_http_requests_total[5m]))`
- p95 latency: `histogram_quantile(0.95, sum(rate(iso50001_http_request_duration_seconds_bucket[5m])) by (le, route))`
- Aktif request: `sum(iso50001_http_requests_active)`
- DB readiness failure: `increase(iso50001_db_events_total{event="readiness_check",outcome="failure"}[5m])`
- Login rate-limit: `increase(iso50001_auth_events_total{event="login_rate_limited"}[5m])`
- PDF failure: `increase(iso50001_pdf_renders_total{outcome="failure"}[15m])`
- Import partial/failure: `increase(iso50001_import_attempts_total{outcome!="success"}[30m])`
- Audit write failure: `increase(iso50001_audit_write_failures_total[5m])`
- Memory: `iso50001_process_resident_memory_bytes`
- Event loop lag: `iso50001_nodejs_eventloop_lag_seconds`

## Minimum alert önerileri

- Readiness failure artışı
- HTTP 5xx oranı veya sayısı
- Login 429 artışı
- DB pool error veya migration startup failure
- PDF render failure
- Import failure/partial artışı
- Audit write failure
- Resident memory artışı
- Instance restart count

Bu repo alerting servisi kurmaz; alert kuralları deployment monitoring katmanında tanımlanmalıdır.

## Secret ve PII politikası

Metrics output müşteri, kullanıcı veya entity tanımlayıcıları içermemelidir. Scrape token operasyon secret’ıdır; uygulama bearer token’ı yerine kullanılmaz ve uygulama session token’ıyla karıştırılmaz.

Log ve metric ayrımı:

- Metrics: düşük-cardinality operasyon sinyali
- Audit: kritik iş mutasyonlarının tutarlı kayıt sistemi
- Logs: request ID ile hata inceleme ve lifecycle korelasyonu

Audit başarısızlığı iş mutasyonunu rollback ettirebilir; metrics instrumentasyonu best-effort’tur ve business request’i fail ettirmemelidir.

## Incident inceleme akışı

1. Grafana/Prometheus’ta ilgili panel ve alarmı incele.
2. Aynı zaman aralığında `requestId` içeren API loglarını filtrele.
3. Kritik mutasyon varsa audit event kayıtlarıyla request ID ve action/outcome korelasyonu kur.
4. Tenant veya kullanıcı kimliğini metrics’ten değil, yetkili audit/log verisinden incele.
5. Secret veya PII içeren ham payload’ları monitoring sistemine aktarma.

## Health ve readiness

- `/api/healthz` liveness içindir; DB outage sırasında da API process sağlıklıysa `200` dönebilir.
- `/api/readyz` DB erişilebilirliğini kontrol eder; DB outage sırasında `503` döner.
- Metrics registry hatası health/readiness veya business route’ları düşürmemelidir.


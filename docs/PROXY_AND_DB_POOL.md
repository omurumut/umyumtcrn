# Reverse Proxy ve PostgreSQL Pool Runbook

Bu doküman ISO 50001 EMS API sunucusunun reverse proxy trust modeli, client IP semantiği ve PostgreSQL pool ayarlarını açıklar.

## Trust proxy modları

Varsayılan mod:

```text
TRUST_PROXY_MODE=none
```

Desteklenen modlar:

| Mode | Açıklama | Express değeri |
| --- | --- | --- |
| `none` | Proxy header’ları güvenilmez. `X-Forwarded-For` rate-limit IP’sini değiştirmez. | `false` |
| `loopback` | Yalnız loopback proxy kaynakları güvenilir. Lokal reverse proxy testleri için uygundur. | `loopback` |
| `hops` | Sabit ve bounded hop sayısı güvenilir. | `TRUST_PROXY_HOPS` |

`trust proxy=true` kullanılmaz. `TRUST_PROXY_HOPS` yalnız `1–3` aralığında kabul edilir. Production’da geçersiz proxy config fail-fast davranır.

Örnek:

```text
TRUST_PROXY_MODE=hops
TRUST_PROXY_HOPS=1
```

Replit veya başka bir platform için hop sayısı repo içinde tahmin edilmemelidir; staging üzerinde doğrulanmalıdır.

## Client IP normalization

Uygulama route’ları raw `X-Forwarded-For` parse etmez. Merkezi helper Express’in trust proxy sonucundaki `req.ip` değerini doğrular ve normalize eder:

- IPv4 geçerli biçimde korunur.
- IPv6 lower-case normalize edilir.
- IPv4-mapped IPv6 (`::ffff:127.0.0.1`) IPv4’e normalize edilir.
- Geçersiz değer `unknown` sentinel’ına düşer.

Rate-limit key’i ve audit IP hash’i normalize edilmiş client IP üzerinden hesaplanır. Raw IP DB’ye, loglara, metric label’larına veya response’a yazılmamalıdır.

## XFF spoofing riski

`TRUST_PROXY_MODE=none` durumunda client’ın gönderdiği `X-Forwarded-For` header’ı rate-limit key’ini değiştirmez.

`hops=1` durumunda yalnız güvenilir son proxy hop’u hesaba katılır. Şu zincirde sol taraftaki attacker-controlled değer güvenilir kabul edilmemelidir:

```text
X-Forwarded-For: attacker-controlled, actual-client
```

Staging smoke’ta hem normal hem spoofed XFF ile login rate-limit davranışı doğrulanmalıdır.

## Login rate-limit davranışı

Login rate-limit iki shared PostgreSQL scope’u kullanır:

- normalized IP hash
- normalized username hash

İki API instance aynı DB’ye bağlıysa IP ve username sayaçları instance’lar arasında paylaşılır. Header değiştirerek veya instance değiştirerek threshold bypass edilmemelidir.

## PostgreSQL pool environment

Pool ayarları:

```text
DB_POOL_MAX=10
DB_POOL_IDLE_TIMEOUT_MS=10000
DB_POOL_CONNECTION_TIMEOUT_MS=5000
DB_POOL_MAX_USES=<optional>
```

Sınırlar:

| Env | Default | Aralık |
| --- | ---: | ---: |
| `DB_POOL_MAX` | `10` | `1–50` |
| `DB_POOL_IDLE_TIMEOUT_MS` | `10000` | `1000–600000` |
| `DB_POOL_CONNECTION_TIMEOUT_MS` | `5000` | `100–60000` |
| `DB_POOL_MAX_USES` | unset | `1–100000` |

`connectionTimeoutMillis=0` kullanılmaz. Production’da geçersiz değerler fail-fast davranır. Development/test ortamında geçersiz değer güvenli default’a düşer.

Startup logları yalnız güvenli pool özetini içerebilir:

```json
{
  "poolMax": 10,
  "idleTimeoutMs": 10000,
  "connectionTimeoutMs": 5000,
  "maxUses": null
}
```

DB URL, host, kullanıcı veya parola loglanmamalıdır.

## Autoscale connection budget

Her API instance kendi PostgreSQL pool’una sahiptir:

```text
toplam olası bağlantı ≈ instance sayısı × DB_POOL_MAX
```

Örnek:

```text
5 instance × 10 pool max = 50 olası connection
```

Gerçek DB provider limitini repo içinde uydurma. Deployment öncesi:

1. DB provider connection limitini öğren.
2. Maksimum API instance sayısını belirle.
3. Migration/admin bağlantıları için pay bırak.
4. `DB_POOL_MAX` değerini buna göre ayarla.
5. Scale-out sırasında metrics üzerinden `total`, `idle`, `waiting` pool değerlerini izle.

## Pool saturation

Düşük pool max durumunda beklenen davranış:

- Connection acquisition sonsuza kadar beklemez.
- Timeout bounded ve güvenli hata üretir.
- DB URL veya stack response’a sızmaz.
- Connection serbest kalınca sistem recovery yapar.
- Health process canlıysa `200`, readiness DB erişemiyorsa `503` döner.

Readiness query ayrıca query timeout taşır ve pool saturation/outage durumunda sistemi kilitlememelidir.

## Metrics

Pool gauge’ları `/api/metrics` altında yayınlanır:

- `iso50001_db_pool_connections{state="total"}`
- `iso50001_db_pool_connections{state="idle"}`
- `iso50001_db_pool_connections{state="waiting"}`

DB lifecycle olayları:

- readiness success/failure
- pool error
- migration startup success/failure
- pool close success/failure

Pool config değerleri metric label yapılmaz.

## Graceful shutdown

Scale-in veya SIGTERM sırasında:

1. HTTP server yeni request kabul etmeyi durdurur.
2. Optional scheduler durdurulur.
3. PostgreSQL pool `pool.end()` ile kapatılır.
4. Shutdown timeout aşılırsa process non-zero çıkabilir.

Normal senaryoda listener/process kalıntısı bırakılmamalıdır.

## PgBouncer değerlendirmesi

Bu faz PgBouncer kurmaz.

Kullanılacaksa ayrıca doğrulanmalı:

- Runtime migration doğrudan DB bağlantısı gerektirebilir.
- Transaction pooling altında session-level PostgreSQL davranışları farklılaşabilir.
- Uygulama kodu açık advisory lock kullanmıyor.
- `pg` prepared statement kullanımı deployment ayarlarıyla uyumlu olmalı.
- Session store ve rate-limit işlemleri kısa transaction/query akışlarıyla uyumludur; yine de staging’de test edilmelidir.

## Replit staging checklist

Gerçek deploy bu fazda yapılmaz. Staging’de şu kontroller yapılmalıdır:

1. Public staging deploy oluştur.
2. Gerçek browser/request IP gözlemini güvenli log veya geçici diagnostik ile doğrula; raw IP kalıcı loglama yapma.
3. Replit forwarding hop sayısını belirle.
4. `TRUST_PROXY_MODE=none` ile spoofed XFF rate-limit bypass olmadığını doğrula.
5. Seçilen `hops` değeriyle gerçek client IP ayrışmasını doğrula.
6. Spoofed XFF zinciriyle sol attacker-controlled değerin güvenilmediğini doğrula.
7. Login rate-limit IP ve username sayaçlarını test et.
8. `/api/metrics` pool gauge değerlerini izle.
9. Scale-out instance sayısı arttığında DB connection count’u izle.
10. Scale-in/SIGTERM graceful shutdown ve pool close davranışını doğrula.
11. DB pause/outage benzeri kontrollü testte health/readiness davranışını doğrula.


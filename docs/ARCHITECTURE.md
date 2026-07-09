# Architecture

Bu doküman EnYS projesinin teknik mimarisi için resmi referanstır. Amaç, yeni bir geliştiricinin sistemin paket yapısını, uygulama katmanlarını, veri akışını ve genişletme kurallarını projedeki gerçek dosya düzenine göre anlayabilmesidir.

## 1. Genel Mimari

EnYS, ISO 50001 odaklı çok birimli enerji yönetim sistemi olarak tasarlanmış bir TypeScript monorepo projesidir. Sistem üç ana teknik alandan oluşur:

- `artifacts/api-server`: Express tabanlı backend uygulaması.
- `artifacts/ems-dashboard`: React + Vite tabanlı web arayüzü.
- `lib/*`: Backend ve frontend tarafından paylaşılan DB, OpenAPI, generated client ve validasyon paketleri.

Uygulamanın ana çalışma akışı şöyledir:

```text
Browser
  -> ems-dashboard
  -> /api istekleri
  -> api-server
  -> @workspace/db
  -> PostgreSQL
```

Frontend geliştirme ortamında `vite.config.ts`, `/api` isteklerini `http://localhost:8080` API sunucusuna proxy eder. Web uygulaması varsayılan olarak `5000` portunda, API ise `PORT` ortam değişkeniyle verilen portta çalışır. Projedeki Windows start scriptleri API için `PORT=8080` varsayımını kullanır.

Backend başlarken:

1. `PORT` ortam değişkenini doğrular.
2. `@workspace/db` içindeki `runMigrations` fonksiyonunu çağırır.
3. Migration klasörünü `dist/drizzle` olarak bekler.
4. Express uygulamasını dinlemeye alır.
5. Varsayılan admin kullanıcısını seed eder.
6. MGM meteoroloji referans verisi bootstrap/scheduler işlemlerini arka planda başlatır.

Bu nedenle sistem yalnızca HTTP route katmanı değildir; DB migration, seed, meteoroloji veri hazırlığı ve tenant izolasyonu birlikte çalışır.

## 2. Monorepo Yapısı

Proje `pnpm workspaces` kullanır. Workspace paketleri `pnpm-workspace.yaml` içinde tanımlıdır:

```yaml
packages:
  - artifacts/*
  - lib/*
  - lib/integrations/*
  - scripts
```

Root paket `package.json` yalnızca orkestrasyon ve ortak geliştirme komutlarını içerir. Gerçek uygulama kodu alt paketlerdedir.

### Root Scriptleri

- `pnpm run build`: Önce typecheck çalıştırır, sonra `@workspace/mockup-sandbox` dışındaki paketlerin build scriptlerini çalıştırır.
- `pnpm run typecheck`: Önce `lib` paketlerini TypeScript project references ile kontrol eder, sonra `artifacts` ve `scripts` paketlerini kontrol eder.
- `pnpm run typecheck:libs`: Root `tsconfig.json` referanslarına göre `lib/db`, `lib/api-client-react` ve `lib/api-zod` paketlerini kontrol eder.
- `pnpm run replit:check`: Replit için install ve build kontrolü yapar.
- `pnpm run replit:start`: API sunucusunu geliştirme modunda başlatır.
- `pnpm run replit:web`: Frontend geliştirme sunucusunu başlatır.

Root `preinstall` scripti `pnpm` dışındaki package manager kullanımını engeller. Bu proje `npm install` veya `yarn` ile yönetilmemelidir.

### Workspace Paketleri

| Paket | Konum | Rol |
| --- | --- | --- |
| `@workspace/api-server` | `artifacts/api-server` | Express API uygulaması, route/middleware/service katmanı |
| `@workspace/ems-dashboard` | `artifacts/ems-dashboard` | React + Vite web arayüzü |
| `@workspace/mockup-sandbox` | `artifacts/mockup-sandbox` | Build dışında tutulan sandbox alan |
| `@workspace/db` | `lib/db` | Drizzle schema, PostgreSQL bağlantısı, migration runner |
| `@workspace/api-spec` | `lib/api-spec` | OpenAPI kontratı ve Orval codegen konfigürasyonu |
| `@workspace/api-client-react` | `lib/api-client-react` | Orval generated React Query client ve custom fetcher |
| `@workspace/api-zod` | `lib/api-zod` | OpenAPI'den üretilen Zod şemaları |
| `@workspace/scripts` | `scripts` | Seed, import/export ve MGM veri yardımcı scriptleri |

### Catalog ve Güvenlik Ayarları

`pnpm-workspace.yaml` merkezi dependency catalog kullanır. React, Vite, Tailwind, Drizzle, Zod, TanStack Query gibi ortak paketler burada sabitlenir.

`minimumReleaseAge: 1440` ayarı npm supply-chain riskini azaltmak için kullanılır. Yeni paket eklerken bu ayar kapatılmamalıdır. Gerekiyorsa yalnızca güvenilir ve bilinçli istisnalar `minimumReleaseAgeExclude` altında değerlendirilmelidir.

## 3. Backend Mimarisi

Backend uygulaması `artifacts/api-server` paketindedir. Ana dosyalar:

- `src/index.ts`: Server bootstrap, port kontrolü, migration çalıştırma, seed ve scheduler başlangıcı.
- `src/app.ts`: Express app kurulumu, global middleware ve `/api` router mount işlemi.
- `src/routes/index.ts`: Tüm route modüllerinin merkezi kaydı.
- `src/middlewares/auth.ts`: Bearer token session çözümleme ve rol bazlı guard fonksiyonları.
- `src/services/*`: MGM ve benzeri iş/entegrasyon servisleri.
- `build.mjs`: API bundle üretimi, migration ve data klasörü kopyalama işlemleri.

### Express Katmanı

`src/app.ts` içinde middleware sırası şöyledir:

1. `pino-http`: Request/response logging.
2. `cors`: CORS desteği.
3. `express.json()`: JSON body parse.
4. `express.urlencoded({ extended: true })`: Form body parse.
5. `authMiddleware`: Bearer token varsa `req.user` alanını doldurur.
6. `app.use("/api", router)`: Tüm API route'larını `/api` altında yayınlar.

Bu sırada `authMiddleware` globaldir; ancak route erişimi `requireAuth`, `requireAdmin` veya `requireSuperAdmin` guard fonksiyonlarıyla route bazında kontrol edilir.

### Route Yapısı

`src/routes/index.ts` tüm route modüllerini tek Express router altında toplar. Mevcut route alanları şunları kapsar:

- `auth`
- `companies`
- `units`
- `sub-units`
- `energy-sources`
- `energy-use-groups`
- `meters`
- `consumption`
- `weather`
- `mgm`
- `dashboard`
- `summary`
- `analysis`
- `swot`
- `risks`
- `seu`
- `seu-assessment`
- `targets`
- `energy-action-plans`
- `energy-target-progress`
- `energy-performance`
- `energy-review`
- `energy-review-records`
- `vap-projects`
- `variables`
- `ai`
- `reports`
- `seed`
- `health`

Route modülleri genellikle şu sorumlulukları aynı dosyada toplar:

- HTTP endpoint tanımı.
- Yetki guard çağrısı.
- Query/body parametrelerinin parse edilmesi.
- Tenant ve rol filtrelerinin uygulanması.
- Drizzle ile DB sorgusu.
- JSON response üretimi.

Yeni route eklenirken `src/routes/index.ts` içine kaydedilmesi gerekir. API server yeniden başlatılmadan yeni route'lar çalışma zamanında görünmez.

### Middleware

`src/middlewares/auth.ts` içinde üç ana guard vardır:

- `requireAuth`: Oturum yoksa `401` döner.
- `requireAdmin`: `admin` veya `superadmin` dışındaki kullanıcıları `403` ile engeller.
- `requireSuperAdmin`: Sadece `superadmin` rolüne izin verir.

`authMiddleware`, `Authorization: Bearer <token>` header'ını okur ve token'ı memory içindeki `sessions` map'inden çözer. Eşleşen token varsa `req.user` dolu gelir; yoksa `req.user = null` olur.

### Service Katmanı

`src/services` altında özellikle MGM meteoroloji verisiyle ilgili servisler bulunur:

- `mgm-bootstrap.ts`
- `mgm-excel-import.ts`
- `mgm-official-sync.ts`
- `mgm-stations-data.ts`
- `mgm-sync.ts`

Bu servisler route dosyalarındaki HTTP sorumluluğundan ayrılan veri hazırlama, MGM lookup, derece-gün senkronizasyonu ve scheduler işlerini kapsar.

### Validation

Projede validasyon üç kaynakla yapılır:

1. `lib/db/src/schema/energy.ts` içindeki Drizzle tablolarından `drizzle-zod` ile insert şemaları üretilir.
2. `lib/api-spec/openapi.yaml` üzerinden `@workspace/api-zod` generated Zod şemaları üretilir.
3. Route dosyalarında manuel zorunlu alan, parametre ve yetki kontrolleri bulunur.

Mevcut route'ların önemli bir bölümü manuel validation kullanır. Yeni geliştirmelerde mevcut route pattern'i korunmalı; OpenAPI/Zod kullanımı artırılacaksa bu, API sözleşmesi ve frontend client üretimiyle birlikte düşünülmelidir.

### Auth İlişkisi

Login akışı `src/routes/auth.ts` içindedir:

1. `/api/auth/login` kullanıcı adı ve şifreyi alır.
2. Şifre SHA-256 + sabit salt ile hashlenir.
3. `usersTable` üzerinden aktif kullanıcı kontrol edilir.
4. Başarılı girişte `randomUUID()` ile token üretilir.
5. Token ve kullanıcı bilgisi `sessions` map'ine yazılır.
6. Frontend'e `{ token, user }` döner.

Bu yapı memory session kullandığı için process restart sonrası token'lar geçersiz hale gelir. Authentication davranışı değiştirilirken route, middleware, frontend `AuthContext` ve generated client token bağlantısı birlikte ele alınmalıdır.

## 4. Frontend Mimarisi

Frontend uygulaması `artifacts/ems-dashboard` paketindedir. Ana dosyalar:

- `src/main.tsx`: React root mount noktası.
- `src/App.tsx`: Provider zinciri, QueryClient, route tanımları ve auth gate.
- `src/pages/*`: Ekran seviyesindeki sayfa bileşenleri.
- `src/components/*`: Paylaşılan ve alan bazlı UI bileşenleri.
- `src/context/*`: Auth, company, unit ve year state yönetimi.
- `vite.config.ts`: Vite, Tailwind, alias ve `/api` proxy ayarları.

### React Uygulama Kurgusu

`App.tsx` içinde provider sırası şöyledir:

```text
QueryClientProvider
  -> TooltipProvider
    -> AuthProvider
      -> YearProvider
        -> CompanyProvider
          -> UnitProvider
            -> AppInner
```

`AppInner` kullanıcı yüklenene kadar loading gösterir. Kullanıcı yoksa `Login` sayfası gösterilir. Kullanıcı varsa Wouter tabanlı route ağacı `Layout` içinde çalışır.

### Page Katmanı

`src/pages` altındaki dosyalar ekran seviyesinde iş mantığını yönetir. Örnekler:

- `Dashboard.tsx`: Ana KPI ve özet ekranı.
- `Units.tsx`: Birim, alt birim, enerji kaynakları ve kullanıcı yönetimi.
- `Meters.tsx`: Sayaç yönetimi.
- `Consumption.tsx`: Tüketim verisi girişi.
- `Targets.tsx`: Enerji hedefleri ve aksiyon planları.
- `EnergyPerformance.tsx`: EnPI/baseline/performance hesapları.
- `EnergyReview.tsx`: Enerji gözden geçirme.
- `Risks.tsx`, `Swot.tsx`, `Seu.tsx`: ISO 50001 modülleri.
- `Companies.tsx`: Superadmin firma yönetimi.

Sayfalar genellikle context değerlerini alır, API parametrelerini üretir, React Query ile veri çeker ve UI bileşenlerini besler.

### Component Katmanı

`src/components` altında tekrar kullanılabilir UI parçaları bulunur. `src/components/ui` Radix/shadcn tarzı temel UI bileşenlerini; alan bazlı klasörler ise belirli iş akışlarına ait bileşenleri içerir.

Component katmanı route yetkilendirmesi yerine geçmez. Yetki ve tenant güvenliği backend'de korunmalıdır; frontend yalnızca kullanıcı deneyimi için görünürlük ve yönlendirme yapar.

### Context Katmanı

Mevcut context'ler:

- `AuthContext`: Token, kullanıcı bilgisi, login/logout ve API client token getter bağlantısı.
- `CompanyContext`: Sadece `superadmin` için aktif firma filtresi.
- `UnitContext`: Admin/superadmin için aktif birim filtresi; normal kullanıcı için kendi birimi.
- `YearContext`: Aktif raporlama/analiz yılı.

`AuthContext`, token'ı `localStorage` içinde `eys_token`, kullanıcıyı `eys_user` anahtarıyla saklar. Token ayrıca `setAuthTokenGetter` ile `@workspace/api-client-react` custom fetcher'ına enjekte edilir.

### API Client Kullanımı

Frontend iki şekilde API çağrısı yapar:

1. `@workspace/api-client-react` içindeki Orval generated React Query hook'ları.
2. Bazı sayfalarda doğrudan `fetch("/api/...")` veya küçük `apiFetch` helper'ları.

Generated hook kullanıldığında query key kalıbı genellikle şu şekildedir:

```ts
useHookName(params, {
  query: { queryKey: getHookNameQueryKey(params) },
});
```

Doğrudan `fetch` kullanılan yerlerde `Authorization: Bearer <token>` header'ının doğru eklendiği ve React Query cache invalidation davranışının korunduğu kontrol edilmelidir.

### Routing

Routing Wouter ile yapılır. Bazı route'lar role göre wrapper bileşenlerle korunur:

- `AdminRoute`: `admin` veya `superadmin`.
- `SuperAdminRoute`: sadece `superadmin`.

Bu frontend route guard'ları güvenlik sınırı değildir; backend guard'ları her zaman asıl yetki kontrolüdür.

## 5. Veritabanı Mimarisi

DB paketi `lib/db` altında yer alır. Ana dosyalar:

- `src/index.ts`: PostgreSQL pool, Drizzle instance ve migration runner.
- `src/schema/index.ts`: Schema export noktası.
- `src/schema/energy.ts`: Tüm tablo tanımları, insert şemaları ve TypeScript tipleri.
- `drizzle.config.ts`: Drizzle Kit konfigürasyonu.
- `drizzle/*.sql`: SQL migration dosyaları.

### Drizzle Bağlantısı

`lib/db/src/index.ts`, `DATABASE_URL` ortam değişkenini zorunlu tutar. Bu değişken yoksa uygulama hata vererek başlar.

```text
DATABASE_URL
  -> pg Pool
  -> drizzle(pool, { schema })
  -> db export
```

Backend route'ları `@workspace/db` üzerinden `db` ve tablo objelerini import eder.

### Schema

Ana schema `lib/db/src/schema/energy.ts` içindedir. Mevcut tablolar enerji yönetim sisteminin temel alanlarını kapsar:

- tenant ve kullanıcı: `companies`, `users`
- organizasyon: `units`, `sub_units`
- enerji yapısı: `energy_sources`, `energy_use_groups`, `meters`, `consumption`
- meteoroloji: `mgm_stations`, `mgm_degree_data`, `mgm_sync_log`, `weather`, `weather_degree_days`, `mgm_station_mappings`
- ISO 50001 modülleri: `swot_items`, `risks`, `risk_notes`, `seu_items`, `seu_assessments`, `energy_targets`, `energy_action_plans`, `energy_target_progress`, `vap_projects`, `energy_review_records`
- performans ve değişkenler: `variables`, `variable_values`, `energy_performance_indicators`, `energy_baselines`, `energy_baseline_variables`, `energy_performance_results`
- raporlama: `reports`

Her tablo için genellikle şu çıktılar bulunur:

- Drizzle table objesi.
- `createInsertSchema(...)` ile insert Zod şeması.
- `Insert...` tipi.
- Select tipi.

### Migration Mantığı

Migration dosyaları `lib/db/drizzle` altında tutulur. API build sürecinde `artifacts/api-server/build.mjs`, bu klasörü `artifacts/api-server/dist/drizzle` altına kopyalar.

Runtime'da `artifacts/api-server/src/index.ts` şu klasörü kullanır:

```text
dist/drizzle
```

ve `runMigrations(migrationsFolder)` çağırır.

Drizzle Kit komutları `@workspace/db` paketindedir:

```bash
pnpm --filter @workspace/db run push
pnpm --filter @workspace/db run push-force
```

Bu komutlar local/dev DB geliştirme içindir. Replit import veya sıradan uygulama geliştirme sırasında migration oluşturmak, DB state değiştirmek veya push-force çalıştırmak mimari olarak risklidir ve açık talep olmadan yapılmamalıdır.

## 6. API Katmanı

API katmanı üç parçadan oluşur:

```text
lib/api-spec/openapi.yaml
  -> Orval
  -> lib/api-client-react/src/generated
  -> lib/api-zod/src/generated
```

### OpenAPI

`lib/api-spec/openapi.yaml`, API sözleşmesinin kaynak dosyasıdır. Endpoint path'leri, operationId değerleri, request/response şemaları ve tag'ler burada tanımlanır.

OpenAPI sözleşmesi frontend generated hook'ları ve Zod schema üretimi için kaynak olduğundan, API davranışı değiştiğinde sözleşme de güncellenmelidir.

### Orval

`lib/api-spec/orval.config.ts` iki çıktı üretir:

1. `api-client-react`: React Query client, `/api` base URL ve custom fetcher ile.
2. `zod`: OpenAPI şemalarından generated Zod çıktıları.

Codegen komutu:

```bash
pnpm --filter @workspace/api-spec run codegen
```

Bu komut Orval çıktısını üretir, `lib/api-zod/src/index.ts` export dosyasını günceller ve ardından `pnpm -w run typecheck:libs` çalıştırır.

### Generated Client

`lib/api-client-react/src/index.ts`, generated API hook'larını ve schema tiplerini dışa açar:

```ts
export * from "./generated/api";
export * from "./generated/api.schemas";
export { setBaseUrl, setAuthTokenGetter } from "./custom-fetch";
```

`custom-fetch.ts` şu sorumlulukları taşır:

- relative URL'ler için opsiyonel base URL uygulamak,
- bearer token getter üzerinden `Authorization` header'ı eklemek,
- JSON/text/blob response parse etmek,
- HTTP hata durumlarında `ApiError` fırlatmak,
- parse hataları için `ResponseParseError` üretmek.

Generated dosyalar elle değiştirilmemelidir. API sözleşmesi değiştiğinde `openapi.yaml` güncellenir ve codegen çalıştırılır.

## 7. Authentication

Authentication mevcut mimaride bearer token ve memory session üzerine kuruludur.

### Backend Akışı

```text
POST /api/auth/login
  -> usersTable kontrolü
  -> password hash doğrulama
  -> randomUUID token
  -> sessions Map
  -> token + user response
```

Her request'te `authMiddleware`:

1. `Authorization` header'ını okur.
2. `Bearer ` prefix'ini kontrol eder.
3. Token'ı `sessions` map içinde arar.
4. Bulursa `req.user` alanını doldurur.
5. Bulamazsa `req.user = null` bırakır.

### Roller

Mevcut kodda temel roller:

- `superadmin`: Tüm firmaları görebilir ve firma yönetimi yapabilir.
- `admin`: Kendi firmasındaki birimleri ve kullanıcıları yönetir.
- `user`: Kendi atanmış `unitId` kapsamındaki verilerle sınırlıdır.

Backend route'larında rol ve tenant kontrolü tekrar tekrar uygulanır. Örneğin:

- `companies` route'ları `requireSuperAdmin` ister.
- `units` route'larında `superadmin` tüm firmaları veya `companyId` filtresini; `admin` kendi firmasını; normal kullanıcı kendi birimini görür.
- `sub-units`, `meters`, `consumption` gibi route'lar `companyId` ve `unitId` ilişkilerini doğrular.

### Frontend Akışı

`AuthContext`:

- login için `/api/auth/login` çağırır,
- token'ı `localStorage` içine yazar,
- kullanıcı bilgisini saklar,
- token getter'ı generated API client'a verir,
- logout sırasında `/api/auth/logout` çağırır ve local state'i temizler.

React Query global hata yönetimi `401` hatalarında logout fonksiyonunu çağıracak şekilde ayarlanmıştır.

Authentication davranışı değiştirilirse backend middleware, auth route, frontend `AuthContext`, generated client token bağlantısı ve route guard'lar birlikte değerlendirilmelidir.

## 8. Multi Tenant

EnYS multi-tenant çalışır. Tenant izolasyonu mimarinin temel güvenlik kuralıdır.

Temel hiyerarşi:

```text
Company
  -> Unit
    -> SubUnit
      -> Energy Source
        -> Meter
          -> Consumption
```

Bu hiyerarşi bazı tablolarda doğrudan foreign key ile, bazı tablolarda ise `companyId`, `unitId`, `subUnitId`, `energySourceId` gibi alanların birlikte doğrulanmasıyla korunur.

### Company

`companiesTable`, tenant seviyesinin köküdür. Alanları:

- `id`
- `name`
- `subdomain`
- `isActive`
- `createdAt`

`superadmin` firma listesi ve firma CRUD işlemlerini yapabilir. `admin` ve `user` rolleri doğrudan firma yönetemez.

### Unit

`unitsTable`, company altında çalışan ana organizasyon birimidir. Her unit `companyId` taşır.

Rol davranışı:

- `superadmin`: Tüm unit kayıtlarını görebilir veya `companyId` ile filtreleyebilir.
- `admin`: Sadece kendi `sessionCompanyId` kapsamındaki unit kayıtlarını görür ve yönetir.
- `user`: Sadece kendi `sessionUnitId` değerine bağlı unit kaydını görür.

Frontend tarafında `UnitContext`, admin/superadmin için aktif birim filtresini `number | null` olarak tutar. `null`, "Tüm Birimler" görünümü anlamına gelir.

### SubUnit

`subUnitsTable`, unit altında alt birim/lokasyon seviyesidir. Hem `companyId` hem `unitId` taşır.

Route davranışı:

- Normal kullanıcı kendi unit'ine ait sub-unit kayıtlarını görür.
- Admin kendi firmasındaki sub-unit kayıtlarını görür; isteğe bağlı `unitId` filtresi uygulanır.
- Superadmin isteğe bağlı `companyId` ve `unitId` filtresi kullanabilir.

Sub-unit oluştururken hedef unit'in company ilişkisi kontrol edilir ve `companyId` parent unit'ten türetilir.

### Energy Source

`energySourcesTable`, unit altında enerji kaynağı tanımıdır. `companyId` ve `unitId` taşır.

Enerji kaynakları sayaç ve tüketim akışlarında filtreleme için kullanılır. Bir enerji kaynağının yanlış company veya unit altında kullanılması tenant izolasyonunu bozar; bu yüzden meter route'larında energy source ilişkisi company/unit seviyesinde doğrulanır.

### Meter

`metersTable`, tüketim verisinin bağlandığı ana ölçüm noktasıdır. Şu tenant alanlarını taşır:

- `companyId`
- `unitId`
- `subUnitId`
- `energySourceId`
- `energyUseGroupId`

Meter oluşturma ve güncelleme işlemlerinde:

- Normal kullanıcı sadece kendi birimine sayaç ekleyebilir.
- Admin hedef unit'in kendi firmasına ait olduğunu doğrular.
- Superadmin için company hedefi parent unit üzerinden belirlenir.
- `subUnitId`, `energySourceId` ve `energyUseGroupId` cross-company doğrulamasından geçer.
- Unit değişiyorsa mevcut sub-unit ve energy source uyumluluğu yeniden değerlendirilir.

### Consumption

`consumptionTable`, tüketim kaydını `meterId` üzerinden meter'a bağlar ve `companyId` taşır.

Tüketim listelenirken veya oluşturulurken meter'ın `unitId` ve `companyId` değerleri üzerinden yetki kontrolü yapılır:

- Normal kullanıcı yalnızca kendi unit'ine ait meter tüketimlerini görebilir/girebilir.
- Admin yalnızca kendi firmasındaki meter tüketimlerini görebilir/girebilir.
- Superadmin daha geniş kapsama sahiptir.

Tüketim verileri KPI, EnPI, hedef, enerji gözden geçirme ve raporlama modüllerini etkilediği için tenant filtresi bu katmanda özellikle kritiktir.

### Frontend Tenant State

Frontend tenant state'i üç context ile taşır:

- `CompanyContext`: Superadmin için aktif company filtresi.
- `UnitContext`: Admin/superadmin için aktif unit filtresi; normal user için kendi unit'i.
- `YearContext`: Tenant değil, raporlama dönemi filtresi.

Frontend filtreleri kullanıcı deneyimi içindir. Asıl tenant güvenliği backend route filtreleri ve DB ilişkileriyle sağlanır.

### Multi Tenant Geliştirme Kuralı

Yeni modül eklenirken her tablo ve endpoint için şu sorular cevaplanmalıdır:

- Kayıt hangi `companyId` kapsamına ait?
- Kayıt hangi `unitId` kapsamına ait?
- Normal kullanıcı bu kaydı görebilir mi?
- Admin yalnızca kendi firmasındaki veriye mi erişiyor?
- Superadmin için `companyId` filtresi gerekli mi?
- Parent-child ilişkisi create/update sırasında doğrulanıyor mu?
- Frontend filtreleri backend yetkisiyle tutarlı mı?

Bu sorular net cevaplanmadan multi-tenant veri modeli genişletilmemelidir.

## 9. Veri Akışı

Temel veri akışı:

```text
Frontend
  ->
API
  ->
DB
  ->
API
  ->
Frontend
```

### 1. Frontend

Sayfa bileşeni context değerlerini okur:

- `user`, `token`
- `companyId`
- `unitId`
- `year`

Sonra API parametrelerini oluşturur. Generated hook kullanıyorsa `@workspace/api-client-react` fonksiyonlarını çağırır; doğrudan fetch kullanıyorsa `/api/...` path'ine token header'ı ile istek yapar.

### 2. API

Express route isteği alır:

1. Global middleware request'i loglar ve body parse eder.
2. `authMiddleware` token'ı çözer.
3. Route guard yetkiyi kontrol eder.
4. Query/body parametreleri parse edilir.
5. Tenant filtresi uygulanır.
6. Drizzle sorgusu çalıştırılır.

### 3. DB

`@workspace/db` içindeki Drizzle instance PostgreSQL'e sorgu gönderir. Schema `energy.ts` içindeki tablo tanımlarıyla type-safe sorgu oluşturulur.

### 4. API Response

Route, DB sonucunu JSON olarak döndürür. Gerekirse join alanlarını normalize eder veya internal kontrol alanlarını response dışı bırakır.

### 5. Frontend Render

React Query sonucu cache'ler. Sayfa bileşeni loading/error/success durumlarına göre UI render eder. Mutation sonrası ilgili query key'ler invalidate edilmelidir.

Örnek tüketim akışı:

```text
Consumption page
  -> unit/source/sub-unit/meter filtreleri
  -> GET /api/meters veya GET /api/consumption
  -> meter + tenant kontrolü
  -> consumptionTable sorgusu
  -> JSON response
  -> tablo/form/grafik render
```

## 10. Geliştirme Prensipleri

Yeni modül eklerken sistem şu sırayla genişletilmelidir.

### 1. Veri Modelini Belirle

Yeni modül kalıcı veri tutacaksa önce tenant kapsamını belirle:

- Global mi?
- Company bazlı mı?
- Unit bazlı mı?
- Meter veya consumption gibi daha alt seviyeye mi bağlı?

Sonra `lib/db/src/schema/energy.ts` içinde tablo ve tip ihtiyacı değerlendirilir. DB değişikliği gerekiyorsa migration konusu ayrı ve kontrollü ele alınmalıdır.

### 2. API Sözleşmesini Belirle

Endpoint davranışı OpenAPI ile uyumlu olmalıdır. Yeni endpoint eklenecekse:

- path,
- method,
- operationId,
- request params/body,
- response schema,
- error davranışı

tasarlanmalıdır.

OpenAPI güncellenirse Orval codegen çalıştırılmalı ve generated client çıktısı kullanılmalıdır.

### 3. Backend Route Ekle

Route eklerken mevcut yapı korunmalıdır:

1. Dosya `artifacts/api-server/src/routes` altına eklenir veya ilgili mevcut route güncellenir.
2. Route `src/routes/index.ts` içine kaydedilir.
3. Uygun guard seçilir: `requireAuth`, `requireAdmin`, `requireSuperAdmin`.
4. Tenant filtresi ve parent-child doğrulamaları uygulanır.
5. Drizzle sorguları `@workspace/db` tablolarıyla yazılır.
6. Hata durumları açık HTTP status kodlarıyla döndürülür.

### 4. Frontend Sayfa veya Bileşen Ekle

Frontend geliştirme mevcut kalıba uymalıdır:

- Sayfa gerekiyorsa `src/pages` altında konumlandırılır.
- Reusable UI gerekiyorsa `src/components` altında ayrıştırılır.
- Auth/company/unit/year state'i context üzerinden alınır.
- API çağrısı mümkünse generated hook ile yapılır.
- Doğrudan fetch kullanılıyorsa token header ve cache invalidation dikkatle uygulanır.
- Route gerekiyorsa `App.tsx` içine eklenir.
- Menü/layout bağlantısı gerekiyorsa `Layout` ve ilgili navigasyon dosyaları kontrol edilir.

### 5. Cache ve State Tutarlılığını Koru

Mutation sonrası ilgili React Query cache key'leri invalidate edilmelidir. Generated hook kullanılıyorsa ilgili `get...QueryKey` yardımcıları tercih edilmelidir.

Company/unit/year filtreleri değiştiğinde eski tenant verisinin ekranda kalmaması için query key'ler parametreleri içermelidir.

### 6. Doğrulama Yap

Her modül değişikliği için en az şu kontroller beklenir:

```bash
pnpm run typecheck
pnpm run build
```

Frontend etkileniyorsa ilgili ekran manuel kontrol edilmelidir. API etkileniyorsa route'un auth ve tenant davranışı admin, superadmin ve normal user açısından düşünülmelidir.

### 7. Mimari Sınırları Koru

Yeni geliştirmelerde aşağıdaki sınırlar korunmalıdır:

- Authentication mimarisi açık talep olmadan değiştirilmez.
- Tenant izolasyonu zayıflatılmaz.
- Generated dosyalar elle düzenlenmez.
- Package eklemek son seçenek olmalıdır.
- Migration açık talep olmadan oluşturulmaz.
- Büyük refactor, küçük özellik işinin içine dahil edilmez.
- Route, schema, OpenAPI ve frontend client değişiklikleri birbiriyle tutarlı tutulur.

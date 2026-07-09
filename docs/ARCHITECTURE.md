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

### Katman Mimarisi

EnYS mimarisi browser'dan PostgreSQL'e kadar belirgin sorumluluk katmanlarıyla çalışır:

```text
Browser
  ->
React UI
  ->
React Context
  ->
React Query / Generated API Client
  ->
Vite Proxy
  ->
Express Route
  ->
Middleware / Auth Guard
  ->
Validation / Business Logic
  ->
Drizzle ORM
  ->
PostgreSQL
```

Katman sorumlulukları:

- Browser: Kullanıcının etkileşim yüzeyidir. Güvenlik veya tenant kararı vermez.
- React UI: Form, tablo, grafik, loading/error/empty state ve kullanıcı akışını yönetir. Veritabanı veya yetki kararını taklit etmemelidir.
- React Context: `AuthContext`, `CompanyContext`, `UnitContext` ve `YearContext` ile kullanıcı, tenant filtresi ve raporlama yılı bilgisini taşır. Backend yerine geçmez.
- React Query / API Client: Veri çekme, cache, mutation ve invalidation davranışını yönetir. API sözleşmesini atlayarak farklı response varsayımı yapmamalıdır.
- Vite Proxy: Local geliştirmede `/api` isteklerini `http://localhost:8080` adresine taşır. Production auth veya routing kararı vermez.
- Express Route: HTTP endpoint, guard, parametre parse, validation ve response üretiminden sorumludur.
- Middleware / Auth Guard: Token çözümleme, `req.user` doldurma ve rol bazlı erişim kontrolünü sağlar.
- Business Logic: Tenant filtreleri, parent-child doğrulamaları, ISO 50001 iş kuralları ve hata durumlarını yönetir.
- Drizzle ORM: Type-safe sorgu üretir ve schema ile runtime DB erişimi arasında köprü kurar.
- PostgreSQL: Kalıcı veri kaynağıdır. Uygulama seviyesindeki tenant ve auth kurallarının yerine geçmez.

En önemli sınır: UI kullanıcının ne görebileceğini kolaylaştırabilir, ancak kullanıcının neye erişmeye yetkili olduğunu backend belirler.

### Dependency Rule / Katmanlar Arası Bağımlılık Kuralları

EnYS'de katmanlar arası bağımlılık tek yönde ve kontrollü olmalıdır. Üst katmanlar alt katmanların sunduğu sözleşmeleri kullanır; alt katmanlar üst katmanların state, component veya ekran davranışına bağımlı olmaz.

İzin verilen temel akış:

```text
Browser
  ->
React UI
  ->
React Context
  ->
React Query / Generated API Client
  ->
API Route
  ->
Business Logic / Service
  ->
Drizzle
  ->
PostgreSQL
```

Pratik bağımlılık kuralları:

| Katman | Bağımlı Olabilir | Bağımlı Olmamalıdır |
| --- | --- | --- |
| React UI | React Context, generated API hook'ları, UI componentleri | Drizzle, DB schema, backend session yapısı |
| React Context | Auth response, kullanıcı/tenant seçimi, local UI state | Backend route iç mantığı, SQL veya Drizzle |
| React Query / Generated Client | OpenAPI sözleşmesi, custom fetcher, query key helper'ları | Elle değiştirilmiş generated dosya veya DB detayı |
| API Route | Middleware, validation, service/business logic, `@workspace/db` | Frontend component state'i, sayfa içi UI varsayımları |
| Business Logic / Service | Drizzle, schema tipleri, harici entegrasyon yardımcıları | React, Wouter, browser API'leri |
| `lib/db` | PostgreSQL, Drizzle schema/migration yapısı | Frontend veya API route state'i |
| `scripts` | `@workspace/db`, import/export kaynakları | Runtime uygulama davranışının yerine geçen iş mantığı |

Yasak veya hatalı akış örnekleri:

- React component doğrudan Drizzle veya DB mantığı bilmemelidir.
- Frontend tenant güvenliğini tek başına sağlamamalıdır.
- API route, frontend state yapısına veya component iç davranışına bağımlı olmamalıdır.
- `lib/db` frontend tarafından doğrudan kullanılmamalıdır.
- Generated client elle değiştirilmemelidir; kaynak `openapi.yaml` ve codegen akışıdır.
- `scripts` runtime API davranışının yerine geçmemeli; seed, import/export ve bakım amaçlı kalmalıdır.

Bu kuralın amacı mimariyi katılaştırmak değil, değişikliğin etkisini tahmin edilebilir tutmaktır. Bir katman sınırı aşılacaksa önce neden gerekli olduğu, tenant/auth etkisi ve test kapsamı açıkça değerlendirilmelidir.

### Request Lifecycle

Bir istek sistem içinde aşağıdaki sırayla ilerler:

```text
Browser
  ->
Vite Proxy
  ->
Express
  ->
Global Middleware
  ->
Authentication
  ->
Authorization
  ->
Route
  ->
Validation
  ->
Service / Business Logic
  ->
Drizzle
  ->
PostgreSQL
  ->
Response
  ->
React Query Cache
  ->
UI Update
```

Adımlar:

1. Browser, React ekranındaki kullanıcı aksiyonu veya query tetiklenmesiyle `/api/...` isteği oluşturur.
2. Vite dev server local geliştirmede bu isteği API sunucusuna proxy eder.
3. Express uygulaması isteği alır.
4. `pino-http`, CORS ve body parser middleware'leri çalışır.
5. `authMiddleware`, bearer token varsa `sessions` map üzerinden kullanıcıyı çözer ve `req.user` alanını doldurur.
6. Route bazındaki `requireAuth`, `requireAdmin` veya `requireSuperAdmin` guard'ı erişim yetkisini kontrol eder.
7. Route query, params ve body alanlarını parse eder.
8. Validation zorunlu alanları, tipleri, parent-child ilişkilerini ve tenant kapsamını doğrular.
9. Business logic, role göre filtreleri ve ISO 50001 iş kurallarını uygular.
10. Drizzle ORM, `@workspace/db` schema objeleriyle PostgreSQL sorgusunu üretir.
11. PostgreSQL sonucu döndürür.
12. Route sonucu normalize ederek JSON response üretir.
13. Generated client veya fetch helper response'u parse eder.
14. React Query sonucu cache'ler veya mutation sonrası ilgili query key'leri invalidate eder.
15. React UI loading/error/success state'e göre ekranı günceller.

Bu akışta tenant izolasyonu yalnızca tek bir noktaya bırakılmaz; auth, route validation, business logic, DB ilişkileri ve frontend query parametreleri birlikte tutarlı olmalıdır.

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

### Paket İlişki Diyagramı

Workspace paketleri birbirinden bağımsız klasörler gibi görünse de build ve runtime akışında birbirine bağlıdır:

```text
artifacts/api-server
  -> lib/db
  -> lib/api-zod

lib/api-spec
  -> lib/api-client-react
  -> lib/api-zod

artifacts/ems-dashboard
  -> lib/api-client-react

scripts
  -> lib/db

artifacts/mockup-sandbox
  -> build kapsamı dışında yardımcı/sandbox alan
```

Sorumluluk özeti:

- `artifacts/api-server`, çalışan HTTP API'dir; DB erişimini `@workspace/db` üzerinden yapar.
- `artifacts/ems-dashboard`, çalışan React arayüzüdür; mümkün olduğunda `@workspace/api-client-react` hook'larını kullanır.
- `lib/db`, kalıcı veri modelinin teknik kaynağıdır; schema değişikliği backend, scripts ve bazen frontend tiplerini etkiler.
- `lib/api-spec`, API sözleşmesinin kaynağıdır; frontend client ve Zod çıktıları buradan üretilir.
- `lib/api-client-react`, frontend'in kontrata bağlı API kullanımını sağlar.
- `lib/api-zod`, OpenAPI tabanlı generated validation/type çıktısı sağlar.
- `scripts`, uygulama runtime'ı dışında seed, import/export ve MGM veri işlemleri için kullanılır.

Monorepo kararında ana ilke şudur: çalışan uygulama kodu `artifacts`, paylaşılan sözleşme ve altyapı kodu `lib`, operasyonel yardımcılar `scripts` altında kalmalıdır.

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

### Route, Validation, Business Logic ve Response Sınırları

Route dosyaları HTTP sınırıdır. Bu katmanda yapılması gerekenler:

- path ve method tanımlamak,
- doğru auth guard'ı bağlamak,
- `req.params`, `req.query` ve `req.body` alanlarını parse etmek,
- zorunlu alanları ve temel tipleri doğrulamak,
- tenant ve rol filtrelerini uygulamak,
- gerekli business logic veya service fonksiyonunu çağırmak,
- anlaşılır HTTP status code ve JSON response dönmek.

Route içinde yapılmaması gerekenler:

- frontend davranışına güvenerek auth veya tenant kontrolünü atlamak,
- aynı parent-child doğrulamasını farklı endpoint'lerde tutarsız yazmak,
- generated client'a göre değil, rastgele response şekli üretmek,
- uzun ve tekrar eden business logic'i gereksiz yere route içinde büyütmek,
- veritabanı schema değişikliğini OpenAPI ve frontend etkisini düşünmeden yapmak.

Mevcut projede birçok route business logic'i aynı dosyada taşır. Yeni geliştirmede önce mevcut pattern korunmalı; logic çok büyür, tekrar eder veya ayrı test edilmesi gerekirse service katmanına ayrılmalıdır.

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

### React Veri Akışı

Bir ekran açıldığında veri akışı genellikle şu sırayla ilerler:

```text
App Provider zinciri
  ->
AuthContext
  ->
CompanyContext / UnitContext / YearContext
  ->
Page component
  ->
Generated API hook veya fetch helper
  ->
React Query cache
  ->
UI render
```

Context sorumlulukları:

- `AuthContext`: login/logout, token, kullanıcı bilgisi, loading state ve generated client token getter bağlantısı.
- `CompanyContext`: yalnızca `superadmin` için aktif company filtresi.
- `UnitContext`: `admin` ve `superadmin` için aktif unit filtresi; normal kullanıcı için kendi `unitId` kapsamı.
- `YearContext`: dashboard, analiz, hedef, performans ve raporlama ekranlarında kullanılan aktif yıl.

Sayfa bileşeni bu context değerlerini okuyarak API parametrelerini üretir. Örneğin admin için `unitId === null` "Tüm Birimler" görünümüdür; generated hook'a parametre gönderirken bazı akışlarda `null` yerine `undefined` kullanılması gerekir. Bu ayrım frontend cache key'leri ve backend filtreleriyle uyumlu olmalıdır.

React Query:

- GET isteklerinde loading/error/success state sağlar,
- response'u query key'e göre cache'ler,
- mutation sonrası ilgili query key'lerin invalidate edilmesini bekler,
- `401` hatalarında global hata yönetimi üzerinden logout akışını tetikleyebilir.

Generated client, API sözleşmesini frontend'e taşır. Doğrudan `fetch` kullanılan yerlerde aynı token, error ve cache davranışının elle korunması gerekir.

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

### Schema, Migration ve Runtime İlişkisi

Drizzle mimarisinde üç kavram birlikte düşünülmelidir:

```text
lib/db/src/schema/energy.ts
  -> TypeScript table/type kaynağı
  -> drizzle migration SQL dosyaları
  -> API build sırasında dist/drizzle kopyası
  -> runtime runMigrations
  -> PostgreSQL gerçek tablo yapısı
```

Schema değişirse şu alanlar etkilenebilir:

- backend route sorguları,
- insert/select TypeScript tipleri,
- `drizzle-zod` insert şemaları,
- seed/import/export scriptleri,
- OpenAPI response/request şemaları,
- generated client tipleri,
- frontend form ve tablo alanları,
- raporlama ve ISO 50001 hesaplama akışları.

Bu nedenle schema değişikliği yalnızca tablo alanı eklemek değildir; API, frontend, test ve migration uyumu gerektirir. Migration ise mevcut verinin yeni yapıya güvenli taşınmasıdır. Local/dev DB için hızlı `push` kullanılabilir, ancak paylaşılan veya kalıcı ortamda migration planı açık olmalıdır.

Runtime'da API başlangıcı migration klasörünü `dist/drizzle` altında beklediği için API build süreci migration dosyalarını kopyalar. Build çıktısı, schema ve migration klasörü uyumsuzsa uygulama başlama aşamasında veya ilk DB erişiminde hata verebilir.

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

### OpenAPI ve Orval Akışı

Gerçek geliştirme zinciri şu şekildedir:

```text
Backend davranışı
  ->
lib/api-spec/openapi.yaml
  ->
pnpm --filter @workspace/api-spec run codegen
  ->
lib/api-client-react/src/generated
  ->
lib/api-zod/src/generated
  ->
Frontend hook kullanımı
```

Bu zincir önemlidir çünkü frontend'in kullandığı hook isimleri, request parametreleri, response tipleri ve query key helper'ları OpenAPI sözleşmesinden üretilir. Backend davranışı değişip OpenAPI güncellenmezse frontend eski sözleşmeye göre çalışır. OpenAPI güncellenip codegen çalıştırılmazsa frontend eski generated client'ı kullanmaya devam eder.

Generated dosyalar elle değiştirilmez; çünkü bir sonraki codegen çalışmasında üzerine yazılır. Kalıcı değişiklik yapılacaksa kaynak dosya `openapi.yaml`, `orval.config.ts` veya custom fetcher olmalıdır.

API değişikliğinde beklenen sıra:

1. Backend davranışı ve response şekli netleştirilir.
2. OpenAPI sözleşmesi güncellenir.
3. Codegen çalıştırılır.
4. Frontend generated hook ve tiplerle güncellenir.
5. Typecheck ve ilgili manuel test yapılır.

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

### Authorization ve Tenant İlişkisi

Authentication "kullanıcı kim?" sorusunu cevaplar. Authorization ise "bu kullanıcı bu kaynağa erişebilir mi?" sorusunu cevaplar. EnYS'de authorization tenant hiyerarşisiyle birlikte uygulanır.

Rol davranışı mimari olarak:

- `superadmin`: Sistem seviyesinde çalışır. Firma yönetebilir, birden fazla company kapsamında veri görebilir. Buna rağmen frontend'de aktif company filtresi (`CompanyContext`) ve backend'de gerektiğinde `companyId` filtresi kullanılır.
- `admin`: Kendi `companyId` kapsamındaki unit, kullanıcı ve enerji verilerini yönetir. Başka company verisine erişmemelidir.
- `user`: Genellikle kendi `unitId` kapsamındaki operasyon verileriyle sınırlıdır. UI'da seçim alanları kısıtlanabilir, ancak gerçek sınır backend route'larında uygulanır.

Token tek başına tenant yetkisi anlamına gelmez. Token'dan çözülen `req.user` içindeki `role`, `companyId` ve `unitId` bilgileri route bazında filtreye dönüştürülmelidir. Özellikle `meters`, `consumption`, `sub-units`, `targets`, `risks`, `seu`, `energy-performance` ve `energy-review` gibi modüllerde parent kayıtların aynı tenant kapsamında olduğu doğrulanmalıdır.

Frontend route guard'ları kullanıcı deneyimi içindir. Backend guard ve tenant filtreleri olmadan güvenlik sağlanmış sayılmaz.

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

### Data Ownership / Veri Sahipliği İlkeleri

Veri sahipliği, EnYS'de tenant güvenliği ve ISO 50001 denetlenebilirliği için temel mimari karardır. Bir kaydın kime ait olduğu yalnızca frontend filtresiyle değil; backend route kontrolü, parent-child ilişkisi ve DB alanlarıyla doğrulanmalıdır.

Yönetim sistemi veri sahipliği şu akışla düşünülür:

```text
Company
  ->
Unit
  ->
SubUnit
  ->
Energy Source
  ->
Meter
  ->
Consumption
  ->
Variable / EnPI / SEU
  ->
Target / Action
  ->
Energy Review
  ->
Report
```

Sahiplik ilkeleri:

- `Company`, tenant sınırıdır. Farklı company verileri hiçbir route, rapor veya frontend cache davranışında karışmamalıdır.
- `Unit`, operasyonel sorumluluk sınırıdır. Normal kullanıcı erişimi çoğunlukla kendi unit kapsamıyla sınırlıdır.
- `SubUnit`, fiziksel lokasyon veya organizasyonel alt kapsamdır. Parent unit ve company ilişkisi create/update sırasında doğrulanmalıdır.
- `Energy Source`, tüketim verisinin enerji türü bağlamını belirler ve unit/company kapsamına bağlıdır.
- `Meter`, ölçüm noktasının sahibidir. Tüketim kaydının hangi unit, subUnit ve enerji kaynağına bağlandığı meter üzerinden doğrulanır.
- `Consumption`, enerji performansı hesaplarının ana girdisidir. Yanlış tenant veya meter ilişkisi EnPI, SEU, hedef, enerji gözden geçirme ve rapor çıktısını bozar.
- `Variable`, `EnPI` ve `SEU` kayıtları tüketim ve operasyon verilerinden türeyen performans/önceliklendirme kayıtlarıdır.
- `Target` ve `Action`, analiz sonucunu takip edilebilir yönetim sistemi işine dönüştürür.
- `Energy Review`, tüketim, performans, risk, fırsat, hedef ve aksiyonları denetlenebilir yönetim gözden geçirme bağlamında toplar.
- `Report`, bu ilişkilerin çıktı katmanıdır; sahiplik ve filtreleme hatalarını görünür hale getirir.

Rol bazlı sahiplik:

- Normal `user`, kendi `unitId` kapsamındaki verilere erişmelidir.
- `admin`, kendi `companyId` kapsamındaki unit ve alt verileri yönetmelidir.
- `superadmin`, daha geniş kapsamda çalışabilir; ancak company filtresi ve tenant bağlamı yine açık olmalıdır.

Frontend görünürlüğü veri sahipliği yerine geçmez. UI'da bir seçeneğin gizlenmesi güvenlik kontrolü değildir. Backend route'ları, ilgili parent kayıtların aynı company/unit zincirinde olduğunu doğrulamalı; DB ilişkileri de bu sahiplik modelini desteklemelidir.

Bu yaklaşım ISO 50001 açısından da kritiktir: denetimde bir tüketim kaydının hangi sayaçtan, hangi birimden, hangi enerji kaynağından geldiği ve hangi hedef/aksiyon/rapor çıktısını etkilediği geriye dönük izlenebilir olmalıdır.

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

### ISO 50001 Modül İlişkileri

EnYS modülleri bağımsız ekranlar olarak değil, ISO 50001 enerji yönetim döngüsünün bağlı parçaları olarak çalışır:

```text
Enerji Kaynağı
  ->
Sayaç
  ->
Tüketim
  ->
Değişken
  ->
EnPI
  ->
SEU
  ->
Enerji Gözden Geçirme
  ->
Hedef
  ->
Aksiyon
  ->
Rapor
```

Akışın anlamı:

- Enerji kaynağı, tüketimin hangi enerji türüyle ilişkili olduğunu belirler.
- Sayaç, ölçüm noktasını ve tenant kapsamını taşır.
- Tüketim, KPI, EnPI, hedef ve raporlama hesaplarının ana girdisidir.
- Değişkenler, üretim, hava durumu veya operasyonel etkenleri enerji performansı ile ilişkilendirir.
- EnPI ve baseline kayıtları performans değerlendirmesini oluşturur.
- SEU modülleri önemli enerji kullanımlarını tanımlar ve önceliklendirir.
- Enerji gözden geçirme, tüketim, performans, risk, fırsat, hedef ve aksiyonların yönetim sistemi seviyesinde değerlendirilmesini sağlar.
- Hedefler ve aksiyonlar, analiz sonucunu takip edilebilir iyileştirme planına dönüştürür.
- Raporlar, denetlenebilir çıktı üretir.

Bu nedenle bir modülde yapılan değişiklik diğer modüllerin hesaplama, filtreleme veya raporlama davranışını etkileyebilir. Örneğin tüketim kaydı yalnızca sayaç ekranının verisi değildir; enerji performansı, hedef ilerlemesi, SEU değerlendirmesi ve enerji gözden geçirme kayıtları için de girdidir.

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

## 11. Geleceğe Açık Mimari

EnYS bugün ISO 50001 odaklıdır, ancak ileride ISO 9001, ISO 14001, ISO 45001 veya ISO 27001 gibi farklı yönetim sistemi modüllerine genişleyebilir. Bu ihtimal mimari kararlarda dikkate alınmalıdır.

Korunması gereken genişleme noktaları:

- tenant, kullanıcı, rol, firma, birim ve raporlama altyapısı mümkün olduğunca ortak kalmalıdır,
- risk, fırsat, aksiyon, doküman, hedef ve rapor gibi yönetim sistemi kavramları gereksiz yere sadece enerji terminolojisine kilitlenmemelidir,
- ISO 50001'e özel hesaplama ve alanlar kendi modüllerinde tutulmalıdır,
- yeni standart ihtimali var diye bugünden gereksiz soyutlama ve genel framework yazılmamalıdır.

Doğru yaklaşım, bugünkü gerçek ihtiyaç için sade çözüm üretmek; ancak isimlendirme, tenant ilişkisi ve modül sınırlarını gelecekte genişlemeyi imkansız hale getirmeyecek şekilde korumaktır.

Örnek karar: Enerji tüketimi ve EnPI hesapları ISO 50001'e özgüdür. Ancak aksiyon planı, risk notu, kullanıcı rolü veya rapor üretimi gibi kavramlar ileride başka yönetim sistemi modülleriyle paylaşılabilecek şekilde temiz sınırlar içinde tutulmalıdır.

## 12. Performans Yaklaşımı

Performans mimarisi yalnızca runtime hızından ibaret değildir; geliştirme, typecheck, build ve frontend veri akışı da performansın parçasıdır.

### Frontend Performansı

- React Query cache, aynı veri için tekrar tekrar API çağrısı yapılmasını azaltır.
- `QueryClient` varsayılan `staleTime: 30_000` kullanır; bu değer gereksiz refetch'i azaltır.
- Query key'ler `companyId`, `unitId`, `year` ve ilgili filtreleri içermelidir; aksi halde eski tenant veya yıl verisi ekranda kalabilir.
- Mutation sonrası yalnızca ilgili query key'ler invalidate edilmelidir.
- Büyük listelerde filtreleme, sayfalama veya server-side query ihtiyacı değerlendirilmelidir.
- Lazy loading yalnızca gerçek bundle veya rota yükü belirginleşirse düşünülmelidir; her ekran için erken soyutlama yapılmamalıdır.

### Build ve Workspace Performansı

- TypeScript project references, `lib` paketlerinin ayrı kontrol edilmesini sağlar.
- Root `typecheck`, önce paylaşılan `lib` paketlerini sonra uygulama paketlerini kontrol eder.
- Vite frontend build'i `artifacts/ems-dashboard/dist/public` çıktısını üretir.
- API build'i esbuild kullanır ve migration/data gibi runtime dosyalarını dist altına taşır.
- Workspace filtreleri (`pnpm --filter ...`) geliştirme sırasında hedefli build/typecheck yapılmasını sağlar.

### Backend ve DB Performansı

- Tenant filtresi performans gerekçesiyle kaldırılmamalıdır.
- N+1 sorgu üretebilecek döngülerden kaçınılmalıdır.
- Liste endpoint'lerinde gereksiz geniş join veya tüm tenant verisini çekme davranışı dikkatle değerlendirilmelidir.
- Meter, consumption, target, EnPI ve report akışlarında veri hacmi büyüyebileceği için filtreler ve tarih/yıl parametreleri mimari olarak önemlidir.

Performans iyileştirmesi gerçek belirti, ölçüm veya kullanıcı etkisiyle yapılmalıdır. Varsayımsal optimizasyon büyük refactor gerekçesi olmamalıdır.

## 13. Mimari Karar İlkeleri

Yeni geliştirme yapılırken AI ve geliştiriciler aşağıdaki karar sırasını izlemelidir:

1. Mevcut pattern bulunur ve korunur.
2. Değişiklik mümkün olan en küçük güvenli kapsamda tutulur.
3. Tenant izolasyonu ilk tasarım kararı olarak değerlendirilir.
4. Authentication ve authorization davranışı açık talep olmadan değiştirilmez.
5. Mevcut API sözleşmesi gereksiz yere bozulmaz.
6. OpenAPI, generated client ve frontend kullanım zinciri birlikte düşünülür.
7. Schema değişikliği migration, API, frontend ve script etkileriyle birlikte değerlendirilir.
8. Package eklemek son çare olarak görülür.
9. Gereksiz refactor yapılmaz.
10. Büyük geliştirme küçük görevlere bölünür.
11. Doğrulama için en az typecheck, gerekiyorsa build ve manuel ekran/API testi yapılır.
12. Kullanıcı istemedikçe commit, push veya release yapılmaz.

Mimari karar verilemiyorsa tahminle ilerlenmemelidir. Önce ilgili dosyalar okunmalı, benzer uygulama aranmalı, risk tenant/auth/DB/API sözleşmesi seviyesindeyse kullanıcıdan net karar alınmalıdır.

## 14. Mimari Özet

EnYS mimarisinin temel felsefesi:

- Monorepo yapısı, çalışan uygulamaları `artifacts` altında; paylaşılan sözleşme ve altyapıyı `lib` altında toplar.
- Backend güvenlik sınırıdır; auth, authorization ve tenant izolasyonu backend route'larında korunur.
- Frontend kullanıcı deneyimini yönetir; context ve React Query ile doğru kapsamda veri ister.
- OpenAPI ve Orval, backend ile frontend arasındaki teknik sözleşmeyi taşır.
- Drizzle schema, veritabanı ve TypeScript dünyası arasındaki ana köprüdür.
- ISO 50001 modülleri birbirine bağlıdır; tüketimden rapora kadar veri akışı bütün olarak düşünülmelidir.
- Mimari kararlar sade, denetlenebilir, tenant güvenli ve uzun ömürlü olmalıdır.

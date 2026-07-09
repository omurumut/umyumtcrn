# Coding Rules

Bu doküman, EnYS projesinde kod yazacak tüm geliştiriciler ve AI geliştiricileri için zorunlu kodlama standardıdır. Kurallar projenin mevcut mimarisine dayanır ve `artifacts/api-server`, `artifacts/ems-dashboard`, `lib/db`, `lib/api-spec`, `lib/api-client-react` ve `scripts` paketlerinin çalışma biçimini korumayı amaçlar.

## 1. Genel Kodlama Prensipleri

### Önce Mevcut Kod Okunur

Kod yazmadan önce ilgili dosyalar okunmalıdır. EnYS monorepo içinde aynı işin backend, frontend, DB schema, OpenAPI ve generated client tarafları olabilir.

Bir değişikliğe başlamadan önce en az şu noktalar kontrol edilir:

- İlgili route: `artifacts/api-server/src/routes`
- İlgili context/page/component: `artifacts/ems-dashboard/src`
- İlgili tablo veya tip: `lib/db/src/schema/energy.ts`
- API sözleşmesi: `lib/api-spec/openapi.yaml`
- Generated client kullanımı: `lib/api-client-react/src`

Tahmin ederek kod yazılmaz. Mevcut pattern bulunur ve o pattern genişletilir.

### En Küçük Güvenli Değişiklik Yapılır

Değişiklik kapsamı isteği karşılayacak en küçük seviyede tutulmalıdır.

İyi değişiklik:

- ilgili dosyalarla sınırlıdır,
- mevcut davranışı korur,
- tenant izolasyonunu bozmaz,
- typecheck ve build ile doğrulanabilir,
- gereksiz mimari karar içermez.

Tek bir hata düzeltmesi için geniş çaplı dosya taşıma, component bölme, route yeniden yazma veya schema değişikliği yapılmaz.

### Gereksiz Refactor Yapılmaz

Refactor yalnızca açık ihtiyaç varsa yapılır. Özellikle şu durumlarda refactor yapılmaz:

- Kullanıcı yalnızca küçük bir bug fix istemişse.
- Kod çalışıyor ve değişiklik için yeniden düzenleme gerekmiyorsa.
- Refactor authentication, tenant filtreleri veya API sözleşmesi davranışını riske atıyorsa.
- Refactor çok sayıda ilgisiz dosyayı etkileyecekse.

AI geliştiricileri “temizlemek” amacıyla kodu yeniden şekillendirmemelidir. EnYS için güvenilir küçük değişiklik, estetik büyük değişiklikten daha değerlidir.

### Mevcut Pattern Korunur

Projede yerleşik kalıplar vardır:

- Backend route'ları Express `Router` modülleri olarak yazılır.
- Route'lar `src/routes/index.ts` içinde merkezi olarak kaydedilir.
- DB erişimi `@workspace/db` üzerinden Drizzle ile yapılır.
- Frontend ekranları `src/pages`, tekrar kullanılabilir parçalar `src/components` altında tutulur.
- Auth, company, unit ve year state'i context üzerinden alınır.
- API çağrıları mümkünse `@workspace/api-client-react` generated hook'larıyla yapılır.
- Bazı eski/özel akışlarda doğrudan `fetch` ve yerel `apiFetch` helper'ları bulunur; bu kalıp varsa dikkatli korunur.

Yeni kod, bulunduğu alanın mevcut stilini takip etmelidir.

### Kod Okunabilirliği

Kod açık, doğrudan ve izlenebilir olmalıdır.

- Anlamsız kısaltmalar kullanılmaz.
- Tekrarlayan tenant kontrolü anlaşılır kalacak şekilde yazılır.
- Karmaşık koşullar küçük yardımcı değişkenlerle okunabilir hale getirilir.
- Kullanılmayan import, state ve helper bırakılmaz.
- Yorum yalnızca karmaşık iş kuralını açıklamak için eklenir.
- İş mantığı UI metni veya CSS içinde saklanmaz.

### Naming Conventions

İsimlendirme, dosyanın hangi katmana ait olduğunu ve neyi temsil ettiğini hızlıca anlatmalıdır.

- Component isimleri PascalCase olmalıdır: `Dashboard`, `EnergyReview`, `MeterForm`.
- Hook isimleri `use` ile başlamalıdır: `useAuth`, `useUnit`, `useYear`, generated hook'larda Orval çıktısı korunur.
- Context isimleri domain + `Context` veya provider kalıbını izlemelidir: `AuthContext`, `UnitContext`, `CompanyProvider`.
- Backend route dosyaları domain odaklı kebab-case olmalıdır: `energy-sources.ts`, `sub-units.ts`, `energy-review.ts`.
- Frontend dosyalarında page componentleri PascalCase, klasör ve yardımcı dosyalar mevcut alanın stiline uygun olmalıdır.
- API `operationId` değerleri stabil, açıklayıcı ve generated hook üretimine uygun olmalıdır.
- DB table objeleri çoğul domain + `Table` kalıbını izlemelidir: `metersTable`, `consumptionTable`, `energyTargetsTable`.
- Insert/select tipleri domain anlamını korumalıdır: `InsertMeter`, `Consumption`, `EnergyTarget`.

İsimlendirme değişikliği davranış değiştirmese bile geniş etki yaratabilir. Generated hook, import ve type kullanımlarını etkileyen rename işlemleri küçük bug fix kapsamına alınmamalıdır.

### Dosya Organizasyonu

Kod, ait olduğu katmanda tutulmalıdır.

- Sayfalar `artifacts/ems-dashboard/src/pages` altında olmalıdır.
- Paylaşılan domain componentleri `artifacts/ems-dashboard/src/components` altında tutulmalıdır.
- Temel UI primitive bileşenleri `artifacts/ems-dashboard/src/components/ui` altında kalmalıdır.
- Backend route dosyaları `artifacts/api-server/src/routes` altında domain bazlı ayrılmalıdır.
- Route sayısı veya iş mantığı büyüyorsa helper/service yalnızca gerçek tekrar veya karmaşıklık varsa oluşturulmalıdır.
- MGM gibi entegrasyon veya zamanlayıcı işleri `artifacts/api-server/src/services` altında tutulabilir.
- DB schema ve tip kaynağı `lib/db/src/schema/energy.ts` dosyasıdır.
- OpenAPI sözleşmesi `lib/api-spec/openapi.yaml` dosyasıdır.
- Generated dosyalar kaynak değildir; codegen çıktısıdır ve elle düzeltilmez.

Dosya taşımak veya klasör yapısını değiştirmek mimari değişiklik sayılabilir. Bu tür değişiklikler yalnızca açık ihtiyaç varsa yapılmalıdır.

## 2. Backend Kuralları

Backend kodu `artifacts/api-server` paketindedir.

### Route Organizasyonu

Her iş alanı kendi route dosyasında tutulur:

```text
artifacts/api-server/src/routes/<domain>.ts
```

Yeni route dosyası eklendiğinde mutlaka `artifacts/api-server/src/routes/index.ts` içine import edilip `router.use(...)` ile kaydedilmelidir.

Route dosyalarında beklenen sıra:

1. Importlar.
2. `Router()` oluşturma.
3. Yardımcı tip/fonksiyonlar.
4. GET/POST/PATCH/DELETE endpoint'leri.
5. `export default router`.

Route handler içinde beklenen sıra:

1. `try/catch`.
2. `req.user` ve rol bilgilerinin alınması.
3. Query/body parse işlemleri.
4. Zorunlu alan kontrolü.
5. Tenant ve yetki kontrolü.
6. DB sorgusu.
7. Uygun status koduyla response.

### API Route Standardı

Route handler, okunabilir ve denetlenebilir bir sıra izlemelidir:

```text
Auth guard
  ->
Param/query/body parse
  ->
Validation
  ->
Tenant ve rol kontrolü
  ->
DB sorgusu veya service çağrısı
  ->
Response
  ->
Error handling
```

Pratik kurallar:

- Guard route tanımında açıkça görünmelidir.
- `req.params` ve `req.query` değerleri kullanılmadan önce parse edilmelidir.
- Validation, DB sorgusundan önce yapılmalıdır.
- Tenant kontrolü validation'dan sonra, veri erişiminden önce yapılmalıdır.
- Parent kayıtlar (`company`, `unit`, `meter` gibi) create/update sırasında doğrulanmalıdır.
- Response mevcut API pattern'iyle uyumlu olmalıdır.
- Hata durumunda kullanıcıya `{ error: string }` yapısında anlaşılır mesaj dönülmelidir.
- `catch` içinde log gerekiyorsa hassas veri yazılmadan backend logger kullanılmalıdır.

Route içinde frontend state varsayımı yapılmaz. Örneğin UI'da unit seçimi kısıtlı diye backend'de `unitId` kontrolü atlanmaz.

### Middleware Kullanımı

Global middleware sırası `app.ts` içinde korunur:

1. `pino-http`
2. `cors`
3. `express.json()`
4. `express.urlencoded(...)`
5. `authMiddleware`
6. `/api` router

Yeni middleware eklemek gerekiyorsa bu sıranın davranışa etkisi analiz edilmelidir. Auth öncesi veya sonrası çalışmasının güvenlik sonucuna dikkat edilmelidir.

### Auth Kuralları

Authentication mevcut yapıda bearer token ve memory session ile çalışır.

Mevcut guard'lar:

- `requireAuth`: Oturum gerektirir.
- `requireAdmin`: `admin` veya `superadmin` gerektirir.
- `requireSuperAdmin`: yalnızca `superadmin` gerektirir.

Kurallar:

- Auth mimarisi açık talep olmadan değiştirilmez.
- Token saklama, `sessions` map'i veya password hash davranışı değiştirilmez.
- Frontend route guard'ları güvenlik için yeterli kabul edilmez; backend guard zorunludur.
- Yeni veri route'u varsayılan olarak `requireAuth` ile korunmalıdır.
- Admin işlemlerinde `requireAdmin`, firma yönetimi gibi sistem seviyesi işlemlerde `requireSuperAdmin` kullanılır.

### Tenant İzolasyonu

EnYS multi-tenant çalışır. Temel hiyerarşi:

```text
Company
  -> Unit
    -> SubUnit
      -> Energy Source
        -> Meter
          -> Consumption
```

Her backend değişikliğinde şu kontroller yapılmalıdır:

- Kullanıcının `role`, `companyId` ve `unitId` bilgileri dikkate alındı mı?
- `admin` sadece kendi firmasındaki kayıtları görebiliyor mu?
- `user` sadece kendi `unitId` kapsamındaki kayıtları görebiliyor mu?
- `superadmin` için gerekiyorsa `companyId` filtresi destekleniyor mu?
- Create/update sırasında parent-child ilişkisi doğrulanıyor mu?
- Cross-company ilişki kurulması engelleniyor mu?

Örnek kurallar:

- Sub unit oluştururken parent unit'in company ilişkisi kontrol edilir.
- Meter oluştururken `subUnitId`, `energySourceId` ve `energyUseGroupId` aynı company/unit bağlamında doğrulanır.
- Consumption işlemlerinde yetki meter üzerinden kontrol edilir.
- Frontend'den gelen `companyId` veya `unitId` güvenilir kabul edilmez; backend tekrar doğrular.

Tenant filtresi eksik olan route güvenlik açığıdır.

### Drizzle Kullanımı

DB erişimi `@workspace/db` üzerinden yapılır:

```ts
import { db, metersTable } from "@workspace/db";
```

Kurallar:

- Tablo objeleri `lib/db/src/schema/energy.ts` içinden export edilen kaynaklardan kullanılmalıdır.
- Drizzle `eq`, `and`, `ne`, `sql` gibi helper'ları tercih edilir.
- Raw SQL yalnızca Drizzle helper'ları yeterli değilse ve açık gerekçeyle kullanılır.
- Insert/update sonrası response gerekiyorsa `.returning()` kullanılır.
- Delete işlemlerinde ilişkili kayıt davranışı schema ve mevcut route pattern'ine göre kontrol edilir.
- Büyük listelerde gereksiz tüm tablo çekimi yerine mümkün olduğunca DB seviyesinde filtreleme tercih edilir.

Mevcut bazı route'larda önce geniş sorgu, sonra JS tarafında tenant filtresi kullanımı vardır. Yeni kodda mevcut davranış korunurken mümkünse sorgu seviyesinde güvenli filtre tercih edilmelidir.

### Validation Yaklaşımı

Projede üç validasyon kaynağı vardır:

- Drizzle tablolardan türetilen `drizzle-zod` insert şemaları.
- OpenAPI'den türetilen `@workspace/api-zod` generated şemaları.
- Route dosyalarındaki manuel zorunlu alan ve parametre kontrolleri.

Kurallar:

- Mevcut route pattern'i korunur.
- Zorunlu alanlar açıkça kontrol edilir.
- `parseInt` sonucu kullanılacaksa `Number.isNaN` veya mantıksal geçerlilik değerlendirilir.
- Body'den gelen ID'ler sayı gibi görünse bile güvenilir kabul edilmez.
- Hatalar anlaşılır JSON response ile döndürülür.

### Zod ve Drizzle Kullanım Standardı

Drizzle schema, kalıcı veri modelinin TypeScript kaynağıdır. Zod ise runtime input doğrulaması için kullanılır.

Kullanım ilkeleri:

- `lib/db/src/schema/energy.ts` tablo, ilişki ve insert/select type kaynağıdır.
- `drizzle-zod` insert şemaları DB insert yapısına yakın doğrulama gerektiğinde kullanılır.
- `@workspace/api-zod` OpenAPI sözleşmesinden üretilir; API kontratıyla uyumlu validation/type ihtiyacında tercih edilir.
- Manuel validation, mevcut route pattern'i böyleyse veya küçük parametre/body kontrolleri için yeterliyse kullanılabilir.
- Zod, karmaşık body doğrulaması, tekrar eden input şekli veya OpenAPI ile uyumlu contract doğrulaması gerektiğinde tercih edilmelidir.
- Zod eklemek mevcut route davranışını sessizce değiştirmemelidir.

Schema değişikliği riskleri:

- backend sorguları ve route response'ları etkilenebilir,
- insert/select TypeScript tipleri değişebilir,
- OpenAPI ve generated client güncellemesi gerekebilir,
- frontend form, tablo ve mutation payload'ları etkilenebilir,
- migration ihtiyacı doğabilir.

Bu nedenle schema değişikliği küçük UI veya bug fix kapsamına gizlenmemelidir.

### Logging Kuralları

Backend loglarında mevcut `pino`/`pino-http` altyapısı tercih edilmelidir.

Kurallar:

- Debug amaçlı `console.log` commit edilmemelidir.
- Token, şifre, authorization header, kişisel veri veya hassas tenant verisi loglanmamalıdır.
- Hata logu geliştirici içindir; kullanıcıya dönen hata mesajı sade ve eyleme dönük olmalıdır.
- Log mesajları endpoint, işlem ve hata bağlamını anlatmalıdır.
- Frontend'de geçici debug logları commit edilmeden temizlenmelidir.
- Beklenen validation hataları gereksiz error log gürültüsüne çevrilmemelidir.

## 3. Frontend Kuralları

Frontend kodu `artifacts/ems-dashboard` paketindedir.

### Context Kullanımı

Mevcut provider sırası `App.tsx` içinde korunmalıdır:

```text
QueryClientProvider
  -> TooltipProvider
    -> AuthProvider
      -> YearProvider
        -> CompanyProvider
          -> UnitProvider
            -> AppInner
```

Context sorumlulukları:

- `AuthContext`: `user`, `token`, `login`, `logout`, `setAuthTokenGetter`.
- `CompanyContext`: sadece `superadmin` için aktif company filtresi.
- `UnitContext`: aktif unit filtresi; `null` "Tüm Birimler" anlamına gelir.
- `YearContext`: aktif yıl.

Kurallar:

- Auth bilgisi component prop zinciriyle taşınmaz; `useAuth` kullanılır.
- Aktif birim için `useUnit`, aktif firma için `useCompany`, yıl için `useYear` kullanılır.
- Normal kullanıcıların unit değiştirmesine izin verilmez.
- `unitId === null` özel anlam taşır; rastgele `0`, boş string veya magic value kullanılmaz.

### React Query

Veri çekme ve cache yönetimi için TanStack React Query kullanılır.

Kurallar:

- Query key, query sonucunu etkileyen tüm parametreleri içermelidir.
- `companyId`, `unitId`, `year`, `meterId`, `month` gibi filtreler query key dışında bırakılmamalıdır.
- Mutation sonrası ilgili query'ler invalidate edilmelidir.
- `401` hatalarında global logout davranışı korunmalıdır.
- Gereksiz refetch yaratacak inline nesneler ve değişen query key yapıları dikkatle kullanılmalıdır.
- `enabled` koşulu, veri çekmek için gereken parametreler hazır değilse kullanılmalıdır.

Generated hook kullanılırken yaygın kalıp:

```ts
useHookName(params, {
  query: { queryKey: getHookNameQueryKey(params) },
});
```

### Hook Standardı

Hook kullanımı veri akışını ve cache davranışını görünür tutmalıdır.

- Generated hook varsa öncelik generated hook'tadır.
- Custom hook yalnızca tekrar eden veri hazırlama, query parametresi üretme veya UI state davranışı gerçekten ortaksa oluşturulur.
- Custom hook içinde tenant, auth veya role güvenliği sağlanmış sayılmaz; backend yine doğrulamalıdır.
- Query key, sonucu etkileyen tüm parametreleri içermelidir.
- Mutation sonrası ilgili query key'ler invalidate edilmelidir.
- `enabled`, zorunlu parametre hazır değilse veya kullanıcı/tenant context'i yüklenmediyse kullanılmalıdır.
- Context değerleri hook parametrelerine açık şekilde yansıtılmalıdır.

Kötü hook kullanımı örnekleri:

- `unitId`, `companyId` veya `year` değiştiği halde query key'in değişmemesi.
- Mutation sonrası tüm cache'i gereksiz invalidate etmek.
- Gerekli ID yokken API çağrısı başlatmak.
- Generated hook varken aynı endpoint için farklı manuel fetch davranışı yazmak.

### Generated API Client

`@workspace/api-client-react` Orval tarafından üretilir. Kullanılması tercih edilir.

Kurallar:

- `lib/api-client-react/src/generated` dosyaları elle düzenlenmez.
- OpenAPI sözleşmesi değişirse `pnpm --filter @workspace/api-spec run codegen` çalıştırılır.
- `setAuthTokenGetter` bağlantısı `AuthContext` tarafından yönetilir; sayfalarda tekrar kurulmaz.
- Generated hook varsa manuel `fetch` eklemek yerine hook tercih edilir.
- Manuel `fetch` gerekiyorsa token header, error handling ve cache invalidation açıkça yönetilir.

### Component Organizasyonu

Kurallar:

- Ekran seviyesi bileşenler `src/pages` altında kalır.
- Paylaşılan UI parçaları `src/components` altında tutulur.
- Temel UI primitives `src/components/ui` altında mevcut stile uygun kullanılmalıdır.
- Sayfa çok büyürse yalnızca ilgili domain içinde anlamlı alt bileşenlere ayrılır.
- Component ayrıştırması davranışı değiştirmemelidir.

UI kodu, backend yetkilendirme davranışının yerine geçmez. Kullanıcıya bir butonu göstermemek güvenlik sayılmaz; backend yine de guard uygulamalıdır.

### Component Standardı

Component tipi, sorumluluğunu belirlemelidir.

- Page component: Route seviyesindeki ekranı temsil eder; context okur, API çağrısını başlatır, domain componentleri birleştirir.
- Domain component: Belirli iş alanına ait tablo, form, kart veya grafik davranışını taşır.
- UI primitive: Button, Dialog, Table, Input gibi genel bileşendir; iş kuralı içermez.
- Form component: Kullanıcı girdisini, validation mesajlarını, submit/loading state'i ve başarılı/başarısız sonucu yönetir.
- Table/list component: Listeleme, boş durum, loading, error ve satır aksiyonlarını tutarlı gösterir.

Her ekran şu state'leri düşünmelidir:

- loading: veri yüklenirken kullanıcı beklediğini anlamalıdır,
- error: hata anlaşılır ve eyleme dönük olmalıdır,
- empty: veri yoksa bunun normal mi aksiyon gerektiren bir durum mu olduğu anlaşılmalıdır,
- success: mutation sonrası kullanıcı sonucu görmelidir.

Component ayrıştırması yalnızca okunabilirliği artırıyorsa yapılmalıdır. Sırf dosya bölmek için component oluşturulmaz.

### UI Tasarım Öncelikleri

Yeni ekran veya UI değişikliğinde öncelik sırası:

1. Kullanıcının işi anlayabilmesi.
2. Veri doğruluğu.
3. Tenant/auth güvenliği.
4. Az tıklama.
5. Tutarlılık.
6. Estetik.

Görsel iyileştirme, veri doğruluğu veya güvenlik davranışının önüne geçmemelidir. EnYS kullanıcıları çoğu zaman enerji yönetimi işini tamamlamak ister; ekranlar sade, açıklayıcı ve tekrar eden işlerde hızlı olmalıdır.

### Form Davranışları

Formlar sade, öngörülebilir ve tenant hiyerarşisine uyumlu olmalıdır.

Kurallar:

- Zorunlu alanlar kullanıcıya açık olmalıdır.
- ID alanları string olarak geliyorsa backend'e gönderilmeden önce mevcut pattern'e uygun ele alınmalıdır.
- Seçim akışı hiyerarşiyi takip etmelidir: company -> unit -> sub unit -> energy source -> meter.
- Kullanıcı mümkün olduğunca az tıklamayla veri girebilmelidir.
- Tüketim, sayaç ve enerji performansı formlarında otomatik hesaplanan alanlar manuel müdahaleyle bozulmamalıdır.
- Form submit sonrası başarılı/başarısız durum kullanıcıya görünür olmalıdır.

### Hata Yönetimi

Kurallar:

- API hataları kullanıcıya anlaşılır mesajla gösterilmelidir.
- Teknik hata detayı kullanıcıya ham stack trace olarak verilmez.
- `401` durumunda global logout davranışı korunur.
- `toast` veya mevcut bildirim sistemi kullanılıyorsa TypeScript dönüş akışı bozulmamalıdır.
- `return toast()` anti-pattern'inden kaçınılır; bunun yerine:

```ts
toast();
return;
```

## 4. Database Kuralları

DB kodu `lib/db` paketindedir.

### Migration Oluşturma Kuralları

Migration oluşturmak veya DB state değiştirmek normal geliştirme adımı değildir. Açık kullanıcı talebi olmadan migration oluşturulmaz.

Özellikle yasak:

```bash
pnpm --filter @workspace/db run push
pnpm --filter @workspace/db run push-force
drizzle-kit push
drizzle-kit generate
drizzle-kit migrate
```

Bu komutlar Replit import sırasında çalıştırılmaz. Local/dev DB geliştirmesinde bile kullanılmadan önce risk değerlendirmesi yapılmalıdır.

### Schema Değişiklikleri

Ana schema:

```text
lib/db/src/schema/energy.ts
```

Schema değişikliği yapılacaksa:

- Etkilenen route'lar bulunur.
- OpenAPI sözleşmesi etkileniyor mu kontrol edilir.
- Frontend generated hook ve manuel fetch kullanan ekranlar kontrol edilir.
- Tenant alanları ve foreign key ilişkileri korunur.
- Migration gerekip gerekmediği açıkça belirlenir.

Schema değişikliği küçük UI işi içine saklanmamalıdır.

### Foreign Key İlişkileri

Mevcut schema, enerji yönetimi hiyerarşisini foreign key'lerle taşır.

Örnek ilişkiler:

- `units.companyId -> companies.id`
- `sub_units.unitId -> units.id`
- `energy_sources.unitId -> units.id`
- `meters.subUnitId -> sub_units.id`
- `meters.energySourceId -> energy_sources.id`
- `consumption.meterId -> meters.id`

Kurallar:

- Parent kayıt varlığı create/update sırasında doğrulanmalıdır.
- Cross-company ilişki kurulmasına izin verilmemelidir.
- `onDelete` davranışı schema ile uyumlu olmalıdır.
- Nullable foreign key alanlarında `null` ve `undefined` anlamları karıştırılmamalıdır.

### Tenant Alanları

Tenant kapsamlı tablolarda `companyId` temel izolasyon alanıdır. Çoğu operasyonel tabloda ayrıca `unitId`, `subUnitId`, `energySourceId` veya `meterId` bulunur.

Yeni tablo eklenecekse şu karar verilmelidir:

- Global tablo mu?
- Company bazlı mı?
- Unit bazlı mı?
- Meter veya consumption seviyesine mi bağlı?

Tenant alanı eksik tasarlanan tablo ileride güvenlik ve raporlama sorunu yaratır.

## 5. API Kuralları

### OpenAPI

API sözleşmesinin kaynağı:

```text
lib/api-spec/openapi.yaml
```

Kurallar:

- Yeni endpoint eklenirse OpenAPI sözleşmesi güncellenmelidir.
- Request parametreleri, body şeması ve response şeması gerçek backend davranışıyla uyumlu olmalıdır.
- `operationId` değerleri stabil ve açıklayıcı olmalıdır.
- Var olan API sözleşmesi kırılmamalıdır.

### Generated Client

Codegen komutu:

```bash
pnpm --filter @workspace/api-spec run codegen
```

Bu komut:

- React Query client üretir.
- API schema tiplerini üretir.
- Zod çıktılarını üretir.
- `typecheck:libs` çalıştırır.

Generated çıktı elle düzenlenmez. Değişiklik kaynağı `openapi.yaml` veya Orval config olmalıdır.

### Zod

Zod iki yerde kullanılır:

- `drizzle-zod` ile DB insert şemaları.
- Orval ile OpenAPI'den üretilen `@workspace/api-zod`.

Kurallar:

- Zod şemaları gerçek runtime davranışla uyumlu olmalıdır.
- Query ve param coercion OpenAPI/Orval tarafındaki mevcut ayarlara uygun olmalıdır.
- Route içinde manuel validation varsa Zod eklenirken davranış değişmemelidir.

### Response Yapısı

Kurallar:

- Başarılı liste response'ları array veya belgelenmiş object olarak dönmelidir.
- Create işlemleri genellikle `201` ve oluşturulan kayıt ile dönmelidir.
- Delete işlemleri genellikle `204` dönmelidir.
- Validation hataları `400`, auth eksikliği `401`, yetki hataları `403`, bulunamayan kayıtlar `404` kullanmalıdır.
- Hata response formatı mevcut pattern'e uygun olarak `{ error: string }` olmalıdır.
- Response içine internal tenant kontrol alanları gereksizse dahil edilmemelidir.

## 6. TypeScript Kuralları

Proje `tsconfig.base.json` içinde sıkı TypeScript ayarları kullanır:

- `noImplicitAny: true`
- `strictNullChecks: true`
- `noImplicitReturns: true`
- `noImplicitThis: true`
- `alwaysStrict: true`
- `useUnknownInCatchVariables: true`
- `isolatedModules: true`

### `any` Kullanımı

Yeni kodda `any` kullanılmamalıdır. Var olan dosyalarda explicit `any` bulunabilir; yeni değişiklikte mümkünse iyileştirilir ama ilgisiz refactor yapılmaz.

Tercihler:

- `unknown` kullan ve narrow et.
- Domain type tanımla.
- Generated schema/type kullan.
- Drizzle infer type kullan.

### Null Kontrolü

`null` ve `undefined` farklı anlamlar taşıyabilir.

Örnekler:

- Frontend `unitId === null`: "Tüm Birimler" görünümü.
- Optional query param: çoğu yerde `undefined` tercih edilir.
- Nullable DB foreign key: gerçek ilişki yok anlamında `null`.

Bu anlamlar karıştırılmamalıdır.

### Parse İşlemleri

Express 5'te route parametreleri `string | string[]` olabilir. Mevcut pattern:

```ts
const id = parseInt(req.params.id as string, 10);
```

Kurallar:

- `req.params` cast edilmeden doğrudan sayı gibi kullanılmaz.
- Query parametreleri parse edilirken `undefined` durumu korunur.
- Body'den gelen ID string olabilir; parse sonrası geçerlilik kontrol edilir.
- `Number(...)`, `parseInt(...)` ve boolean dönüşümleri açık yapılmalıdır.

### Return Akışı

`noImplicitReturns` aktiftir. Erken dönüşlerde response gönderildikten sonra `return` kullanılmalıdır.

Örnek:

```ts
if (!req.user) {
  res.status(401).json({ error: "Giriş yapmalısınız" });
  return;
}
```

## 7. Performans Kuralları

### Gereksiz Render

Frontend'de gereksiz render yaratabilecek değişikliklerden kaçınılır.

- Büyük inline object/function üretimleri dikkatli kullanılmalıdır.
- Context değerleri gereksiz sık değişmemelidir.
- Ağır hesaplamalar render içinde tekrar tekrar yapılmamalıdır.

Memoization yalnızca gerçek maliyet veya referans stabilitesi ihtiyacı varsa kullanılmalıdır. Gereksiz `useMemo`/`useCallback` kodu karmaşıklaştırır.

### Gereksiz Sorgu

API çağrıları ihtiyaç olduğunda yapılmalıdır.

- Gerekli filtre hazır değilse React Query `enabled` kullanılmalıdır.
- Aynı veri birden fazla kez çekiliyorsa query key ve cache yapısı kontrol edilmelidir.
- Mutation sonrası yalnızca ilgili query'ler invalidate edilmelidir.

### Büyük Listeler

Büyük liste potansiyeli olan alanlarda:

- DB seviyesinde filtreleme tercih edilir.
- Frontend tarafında gereksiz tüm veri çekimi yapılmaz.
- Tablo/listelerde arama ve filtreleme kullanıcı deneyimini bozmayacak şekilde tasarlanır.
- Export/import işlemleri UI thread'i gereksiz kilitlememelidir.

### Backend Performansı

- Tenant filtresi mümkün olduğunca DB sorgusuna dahil edilmelidir.
- Çok sayıda kayıt üzerinde JS tarafında filtreleme son seçenek olmalıdır.
- Join kullanılan sorgularda yalnızca gerekli kolonlar seçilmelidir.
- MGM/scheduler gibi ağır işler route response'unu gereksiz bekletmemelidir.

### Performans Anti-pattern'leri

EnYS uzun ömürlü bir kurumsal uygulamadır. Küçük performans hataları, veri hacmi ve kullanıcı sayısı arttıkça büyük bakım ve kullanıcı deneyimi problemlerine dönüşebilir.

Kaçınılması gereken anti-pattern'ler:

- Aynı endpoint'i farklı componentlerde aynı parametrelerle gereksiz tekrar çağırmak.
- React Query cache varken aynı server verisini ikinci kez local state içinde kaynak veri gibi tutmak.
- Büyük listeleri her render'da yeniden filtrelemek, sıralamak veya gruplayarak tabloya vermek.
- `useEffect` bağımlılıklarını eksik veya fazla tanımlayarak gereksiz API çağrıları oluşturmak.
- Küçük bir state değişikliğinde tüm sayfanın yeniden render olmasına neden olmak.
- Büyük tabloların tüm hesaplamalarını component gövdesinde sürekli çalıştırmak.
- Query invalidate işlemlerini gereğinden geniş tutarak ilgisiz ekranların yeniden veri çekmesine neden olmak.
- Aynı tenant, unit, year veya kullanıcı bilgisini farklı context'lerde tekrar saklamak.
- Ağır hesaplamaları ölçmeden `useMemo` ile sarmak veya tam tersi her render'da tekrar çalıştırmak.
- Performans problemini doğrulamadan varsayımla refactor yapmak.

Performans sorunu çözülmeden önce ölçüm yapılmalıdır:

- React Query Devtools veya query davranışı ile gereksiz refetch var mı kontrol edilir.
- Browser Network panelinde endpoint sayısı, süre ve tekrar eden istekler incelenir.
- React DevTools ile gereksiz render veya büyük component ağacı kontrol edilir.
- Büyük liste veya tablo davranışı gerçek veri hacmine yakın örnekle gözlemlenir.

Önce belirti ve ölçüm, sonra dar kapsamlı çözüm uygulanmalıdır. Performans bahanesiyle tenant filtresi, auth guard veya veri doğruluğu zayıflatılamaz.

## 8. Yasaklar

Açık kullanıcı talebi olmadan aşağıdakiler yapılmaz:

- Package ekleme veya package manager değiştirme.
- `pnpm-workspace.yaml` güvenlik ayarlarını gevşetme.
- Authentication mimarisini değiştirme.
- Generated dosya düzenleme.
- Migration oluşturma.
- DB push, push-force veya migration komutu çalıştırma.
- Büyük refactor.
- İlgisiz dosya değiştirme.
- Tenant izolasyonunu zayıflatma.
- API sözleşmesini kırma.
- Kullanıcı rollerinin anlamını değiştirme.
- Demo/admin kullanıcı davranışını değiştirme.
- Replit import sırasında DB state'e müdahale etme.

Generated dosyalar yalnızca codegen sonucu değişebilir. Codegen çalıştırılacaksa bunun nedeni açık olmalı ve çıktı kontrol edilmelidir.

### Anti-pattern Listesi

Aşağıdaki örnekler EnYS için özellikle risklidir:

- Frontend filtresini güvenlik kontrolü sanmak.
- Generated dosyayı elle düzeltmek.
- Küçük bug fix içinde refactor yapmak.
- Basit sorunu yeni package ekleyerek çözmek.
- Migration gerektiren işi gizlice yapmak.
- DB alanını UI varsayımıyla kullanmak.
- `return toast()` kullanmak.
- `companyId` veya `unitId` değerini backend'de doğrulamadan kullanmak.
- API response şeklini OpenAPI/generate client etkisini düşünmeden değiştirmek.
- Component içine SQL, Drizzle veya DB schema bilgisi taşımak.
- `scripts` ile runtime davranışını yamalamaya çalışmak.
- Hata yakalayıp sessizce yutmak.
- `any` ile type hatasını gizlemek.

Bu anti-pattern'lerden biri görülürse önce kapsam daraltılmalı, sonra mevcut mimariye uygun çözüm seçilmelidir.

## 9. Test ve Doğrulama

Her kod değişikliğinden sonra kapsamına göre doğrulama yapılmalıdır.

Temel doğrulama:

```bash
pnpm run typecheck
```

Yayın veya geniş kapsamlı değişiklik öncesi:

```bash
pnpm run build
```

Paket bazlı kontroller:

```bash
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/ems-dashboard run typecheck
pnpm --filter @workspace/scripts run typecheck
```

Frontend ekranı etkileniyorsa manuel test yapılmalıdır:

- Login sayfası açılıyor mu?
- `admin / admin123` ile giriş yapılabiliyor mu?
- İlgili ekran doğru veri çekiyor mu?
- Company/unit/year filtreleri doğru çalışıyor mu?
- Mutation sonrası liste güncelleniyor mu?
- Hata mesajları kullanıcıya görünüyor mu?

Backend route etkileniyorsa manuel veya otomatik testte şu roller düşünülmelidir:

- `superadmin`
- `admin`
- normal `user`
- oturumsuz istek

Playwright kullanılacaksa proje kökündeki test altyapısı üzerinden çalıştırılabilir:

```bash
pnpm exec playwright test
```

### Kod İnceleme Kontrolü

AI veya geliştirici işi bitirmeden önce şu soruları sormalıdır:

- Değişiklik yalnızca istenen kapsamda mı?
- Tenant izolasyonu korundu mu?
- `companyId`, `unitId`, `subUnitId`, `meterId` ilişkileri doğru doğrulandı mı?
- Auth guard doğru yerde mi?
- Normal user, admin ve superadmin davranışı düşünüldü mü?
- Frontend görünürlüğü backend güvenliği yerine kullanılmadı mı?
- React Query query key ve invalidation doğru mu?
- Loading, error ve empty state var mı?
- API response yapısı OpenAPI ve generated client ile uyumlu mu?
- Generated dosya elle değişmedi mi?
- Migration veya package değişikliği oluşmadı mı?
- TypeScript hatası `any` veya gereksiz cast ile gizlenmedi mi?
- Hata mesajı kullanıcıya sade, log geliştiriciye yeterli mi?
- İlgisiz refactor veya dosya değişikliği var mı?

Doğrulama çalıştırılamadıysa final raporda açıkça belirtilmelidir.

## 10. AI Geliştiricileri İçin Çalışma Sırası

AI geliştiricileri aşağıdaki sırayı varsayılan çalışma modeli olarak izlemelidir:

```text
Analiz
  ->
Plan
  ->
Kod
  ->
Typecheck
  ->
Build
  ->
Test
  ->
Commit
```

### Analiz

- Kullanıcı isteği okunur.
- `docs/AI_CONTEXT.md`, `docs/DEVELOPER_GUIDE.md`, `docs/ARCHITECTURE.md` ve bu dosya gerektiği kadar incelenir.
- İlgili kod dosyaları okunur.
- Tenant, auth, API ve DB etkisi belirlenir.

### Plan

- Değiştirilecek dosyalar belirlenir.
- Gereksiz dosyalar kapsam dışı bırakılır.
- Migration, package veya API sözleşmesi etkisi varsa ayrıca not edilir.

### Kod

- Sadece gerekli dosyalar düzenlenir.
- Mevcut pattern korunur.
- Generated dosyalar elle değiştirilmez.
- Kullanıcı değişiklikleri geri alınmaz.

### Typecheck

Öncelik:

```bash
pnpm run typecheck
```

Gerekirse paket bazlı typecheck yapılır.

### Build

Geniş kapsamlı veya yayın öncesi değişikliklerde:

```bash
pnpm run build
```

### Test

İlgili ekranlar ve roller manuel test edilir. Uygunsa Playwright çalıştırılır.

### Commit

Commit ancak kullanıcı istediğinde yapılır. Commit öncesi:

```bash
git status --short
git diff
```

ile yalnızca beklenen dosyaların değiştiği kontrol edilir.

## 11. Commit Kalitesi

Commit, yalnızca Git işlemi değil; değişikliğin gelecekte okunabilir, incelenebilir ve geri alınabilir olmasını sağlayan kalite sınırıdır.

Kurallar:

- Bir commit tek mantıksal değişikliği temsil etmelidir.
- Refactor ile yeni özellik mümkün olduğunca aynı commit içinde olmamalıdır.
- Dokümantasyon değişiklikleri mümkünse ayrı commit olarak tutulmalıdır.
- Commit mesajı yapılan işi açıkça anlatmalıdır.
- Büyük geliştirmelerde küçük ve sıralı commitler tercih edilmelidir.
- Push öncesinde `git status --short` ve `git diff` ile kapsam kontrol edilmelidir.
- Mümkün olduğunda commit öncesinde `pnpm run typecheck` ve ilgili build/test çalıştırılmalıdır.
- Commit geçmişi, sonradan bakan geliştiricinin neyin neden değiştiğini anlayabileceği kadar okunabilir olmalıdır.
- Gereksiz merge commit, geçici deneme commit'i veya `fix`, `update`, `wip` gibi anlamsız mesajlardan kaçınılmalıdır.

Commit kalitesi özellikle EnYS gibi tenant, auth, DB ve ISO 50001 süreçleri içeren bir üründe önemlidir. Küçük ve anlamlı commitler; hatanın kaynağını bulmayı, review yapmayı, release hazırlığını ve gerektiğinde geri dönüşü kolaylaştırır.

## Kalıcı Not

EnYS bir ISO 50001 enerji yönetim sistemi ürünüdür. Kod standardının amacı yalnızca TypeScript hatalarını önlemek değildir; amaç, sistemin denetlenebilir, sürdürülebilir, tenant güvenliği korunmuş ve kullanıcıların gerçek enerji yönetimi süreçlerine uygun kalmasını sağlamaktır.

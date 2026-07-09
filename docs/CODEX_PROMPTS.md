# Codex Prompts

Bu doküman, EnYS projesinde Codex ile yapılacak işler için standart görev şablonlarını içerir. Şablonlar yalnızca Codex için değil, benzer şekilde çalışan AI geliştirici araçları için de kullanılabilir.

Amaç; her işte aynı güvenlik, mimari ve doğrulama disiplinini korumaktır. Promptlar EnYS'in gerçek monorepo yapısına, Express API katmanına, React dashboard mimarisine, Drizzle/PostgreSQL veri modeline, OpenAPI/Orval generated client akışına ve multi-tenant izolasyon kurallarına göre hazırlanmıştır.

## 1. Kullanım Kuralları

### Kısa Açıklama

Bu doküman, Codex'e verilecek görevleri standartlaştırır. Her prompt; işin kapsamını, mimari sınırları, doğrulama adımlarını ve beklenen raporu açıkça belirtmelidir.

Codex ile çalışmaya başlamadan önce şu dokümanlar okunmalıdır:

- `docs/AI_CONTEXT.md`
- `docs/ARCHITECTURE.md`
- `docs/CODING_RULES.md`
- `docs/DEVELOPER_GUIDE.md`

Bu dosyalar EnYS'in proje hafızasıdır. Kod yazılacaksa ilgili kaynak dosyalar ayrıca okunmalıdır.

### Ne Zaman Kullanılır

Her Codex oturumundan önce veya yeni bir görev tanımlanırken kullanılır. Görev küçük olsa bile prompt, sınırları açıkça söylemelidir.

### Örnek Prompt

```text
Bu EnYS projesinde çalışacaksın.

Önce şu dokümanları oku:
- docs/AI_CONTEXT.md
- docs/ARCHITECTURE.md
- docs/CODING_RULES.md
- docs/DEVELOPER_GUIDE.md

Sonra isteği analiz et.
Kod yazmadan önce ilgili dosyaları oku.
Gereksiz refactor yapma.
Package ekleme.
Migration oluşturma.
Authentication değiştirme.
Tenant izolasyonunu bozma.
Generated dosyaları elle değiştirme.

İş bitince değiştirdiğin dosyaları ve çalıştırdığın doğrulama komutlarını raporla.
```

### Beklenen Çıktı

- Okunan bağlamın kısa özeti.
- Etkilenecek alanların listesi.
- Uygulandıysa değişen dosyalar.
- Çalıştırılan doğrulamalar.
- Yapılamayan doğrulamalar varsa nedeni.

### Codex'in Rolü

Codex, EnYS projesinde repo üzerinde çalışan uygulayıcı geliştirici aracıdır. Görevi; mevcut kodu ve dokümanları okuyarak dar kapsamlı analiz yapmak, gerekli dosyaları düzenlemek, doğrulama komutlarını çalıştırmak ve sonucu açık biçimde raporlamaktır.

Codex'in temel görevleri:

- repo yapısını ve ilgili dosyaları analiz etmek,
- kod geliştirmek veya hata düzeltmek,
- dokümantasyon geliştirmek,
- yalnızca gerekli olduğunda ve açık gerekçeyle refactor önermek veya yapmak,
- `pnpm run typecheck` ve gerektiğinde `pnpm run build` çalıştırmak,
- ilgili manuel/otomatik testleri raporlamak,
- değişen dosyaları, riskleri ve doğrulama sonucunu özetlemek.

Codex ürün sahibi veya mimar değildir. Ürün önceliği, kapsam kararı, risk kabulü, release kararı, commit/push onayı ve büyük mimari yön seçimi kullanıcıya aittir. Codex karar önerebilir, ancak belirsiz veya yüksek riskli durumda kullanıcıya soru sormalıdır.

### İyi Prompt Nasıl Yazılır?

İyi bir Codex promptu, uygulanabilir ve denetlenebilir olmalıdır. EnYS için iyi prompt aşağıdaki parçaları içermelidir:

| Bölüm | Neden Önemli? |
| --- | --- |
| Amaç | Codex'in neyi başarması gerektiğini netleştirir. |
| Kapsam | Hangi modül, ekran, route veya dokümanın etkileneceğini sınırlar. |
| İlgili dosyalar | Gereksiz repo taramasını azaltır ve doğru bağlamı hızla buldurur. |
| Yasaklar | Migration, package, auth, generated dosya ve ilgisiz refactor risklerini kapatır. |
| Kabul kriterleri | İşin bittiğinin nasıl anlaşılacağını tarif eder. |
| Çıktı formatı | Final raporun kısa, denetlenebilir ve karar verdirici olmasını sağlar. |

Örnek iyi prompt iskeleti:

```text
Amaç:
[Ne yapılacak?]

Kapsam:
[Hangi modül/ekran/route/doküman?]

Önce oku:
- docs/AI_CONTEXT.md
- docs/ARCHITECTURE.md
- docs/CODING_RULES.md
- [ilgili kaynak dosyalar]

Kurallar:
- Kod/package/migration/auth/generate sınırları
- Tenant izolasyonu
- Mevcut pattern

Kabul kriterleri:
- [Beklenen davranış]
- [Doğrulama]

Çıktı:
- Değişen dosyalar
- Doğrulama sonucu
- Riskler
```

### Kötü Prompt Örnekleri

Aşağıdaki promptlar EnYS için risklidir:

- "Düzelt."
- "Hepsini yeniden yaz."
- "Projeyi modernize et."
- "En iyi hale getir."
- "Kodları optimize et."

Bu promptlar kötüdür çünkü kapsam, risk, kabul kriteri ve yasakları belirtmez. Codex'in gereksiz refactor yapmasına, çok sayıda dosyaya dokunmasına, auth/tenant davranışını riske atmasına veya package/migration gibi yüksek etkili değişiklikleri gündeme almasına neden olabilir.

Kötü prompt yerine şu yaklaşım kullanılmalıdır:

- hangi davranış bozuk veya eksik açıkça yazılır,
- hangi dosya veya modülün inceleneceği belirtilir,
- yapılmaması gerekenler net söylenir,
- typecheck/build/test beklentisi açıklanır,
- final rapor formatı istenir.

### İyi Prompt Örnekleri

Kısa, tekrar kullanılabilir EnYS prompt örnekleri:

```text
Bug Fix:
EnYS projesinde [HATA] sorununu düzelt. Önce kök nedeni bul. İlgili route/page/context/schema dosyalarını oku. Gereksiz refactor yapma. Package, migration ve auth değiştirme. Tenant izolasyonunu koru. İş bitince değişen dosyaları, typecheck sonucunu ve kalan riski raporla.
```

```text
Yeni Ekran:
EnYS frontend içinde [EKRAN] ekranını mevcut component ve context pattern'lerine uygun geliştir. Önce ilgili page/component/context ve generated API client kullanımını incele. Backend güvenliğini UI'a taşıma. Responsive, loading, error ve empty state'leri düşün. Typecheck çalıştır ve sonucu raporla.
```

```text
Yeni API:
EnYS backend içinde [ENDPOINT] için API geliştirmesi yap. Önce ilgili route, schema, auth guard ve tenant ilişkilerini oku. OpenAPI etkisini değerlendir. Generated dosyaları elle değiştirme. Param parse, validation, tenant kontrolü, DB sorgusu ve response sırasını koru. Typecheck/build sonucunu raporla.
```

```text
Doküman Güncelleme:
Sadece docs/[DOSYA].md dosyasını geliştir. Kod, package, migration ve generated dosyalara dokunma. Mevcut dokümanı oku, eksikleri belirle, mevcut yapıyı bozmadan güncelle. İş bitince yalnızca değiştirdiğin dosyayı ve kısa özeti raporla.
```

```text
Kod İnceleme:
Kod değiştirmeden mevcut değişiklikleri incele. Git diff'i ve ilgili dosyaları oku. Önce bulguları önem sırasına göre raporla. Tenant, auth, OpenAPI/generated client, React Query, typecheck/build ve test risklerini belirt. Kod değiştirme.
```

```text
Refactor:
[ALAN] için refactor gerekli mi değerlendir. Önce mevcut kodu oku. Refactor gerekmiyorsa küçük güvenli alternatifi öner. Gerekliyse dosya listesi, riskler ve doğrulama planı sun. Kullanıcı onayı olmadan geniş refactor yapma.
```

```text
Performans Analizi:
[EKRAN/API] için performans analizi yap. Kod değiştirme. React Query, Network, render davranışı, DB sorgusu ve tenant filtrelerini incele. Varsayım yerine gözlem raporla. Çözüm önerilerini küçük ve risk sırasına göre listele.
```

### Prompt Karmaşıklık Seviyesi

EnYS geliştirmelerinde her iş tek bir prompt ile yapılmamalıdır. Promptun kapsamı, işin büyüklüğüne, etkileyeceği katmanlara ve risk seviyesine göre belirlenmelidir.

#### 1. Küçük Prompt

Küçük prompt, dar kapsamlı ve tek mantıksal değişiklik içeren işler için uygundur.

Örnekler:

- küçük bug fix,
- metin değişikliği,
- tek component düzeltmesi,
- tek route düzeltmesi,
- doküman güncellemesi.

Önerilen kapsam:

- 1-3 dosya,
- yaklaşık 10-30 dakika,
- tek mantıksal değişiklik.

Bu tür işlerde tek prompt yeterlidir. Yine de prompt; kapsamı, yasakları, değiştirilecek dosyayı veya modülü ve beklenen raporu açıkça belirtmelidir.

#### 2. Orta Ölçekli Prompt

Orta ölçekli prompt, birden fazla dosyayı veya iki katmanı etkileyen ama hâlâ kontrollü tutulabilen işler için uygundur.

Örnekler:

- yeni ekran,
- yeni endpoint,
- mevcut modül geliştirmesi,
- frontend ve backend'in birlikte değişmesi.

Önerilen kapsam:

- 3-10 dosya,
- yaklaşık 30-120 dakika,
- birkaç küçük adıma bölünebilir çalışma.

Bu tür işlerde Codex önce analiz yapmalı, ilgili route/page/context/schema/OpenAPI ilişkisini okumalı, ardından kontrollü değişiklikler uygulamalıdır. Her adımda tenant, auth, React Query ve generated client etkisi ayrıca düşünülmelidir.

#### 3. Büyük Prompt

Büyük prompt, aslında tek uygulama promptu olarak kullanılmamalıdır. Bu seviyede promptun amacı, geliştirmeyi doğrudan yaptırmak değil; ihtiyacı analiz ettirmek, kabul kriterlerini netleştirmek ve işi küçük görevlere böldürmektir.

Örnekler:

- yeni modül,
- kapsamlı refactor,
- büyük ISO 50001 geliştirmesi,
- birden fazla modülü etkileyen değişiklik.

Önerilen süreç:

```text
İhtiyaç Analizi
  ->
Kabul Kriterleri
  ->
Görevlere Bölme
  ->
Her görev için ayrı prompt
  ->
Her görev sonunda test
  ->
Son entegrasyon doğrulaması
  ->
Release
```

Temel ilke:

> Büyük geliştirmeler tek prompt, tek commit veya tek Codex oturumu olarak ele alınmamalıdır.

Bu yaklaşımın amacı:

- incelemeyi kolaylaştırmak,
- riski azaltmak,
- tenant ve auth güvenliğini korumak,
- geri dönüşü kolaylaştırmak,
- geliştirmeyi daha yönetilebilir hale getirmek.

Büyük işlerde ilk Codex görevi genellikle "analiz ve görev bölme" olmalıdır. Uygulama adımları daha sonra ayrı promptlarla, küçük ve doğrulanabilir parçalar halinde yürütülmelidir.

### Varsayılan Çalışma Sırası

Codex'in varsayılan çalışma sırası:

```text
İsteği oku
  ->
Dokümanları oku
  ->
İlgili dosyaları incele
  ->
Plan oluştur
  ->
Kod veya doküman değişikliği yap
  ->
Typecheck
  ->
Build
  ->
Test
  ->
Raporla
```

Her görevde tüm adımlar aynı ağırlıkta olmayabilir. Sadece doküman değişikliğinde typecheck/build gerekmez; API veya frontend kod değişikliğinde ise doğrulama beklenir. Doğrulama çalıştırılamadıysa sebep raporda açıkça yazılmalıdır.

### Dosya Okuma Stratejisi

Codex bütün repoyu baştan sona okumamalıdır. Önce hedefe en yakın dosyalar okunur, sonra ihtiyaç oldukça bağlam genişletilir.

Okuma stratejisi:

- Backend sorunu: ilgili route, `routes/index.ts`, auth middleware, DB schema ve gerekiyorsa service okunur.
- Frontend sorunu: ilgili page, component, context, generated hook kullanımı ve gerekirse layout/navigation okunur.
- Tenant sorunu: route, parent-child DB ilişkileri, `CompanyContext`, `UnitContext` ve ilgili filtreler okunur.
- OpenAPI sorunu: backend route, `lib/api-spec/openapi.yaml`, Orval config ve generated client kullanımı okunur.
- DB sorunu: `lib/db/src/schema/energy.ts`, migration durumu ve ilgili route/script okunur.
- Doküman işi: ilgili docs dosyası, gerekirse `package.json`, `pnpm-workspace.yaml`, `replit.md` ve ana referans dokümanları okunur.

Ek dosya yalnızca şu durumlarda okunmalıdır:

- mevcut dosya başka helper/service/context'e açıkça bağlıysa,
- typecheck/build hatası başka dosyayı işaret ediyorsa,
- tenant/auth/API sözleşmesi etkisi belirsizse,
- kullanıcı isteği birden fazla katmanı etkiliyorsa.

Amaç az dosya okumak değil, doğru dosyaları gereksiz gürültü oluşturmadan okumaktır.

### Güvenlik Kuralları

Codex açık kullanıcı talebi olmadan şunları yapmamalıdır:

- migration oluşturmak,
- DB push/push-force veya migration komutu çalıştırmak,
- package eklemek veya package manager değiştirmek,
- authentication davranışını değiştirmek,
- tenant izolasyonunu zayıflatmak,
- generated dosyaları elle değiştirmek,
- API sözleşmesini habersiz kırmak,
- gizli bilgileri, token'ları, şifreleri veya tenant verilerini loglamak,
- ilgisiz dosyalarda refactor yapmak,
- commit veya push yapmak.

Güvenlik kuralı yalnızca siber güvenlik değildir; EnYS için veri sahipliği, tenant izolasyonu, ISO 50001 denetlenebilirliği ve kullanıcı rollerinin korunması da güvenlik kapsamındadır.

### Çalışma Sonu Raporu

Her görevin sonunda Codex kısa ve denetlenebilir rapor vermelidir.

Rapor içeriği:

- hangi dosyalar değişti,
- neden değişti,
- typecheck sonucu,
- build sonucu,
- manuel/otomatik test sonucu,
- çalıştırılamayan adımlar ve nedenleri,
- kalan riskler,
- önerilen sonraki adım,
- commit/push yapılmadıysa bunun teyidi.

Sadece doküman işi yapıldıysa rapor kısa tutulmalı; değişen doküman dosyası ve kod/package/migration değişmediği belirtilmelidir. Kullanıcı özellikle "yalnızca değiştirdiğin dosyayı raporla" dediyse final rapor bu formata uymalıdır.

### AI İşbirliği

Codex, AI destekli geliştirme akışında repo üzerinde çalışan uygulayıcı roldedir.

- ChatGPT ihtiyaç, mimari seçenek, kalite sorusu veya prompt hazırlığında yardımcı olabilir.
- Codex dosyaları okur, değişiklik yapar, doğrulama çalıştırır ve sonucu raporlar.
- Kullanıcı kapsam, öncelik, risk kabulü, commit, push ve release kararını verir.

Codex şu durumlarda kullanıcıya soru sormalıdır:

- istek birden fazla güvenli yorum içeriyorsa,
- migration, package, auth veya API sözleşmesi değişikliği gerekebilecekse,
- tenant izolasyonu veya veri sahipliği belirsizse,
- kullanıcı "kod değiştirme" gibi net sınır koymuşsa ve istek bu sınırla çelişiyorsa,
- doğrulama için dış kaynak, credentials veya çalışan ortam gerekiyorsa.

Düşük riskli ve mevcut pattern'i açık olan küçük işlerde Codex soru sormadan ilerleyebilir.

### Codex Kalite Kontrol Listesi

Görev bitmeden önce Codex şu maddeleri kontrol etmelidir:

- İlgisiz dosya değişti mi?
- İstenen kapsam dışına çıkıldı mı?
- Tenant izolasyonu korundu mu?
- Authentication veya authorization değişti mi?
- Generated dosya elle değişti mi?
- Migration veya package değişikliği oluştu mu?
- OpenAPI/generated client etkisi varsa doğru ele alındı mı?
- React Query key ve invalidation davranışı korundu mu?
- Typecheck geçti mi veya neden çalıştırılamadı?
- Build gerekli miydi, çalıştı mı?
- Manuel/otomatik test ihtiyacı karşılandı mı?
- Kabul kriterleri karşılandı mı?
- Gereksiz refactor yapıldı mı?
- Final rapor kullanıcı formatına uyuyor mu?

## 2. Yeni Modül Geliştirme Promptu

### Kısa Açıklama

Yeni bir iş modülü, EnYS'in backend, frontend, DB, API sözleşmesi ve tenant yapısını etkileyebilir. Bu prompt, modül geliştirmesini kontrollü ve küçük adımlarla yaptırmak için kullanılır.

### Ne Zaman Kullanılır

Yeni bir ISO 50001 modülü, yönetim ekranı, raporlama alanı, analiz akışı veya domain özelliği geliştirileceğinde kullanılır.

### Örnek Prompt

```text
EnYS projesinde yeni bir modül geliştireceğiz: [MODÜL ADI].

Önce şu dokümanları oku:
- docs/AI_CONTEXT.md
- docs/ARCHITECTURE.md
- docs/CODING_RULES.md
- docs/DEVELOPER_GUIDE.md

Sonra mevcut mimariyi analiz et:
- artifacts/api-server/src/routes
- artifacts/ems-dashboard/src/pages
- artifacts/ems-dashboard/src/components
- artifacts/ems-dashboard/src/context
- lib/db/src/schema/energy.ts
- lib/api-spec/openapi.yaml
- lib/api-client-react/src

Kurallar:
- Mevcut pattern'i koru.
- En küçük güvenli değişikliği yap.
- Migration oluşturma.
- Package ekleme.
- Authentication değiştirme.
- Tenant izolasyonunu koru.
- Generated dosyaları elle değiştirme.
- OpenAPI gerekiyorsa önce etkiyi raporla.
- Typecheck ve build çalıştır.
- Yapılan değişiklikleri dosya dosya raporla.

Modül amacı:
[MODÜLÜN AMACI]

Beklenen davranış:
[BEKLENEN DAVRANIŞ]
```

### Beklenen Çıktı

- Modülün mevcut mimariyle ilişkisi.
- Değiştirilecek dosya listesi.
- Tenant ve auth etkisi.
- Uygulama değişiklikleri.
- `pnpm run typecheck` sonucu.
- Uygunsa `pnpm run build` sonucu.
- Manuel test notları.
- Commit mesajı önerisi.

## 3. Yeni CRUD Geliştirme Promptu

### Kısa Açıklama

CRUD geliştirmeleri EnYS'te çoğunlukla route, DB schema, OpenAPI, generated client ve React ekranını birlikte etkiler. Bu prompt, CRUD işinin uçtan uca ama kontrollü ele alınmasını sağlar.

### Ne Zaman Kullanılır

Yeni bir listeleme, oluşturma, güncelleme, silme ekranı veya mevcut bir CRUD akışına yeni alan/filtre ekleneceğinde kullanılır.

### Örnek Prompt

```text
EnYS projesinde [VARLIK ADI] için CRUD geliştirmesi yap.

Önce şu dokümanları oku:
- docs/AI_CONTEXT.md
- docs/ARCHITECTURE.md
- docs/CODING_RULES.md
- docs/DEVELOPER_GUIDE.md

Analiz et:
- İlgili backend route var mı?
- artifacts/api-server/src/routes/index.ts içinde kayıtlı mı?
- DB schema karşılığı lib/db/src/schema/energy.ts içinde var mı?
- Tenant alanları nelerdir?
- OpenAPI sözleşmesinde karşılığı var mı?
- lib/api-client-react generated hook kullanılabiliyor mu?
- Frontend sayfası veya component yapısı nerede olmalı?
- Auth rolü requireAuth, requireAdmin veya requireSuperAdmin mi olmalı?

Kurallar:
- Migration oluşturma.
- Package ekleme.
- Authentication değiştirme.
- Generated dosyaları elle değiştirme.
- Tenant izolasyonunu koru.
- Mevcut route/component/context pattern'lerini takip et.
- React Query query key ve invalidation davranışını doğru kur.
- Typecheck/build çalıştır.

CRUD kapsamı:
- Listeleme: [AÇIKLAMA]
- Oluşturma: [AÇIKLAMA]
- Güncelleme: [AÇIKLAMA]
- Silme: [AÇIKLAMA]
```

### Beklenen Çıktı

- Backend route durumu.
- Frontend ekran/component durumu.
- OpenAPI/generated client etkisi.
- Tenant izolasyonu için alınan önlemler.
- Değişen dosya listesi.
- Doğrulama sonuçları.
- Eksik kalan riskler veya manuel test önerileri.

## 4. Bug Fix Promptu

### Kısa Açıklama

Hata düzeltmelerinde önce kök neden bulunmalı, sonra en küçük güvenli düzeltme yapılmalıdır. Bu prompt gereksiz refactor ve yan etki riskini azaltır.

### Ne Zaman Kullanılır

Bir ekran bozulduğunda, API hatası oluştuğunda, yanlış veri listelendiğinde, tenant filtresi beklenmedik çalıştığında veya build/typecheck hatası düzeltileceğinde kullanılır.

### Örnek Prompt

```text
EnYS projesinde şu hatayı düzelt:
[HATA AÇIKLAMASI]

Önce kök nedeni bul.
Kod yazmadan önce ilgili dosyaları oku.

Kontrol et:
- Hata backend route kaynaklı mı?
- Frontend context veya React Query kullanımı kaynaklı mı?
- Generated API client veya OpenAPI uyumsuzluğu var mı?
- DB schema veya tenant ilişkisi etkileniyor mu?
- Auth/rol davranışı etkileniyor mu?

Kurallar:
- Gereksiz refactor yapma.
- En küçük güvenli değişikliği yap.
- Package ekleme.
- Migration oluşturma.
- Authentication değiştirme.
- İlgisiz dosyaları değiştirme.
- Typecheck çalıştır.
- Gerekiyorsa build ve ilgili manuel testi yap.

İş bitince:
- Kök nedeni açıkla.
- Değişen dosyaları listele.
- Test/doğrulama sonucunu raporla.
```

### Beklenen Çıktı

- Kök neden.
- Yapılan minimal düzeltme.
- Değişen dosyalar.
- Çalıştırılan test/typecheck/build sonucu.
- Kalan risk veya gözlem.

## 5. UI Geliştirme Promptu

### Kısa Açıklama

UI geliştirmeleri sade, kullanıcı dostu ve mevcut component sistemine uyumlu olmalıdır. EnYS kullanıcıları arasında mühendis olmayan operasyon kullanıcıları da bulunur.

### Ne Zaman Kullanılır

Yeni ekran düzeni, form iyileştirmesi, tablo/filtre düzenlemesi, dashboard kartı, rapor görünümü veya kullanıcı akışı geliştirileceğinde kullanılır.

### Örnek Prompt

```text
EnYS frontend içinde şu UI geliştirmesini yap:
[UI İSTEĞİ]

Önce ilgili sayfa ve componentleri oku:
- artifacts/ems-dashboard/src/pages
- artifacts/ems-dashboard/src/components
- artifacts/ems-dashboard/src/components/ui
- artifacts/ems-dashboard/src/context

Kurallar:
- Kullanıcı dostu ve sade olsun.
- Mevcut componentleri kullan.
- Gereksiz karmaşıklık oluşturma.
- Tenant akışını bozma.
- Company/unit/year context davranışını koru.
- Responsive davranışı koru.
- Hataları kullanıcıdan gizleme.
- Formlarda zorunlu alan ve loading/error state'lerini net göster.
- Backend auth veya tenant güvenliğini UI'a taşıma.
- Package ekleme.
- Typecheck çalıştır.

Beklenen UI davranışı:
[BEKLENEN DAVRANIŞ]
```

### Beklenen Çıktı

- Güncellenen sayfa/component listesi.
- Kullanılan mevcut UI pattern'leri.
- Responsive ve state davranışı özeti.
- Typecheck sonucu.
- Manuel ekran kontrolü notları.

## 6. Analiz Promptu

### Kısa Açıklama

Kod değiştirmeden yalnızca mevcut davranışı anlamak, riskleri belirlemek ve çözüm önermek için kullanılır.

### Ne Zaman Kullanılır

Bir özelliğin nasıl çalıştığı bilinmediğinde, değişiklik öncesi etki analizi gerektiğinde veya hata kaynağı araştırılacak ama henüz kod yazılmayacaksa kullanılır.

### Örnek Prompt

```text
EnYS projesinde şu konu hakkında sadece analiz yap:
[ANALİZ KONUSU]

Kod değiştirme.
Package değiştirme.
Migration oluşturma.
Hiçbir dosyayı düzenleme.

Önce ilgili dokümanları ve kaynak dosyaları oku.
Özellikle gerekirse şunları incele:
- docs/AI_CONTEXT.md
- docs/ARCHITECTURE.md
- docs/CODING_RULES.md
- artifacts/api-server/src/routes
- artifacts/ems-dashboard/src/pages
- artifacts/ems-dashboard/src/context
- lib/db/src/schema/energy.ts
- lib/api-spec/openapi.yaml

Beklenen çıktı:
- Mevcut davranış
- Olası riskler
- Önerilen çözüm
- Etkilenecek dosyalar
- Doğrulama önerisi
```

### Beklenen Çıktı

- Kod değişikliği olmadan analiz raporu.
- Mevcut akışın açıklaması.
- Riskler ve belirsizlikler.
- Önerilen çözüm yolu.
- Etkilenecek dosyaların listesi.

## 7. Doküman Güncelleme Promptu

### Kısa Açıklama

Sadece `docs` klasörü altında dokümantasyon güncellemek için kullanılır. Kod, package ve migration dosyalarına dokunulmaz.

### Ne Zaman Kullanılır

Geliştirici rehberi, mimari doküman, çalışma kuralları, prompt şablonları, release checklist veya troubleshooting içeriği güncelleneceğinde kullanılır.

### Örnek Prompt

```text
EnYS projesinde sadece dokümantasyon güncellemesi yap:
[DOKÜMAN İSTEĞİ]

Kurallar:
- Sadece docs klasörü altındaki ilgili dosyaları düzenle.
- Kod değiştirme.
- Package değiştirme.
- Migration oluşturma.
- Generated dosyaları değiştirme.
- Dokümanı gerçek proje mimarisine dayandır.
- Gerekirse package.json, pnpm-workspace.yaml, replit.md ve ilgili docs dosyalarını yalnızca oku.
- İş bitince sadece değiştirdiğin doküman dosyalarını listele.
```

### Beklenen Çıktı

- Güncellenen doküman dosyaları.
- Kısa içerik özeti.
- Kod/package/migration değişmediğinin teyidi.

## 8. Refactor Kontrol Promptu

### Kısa Açıklama

Refactor yapılmadan önce gerçekten gerekli olup olmadığını değerlendirmek için kullanılır. EnYS'te gereksiz refactor yasaktır.

### Ne Zaman Kullanılır

Kod karmaşık göründüğünde, tekrar eden yapı azaltılmak istendiğinde, component veya route bölme önerildiğinde ya da teknik borç temizliği yapılmadan önce kullanılır.

### Örnek Prompt

```text
EnYS projesinde şu alan için refactor gerekip gerekmediğini değerlendir:
[REFACTOR ALANI]

Önce analiz yap.
Kod yazmadan önce ilgili dosyaları oku.

Değerlendir:
- Refactor gerçekten gerekli mi?
- Kullanıcı isteğini karşılamak için refactor şart mı?
- Tenant izolasyonu, auth veya API sözleşmesi riske giriyor mu?
- Daha küçük güvenli bir değişiklik mümkün mü?
- Kaç dosya etkilenecek?
- Typecheck/build riski nedir?

Kurallar:
- Refactor gerekli değilse mevcut yapıyı koru.
- Gereksiz dosya taşıma yapma.
- Package ekleme.
- Migration oluşturma.
- Authentication değiştirme.
- Generated dosyaları elle değiştirme.

Eğer refactor öneriyorsan önce plan ve dosya listesi sun.
Kod yazmaya başlamadan önce riskleri açıkla.
```

### Beklenen Çıktı

- Refactor gerekli mi sorusuna net cevap.
- Gerekliyse gerekçe.
- Gerekli değilse küçük alternatif çözüm.
- Etkilenecek dosyalar.
- Riskler ve doğrulama planı.

## 9. Test Promptu

### Kısa Açıklama

Kod yazmadan yalnızca doğrulama, typecheck, build ve manuel test yapmak için kullanılır.

### Ne Zaman Kullanılır

Bir değişiklik sonrası kalite kontrol yapılacaksa, release öncesi kontrol isteniyorsa veya mevcut projenin çalışırlığı doğrulanacaksa kullanılır.

### Örnek Prompt

```text
EnYS projesinde yalnızca test ve doğrulama yap.

Kod değiştirme.
Package değiştirme.
Migration oluşturma.
Hiçbir dosyayı düzenleme.

Çalıştır:
- pnpm run typecheck
- pnpm run build

Gerekirse ilgili ekranları manuel kontrol et:
- Login
- Dashboard
- Birim Yönetimi
- Sayaç Yönetimi
- Tüketim Verileri
- İstekle ilgili özel ekranlar

Bulunan sorunları listele.
Kod düzeltmesi yapma.
Sonuçları komut bazında raporla.
```

### Beklenen Çıktı

- Çalıştırılan komutlar.
- Başarılı/başarısız sonuçlar.
- Hata varsa kısa kök neden tahmini.
- Manuel test edilen ekranlar.
- Kod değişikliği yapılmadığının teyidi.

## 10. Commit Hazırlama Promptu

### Kısa Açıklama

Commit atmadan önce değişiklikleri gözden geçirmek ve güvenli commit mesajı önermek için kullanılır. Bu prompt push yapmaz.

### Ne Zaman Kullanılır

Bir iş tamamlandıktan sonra commit öncesi kontrol isteniyorsa kullanılır.

### Örnek Prompt

```text
EnYS projesinde commit hazırlığı yap.

Commit atma.
Push yapma.
Kod değiştirme.
Package değiştirme.
Migration oluşturma.

Kontrol et:
- git status --short
- git diff

Raporla:
- Değişen dosyalar
- Hangi dosyalar bu işle ilgili
- İlgisiz dosya var mı
- Generated dosya değişmiş mi
- Package veya migration değişmiş mi
- Typecheck/build çalıştırılmış mı

Son olarak uygun commit mesajı öner.
```

### Beklenen Çıktı

- Git durum özeti.
- Değişen dosya listesi.
- İlgisiz değişiklik uyarısı.
- Riskli dosya uyarısı.
- Önerilen commit mesajı.
- Push yapılmadığının teyidi.

## 11. Büyük Özellik Geliştirme Promptu

### Kısa Açıklama

Yeni modül veya büyük geliştirmelerde işi aşamalı ve kontrollü yürütmek için kullanılır. Büyük işler tek hamlede değil, analiz ve plan sonrası uygulanmalıdır.

### Ne Zaman Kullanılır

Birden fazla katmanı etkileyen özelliklerde kullanılır:

- yeni ISO 50001 modülü,
- yeni dashboard/rapor akışı,
- yeni backend domain route'ları,
- yeni frontend ekranları,
- OpenAPI/generated client entegrasyonu,
- tenant kapsamlı veri modeli genişletmesi.

### Örnek Prompt

```text
EnYS projesinde büyük bir özellik geliştireceğiz:
[ÖZELLİK AÇIKLAMASI]

Önce şu dokümanları oku:
- docs/AI_CONTEXT.md
- docs/ARCHITECTURE.md
- docs/CODING_RULES.md
- docs/DEVELOPER_GUIDE.md

Beklenen çalışma sırası:

Analiz
↓
Plan
↓
Dosya listesi
↓
Kod
↓
Typecheck
↓
Build
↓
Test
↓
Rapor
↓
Commit önerisi

Kurallar:
- Önce mevcut mimariyi analiz et.
- İlgili backend route, frontend page/component/context, DB schema, OpenAPI ve generated client ilişkilerini oku.
- En küçük güvenli adımlarla ilerle.
- Tenant izolasyonunu bozma.
- Authentication değiştirme.
- Migration oluşturma.
- Package ekleme.
- Generated dosyaları elle değiştirme.
- OpenAPI değişirse codegen gereksinimini açıkça belirt.
- Kullanıcı istemedikçe commit veya push yapma.

Özellik kapsamı:
[DETAYLI KAPSAM]
```

### Beklenen Çıktı

- Analiz özeti.
- Net plan.
- Etkilenecek dosya listesi.
- Uygulama değişiklikleri.
- Typecheck sonucu.
- Build sonucu.
- Manuel/otomatik test sonucu.
- Kalan riskler.
- Commit mesajı önerisi.

## 12. Altın Kurallar

### Kısa Açıklama

Bu bölüm, tüm promptların ortak güvenlik ve kalite ilkelerini özetler.

### Ne Zaman Kullanılır

Her Codex görevinin sonunda kontrol listesi olarak kullanılır.

### Örnek Prompt

```text
İşi bitirmeden önce EnYS altın kurallarını kontrol et:

- Önce analiz yaptın mı?
- En küçük güvenli değişikliği mi yaptın?
- Mevcut pattern'i korudun mu?
- Tenant izolasyonunu bozmadın mı?
- Authentication değiştirmedin mi?
- Migration oluşturmadın mı?
- Package eklemedin mi?
- Generated dosyaları elle değiştirmedin mi?
- Typecheck ve gerekirse build çalıştırdın mı?
- Kullanıcı istemedikçe commit ve push yapmadın mı?

Son raporda bunları kısaca belirt.
```

### Beklenen Çıktı

- Altın kuralların kısa kontrol sonucu.
- Değişen dosyalar.
- Doğrulama sonuçları.
- Commit/push yapılmadıysa teyit.

## Hızlı Altın Kural Özeti

- Önce analiz.
- Küçük güvenli değişiklik.
- Mevcut pattern'i koru.
- Tenant izolasyonunu bozma.
- Authentication değiştirme.
- Migration oluşturma.
- Package ekleme.
- Generated dosyaları elle değiştirme.
- Typecheck ve build çalıştır.
- Kullanıcı istemedikçe commit ve push yapma.

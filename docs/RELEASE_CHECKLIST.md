# Release Checklist

Bu doküman, EnYS projesinde bir geliştirme GitHub'a gönderilmeden veya yeni sürüm yayınlanmadan önce uygulanacak standart kalite kontrol listesini tanımlar.

EnYS; ISO 50001 odaklı, multi-tenant çalışan, Express API ve React dashboard içeren bir enerji yönetim sistemi olduğu için release süreci yalnızca kodun build edilmesinden ibaret değildir. Tenant izolasyonu, authentication, OpenAPI uyumu, Drizzle schema ilişkileri, frontend kullanıcı deneyimi ve ISO 50001 süreç bütünlüğü birlikte kontrol edilmelidir.

## 1. Amaç

Release checklist'in amacı, GitHub'a gönderilecek veya yayınlanacak değişikliklerin güvenli, izlenebilir ve doğrulanmış olmasını sağlamaktır.

Bu checklist şu riskleri önlemeyi hedefler:

- TypeScript veya build hatalarının GitHub'a taşınması.
- Tenant izolasyonunun bozulması.
- Authentication veya authorization davranışının farkında olmadan değişmesi.
- OpenAPI ve generated client uyumsuzluğu.
- DB schema veya migration etkisinin gözden kaçması.
- Package veya lockfile değişikliklerinin yanlışlıkla commit edilmesi.
- Frontend'de loading, error, empty veya responsive state'lerin kırılması.
- ISO 50001 süreçleri arasında veri tutarsızlığı oluşması.
- İlgisiz dosyaların release kapsamına girmesi.

Release kararı, teknik doğrulama ve ürün etkisi birlikte değerlendirilerek verilmelidir.

### Release Felsefesi

EnYS'de release yalnızca kodun çalışması değildir. Release, yapılan değişikliğin güvenli, izlenebilir, tenant sınırlarını koruyan, veri doğruluğunu bozmayan ve kullanıcıya anlaşılır bir deneyim sunan hale geldiğini gösteren kalite kapısıdır.

Release sürecinin hedefleri:

- güvenli yayın yapmak,
- değişikliklerin Git geçmişinde ve dokümantasyonda izlenebilir kalmasını sağlamak,
- company ve unit bazlı tenant güvenliğini korumak,
- tüketim, sayaç, EnPI, SEU ve raporlama verilerinin doğruluğunu korumak,
- mühendis olmayan kullanıcılar için sade ve anlaşılır deneyimi sürdürmek,
- sorun çıkarsa geri dönüş yolunu açık tutmak.

Bu nedenle release kararı yalnızca `typecheck` ve `build` sonucuna göre verilmemelidir. EnYS için release; teknik doğrulama, veri sahipliği, ISO 50001 uyumu, kullanıcı deneyimi ve Git güvenliği birlikte sağlandığında hazır kabul edilir.

## 2. Genel Release Akışı

Önerilen release akışı:

```text
Analiz
  ->
Kod
  ->
Typecheck
  ->
Build
  ->
Manuel Test
  ->
Git Kontrolü
  ->
Commit
  ->
Push
  ->
Release
```

Her adımın amacı:

- Analiz: Değişikliğin backend, frontend, DB, OpenAPI, tenant ve ISO 50001 etkisi anlaşılır.
- Kod: En küçük güvenli değişiklik yapılır.
- Typecheck: TypeScript ve package referansları doğrulanır.
- Build: Backend ve frontend üretilebilirliği kontrol edilir.
- Manuel Test: Kullanıcı akışı ve kritik ekranlar doğrulanır.
- Git Kontrolü: İlgisiz veya riskli dosya değişiklikleri yakalanır.
- Commit: Küçük ve anlamlı Git geçmişi oluşturulur.
- Push: Doğrulanmış değişiklik GitHub'a gönderilir.
- Release: Kullanıcı onayı ve kalite kontrollerinden sonra yayın kararı verilir.

### Yayın Öncesi Teknik Kontroller

Release veya push öncesi hızlı teknik kontrol:

- [ ] `pnpm run typecheck` çalıştırıldı.
- [ ] `pnpm run build` çalıştırıldı.
- [ ] İlgili testler veya manuel doğrulamalar yapıldı.
- [ ] API server beklenen şekilde çalışıyor.
- [ ] Frontend uygulaması açılıyor.
- [ ] Kritik ekranlar açılıyor.
- [ ] Tarayıcı console'da yeni error yok.
- [ ] Network sekmesinde beklenmeyen `401`, `403`, `404` veya `500` yok.
- [ ] Login/logout akışı bozulmadı.
- [ ] Ana dashboard ve değişiklikten etkilenen modüller kontrol edildi.

Bu liste, ayrıntılı bölümlerin yerine geçmez; release öncesi ilk kalite kapısı olarak kullanılmalıdır.

## 3. TypeScript Kontrolü

Ana komut:

```bash
pnpm run typecheck
```

Gerekirse paket bazlı kontroller:

```bash
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/ems-dashboard run typecheck
pnpm --filter @workspace/scripts run typecheck
```

Kontrol listesi:

- [ ] `pnpm run typecheck` başarıyla tamamlandı.
- [ ] TypeScript hatası yok.
- [ ] Yeni `any` kullanımı eklenmedi veya açık gerekçeyle sınırlı tutuldu.
- [ ] `strictNullChecks` davranışı dikkate alındı.
- [ ] `noImplicitReturns` nedeniyle eksik `return` akışı yok.
- [ ] Import path hatası yok.
- [ ] Kullanılmayan veya yanlış import bırakılmadı.
- [ ] `req.params` ve query param parse işlemleri güvenli yapıldı.
- [ ] `null` ve `undefined` anlamları karıştırılmadı.

Özellikle dikkat edilmesi gerekenler:

- `unitId === null`, frontend'de "Tüm Birimler" anlamına gelir.
- Express route parametreleri `string | string[]` olabilir.
- Generated client tipleri elle düzeltilmemelidir; kaynak OpenAPI olmalıdır.

## 4. Build Kontrolü

Ana komut:

```bash
pnpm run build
```

Paket bazlı kontroller:

```bash
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/ems-dashboard run build
```

Kontrol listesi:

- [ ] `pnpm run build` başarıyla tamamlandı.
- [ ] Backend build başarılı.
- [ ] Frontend build başarılı.
- [ ] Build sırasında beklenmeyen warning yok.
- [ ] Build çıktısı beklenen klasörlere üretildi.
- [ ] API build sırasında migration dosyalarının `dist/drizzle` akışı bozulmadı.
- [ ] Frontend build çıktısı `artifacts/ems-dashboard/dist/public` altında oluşuyor.
- [ ] Generated dosyalar build hatası üretmiyor.
- [ ] OpenAPI değiştiyse codegen sonrası build tekrar çalıştırıldı.

Build warning'leri release öncesi incelenmelidir. Warning teknik olarak build'i durdurmasa bile runtime riski taşıyabilir.

## 5. Backend Kontrolü

Backend uygulaması `artifacts/api-server` altındadır. Release öncesi backend değişiklikleri şu başlıklarda kontrol edilmelidir.

### Route Kayıtları

- [ ] Yeni route dosyası `artifacts/api-server/src/routes/index.ts` içinde kayıtlı.
- [ ] Route path `/api` altında beklenen URL ile çalışıyor.
- [ ] HTTP method ve response status kodları doğru.
- [ ] Yeni route eklenmişse API server yeniden başlatma ihtiyacı biliniyor.

### Middleware

- [ ] `app.ts` middleware sırası bozulmadı.
- [ ] `authMiddleware` global davranışı korunuyor.
- [ ] Yeni middleware auth veya body parse akışını kırmıyor.
- [ ] Logging davranışı gereksiz hassas veri yazmıyor.

### Authentication ve Authorization

- [ ] `requireAuth` gereken route'larda kullanıldı.
- [ ] Admin işlemlerinde `requireAdmin` kullanıldı.
- [ ] Superadmin işlemlerinde `requireSuperAdmin` kullanıldı.
- [ ] Authentication akışı değiştirilmedi.
- [ ] `sessions` map, token üretimi ve logout davranışı korunuyor.
- [ ] Frontend route guard'ına güvenilip backend guard atlanmadı.

### Tenant İzolasyonu

- [ ] `companyId` filtresi gereken sorgularda uygulanıyor.
- [ ] `unitId` filtresi gereken sorgularda uygulanıyor.
- [ ] Normal user yalnızca kendi unit kapsamındaki veriyi görebiliyor.
- [ ] Admin yalnızca kendi company kapsamındaki veriyi görebiliyor.
- [ ] Superadmin için gerekli `companyId` filtresi destekleniyor.
- [ ] Create/update işlemlerinde parent-child ilişkisi doğrulanıyor.
- [ ] Cross-company ilişki kurulması engelleniyor.

### Error Handling ve Logging

- [ ] Validation hataları `400` ile dönüyor.
- [ ] Auth eksikliği `401` ile dönüyor.
- [ ] Yetki hataları `403` ile dönüyor.
- [ ] Bulunamayan kayıtlar `404` ile dönüyor.
- [ ] Beklenmeyen hatalar loglanıyor ve `500` ile dönüyor.
- [ ] Hata response formatı mevcut pattern'e uygun: `{ error: string }`.

## 6. Frontend Kontrolü

Frontend uygulaması `artifacts/ems-dashboard` altındadır.

Kontrol listesi:

- [ ] İlgili sayfa açılıyor.
- [ ] Login gerektiren sayfalar auth gate altında kalıyor.
- [ ] Admin/superadmin route guard davranışı doğru.
- [ ] Responsive görünüm bozulmadı.
- [ ] Loading state görünüyor.
- [ ] Error state kullanıcıya anlaşılır mesaj veriyor.
- [ ] Empty state kullanıcıyı yönlendiriyor.
- [ ] Form validation çalışıyor.
- [ ] Zorunlu alanlar açık.
- [ ] Submit sonrası başarı/hata bildirimi var.
- [ ] Toast mesajları anlaşılır.
- [ ] `return toast()` anti-pattern'i eklenmedi.
- [ ] React Query query key'leri filtreleri içeriyor.
- [ ] Mutation sonrası ilgili query invalidate ediliyor.
- [ ] `401` durumunda global logout davranışı korunuyor.
- [ ] `CompanyContext`, `UnitContext`, `YearContext` kullanımı doğru.
- [ ] `unitId === null` anlamı korunuyor.

### UI Kontrol Listesi

UI değişikliği varsa aşağıdaki davranışlar ayrıca kontrol edilmelidir:

- [ ] Mobil ve masaüstü responsive görünüm kabul edilebilir.
- [ ] Loading state kullanıcıyı bekleme konusunda bilgilendiriyor.
- [ ] Error state teknik detayı saklayıp anlaşılır mesaj gösteriyor.
- [ ] Empty state kullanıcıya bir sonraki adımı anlatıyor.
- [ ] Toast mesajları kısa, anlaşılır ve işlem sonucuyla uyumlu.
- [ ] Form doğrulama submit öncesi ve submit sonrası doğru çalışıyor.
- [ ] Tablo/listelerde kolonlar taşmıyor.
- [ ] Filtreler seçilen company/unit/year bağlamıyla uyumlu.
- [ ] Sıralama varsa beklenen veri tipine göre çalışıyor.
- [ ] Sayfalama veya büyük liste davranışı kullanıcıyı yavaşlatmıyor.
- [ ] Tarayıcı console'da yeni hata yok.
- [ ] Network hataları kullanıcıya gizlenmiyor.

Manuel testte tarayıcı console hataları da kontrol edilmelidir.

## 7. Database Kontrolü

DB paketi `lib/db` altındadır. Ana schema dosyası:

```text
lib/db/src/schema/energy.ts
```

Kontrol listesi:

- [ ] Migration oluştu mu?
- [ ] Migration kullanıcı tarafından açıkça istendi mi?
- [ ] Schema değişti mi?
- [ ] Schema değiştiyse etkilenen route'lar kontrol edildi mi?
- [ ] Foreign key ilişkileri doğru mu?
- [ ] `companyId` tenant alanı gereken tablolarda var mı?
- [ ] `unitId`, `subUnitId`, `energySourceId`, `meterId` ilişkileri doğru mu?
- [ ] `onDelete` davranışı mevcut veri modeliyle uyumlu mu?
- [ ] Yeni sorgu için index ihtiyacı var mı?
- [ ] Generated schema veya Zod çıktısı etkileniyor mu?
- [ ] DB push, push-force veya migration komutu bilinçsiz çalıştırılmadı.

Release öncesi özellikle şu komutların yanlışlıkla çalıştırılmadığından emin olun:

```bash
pnpm --filter @workspace/db run push
pnpm --filter @workspace/db run push-force
drizzle-kit push
drizzle-kit generate
drizzle-kit migrate
```

Bu komutlar açık karar ve kontrollü local/dev DB süreci olmadan kullanılmamalıdır.

### Release Öncesi DB Kararları

DB veya package etkisi olan değişikliklerde şu sorular net cevaplanmalıdır:

- [ ] Migration gerçekten gerekli mi?
- [ ] Migration gerekiyorsa kullanıcı tarafından açıkça istendi mi?
- [ ] `lib/db/src/schema/energy.ts` değişti mi?
- [ ] Schema değiştiyse backend route, OpenAPI ve frontend etkisi kontrol edildi mi?
- [ ] Package değişti mi?
- [ ] Lockfile değişikliği bilinçli mi?
- [ ] Generated dosya değişti mi?
- [ ] Generated dosya değiştiyse kaynak OpenAPI veya schema değişikliği biliniyor mu?

Belirsiz DB değişiklikleri release kapsamına alınmamalıdır. Önce migration, schema ve veri sahipliği etkisi ayrı analiz edilmelidir.

## 8. OpenAPI Kontrolü

OpenAPI kaynağı:

```text
lib/api-spec/openapi.yaml
```

Generated client kaynağı:

```text
lib/api-client-react/src/generated
lib/api-zod/src/generated
```

Kontrol listesi:

- [ ] Backend API davranışı değiştiyse OpenAPI güncellendi.
- [ ] Request params/body şemaları gerçek backend ile uyumlu.
- [ ] Response şemaları gerçek backend ile uyumlu.
- [ ] `operationId` değerleri stabil ve anlamlı.
- [ ] OpenAPI değiştiyse codegen çalıştırıldı.
- [ ] Generated client güncellendi.
- [ ] Generated dosyalar elle değiştirilmedi.
- [ ] Frontend generated hook kullanımı yeni sözleşmeyle uyumlu.
- [ ] `@workspace/api-zod` çıktıları typecheck'ten geçti.

Codegen komutu:

```bash
pnpm --filter @workspace/api-spec run codegen
```

## 9. Git Kontrolü

Release veya push öncesi Git durumu mutlaka incelenmelidir.

Komutlar:

```bash
git status --short
git diff
```

Kontrol listesi:

- [ ] Değişen dosyalar beklenen dosyalar.
- [ ] İlgisiz dosya değişikliği yok.
- [ ] Commit mesajı uygun.
- [ ] Generated dosya değişikliği bilinçli.
- [ ] Package değişikliği bilinçli.
- [ ] Migration değişikliği bilinçli ve kullanıcı onaylı.
- [ ] Lockfile beklenmedik değişmedi.
- [ ] Build output veya geçici dosyalar commit'e girmiyor.
- [ ] `.env`, secret veya bağlantı bilgisi commit'e girmiyor.
- [ ] Git status temiz veya kalan değişikliklerin release dışında olduğu biliniyor.
- [ ] Commitler küçük ve anlamlı.
- [ ] Gereksiz dosya değişikliği yok.
- [ ] İlgili dokümantasyon güncellendi veya güncelleme gerekmiyor.

Commit öncesi staged diff ayrıca kontrol edilmelidir:

```bash
git diff --staged
```

## 10. ISO 50001 Kontrolü

EnYS release'i yalnızca teknik olarak değil, ISO 50001 süreç bütünlüğü açısından da değerlendirilmelidir.

Kontrol listesi:

- [ ] Tenant izolasyonu korunuyor.
- [ ] EnPI hesapları etkileniyorsa doğru veri kaynağı kullanılıyor.
- [ ] SEU etkisi değerlendirildi.
- [ ] KPI dashboard etkisi değerlendirildi.
- [ ] Hedefler etkileniyorsa hedef ilerleme davranışı kontrol edildi.
- [ ] Aksiyonlar etkileniyorsa aksiyon-plan ilişkisi korunuyor.
- [ ] Risk modülü etkileniyorsa risk/fırsat ayrımı korunuyor.
- [ ] Fırsat yönetimi etkileniyorsa kayıt izlenebilirliği korunuyor.
- [ ] Enerji Gözden Geçirme çıktıları etkileniyorsa ilgili özetler kontrol edildi.
- [ ] Raporlama veya PDF çıktıları etkileniyorsa manuel kontrol yapıldı.
- [ ] Denetlenebilirlik korunuyor.
- [ ] Kullanıcı iş akışı ISO 50001 sürecini kolaylaştırıyor.

Özellikle tüketim, sayaç, enerji kaynağı, değişken, hedef, aksiyon ve enerji performansı değişiklikleri ISO 50001 etkisi açısından birlikte değerlendirilmelidir.

### ISO 50001 Etki Kontrolü

Yeni geliştirme aşağıdaki alanlardan birini etkiliyorsa release öncesi ilgili kontrol yapılmalıdır:

| Alan | Release Öncesi Kontrol |
| --- | --- |
| EnPI | Hesap girdileri, dönem filtresi, birim bağlamı ve gösterilen sonuçlar kontrol edilir. |
| SEU | Önemli enerji kullanımı sınıflandırması ve ilgili tüketim/sayaç bağlantısı doğrulanır. |
| KPI | Dashboard veya özet metriklerin doğru kaynaktan beslendiği kontrol edilir. |
| Hedef | Hedef ilerleme, başlangıç/değer ilişkisi ve aksiyon bağlantısı doğrulanır. |
| Aksiyon | Sorumlu, termin, durum, hedef ve enerji gözden geçirme ilişkisi kontrol edilir. |
| Risk | Risk kaydının tenant, unit ve aksiyon ilişkisi bozulmadı mı kontrol edilir. |
| Fırsat | Fırsat kaydının raporlama ve aksiyon üretme akışıyla uyumu kontrol edilir. |
| Enerji Gözden Geçirme | Tüketim, değişken, EnPI, SEU, hedef ve aksiyon özetleri birlikte doğrulanır. |
| Raporlama | PDF/rapor içeriği, filtreler, dönem ve tenant kapsamı manuel kontrol edilir. |

ISO 50001 etkisi olan release'lerde sadece ekranın açılması yeterli değildir. Verinin doğru bağlamdan geldiği, yönetim sistemi kayıtlarıyla ilişkisinin korunduğu ve denetimde açıklanabilir olduğu doğrulanmalıdır.

## 11. Performans Kontrolü

Kontrol listesi:

- [ ] Gereksiz API sorgusu eklenmedi.
- [ ] N+1 sorgu riski yok.
- [ ] Büyük listeler gereksiz şekilde tamamen çekilmiyor.
- [ ] Tenant filtresi mümkün olduğunca DB sorgusuna dahil edildi.
- [ ] React Query query key'leri doğru ve stabil.
- [ ] Mutation sonrası gereksiz geniş invalidate yapılmıyor.
- [ ] Gereksiz render yaratacak state/context değişikliği yok.
- [ ] Ağır hesaplama render içinde tekrar tekrar yapılmıyor.
- [ ] Memoization yalnızca gerçek ihtiyaç varsa kullanıldı.
- [ ] Export/import işlemleri UI'ı gereksiz kilitlemiyor.

Performans kontrolü özellikle dashboard, summary, energy review, consumption ve reports ekranlarında önemlidir.

## 12. Güvenlik Kontrolü

Kontrol listesi:

- [ ] Authentication davranışı korunuyor.
- [ ] Authorization backend'de uygulanıyor.
- [ ] Tenant izolasyonu backend sorgularında korunuyor.
- [ ] `companyId` ve `unitId` frontend'den geldi diye güvenilir kabul edilmedi.
- [ ] Role kontrolü admin, superadmin ve user için değerlendirildi.
- [ ] Input validation yapıldı.
- [ ] SQL Injection riski yok; Drizzle helper'ları kullanılıyor.
- [ ] Hata mesajları hassas veri sızdırmıyor.
- [ ] Secret, token veya DB bağlantı bilgisi commit'e girmiyor.
- [ ] Generated dosyalar elle değiştirilmedi.
- [ ] UI görünürlük kontrolleri backend güvenliğinin yerine kullanılmadı.

Güvenlikte temel kural: frontend kolaylık sağlar, backend güvenliği sağlar.

### Yayın Öncesi Tenant ve Güvenlik Özeti

Release öncesi tenant ve güvenlik açısından şu özet kontrol mutlaka yapılmalıdır:

- [ ] Company izolasyonu backend sorgularında korunuyor.
- [ ] Unit filtreleri normal user kapsamını doğru sınırlıyor.
- [ ] Admin yalnızca kendi company kapsamını yönetebiliyor.
- [ ] Superadmin davranışı company filtresiyle kontrollü çalışıyor.
- [ ] Role davranışı UI'da ve backend'de uyumlu.
- [ ] Auth token, logout ve `401` davranışı bozulmadı.
- [ ] OpenAPI etkisi varsa generated client güncel.
- [ ] Generated dosyalar elle değiştirilmedi.
- [ ] Frontend görünürlüğü güvenlik kontrolü yerine kullanılmadı.

Tenant veya auth konusunda belirsizlik varsa release yapılmamalıdır. Önce ilgili route, context, DB ilişkisi ve manuel rol testi tamamlanmalıdır.

## 13. Manuel Test Listesi

Release öncesi kapsamına göre aşağıdaki ekranlar manuel kontrol edilmelidir:

- [ ] Login
- [ ] Logout
- [ ] Dashboard
- [ ] Companies
- [ ] Units
- [ ] Sub Units
- [ ] Energy Sources
- [ ] Energy Use Groups
- [ ] Meters
- [ ] Consumption
- [ ] Variables
- [ ] Weather / MGM ilişkili akışlar
- [ ] Analysis
- [ ] EnPI / Energy Performance
- [ ] SEU / ÖEK
- [ ] SWOT
- [ ] Risks
- [ ] Opportunities
- [ ] Targets
- [ ] Actions
- [ ] Target Progress
- [ ] VAP Projects
- [ ] Energy Review
- [ ] Reports
- [ ] AI Suggestions
- [ ] Summary / Çok Birimli Özet

Rol bazlı manuel kontrol:

- [ ] `superadmin` davranışı kontrol edildi.
- [ ] `admin` davranışı kontrol edildi.
- [ ] Normal `user` davranışı kontrol edildi.
- [ ] Yetkisiz istek/login dışı akış kontrol edildi.

Varsayılan test kullanıcıları:

```text
admin / admin123
kontrol_admin / admin123
```

## 14. Release Kararı

Release öncesinde şu sorular net cevaplanmalıdır:

- Tüm testler geçti mi?
- `pnpm run typecheck` başarılı mı?
- `pnpm run build` başarılı mı?
- İlgili ekranlar manuel test edildi mi?
- Beklenmeyen dosya değişti mi?
- Migration gerekli mi?
- Migration varsa açık kullanıcı kararı var mı?
- Package değişikliği var mı?
- Package değişikliği gerçekten gerekli mi?
- OpenAPI ve generated client uyumlu mu?
- Tenant izolasyonu korunuyor mu?
- Authentication davranışı korunuyor mu?
- ISO 50001 süreç etkisi değerlendirildi mi?
- Bilinen risk var mı?
- Risk varsa kullanıcıya açıkça bildirildi mi?
- GitHub'a push için kullanıcı onayı var mı?
- Release için kullanıcı onayı var mı?

### Son Kullanıcı Kontrolü

Release öncesi değişiklik son kullanıcı gözüyle de değerlendirilmelidir:

- Kullanıcı bu davranışı anlayabilecek mi?
- İş akışı gereksiz karmaşık hale geldi mi?
- Hata mesajı anlaşılır mı?
- İşlem mümkün olduğunca az tıklamayla yapılabiliyor mu?
- Kritik uyarılar kullanıcıdan gizleniyor mu?
- Form veya tablo kullanıcıyı yanlış veri girmeye yönlendiriyor mu?
- Mühendis olmayan kullanıcı için ekran dili yeterince sade mi?

Bu sorular özellikle enerji yöneticisi, fabrika personeli ve operasyon kullanıcılarının kullanacağı ekranlarda release kararının parçasıdır.

Bu sorulardan biri belirsizse release yapılmamalı; önce analiz tamamlanmalıdır.

## 15. Release Sonrası Kontrol

Release tamamlandıktan sonra kısa gözlem yapılmalıdır. Yayın sonrası kontrol, release kararının devamı olarak görülmelidir.

Kontrol listesi:

- [ ] Kritik akışlar tekrar test edildi.
- [ ] Login/logout çalışıyor.
- [ ] Dashboard ve değişiklikten etkilenen ekranlar açılıyor.
- [ ] API loglarında beklenmeyen hata yok.
- [ ] Tarayıcı console'da yeni hata yok.
- [ ] Network hataları takip edildi.
- [ ] Kullanıcı geri bildirimi izleniyor.
- [ ] Beklenmeyen hata oluşursa rollback veya hotfix ihtiyacı değerlendirildi.

Release sonrası sorun görülürse önce etki alanı belirlenmeli, sonra en küçük güvenli düzeltme veya rollback yolu seçilmelidir.

## 16. Günlük Release Checklist

Günlük kullanım için tek sayfalık özet checklist:

- [ ] `pnpm run typecheck` geçti.
- [ ] `pnpm run build` geçti.
- [ ] İlgili testler veya manuel doğrulamalar yapıldı.
- [ ] API çalışıyor.
- [ ] Frontend açılıyor.
- [ ] Kritik ekranlar açılıyor.
- [ ] Console error yok.
- [ ] Network error yok.
- [ ] Tenant izolasyonu kontrol edildi.
- [ ] Auth ve role davranışı kontrol edildi.
- [ ] UI responsive/loading/error/empty state kontrol edildi.
- [ ] Form, tablo, filtre, sıralama ve sayfalama kontrol edildi.
- [ ] ISO 50001 etkisi değerlendirildi.
- [ ] DB/schema/migration/package/lockfile etkisi bilinçli.
- [ ] OpenAPI ve generated client etkisi kontrol edildi.
- [ ] `git status --short` incelendi.
- [ ] `git diff` incelendi.
- [ ] Gereksiz dosya yok.
- [ ] Commitler anlamlı.
- [ ] Dokümantasyon gerekiyorsa güncellendi.
- [ ] Kullanıcı deneyimi sade ve anlaşılır.
- [ ] Release hazır.

## 17. Son Hatırlatma

EnYS release ilkeleri:

- Önce kalite.
- Sonra release.
- GitHub source of truth'tur.
- Küçük güvenli değişiklik tercih edilir.
- Tenant izolasyonu korunmalıdır.
- Authentication davranışı korunmalıdır.
- Migration ve package değişiklikleri açık onay olmadan yapılmamalıdır.
- Generated dosyalar elle değiştirilmemelidir.
- Typecheck, build ve manuel test tamamlanmadan push/release yapılmamalıdır.
- Kullanıcı onayı olmadan release yapılmamalıdır.

Release, yalnızca kodu paylaşmak değil; EnYS'in denetlenebilir, sürdürülebilir ve ISO 50001 uyumlu kalmasını güvence altına almaktır.

# ChatGPT Guide

Bu doküman, EnYS projesinde ChatGPT'nin hangi işlerde kullanılacağını, Codex ile nasıl birlikte çalışacağını ve kullanıcı kararlarının AI destekli geliştirme sürecine nasıl aktarılacağını açıklar.

EnYS, ISO 50001 odaklı, multi-tenant çalışan bir enerji yönetim sistemi yazılımıdır. Bu nedenle ChatGPT ve Codex kullanımı yalnızca hızlı çıktı üretmeye değil; mimari bütünlüğü, tenant izolasyonunu, denetlenebilirliği ve kullanıcı dostu iş akışlarını korumaya hizmet etmelidir.

## 1. ChatGPT'nin Rolü

ChatGPT, EnYS projesinde düşünme, açıklama, karar hazırlama ve kalite değerlendirme asistanıdır. Ana rolü doğrudan kod yazmak değil, doğru geliştirme kararının verilmesine yardımcı olmaktır.

ChatGPT şu alanlarda kullanılmalıdır:

- İş ihtiyacını netleştirme.
- ISO 50001 gereksinimlerini yorumlama.
- Yeni modül veya ekran için kapsam belirleme.
- Teknik karar alternatiflerini karşılaştırma.
- Codex'e verilecek promptları hazırlama.
- Kullanıcı hikayesi, kabul kriteri ve test senaryosu oluşturma.
- Kod inceleme mantığı ve risk analizi çıkarma.
- Dokümantasyon taslağı hazırlama.
- Karmaşık teknik konuları sade şekilde açıklama.

ChatGPT, proje dosyalarına doğrudan müdahale eden uygulayıcı gibi değil, ürün, mimari ve kalite danışmanı gibi konumlanmalıdır.

### İyi ChatGPT Sorusu Nasıl Sorulur?

ChatGPT'den alınacak yanıtın kalitesi, sorunun kapsamına bağlıdır. Soru; amaç, bağlam, sınırlar ve beklenen çıktı formatını içermelidir.

Kötü soru:

```text
Bu modülü nasıl yapalım?
```

Bu soru kötüdür çünkü modülün amacı, kullanıcı rolü, tenant kapsamı, ISO 50001 ilişkisi ve Codex'e aktarılacak çıktı belli değildir.

İyi soru:

```text
EnYS içinde enerji hedefleri modülünü geliştirmek istiyorum.
Mevcut mimari multi-tenant çalışıyor ve Company -> Unit -> Meter -> Consumption hiyerarşisi var.
Bu modül EnPI, SEU ve aksiyon planlarıyla ilişkili olacak.

Lütfen:
- ürün davranışını netleştir,
- hangi verilerin gerekli olacağını öner,
- tenant/auth risklerini belirt,
- Codex'e verilecek küçük geliştirme adımlarına böl,
- migration veya package gerekip gerekmediğini risk olarak ayrıca yaz.
```

Bu soru iyidir çünkü ChatGPT'ye karar vereceği bağlamı verir, sınırları belirtir ve çıktıyı Codex görevine dönüştürülebilir hale getirir.

### ChatGPT Çıktı Kalitesi

ChatGPT yanıtları EnYS geliştirme sürecinde uygulanabilir olmalıdır. İyi bir yanıt:

- kısa ve karar vermeyi kolaylaştıran yapıdadır,
- Codex promptuna dönüştürülebilir netliktedir,
- tenant, auth, DB, OpenAPI ve UI risklerini açıkça belirtir,
- ISO 50001 açısından yanlış yönlendirme yapmaz,
- kullanıcı dostu dil ve sade iş akışı önerir,
- belirsizlik varsa bunu açıkça söyler,
- gereksiz refactor veya gereksiz yeni dependency önermekten kaçınır.

### ChatGPT Çalışma Modları

ChatGPT her görevde aynı derinlikte kullanılmamalıdır. EnYS'te çalışma modu, işin büyüklüğüne, belirsizlik seviyesine ve Codex'e aktarılacak görevin riskine göre seçilmelidir.

#### Hızlı Mod

Hızlı mod, dar kapsamlı ve hızlı karar gerektiren konular için uygundur.

Kullanım alanları:

- kısa soru,
- küçük bug değerlendirmesi,
- küçük UI fikri,
- tek karar.

Yaklaşık süre: 5-10 dakika.

Beklenen çıktı:

- kısa öneri,
- hızlı karar,
- küçük Codex promptu.

Bu modda ChatGPT uzun mimari analiz yapmamalıdır. Amaç, kullanıcıyı hızlıca doğru bir sonraki adıma yönlendirmektir.

#### Tasarım Modu

Tasarım modu, ürün davranışı veya teknik yönü netleştirilmesi gereken orta ölçekli işler için uygundur.

Kullanım alanları:

- yeni ekran,
- yeni modül,
- kullanıcı deneyimi,
- mimari alternatifleri,
- veri modeli.

Yaklaşık süre: 20-45 dakika.

Beklenen çıktı:

- alternatifler,
- riskler,
- kabul kriterleri,
- Codex görev planı.

Bu modda ChatGPT, EnYS'in multi-tenant yapısını, ISO 50001 ilişkilerini, auth sınırlarını ve mevcut mimari dokümanlarını dikkate alarak uygulanabilir seçenekler üretmelidir.

#### Danışmanlık Modu

Danışmanlık modu, stratejik veya yüksek etkili kararlar için kullanılmalıdır.

Kullanım alanları:

- büyük ISO 50001 geliştirmeleri,
- ürün roadmap'i,
- yönetim sistemi yaklaşımı,
- mimari yön belirleme,
- büyük refactor değerlendirmesi.

Yaklaşık süre: 45-90 dakika.

Beklenen çıktı:

- stratejik öneriler,
- ürün değerlendirmesi,
- mimari analiz,
- geliştirme yol haritası,
- Codex görevlerine bölünmüş plan.

Bu modda tek seferde kod görevi üretilmemelidir. Önce problem doğru tanımlanmalı, kabul kriterleri yazılmalı, riskler görünür hale getirilmeli ve çalışma küçük Codex görevlerine ayrılmalıdır.

Temel ilke:

> ChatGPT'nin görevi kod yazmak değil; doğru problemi tanımlamak ve Codex'in güvenli şekilde uygulayabileceği görevler oluşturmaktır.

### ChatGPT'nin Kendini Kontrol Etmesi

ChatGPT yanıt üretmeden önce kendi çıktısını EnYS bağlamında kontrol etmelidir. Bu kontrol, yanıtın hem ürün hem mimari hem de ISO 50001 açısından güvenli olmasını sağlar.

İç kalite kontrol soruları:

- Kullanıcının gerçek ihtiyacını doğru anladım mı?
- Repo hakkında kesin bilgi mi veriyorum, yoksa varsayım mı yapıyorum?
- Varsayım yapıyorsam bunu açıkça belirttim mi?
- ISO 50001 açısından önerim doğru ve denetlenebilir mi?
- Tenant izolasyonunu etkileyebilecek bir öneri var mı?
- Authentication veya rol davranışını etkileyen bir yönlendirme yapıyor muyum?
- Gereksiz refactor, package veya migration öneriyor muyum?
- Codex'in uygulayabileceği kadar net konuştum mu?
- Riskleri yeterince açıkladım mı?
- Kullanıcıyı gereksiz karmaşık çözüme yönlendiriyor muyum?
- Birden fazla makul alternatif varsa bunu belirttim mi?
- Gerekirse kullanıcıya sorulacak net soruyu önerdim mi?
- Çıktı küçük, uygulanabilir ve Codex promptuna dönüştürülebilir mi?

Bu kontrol sonucunda belirsizlik devam ediyorsa ChatGPT kesin hüküm vermemeli; kullanıcıdan bilgi istemeli veya Codex'e kod değiştirmeden analiz görevi önermelidir.

## 2. Codex'in Rolü

Codex, EnYS projesinde repo içinde çalışan uygulayıcı geliştirme ajanıdır. Dosyaları okuyabilir, kod veya dokümantasyon düzenleyebilir, komut çalıştırabilir ve yapılan işi doğrulayabilir.

Codex'in ana sorumlulukları:

- Mevcut kodu ve dokümanları okumak.
- İlgili backend, frontend, DB, OpenAPI ve generated client ilişkilerini analiz etmek.
- Kullanıcı isteğine göre en küçük güvenli değişikliği yapmak.
- Tenant izolasyonunu korumak.
- Authentication davranışını korumak.
- Package ve migration değişikliklerinden kaçınmak.
- Typecheck, build ve ilgili testleri çalıştırmak.
- Değişiklikleri dosya bazında raporlamak.

Codex'e verilen görevler net, sınırları belirli ve doğrulama adımları açık olmalıdır. Bu görevler için temel referans `docs/CODEX_PROMPTS.md` dosyasıdır.

## 3. Kullanıcının Rolü

Kullanıcı, projenin sahibi ve nihai karar vericisidir. AI araçları öneri sunabilir, analiz yapabilir ve uygulama gerçekleştirebilir; ancak iş önceliği, ürün yönü ve kabul kararı kullanıcıya aittir.

Kullanıcının sorumlulukları:

- İş ihtiyacını ve hedef sonucu tanımlamak.
- Kararsız noktalarda ürün önceliğini belirtmek.
- Migration, package ekleme, authentication değişikliği gibi riskli işlemler için açık onay vermek.
- Codex'in uyguladığı değişiklikleri değerlendirmek.
- Yayın, commit ve push kararlarını vermek.

Kullanıcı istemedikçe AI araçları commit veya push yapmamalıdır.

### AI Araçları Görev Dağılımı

EnYS'te AI araçları aynı işi yapmak için değil, farklı karar ve uygulama katmanlarını desteklemek için kullanılmalıdır.

| Araç | En Uygun Kullanım | Sınır |
| --- | --- | --- |
| ChatGPT | Mimari düşünme, ISO 50001 yorumu, kullanıcı deneyimi, risk analizi, prompt hazırlama ve kod review soruları | Repo üzerinde gerçek dosya durumunu görmeden kesin uygulama kararı vermemelidir. |
| Codex | Repo analizi, dosya düzenleme, typecheck/build/test çalıştırma, değişiklik raporlama | Ürün sahibi veya mimar yerine geçmez; kullanıcı istemedikçe commit/push yapmaz. |
| Gemini | Geniş bağlamlı doküman karşılaştırma, alternatif ürün akışları ve büyük metin özetleri | Repo içi doğrulama yapmadığı sürece teknik sonuçları kesin kabul edilmemelidir. |
| Claude | Uzun doküman okuma, karar metni sadeleştirme, politika ve süreç dokümanı gözden geçirme | Gerçek kod davranışını Codex doğrulaması olmadan kesinleştirmemelidir. |
| Copilot | IDE içinde küçük kod tamamlama, lokal refactor önerisi ve tekrar eden kod yazımı | Tenant, auth, DB ve API sözleşmesi kararlarını tek başına belirlememelidir. |

Bu dağılımın amacı aynı yanıtı birden fazla araçtan almak değil; analiz, karar, uygulama ve doğrulama adımlarını doğru araca vermektir.

## 4. Önerilen Çalışma Akışı

EnYS için önerilen AI destekli çalışma akışı:

```text
İhtiyaç
  ->
ChatGPT ile netleştirme
  ->
Codex promptu hazırlama
  ->
Codex ile analiz
  ->
Codex ile uygulama
  ->
Typecheck / Build / Test
  ->
ChatGPT veya kullanıcı ile kalite değerlendirme
  ->
Commit kararı
```

Küçük işler doğrudan Codex'e verilebilir. Büyük, belirsiz veya ISO 50001 yorumu gerektiren işler önce ChatGPT ile şekillendirilmelidir.

### ChatGPT + Codex İş Akışı

Küçük geliştirmelerde ChatGPT zorunlu değildir. Kullanıcı hata veya değişiklik isteğini net tarif edebiliyorsa Codex doğrudan ilgili dosyaları okuyup küçük düzeltmeyi yapabilir. ChatGPT yalnızca promptu netleştirmek veya risk sorusu sormak için kullanılmalıdır.

Orta ölçekli geliştirmelerde ChatGPT önce kapsamı, kabul kriterlerini ve Codex promptunu netleştirmelidir. Codex daha sonra ilgili route, page, context, schema veya API client ilişkisini okuyarak kontrollü değişiklik yapar. İş sonunda ChatGPT, Codex raporu üzerinden risk ve kalite kontrol soruları üretmek için kullanılabilir.

Büyük geliştirmelerde ChatGPT'nin görevi işi tek prompta sıkıştırmak değil; ihtiyacı analiz etmek, kabul kriterlerini belirlemek ve geliştirmeyi küçük Codex görevlerine bölmektir. Codex her görevi ayrı uygular, typecheck/build/test sonuçlarını raporlar ve kullanıcı her adımda kapsamı onaylar.

## 5. ChatGPT'ye Ne Zaman Danışılır?

ChatGPT özellikle şu durumlarda kullanılmalıdır:

- İstek henüz net değilse.
- Yeni bir ISO 50001 modülünün kapsamı tartışılıyorsa.
- Ekran akışı veya kullanıcı deneyimi tasarlanıyorsa.
- Birden fazla teknik çözüm alternatifi varsa.
- Hangi dosyaların etkilenebileceği tahmin edilmek isteniyorsa.
- Codex'e verilecek görev promptu hazırlanacaksa.
- Kod değişikliği yapmadan önce risk analizi isteniyorsa.
- Kullanıcı dostu metin, hata mesajı veya açıklama yazılacaksa.
- Denetim, izlenebilirlik veya sürdürülebilirlik açısından karar alınacaksa.

ChatGPT'ye danışmak, özellikle kapsam büyüdüğünde gereksiz refactor veya yanlış mimari hamleleri önlemek için iyi bir ara adımdır.

Pratik kullanım alanları:

- Mimari karar: yeni modülün backend, frontend, DB, OpenAPI ve tenant etkisini karşılaştırmak.
- ISO 50001 yorumu: standardın iş sürecine nasıl çevrileceğini sadeleştirmek.
- Kullanıcı deneyimi: mühendis olmayan kullanıcı için ekran akışını basitleştirmek.
- Prompt hazırlama: Codex'e verilecek görevi kapsam, yasaklar ve kabul kriterleriyle yazmak.
- Risk analizi: auth, tenant, migration, package, performans ve denetlenebilirlik risklerini belirlemek.
- Kod inceleme: Codex değişikliklerinden sonra kontrol sorularını ve olası regresyonları çıkarmak.

### ChatGPT Ne Zaman Kullanılmamalı?

ChatGPT şu işler için doğrudan uygulayıcı araç olarak kullanılmamalıdır:

- repo içinde dosya değiştirme,
- `pnpm run typecheck` veya `pnpm run build` çalıştırma,
- test sonucunu gerçek komut çıktısı gibi raporlama,
- doğrudan commit veya push yapma,
- gerçek dosya durumunu görmeden kesin teknik karar verme,
- generated dosya, migration veya package değişikliğinin gerçekten gerekli olduğunu tek başına ilan etme.

Bu işlerde Codex veya geliştiricinin yerel doğrulaması gerekir. ChatGPT öneri sunabilir, ancak gerçek repo durumu ve komut sonuçlarıyla doğrulanmalıdır.

## 6. Codex'e Ne Zaman Görev Verilir?

Codex'e görev, yapılacak iş yeterince net olduğunda verilmelidir.

Codex için uygun işler:

- Belirli bir bug fix.
- Belirli bir dokümantasyon güncellemesi.
- Mevcut pattern'e göre küçük frontend düzenlemesi.
- Mevcut route veya sayfada kontrollü değişiklik.
- Typecheck, build ve test çalıştırma.
- Git diff ve commit hazırlığı kontrolü.
- OpenAPI veya generated client etkisi net olan küçük API değişiklikleri.

Codex'e görev verirken şunlar açık yazılmalıdır:

- Hangi dosya veya alan üzerinde çalışacağı.
- Hangi dosyalara dokunmaması gerektiği.
- Migration oluşturup oluşturamayacağı.
- Package ekleyip ekleyemeyeceği.
- Typecheck/build/test beklentisi.
- İş bitince nasıl rapor vereceği.

## 7. Mimari Karar Alma Süreci

EnYS'te mimari kararlar acele alınmamalıdır. Proje multi-tenant çalışır ve şu ana hiyerarşi korunmalıdır:

```text
Company
  -> Unit
    -> SubUnit
      -> Energy Source
        -> Meter
          -> Consumption
```

Mimari karar gerektiren durumlar:

- Yeni tablo veya kalıcı veri modeli.
- Yeni API modülü.
- Yeni frontend ekranı veya ana navigasyon değişikliği.
- OpenAPI sözleşmesi değişikliği.
- Authentication veya rol davranışı.
- Tenant izolasyonu etkileyen filtreler.
- Büyük refactor.
- Yeni package ihtiyacı.

Karar süreci:

1. ChatGPT ile iş ihtiyacı ve alternatifler netleştirilir.
2. `docs/AI_CONTEXT.md`, `docs/ARCHITECTURE.md` ve `docs/CODING_RULES.md` dikkate alınır.
3. Tenant, auth, DB, API ve frontend etkisi çıkarılır.
4. En küçük güvenli çözüm seçilir.
5. Codex'e net ve sınırlı görev verilir.
6. Typecheck/build/test sonuçlarına göre karar doğrulanır.

Authentication değiştirme, migration oluşturma veya package ekleme gibi kararlar açık kullanıcı onayı olmadan uygulanmamalıdır.

## 8. Prompt Hazırlama Süreci

ChatGPT, Codex için prompt hazırlarken görevi açık, sınırlı ve doğrulanabilir hale getirmelidir.

İyi bir Codex promptu şunları içerir:

- Görevin amacı.
- Okunması gereken dokümanlar.
- İncelenmesi gereken dosyalar.
- Değiştirilebilecek dosya veya klasörler.
- Dokunulmaması gereken alanlar.
- Migration/package/auth/generated dosya sınırları.
- Tenant izolasyonu uyarısı.
- Typecheck/build/test beklentisi.
- Rapor formatı.

Örnek kısa prompt:

```text
EnYS projesinde [GÖREV] yapılacak.

Önce docs/AI_CONTEXT.md, docs/ARCHITECTURE.md, docs/CODING_RULES.md ve docs/DEVELOPER_GUIDE.md dosyalarını oku.
İlgili backend/frontend dosyalarını analiz et.
En küçük güvenli değişikliği yap.
Migration oluşturma.
Package ekleme.
Authentication değiştirme.
Generated dosyaları elle değiştirme.
Tenant izolasyonunu koru.
pnpm run typecheck çalıştır.
Gerekirse pnpm run build çalıştır.
İş bitince değişen dosyaları ve doğrulama sonuçlarını raporla.
```

Daha ayrıntılı şablonlar için `docs/CODEX_PROMPTS.md` kullanılmalıdır.

## 9. Kod İnceleme ve Kalite Kontrol

ChatGPT, kod inceleme ve kalite kontrol aşamasında ikinci göz gibi kullanılabilir. Özellikle Codex değişikliklerinden sonra şu sorular sorulmalıdır:

- Değişiklik gerçekten istenen problemi çözüyor mu?
- Gereksiz refactor yapılmış mı?
- İlgisiz dosya değişmiş mi?
- Tenant izolasyonu korunmuş mu?
- Admin, superadmin ve user davranışı korunmuş mu?
- Authentication akışı etkilenmiş mi?
- OpenAPI ve generated client tutarlı mı?
- React Query query key ve invalidation davranışı doğru mu?
- Typecheck ve build sonuçları temiz mi?
- Kullanıcı deneyimi sade ve anlaşılır mı?

ChatGPT kod incelemede doğrudan dosya değiştirmek yerine bulgu, risk ve öneri üretmelidir. Değişiklik gerekiyorsa bu öneriler Codex'e yeni bir görev olarak verilmelidir.

### Codex Sonrası ChatGPT'ye Sorulacak Kontrol Soruları

Codex bir değişiklik yaptıktan sonra ChatGPT'ye verilecek review sorusu, yalnızca "iyi mi?" şeklinde olmamalıdır. Codex'in final raporu, değişen dosyalar, typecheck/build sonucu ve varsa manuel test notları birlikte paylaşılmalıdır.

Örnek kontrol soruları:

```text
Codex şu dosyaları değiştirdi: [DOSYA LİSTESİ].
Amaç: [AMAÇ].
Typecheck sonucu: [SONUÇ].
Build sonucu: [SONUÇ].

Lütfen EnYS kurallarına göre review yap:
- tenant izolasyonu riski var mı?
- auth veya rol davranışı etkilenmiş mi?
- gereksiz refactor yapılmış mı?
- API/OpenAPI/generated client uyumu bozulmuş olabilir mi?
- React Query veya context kullanımı doğru mu?
- ISO 50001 denetlenebilirliği etkilenmiş mi?
- manuel testte özellikle ne kontrol edilmeli?
```

ChatGPT'nin çıktısı bulgu odaklı olmalıdır. En kritik riskler önce, küçük iyileştirmeler sonra yazılmalıdır. Kod değişikliği gerekiyorsa bu bulgular yeni ve sınırlı bir Codex promptuna dönüştürülmelidir.

## 10. ISO 50001 Danışmanlığı

ChatGPT, EnYS içinde ISO 50001 süreçlerinin doğru yorumlanması için kullanılabilir.

Danışılabilecek konular:

- EnPI yaklaşımı.
- SEU ve önemli enerji kullanımı mantığı.
- KPI ve hedef ilişkisi.
- Enerji hedefleri ve aksiyon planları.
- Risk ve fırsat değerlendirme dili.
- Enerji gözden geçirme süreci.
- Denetim izi ve izlenebilirlik.
- Kullanıcıya sade açıklama metinleri.
- Raporlama içeriği ve bölüm kurgusu.

ChatGPT'nin ISO 50001 önerileri yazılım mimarisiyle uyumlu hale getirilmeden doğrudan Codex'e kod görevi olarak verilmemelidir. Önce ürün davranışı ve veri modeli netleştirilmelidir.

### ISO 50001 Konularında ChatGPT'nin Rolü

ChatGPT, ISO 50001 bilgisini EnYS'in ürün davranışına çevirmek için kullanılmalıdır. Amaç standardı uzun metin olarak tekrar etmek değil, kullanıcının yazılım içinde hangi veriyi gireceğini, hangi kararı vereceğini ve hangi çıktıyı denetimde göstereceğini netleştirmektir.

| Konu | ChatGPT'nin Katkısı |
| --- | --- |
| EnPI | Enerji performans göstergesinin hangi tüketim, üretim veya değişken verilerinden türetileceğini açıklamak. |
| SEU | Önemli enerji kullanımlarını belirleme kriterlerini kullanıcı dostu hale getirmek. |
| Hedefler | Hedeflerin ölçülebilir, izlenebilir ve ilgili EnPI/SEU kayıtlarıyla bağlantılı olmasını sağlamak. |
| Aksiyonlar | Aksiyon planlarının sorumlu, tarih, beklenen etki ve takip durumu ile denetlenebilir olmasını önermek. |
| Riskler | Enerji performansını veya uyumu etkileyen risklerin sade ve izlenebilir şekilde yazılmasına yardımcı olmak. |
| Fırsatlar | Verimlilik, ölçüm, süreç iyileştirme ve farkındalık fırsatlarını ürün diline çevirmek. |
| Enerji Gözden Geçirme | Tüketim, değişken, EnPI, SEU, hedef ve aksiyon verilerinin tek yönetim sistemi görünümünde yorumlanmasını sağlamak. |
| Raporlama | Denetçiye, enerji ekibine ve yöneticiye uygun rapor başlıkları ve açıklama dili önermek. |

ISO 50001 danışmanlığı sonucunda ortaya çıkan öneriler mutlaka EnYS veri sahipliği hiyerarşisiyle uyumlu olmalıdır. Company tenant sınırı, Unit operasyon kapsamı ve ölçüm verilerinin Meter/Consumption kaynağı korunmadan ISO yorumu kod görevine dönüştürülmemelidir.

## 11. Yasaklar ve Sınırlar

ChatGPT ve Codex kullanımında şu sınırlar korunmalıdır:

- ChatGPT'nin önerisi açık kullanıcı onayı yerine geçmez.
- Codex kullanıcı istemedikçe commit veya push yapmaz.
- Migration açık talep olmadan oluşturulmaz.
- Package açık talep olmadan eklenmez.
- Authentication açık talep olmadan değiştirilmez.
- Generated dosyalar elle düzenlenmez.
- Tenant izolasyonu zayıflatılmaz.
- Büyük refactor küçük işlerin içine eklenmez.
- DB state'i manuel değiştirilmez.
- Replit import sırasında DB push veya migration komutları çalıştırılmaz.
- UI davranışı backend yetkilendirmesinin yerine güvenlik önlemi olarak görülmez.

Belirsizlik varsa önce ChatGPT ile analiz yapılmalı, sonra Codex'e sınırlı görev verilmelidir.

### Karar Alma Kuralları

ChatGPT emin olmadığı konularda varsayımı gerçek gibi sunmamalıdır. Belirsizlik açıkça yazılmalı ve karar için gerekli ek bilgi belirtilmelidir.

Karar alma sırası:

1. Kullanıcının amacını ve kabul kriterini anla.
2. Mevcut EnYS dokümanlarıyla çelişen bir öneri olup olmadığını kontrol et.
3. Tenant, auth, DB, API, frontend ve ISO 50001 etkisini ayrı ayrı düşün.
4. Yüksek riskli konuda kesin konuşma; kullanıcıya sorulacak net soruyu öner.
5. Codex'e aktarılacaksa görevi küçük, sınırlı ve doğrulanabilir hale getir.

ChatGPT tahmin yürütmek zorunda kalırsa bunu "varsayım" olarak işaretlemelidir. Codex'in repo analiziyle doğrulanabilecek bir konu varsa, kesin karar yerine Codex'e analiz görevi önerilmelidir.

## 12. Örnek İş Akışları

### Küçük Bug Fix

```text
Kullanıcı hatayı tarif eder.
  ->
ChatGPT gerekirse hata senaryosunu netleştirir.
  ->
Codex ilgili dosyaları okur ve kök nedeni bulur.
  ->
Codex en küçük düzeltmeyi yapar.
  ->
Codex typecheck/test çalıştırır.
  ->
Kullanıcı sonucu değerlendirir.
```

### Yeni CRUD Ekranı

```text
Kullanıcı CRUD ihtiyacını anlatır.
  ->
ChatGPT entity, alanlar, roller ve tenant kapsamını netleştirir.
  ->
ChatGPT Codex promptu hazırlar.
  ->
Codex route, frontend, OpenAPI ve generated client ilişkisini analiz eder.
  ->
Codex küçük ve kontrollü değişiklikleri yapar.
  ->
Codex typecheck/build ve manuel ekran kontrolü yapar.
```

### ISO 50001 Modülü Tasarımı

```text
Kullanıcı ISO 50001 ihtiyacını anlatır.
  ->
ChatGPT standardın iş süreci karşılığını sadeleştirir.
  ->
ChatGPT veri modeli, ekran akışı ve raporlama beklentisini netleştirir.
  ->
Kullanıcı kapsamı onaylar.
  ->
Codex mevcut mimariyi okuyup uygulama planı çıkarır.
  ->
Codex onaylanan kapsamı uygular.
```

### Sadece Analiz

```text
Kullanıcı bir konuyu sorar.
  ->
ChatGPT veya Codex kod değiştirmeden analiz yapar.
  ->
Mevcut davranış, riskler, önerilen çözüm ve etkilenecek dosyalar raporlanır.
  ->
Kullanıcı isterse ayrı uygulama görevi açar.
```

### Commit Hazırlığı

```text
Codex geliştirmeyi tamamlar.
  ->
Kullanıcı commit hazırlığı ister.
  ->
Codex git status ve git diff kontrol eder.
  ->
İlgili/ilgisiz dosyaları raporlar.
  ->
Commit mesajı önerir.
  ->
Kullanıcı onay verirse commit ayrı görev olarak yapılır.
```

### Ek ChatGPT Kullanım Senaryoları

Yeni modül tasarımı:

```text
EnYS için [MODÜL] tasarlamak istiyorum.
ISO 50001 ilişkisini, tenant kapsamını, kullanıcı rollerini, temel ekranları ve Codex'e bölünecek geliştirme adımlarını çıkar.
Migration/package/auth değişikliği gerektirebilecek noktaları risk olarak ayrıca belirt.
```

Bug analizi:

```text
[Ekran/API] alanında [HATA] yaşanıyor.
Kod değiştirmeden olası kök nedenleri; frontend context, React Query, generated client, backend route, auth ve tenant filtresi açısından sırala.
Codex'e verilecek dar kapsamlı analiz promptunu hazırla.
```

Prompt hazırlama:

```text
Codex'e [GÖREV] yaptıracağım.
Bu iş için amaç, okunacak dosyalar, yasaklar, kabul kriterleri, typecheck/build beklentisi ve final rapor formatı içeren güvenli bir EnYS promptu yaz.
```

Kod review:

```text
Codex [DOSYALAR] üzerinde değişiklik yaptı.
Değişikliğin tenant, auth, OpenAPI/generated client, React Query, performans ve ISO 50001 denetlenebilirliği açısından risklerini kontrol et.
Bulgu varsa önem sırasına göre yaz.
```

ISO 50001 yorumlama:

```text
EnYS içinde [ISO 50001 KONUSU] için kullanıcıya sade bir yazılım akışı tasarlamak istiyorum.
Bu konunun EnPI, SEU, hedef, aksiyon, risk, fırsat, enerji gözden geçirme ve raporlama ile ilişkisini açıkla.
```

UI sadeleştirme:

```text
[Ekran] mühendis olmayan kullanıcılar için karmaşık görünüyor.
Mevcut iş amacını koruyarak daha az tıklama, daha net hata mesajı, daha iyi empty/loading state ve tenant bağlamını görünür tutan sade bir akış öner.
```

## Son Not

ChatGPT EnYS projesinde düşünme ve karar kalitesini artırır; Codex ise kontrollü uygulama ve doğrulama yapar. En iyi sonuç, ChatGPT'nin problemi netleştirdiği, Codex'in repo içinde küçük ve güvenli değişiklik yaptığı, kullanıcının ise ürün kararlarını verdiği çalışma düzeniyle elde edilir.

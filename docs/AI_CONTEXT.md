# AI Context

Bu doküman, EnYS projesinde çalışacak tüm yapay zekâ geliştiricileri için ortak proje hafızasıdır. Codex, ChatGPT, Gemini, Claude veya benzeri araçlar bu projede çalışmaya başlamadan önce bu dosyayı referans almalıdır.

Amaç, her geliştirme oturumunda aynı proje ilkelerini korumak; mimari bütünlüğü, ISO 50001 yaklaşımını, tenant izolasyonunu ve kullanıcı deneyimini bozmadan ilerlemektir.

## 1. Projenin Amacı

EnYS, ISO 50001 Enerji Yönetim Sistemi gerekliliklerini destekleyen bir yazılımdır. Projenin amacı yalnızca enerji verisi toplamak veya raporlamak değildir. Asıl hedef, kullanıcıyı ISO 50001 standardının gerektirdiği süreçleri uygulanabilir, izlenebilir ve denetlenebilir biçimde yürütebilir hale getirmektir.

Sistem; enerji performansını takip etmeyi, enerji kullanımını analiz etmeyi, hedefler oluşturmayı, aksiyonları izlemeyi, risk ve fırsatları yönetmeyi ve enerji gözden geçirme süreçlerini sürdürülebilir hale getirmeyi amaçlar.

Bu nedenle yazılım:

- denetlenebilir,
- sürdürülebilir,
- izlenebilir,
- güvenilir,
- kullanıcıların gerçek iş akışlarına uygun

olmalıdır.

Her geliştirme, kısa vadeli bir ekran veya teknik düzeltme olarak değil, ISO 50001 yönetim sisteminin parçası olarak değerlendirilmelidir.

## 2. Hedef Kullanıcı

EnYS farklı teknik seviyelerden kullanıcılar tarafından kullanılacaktır:

- enerji yöneticileri,
- enerji ekipleri,
- fabrika personeli,
- bakım ve üretim ekipleri,
- mühendis olmayan operasyon kullanıcıları.

Arayüz mümkün olduğunca sade ve anlaşılır olmalıdır. Kullanıcının enerji yönetimi kavramlarını bilmesi beklenebilir, ancak yazılım geliştirme, veritabanı, API veya sistem mimarisi bilgisine sahip olması beklenmemelidir.

AI geliştiricileri UI, akış ve metin tasarlarken şu ilkelere dikkat etmelidir:

- Kullanıcı ne yapacağını kolayca anlamalıdır.
- Kritik bilgiler teknik jargon arkasına saklanmamalıdır.
- Formlar gereksiz alanlarla şişirilmemelidir.
- Hatalar kullanıcıya açık ve eyleme dönük biçimde anlatılmalıdır.
- Karmaşık ISO 50001 kavramları mümkün olduğunca sade iş akışlarına dönüştürülmelidir.

## 3. Geliştirme Felsefesi

Bu projede her geliştirme aşağıdaki nitelikleri taşımalıdır:

- kullanıcı dostu,
- denetlenebilir,
- sade,
- sürdürülebilir,
- mevcut mimariyi bozmayan,
- mevcut davranışı gereksiz yere değiştirmeyen.

Gereksiz karmaşıklık oluşturulmaz. Yeni soyutlamalar, yeni bağımlılıklar veya geniş çaplı refactor çalışmaları ancak açık bir ihtiyaç varsa ve proje mimarisiyle uyumluysa düşünülmelidir.

AI geliştiricileri özellikle şu yaklaşımı benimsemelidir:

1. Önce mevcut davranışı anla.
2. İlgili dosyaları oku.
3. En küçük güvenli değişikliği tasarla.
4. Mevcut kalıplarla uyumlu uygula.
5. Typecheck, build ve ilgili testleri çalıştır.
6. Değişikliklerin kapsamını açıkça raporla.

Bu proje için iyi geliştirme, mümkün olduğunca çok kod yazmak değil, doğru yerde doğru kadar değişiklik yapmaktır.

### Büyük Geliştirmelerin Parçalanması

AI araçları EnYS üzerinde hiçbir zaman tek adımda çok büyük, kontrol edilmesi zor değişiklikler yapmamalıdır. Özellikle binlerce satırlık geliştirmeler; tenant izolasyonu, authentication, API sözleşmesi, generated client, build süreci ve kullanıcı deneyimi açısından yüksek risk oluşturur.

Büyük işler aşağıdaki sırayla parçalanmalıdır:

```text
Analiz
↓
Plan
↓
Küçük adımlar
↓
Typecheck / Build / Manuel test
↓
Sonraki adım
```

Her küçük adım kendi içinde anlamlı, test edilebilir ve geri alınabilir olmalıdır. Bir modül genişletilecekse önce mevcut route, service, schema, OpenAPI, generated client ve frontend akışı incelenir; sonra yalnızca gerekli en küçük değişiklik yapılır.

### Teknik Borç Yaklaşımı

Her teknik borç görüldüğü anda çözülmez. EnYS uzun ömürlü bir ürün olduğu için teknik borç kararları risk, fayda ve kapsam üzerinden değerlendirilmelidir.

Teknik borç hemen ele alınmalıdır:

- tenant izolasyonunu zayıflatıyorsa,
- authentication veya authorization güvenliğini etkiliyorsa,
- veri kaybı, yanlış raporlama veya denetlenebilirlik riski oluşturuyorsa,
- yeni geliştirmenin güvenli şekilde tamamlanmasını engelliyorsa.

Teknik borç ertelenebilir:

- mevcut görevin kapsamı dışında kalıyorsa,
- davranış değişikliği riski yüksekse,
- yalnızca estetik veya kişisel tercih düzeyindeyse,
- daha geniş bir mimari karar gerektiriyorsa.

Refactor yalnızca gerçek bir karmaşıklığı azaltıyorsa, tekrar eden hataları önlüyorsa veya yeni geliştirmeyi daha güvenli hale getiriyorsa yapılmalıdır. Aksi durumda mevcut yapı korunur.

### Uzun Vadeli Mimari Yaklaşım

EnYS yıllarca geliştirilecek bir ürün olarak ele alınmalıdır. Kısa vadede hızlı görünen ama bakım maliyetini artıran çözümlerden kaçınılmalıdır.

Yeni geliştirmeler:

- mevcut modüler yapıya uyumlu olmalı,
- veri bütünlüğünü korumalı,
- API sözleşmesini gereksiz yere değiştirmemeli,
- frontend ve backend sorumluluklarını karıştırmamalı,
- ileride yeni modüller eklendiğinde sistemi zorlamamalıdır.

## 4. Mimari İlkeler

Bu proje multi-tenant çalışır. Tenant izolasyonu temel güvenlik ve veri bütünlüğü kuralıdır. Hiçbir geliştirme farklı şirket, birim veya alt birim verilerinin birbirine karışmasına neden olmamalıdır.

Temel hiyerarşi:

```text
Company
  -> Unit
    -> Sub Unit
      -> Energy Source
        -> Meter
          -> Consumption
```

Bu hiyerarşi; veri listeleme, filtreleme, yetkilendirme, raporlama ve analiz davranışlarının temelidir.

AI geliştiricileri her değişiklikte şu soruları sormalıdır:

- Bu veri hangi company veya unit kapsamına ait?
- Kullanıcı bu veriyi görmeye yetkili mi?
- Admin, user ve varsa superadmin davranışı korunuyor mu?
- `unitId`, `companyId`, `subUnitId`, `energySourceId` ve `meterId` ilişkileri doğru korunuyor mu?
- "Tüm Birimler" görünümü ile birim bazlı görünüm ayrımı bozuluyor mu?

Tenant izolasyonunu zayıflatan hiçbir değişiklik kabul edilmemelidir.

## 5. Kodlama İlkeleri

AI geliştiricileri kod yazmadan önce mevcut kodu okumalıdır. Projede halihazırda bulunan pattern'ler, helper'lar, context yapıları, route organizasyonu ve API client kullanımı tercih edilmelidir.

Temel kodlama ilkeleri:

- Önce mevcut kod okunur.
- En küçük değişiklik yapılır.
- Gereksiz refactor yapılmaz.
- Authentication değiştirilmez.
- Migration oluşturulmaz.
- Package eklenmez.
- Var olan davranış korunur.
- Generated dosyalar elle düzenlenmez.
- API sözleşmesi bilinçsizce değiştirilmez.
- İş mantığı UI tarafına gereksiz taşınmaz.
- UI davranışı backend yetkilendirmesinin yerine geçmez.

Bir dosyada değişiklik yapmadan önce o dosyanın bağlı olduğu route, hook, context, schema veya generated client ilişkileri anlaşılmalıdır.

Eğer bir sorun küçük bir lokal düzeltmeyle çözülebiliyorsa, geniş çaplı mimari değişiklik yapılmamalıdır.

## 6. ISO 50001 Yaklaşımı

EnYS, ISO 50001 süreçlerini ayrı ayrı ekranlardan ibaret görmemelidir. Sistem aşağıdaki modülleri tek bütün olarak ele almalıdır:

- EnPI,
- SEU,
- KPI,
- hedefler,
- aksiyonlar,
- riskler,
- fırsatlar,
- enerji gözden geçirme.

Yeni geliştirmeler bu kavramlarla uyumlu olmalıdır. Örneğin bir tüketim verisi yalnızca sayaç kaydı değildir; enerji performans göstergelerini, önemli enerji kullanımlarını, hedef ilerlemelerini ve gözden geçirme süreçlerini etkileyebilir.

AI geliştiricileri yeni özellik tasarlarken şu bağlantıları düşünmelidir:

- Bu veri EnPI hesaplarını etkiliyor mu?
- SEU değerlendirmelerinde kullanılacak mı?
- KPI dashboard'larına yansıyacak mı?
- Hedef veya aksiyon takibiyle ilişkili mi?
- Risk, fırsat veya enerji gözden geçirme kayıtlarıyla bağlantılı mı?
- Denetimde geriye dönük izlenebilirlik sağlayacak mı?

ISO 50001 uyumu, yalnızca ekran isimleriyle değil, süreçlerin birbirine doğru bağlanmasıyla sağlanır.

### Gelecek Yönetim Sistemi Modülleri

EnYS ileride ISO 9001, ISO 14001, ISO 45001, ISO 27001 gibi diğer yönetim sistemlerine genişleyebilir. Bugünkü geliştirmeler yalnızca ISO 50001 ihtiyacını karşılamakla kalmamalı, gelecekte farklı yönetim sistemi modüllerinin eklenmesini de zorlaştırmamalıdır.

Bu nedenle:

- enerji yönetimine özel iş kuralları doğru modüllerde tutulmalı,
- ortak kullanıcı, tenant, rol, doküman, aksiyon, risk ve raporlama mantıkları gereksiz yere ISO 50001'e gömülmemeli,
- isimlendirme ve veri modeli uzun vadeli genişlemeye engel olmamalı,
- yeni modül ihtimali var diye bugünkü kapsam gereksiz soyutlamalarla büyütülmemelidir.

Amaç geleceğe hazırlıklı olmak, fakat bugünün basit ve çalışan mimarisini gereksiz karmaşıklığa çevirmemektir.

## 7. UI İlkeleri

Arayüz, mühendis olmayan kullanıcıların da rahatça kullanabileceği şekilde sade ve yönlendirici olmalıdır. Kullanıcı mümkün olduğunca az tıklamayla işlem yapabilmelidir.

UI geliştirirken şu ilkeler korunmalıdır:

- Kullanıcıyı gereksiz seçimlerle yormayın.
- Kritik uyarıları kullanıcıdan gizlemeyin.
- Veri girişlerini mümkün olduğunca otomatikleştirin.
- Zorunlu alanları açıkça belirtin.
- Liste, filtre ve form akışlarını tenant hiyerarşisine uygun tasarlayın.
- Hataları yalnızca teknik hata olarak değil, kullanıcının ne yapması gerektiğini anlatan mesajlar olarak gösterin.
- Aynı iş için farklı ekranlarda farklı davranışlar oluşturmayın.

Özellikle tüketim, sayaç, hedef, aksiyon ve raporlama ekranlarında kullanıcı akışı net olmalıdır. Enerji kaynağı, alt birim, sayaç ve dönem ilişkileri kullanıcıya karmaşık hissettirilmeden yönetilmelidir.

## 8. AI Çalışma Kuralları

Yeni geliştirmeye başlamadan önce aşağıdaki dokümanlar okunmalıdır:

- `docs/DEVELOPER_GUIDE.md`
- `docs/ARCHITECTURE.md`
- `docs/CODING_RULES.md`

İlgili dosyalar analiz edilmeden kod yazılmamalıdır. AI geliştiricisi önce bağlam toplamalı, sonra plan yapmalı, sonra uygulamalıdır.

### AI Çalışma Stratejisi

EnYS üzerinde birden fazla AI aracı kullanılabilir. Her aracın rolü net olmalı, nihai karar proje sahibi veya geliştirici tarafından verilmelidir.

| Araç | En Uygun Kullanım |
| --- | --- |
| ChatGPT | İş ihtiyacını netleştirme, ISO 50001 yorumlama, mimari seçenekleri tartışma, dokümantasyon ve prompt hazırlama |
| Codex | Repo içinde dosya okuma, kod değişikliği, typecheck/build çalıştırma, test sonucu raporlama ve sınırlı otomasyon |
| Gemini | Alternatif yaklaşım üretme, geniş bağlamlı karşılaştırma, ikinci görüş alma |
| Claude | Uzun doküman inceleme, süreç analizi, kullanıcı akışı ve kalite kontrol değerlendirmesi |
| Copilot | IDE içinde küçük kod tamamlama, yerel fonksiyon önerisi ve tekrar eden kod yazımını hızlandırma |

Önerilen görev paylaşımı:

1. ChatGPT veya benzeri araçla ihtiyaç ve kabul kriterleri netleştirilir.
2. Codex mevcut kodu analiz eder ve küçük, kontrollü değişiklik yapar.
3. Gerekiyorsa Gemini veya Claude ile mimari/risk açısından ikinci görüş alınır.
4. Copilot yalnızca editör içi yardımcı olarak kullanılır; mimari karar verici değildir.
5. Kullanıcı kapsam, risk, commit, push ve release kararlarını onaylar.

Hiçbir AI çıktısı tek başına proje gerçeği kabul edilmez. Kaynak gerçekliği her zaman repo, veritabanı şeması, çalışan build, test sonucu ve kullanıcı onayıdır.

### Token ve Maliyet Yönetimi

AI kullanımı sırasında maliyet yalnızca ücret değil; zaman, dikkat, risk ve review yüküdür. Bu nedenle çalışma verimli ve hedefli olmalıdır.

İlkeler:

- tüm repo yerine önce ilgili dokümanlar, route, component, schema ve script dosyaları okunur,
- aynı bilgi tekrar tekrar okunmaz; elde edilen bulgu kısa notlarla kullanılır,
- gereksiz uzun analiz, geniş refactor ve kapsam dışı dosya incelemesi yapılmaz,
- paket eklemek yerine mevcut bağımlılıklar ve proje patternleri değerlendirilir,
- büyük promptlar yerine net kabul kriterleri ve dosya kapsamı yazılır,
- belirsizlik yüksekse tahminle ilerlemek yerine kısa soru sorulur,
- generated dosyalar, migration ve package değişiklikleri yalnızca açık ihtiyaç ve kullanıcı onayı varsa gündeme alınır.

Amaç daha az token ile daha güvenilir karar vermektir.

### Karar Alma İlkeleri

AI emin olmadığında önce mevcut proje gerçeklerini araştırmalıdır. Varsayım yapmadan önce dosya, script, schema, route, component ve doküman kontrol edilir.

Karar sırası:

1. Mevcut kod ve doküman incelenir.
2. Benzer pattern bulunur.
3. Risk düşükse mevcut patterne uygun küçük karar alınır.
4. Risk tenant, auth, veri kaybı, migration, package veya API sözleşmesiyle ilgiliyse kullanıcıya soru sorulur.
5. Varsayım yapıldıysa raporda açıkça belirtilir.

AI tahmin yürütebilir, ancak tahmini gerçek gibi sunamaz. Özellikle veritabanı, authentication, tenant izolasyonu ve release kararlarında varsayımla hareket edilmez.

Her çalışma için beklenen davranış:

1. Kullanıcı isteğini netleştir.
2. İlgili dokümanları oku.
3. İlgili kod dosyalarını oku.
4. Mevcut pattern'i anla.
5. Dar kapsamlı plan oluştur.
6. Yalnızca gerekli dosyaları değiştir.
7. Typecheck/build/test adımlarını çalıştır.
8. Değişiklikleri ve doğrulama sonucunu raporla.

Kullanıcı açıkça istemedikçe:

- migration oluşturulmaz,
- package eklenmez,
- authentication değiştirilmez,
- geniş çaplı refactor yapılmaz,
- ilgisiz dosyalar düzenlenmez.

## 9. Yasaklar

Aşağıdaki işlemler açık kullanıcı talebi ve yeterli analiz olmadan yapılmamalıdır:

- gereksiz refactor,
- gereksiz dependency ekleme,
- migration oluşturma,
- authentication değiştirme,
- API sözleşmesini bozma,
- çok sayıda dosyada ilgisiz değişiklik yapma,
- generated dosyaları elle düzenleme,
- tenant izolasyonunu zayıflatma,
- veritabanı state'ini manuel değiştirme,
- mevcut kullanıcı rollerinin davranışını bozma,
- mevcut demo/test kullanıcılarını gereksiz değiştirme.

Bu yasaklar, geliştirmeyi yavaşlatmak için değil; projenin denetlenebilir, sürdürülebilir ve güvenli kalmasını sağlamak için vardır.

## 10. Çalışma Prensibi

AI geliştiricileri aşağıdaki sırayı varsayılan çalışma modeli olarak kabul etmelidir:

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
  ->
Push
```

Her adımın amacı:

- Analiz: İstek, mevcut kod, veri ilişkileri ve riskler anlaşılır.
- Plan: En küçük güvenli değişiklik yolu belirlenir.
- Kod: Sadece gerekli dosyalar değiştirilir.
- Typecheck: TypeScript uyumluluğu doğrulanır.
- Build: Uygulamanın üretilebilir olduğu kontrol edilir.
- Test: İlgili otomatik veya manuel testler yapılır.
- Commit: Değişiklikler anlamlı ve izlenebilir mesajla kaydedilir.
- Push: Paylaşıma hazır değişiklik uzak depoya gönderilir.

Kullanıcı bir adımı açıkça istemediyse bile AI geliştiricisi yaptığı işin doğrulanabilir olmasına dikkat etmelidir. Doğrulama çalıştırılamadıysa bunun nedeni açıkça raporlanmalıdır.

### Kod İnceleme İlkeleri

AI yaptığı değişikliği tamamlanmış saymadan önce kendi kendine kod incelemesi yapmalıdır.

Sorulması gereken temel sorular:

- Tenant izolasyonu bozuldu mu?
- `companyId`, `unitId`, `subUnitId` gibi kapsam alanları doğru filtreleniyor mu?
- Authentication veya authorization davranışı değişti mi?
- Mevcut API sözleşmesi kırıldı mı?
- Generated client veya OpenAPI akışı doğru yönetildi mi?
- Frontend mevcut context ve React Query davranışıyla uyumlu mu?
- Performans gereksiz sorgu, gereksiz render veya büyük liste problemi üretiyor mu?
- Mevcut kullanıcı davranışı beklenmeden değişti mi?
- Hata, loading ve empty state kullanıcıya doğru yansıyor mu?
- Migration, package veya generated dosya değişikliği gerçekten gerekli mi?
- Değişiklik kapsam dışı dosyalara yayıldı mı?

Bu soruların herhangi birinde şüphe varsa değişiklik genişletilmeden önce analiz yapılmalı veya kullanıcıya danışılmalıdır.

## 11. Doküman Güncelleme Politikası

Dokümantasyon EnYS için ikincil bir çıktı değil, geliştirme sürecinin parçasıdır. Yeni geliştirici ve AI araçları projeyi dokümanlar üzerinden anlayacağı için dokümanlar güncel tutulmalıdır.

Doküman güncellenmelidir:

- yeni modül veya önemli ekran eklendiğinde,
- backend route, service, validation veya auth akışında anlamlı değişiklik olduğunda,
- OpenAPI/generated client çalışma düzeni değiştiğinde,
- veritabanı şeması veya tenant hiyerarşisi değiştiğinde,
- yeni AI aracı veya yeni çalışma yöntemi kullanılmaya başlandığında,
- gerçek bir troubleshooting deneyimi tekrar yaşanabilecek nitelikteyse.

Güncelleme ilkeleri:

- Doküman değişikliği gerçek proje davranışına dayanmalıdır.
- Genel internet tavsiyesi yerine EnYS özelinde yazılmalıdır.
- Aynı bilgi birden fazla yerde tekrar edilecekse ana kaynak net olmalıdır.
- Kod değişikliği ile doküman değişikliği aynı kapsamdaysa birlikte değerlendirilmelidir.
- Dokümanlar uzun ömürlü, sade ve karar verdirici olmalıdır.

## Kalıcı Hatırlatma

EnYS bir enerji yönetim sistemi ürünüdür. Her geliştirme, sadece çalışan kod üretmekten ibaret değildir. Geliştirme; kullanıcıyı ISO 50001 süreçlerinde daha güçlü, daha denetlenebilir ve daha sürdürülebilir hale getirmelidir.

Bu doküman, tüm AI geliştiricileri için proje bağlamının başlangıç noktasıdır.

## AI Kalite Manifestosu

1. Önce analiz yapılır.
2. Önce mevcut kod ve doküman okunur.
3. En küçük güvenli değişiklik tercih edilir.
4. Mevcut mimari ve pattern korunur.
5. Tenant izolasyonu hiçbir koşulda bozulmaz.
6. Authentication ve authorization açık talep olmadan değiştirilmez.
7. Migration ve package değişikliği yalnızca açık ihtiyaçla yapılır.
8. Generated dosyalar elle düzenlenmez.
9. Typecheck ve build kalite kapısıdır.
10. Manuel test, kullanıcı akışını doğrulamak için gereklidir.
11. ISO 50001 yaklaşımı ve denetlenebilirlik korunur.
12. Kullanıcı deneyimi sade, anlaşılır ve az tıklamalı olmalıdır.
13. Gereksiz refactor ve gereksiz karmaşıklık oluşturulmaz.
14. Belirsizlik yüksekse tahmin yerine soru sorulur.
15. Kullanıcı istemedikçe commit, push veya release yapılmaz.

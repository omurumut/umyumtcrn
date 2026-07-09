# Git Workflow

Bu doküman, EnYS projesinde Git kullanım standartlarını tanımlar. EnYS geliştirme süreci GitHub merkezlidir; GitHub repository her zaman projenin ana kaynağı ve "source of truth" olarak kabul edilir.

## 1. Amaç

Bu dokümanın amacı, EnYS projesinde yapılan değişikliklerin izlenebilir, güvenli, küçük parçalara ayrılmış ve doğrulanabilir şekilde GitHub'a aktarılmasını sağlamaktır.

Git kullanım felsefesi:

- GitHub ana kaynaktır.
- Yerel çalışma kopyası geçici geliştirme alanıdır.
- Her değişiklik anlamlı, küçük ve geri izlenebilir olmalıdır.
- Kod push edilmeden önce typecheck, build ve ilgili manuel testler yapılmalıdır.
- Tenant izolasyonu, authentication davranışı ve generated dosyalar commit öncesi özellikle kontrol edilmelidir.
- AI araçları kullanıcı istemedikçe commit veya push yapmaz.

Git geçmişi, yalnızca kodun ne zaman değiştiğini değil, neden değiştiğini de anlatmalıdır. Bu nedenle commit mesajları açık, kapsamı küçük ve amaca yönelik olmalıdır.

### Git Felsefesi

EnYS'de Git yalnızca versiyon kontrol sistemi değildir. Git geçmişi; ürün kararlarının, teknik değişikliklerin, kalite kontrollerinin ve release hazırlığının izlenebilir kaydıdır.

Bu yaklaşımın amacı:

- değişikliklerin kim tarafından, ne zaman ve hangi amaçla yapıldığını izlenebilir tutmak,
- review sürecini kolaylaştırmak,
- hatalı değişikliklerden güvenli şekilde geri dönebilmeyi sağlamak,
- release öncesi riskleri görünür hale getirmek,
- büyük işleri küçük ve kontrollü geliştirme adımlarına bölmek.

Bu nedenle EnYS'te "çalışıyor" demek tek başına yeterli değildir. Değişiklik; küçük, anlaşılır, test edilmiş, tenant/auth etkisi değerlendirilmiş ve Git geçmişinde okunabilir olmalıdır.

## 2. Günlük Çalışma Akışı

Önerilen günlük geliştirme sırası:

```text
Git Pull
  ->
Yeni geliştirme
  ->
Typecheck
  ->
Build
  ->
Manuel test
  ->
git status
  ->
git diff
  ->
Commit
  ->
Push
```

Standart komut akışı:

```bash
git pull
pnpm run typecheck
pnpm run build
git status --short
git diff
```

### Adımların Amacı

| Adım | Amaç |
| --- | --- |
| `git pull` | Çalışmaya başlamadan önce GitHub'daki güncel kaynakla yerel kopyayı eşitlemek. |
| Geliştirme | Belirlenen işi küçük ve kontrollü değişikliklerle yapmak. |
| `pnpm run typecheck` | TypeScript, import, tip uyumu ve temel proje referans hatalarını yakalamak. |
| `pnpm run build` | Backend/frontend build sürecinin release'e hazır kalıp kalmadığını doğrulamak. |
| Manuel test | Etkilenen ekran veya API akışının kullanıcı gözünden çalıştığını kontrol etmek. |
| `git status --short` | Hangi dosyaların değiştiğini hızlıca görmek ve ilgisiz dosya olup olmadığını anlamak. |
| `git diff` | Değişikliğin gerçekten istenen kapsamda olup olmadığını satır bazında incelemek. |
| Commit | Doğrulanmış tek mantıksal değişikliği Git geçmişine kaydetmek. |
| Push | Onaylanan commitleri GitHub'a göndererek ana kaynakla paylaşmak. |

Günlük çalışma kuralları:

- Çalışmaya başlamadan önce GitHub'daki son değişiklikler alınmalıdır.
- Değişiklikler küçük ve odaklı tutulmalıdır.
- Aynı commit içinde ilgisiz işler karıştırılmamalıdır.
- Kod değişikliği sonrası en az `pnpm run typecheck` çalıştırılmalıdır.
- Geniş kapsamlı değişikliklerde `pnpm run build` çalıştırılmalıdır.
- UI etkileniyorsa ilgili ekran manuel test edilmelidir.
- Commit öncesi `git status --short` ve `git diff` mutlaka incelenmelidir.

### Branch Stratejisi

Bugünkü çalışma modeli basittir: geliştirme çoğunlukla `main` üzerinden ilerler ve GitHub repository ana kaynak olarak kabul edilir. Bu modelde daha da dikkatli olunmalıdır; çünkü her commit doğrudan ana geliştirme hattının okunabilirliğini ve release güvenliğini etkiler.

Bugünkü modelde:

- küçük ve anlamlı commitler tercih edilir,
- push öncesi typecheck/build/manuel test kontrol edilir,
- migration, package, auth ve generated dosya değişiklikleri ayrıca gözden geçirilir,
- AI araçları kullanıcı istemedikçe commit veya push yapmaz.

İleride ekip veya release süreci büyürse branch yapısı genişletilebilir:

- `feature/*`: Yeni özellik veya modül geliştirmeleri için.
- `hotfix/*`: Yayındaki kritik hataların hızlı ve sınırlı düzeltilmesi için.
- `release/*`: Yayın hazırlığı, son testler ve stabilizasyon için.

Bu olası gelecek yapı bugünkü `main` merkezli akışla karıştırılmamalıdır. Branch stratejisi değişirse önce bu doküman, release checklist ve Codex promptları güncellenmelidir.

## 3. Yeni Özellik Geliştirme

Yeni özellik, yeni modül veya büyük geliştirme işlerinde önerilen akış:

```text
ChatGPT
  ->
Codex
  ->
Test
  ->
Commit
  ->
Push
```

### ChatGPT Aşaması

ChatGPT; ihtiyacı netleştirme, ISO 50001 yorumu, kullanıcı akışı, mimari karar ve Codex prompt hazırlama için kullanılır.

Bu aşamada şu sorular cevaplanmalıdır:

- Özellik hangi kullanıcı problemini çözüyor?
- Hangi ISO 50001 süreciyle ilişkili?
- Hangi tenant seviyesinde çalışacak?
- Backend, frontend, DB, OpenAPI veya generated client etkisi var mı?
- Migration gerekiyor mu?
- Package eklemek gerçekten gerekli mi?
- Authentication veya rol davranışı etkileniyor mu?

### Codex Aşaması

Codex uygulayıcıdır. Repo içinde ilgili dosyaları okur, mevcut pattern'i analiz eder ve en küçük güvenli değişikliği yapar.

Codex'e görev verirken şu sınırlar açık yazılmalıdır:

- Migration oluşturma.
- Package ekleme.
- Authentication değiştirme.
- Tenant izolasyonunu bozma.
- Generated dosyaları elle değiştirme.
- Typecheck/build çalıştır.
- Değişen dosyaları raporla.

### Test, Commit ve Push

Özellik tamamlandığında:

```bash
pnpm run typecheck
pnpm run build
git status --short
git diff
```

İlgili ekranlar manuel test edilir. Sonra küçük ve anlamlı commit oluşturulur. Push yalnızca kullanıcı onayıyla yapılır.

## 4. Bug Fix Süreci

Hata düzeltirken standart süreç:

```text
Analiz
  ->
Kök neden
  ->
Küçük değişiklik
  ->
Typecheck
  ->
Build veya ilgili test
  ->
Commit
  ->
Push
```

Kurallar:

- Önce kök neden bulunur.
- İlgili backend route, frontend sayfa, context, DB schema veya API client dosyaları okunur.
- Gereksiz refactor yapılmaz.
- En küçük güvenli değişiklik yapılır.
- Tenant, auth ve mevcut davranış korunur.
- Hata düzeltmesine ilgisiz dosyalar dahil edilmez.
- Düzeltme sonrası ilgili ekran veya API akışı test edilir.

Bug fix commit'i sorunu ve düzeltme alanını açıkça anlatmalıdır.

## 5. Commit Kuralları

Commit mesajları kısa, açıklayıcı ve tutarlı olmalıdır.

Önerilen format:

```text
type(scope): kısa açıklama
```

### Commit Mesaj Standardı

EnYS'te commit mesajları Conventional Commit yaklaşımına uygun yazılmalıdır. Amaç, Git geçmişinden değişikliğin türünü, etki alanını ve niyetini hızlıca anlayabilmektir.

Başlıca type değerleri:

| Type | Kullanım |
| --- | --- |
| `feat` | Yeni özellik, yeni ekran, yeni API davranışı veya kullanıcıya görünen yeni işlev. |
| `fix` | Hata düzeltmesi veya beklenen davranışa geri dönüş. |
| `docs` | Dokümantasyon güncellemesi. |
| `refactor` | Davranış değiştirmeyen kod düzenleme. |
| `test` | Test ekleme, test verisi güncelleme veya regresyon senaryosu. |
| `build` | Build, script, workspace veya paketleme sürecini etkileyen değişiklik. |
| `chore` | Bakım, temizlik veya çalışma alanı düzeni gibi ürün davranışını değiştirmeyen işler. |

Örnek commit mesajları:

```text
feat(targets): add action progress filters
fix(api): enforce company filter on meter lookup
docs: update Git workflow guide
refactor(dashboard): simplify KPI card mapping
test(login): add admin login smoke test
build: update development scripts
chore(api): refresh generated client after OpenAPI update
```

EnYS'e özel örnekler:

```text
feat(energy-review): add pending tasks widget
fix(meters): prevent duplicate meter creation
docs: update architecture guide
refactor(api): simplify auth middleware
test(seu): add regression dataset validation
build: update development scripts
chore: clean workspace configuration
```

Commit mesajı geçmişi okunabilir hale getirmelidir. Bu yüzden mesaj; "dosya değişti" bilgisinden çok, "neden değişti" ve "hangi alan etkilendi" bilgisini taşımalıdır.

Commit kuralları:

- Commit tek bir anlamlı işi temsil etmelidir.
- Commit mesajı Türkçe veya İngilizce olabilir; ancak kısa ve tutarlı olmalıdır.
- Generated dosya değişikliği varsa neden üretildiği bilinmelidir.
- Package veya lockfile değişmişse bunun bilinçli olup olmadığı kontrol edilmelidir.
- Migration dosyası varsa kullanıcı talebi ve açıklaması olmalıdır.

Profesyonel commit kalitesi:

- Yeni özellik, bug fix, refactor ve dokümantasyon değişiklikleri mümkün olduğunca ayrı commitlerde tutulmalıdır.
- Küçük bir bug fix içinde geniş refactor yapılmamalıdır.
- Dokümantasyon commit'i kod davranışını değiştirmemelidir.
- Refactor commit'i davranış değişikliği içermemelidir; davranış değişikliği gerekiyorsa ayrı commit yapılmalıdır.
- Büyük geliştirmelerde tek büyük commit yerine okunabilir küçük commitler tercih edilmelidir.
- Commit mesajı dosya listesini değil, yapılan işin amacını anlatmalıdır.

## 6. Push Kuralları

Push, yalnızca yerel değişiklikler doğrulandıktan ve commit hazırlandıktan sonra yapılmalıdır.

Push öncesi kontrol edilmesi gerekenler:

```bash
git status --short
git diff
pnpm run typecheck
pnpm run build
```

Push öncesi ayrıca:

- İlgili ekran manuel test edildi mi?
- Login ve yetki akışı bozulmadı mı?
- Tenant izolasyonu korundu mu?
- Package dosyaları beklenmeden değişmedi mi?
- Migration beklenmeden oluşmadı mı?
- Generated dosyalar elle değiştirilmedi mi?
- Commit mesajı doğru mu?

AI araçları kullanıcı açıkça istemedikçe push yapmaz. Push işlemi, ekip veya kullanıcı tarafından paylaşılmaya hazır kabul edilen değişiklikler için yapılmalıdır.

### Review Öncesi Kontrol

Push veya review öncesinde geliştirici kendi değişikliğine eleştirel bakmalıdır.

Sorulması gereken sorular:

- Değişiklik gerçekten istenen problemi çözüyor mu?
- Gereksiz dosya değişikliği var mı?
- İlgisiz refactor yapıldı mı?
- Tenant izolasyonu korundu mu?
- Authentication veya role davranışı değişti mi?
- API sözleşmesi veya generated client etkisi doğru yönetildi mi?
- Migration veya package değişikliği beklenmeden oluştu mu?
- `pnpm run typecheck` geçti mi?
- Gerekliyse `pnpm run build` geçti mi?
- İlgili ekran veya API akışı manuel test edildi mi?
- Commit mesajı değişikliği açık anlatıyor mu?

Bu sorulardan birine net cevap verilemiyorsa push öncesi değişiklik tekrar incelenmelidir.

### Dokümantasyon Commitleri

Dokümantasyon değişiklikleri EnYS'te ürün hafızasının parçasıdır ve kod değişiklikleri kadar düzenli yönetilmelidir.

Dokümantasyon commit kuralları:

- Sadece doküman güncelleniyorsa commit tipi genellikle `docs` olmalıdır.
- Kod davranışı ile dokümantasyon güncellemesi aynı işin ayrılmaz parçası değilse ayrı commit tercih edilmelidir.
- Geliştirici rehberi, mimari, kodlama kuralları veya AI prompt dokümanları değiştiğinde commit mesajı hangi referansın güncellendiğini açıkça belirtmelidir.
- Dokümantasyon commit'i migration, package veya generated dosya değişikliği içermemelidir.
- Doküman değişikliği kodu açıklıyorsa, ilgili kod değişikliği önce doğrulanmış olmalıdır.

Örnekler:

```text
docs: update Git workflow review checklist
docs(ai): add ChatGPT working modes
docs(architecture): clarify tenant ownership rules
```

## 7. Yasaklar

Açık kullanıcı talebi olmadan aşağıdaki işlemler yapılmamalıdır:

- `force push`
- history rewrite
- rebase
- branch silme
- tag oluşturma
- release oluşturma
- remote branch silme
- toplu dosya geri alma
- `git reset --hard`
- migration commit'i oluşturma
- package/lockfile değiştiren commit hazırlama

Bu işlemler Git geçmişini, ekip çalışmasını veya yayın sürecini etkileyebilir. Gerekiyorsa önce riskler açıklanmalı ve kullanıcıdan açık onay alınmalıdır.

## 8. Commit Öncesi Kontrol Listesi

Commit öncesi aşağıdaki liste kontrol edilmelidir:

- [ ] `git status --short` incelendi.
- [ ] `git diff` incelendi.
- [ ] Sadece bu işe ait dosyalar değişti.
- [ ] `pnpm run typecheck` çalıştırıldı.
- [ ] Gerekliyse `pnpm run build` çalıştırıldı.
- [ ] İlgili ekranlar manuel test edildi.
- [ ] Tenant kontrolü yapıldı.
- [ ] Auth kontrolü yapıldı.
- [ ] Migration oluşmadı veya açık talep ile oluştu.
- [ ] Package dosyaları değişmedi veya açık talep ile değişti.
- [ ] Generated dosya elle değiştirilmedi.
- [ ] OpenAPI değiştiyse codegen çıktısı bilinçli kontrol edildi.
- [ ] İlgisiz refactor yapılmadı.
- [ ] Commit mesajı değişikliği doğru anlatıyor.

## 9. Merge Hazırlığı

Merge öncesinde kalite kontrolleri daha sıkı yapılmalıdır.

Merge hazırlığı:

1. GitHub'daki hedef branch ile yerel branch güncel hale getirilir.
2. `pnpm run typecheck` çalıştırılır.
3. `pnpm run build` çalıştırılır.
4. İlgili ekranlar manuel test edilir.
5. Login ve temel yetki akışları kontrol edilir.
6. Admin, superadmin ve normal user etkisi düşünülür.
7. Tenant filtreleri kontrol edilir.
8. Package, migration ve generated dosya değişiklikleri incelenir.
9. Commit geçmişi anlaşılır mı kontrol edilir.
10. Merge açıklamasında riskler ve testler belirtilir.

Merge öncesi özellikle şu alanlar incelenmelidir:

- `artifacts/api-server/src/routes`
- `artifacts/ems-dashboard/src/pages`
- `artifacts/ems-dashboard/src/context`
- `lib/db/src/schema/energy.ts`
- `lib/api-spec/openapi.yaml`
- `lib/api-client-react/src/generated`
- `package.json`
- `pnpm-lock.yaml`

### Küçük Merge Conflict Rehberi

Merge conflict, panik nedeni değildir. Git aynı satır veya yakın alanlarda iki farklı değişikliği otomatik birleştiremediğinde geliştiriciden karar ister.

Temel yaklaşım:

1. Önce durum görülür:

```bash
git status --short
```

2. Conflict olan dosyalar belirlenir.
3. Conflict marker'ları incelenir:

```text
<<<<<<<
=======
>>>>>>>
```

4. Marker'lar anlamadan silinmez.
5. İki değişikliğin amacı anlaşılmadan çözüm yapılmaz.
6. Gerekirse ChatGPT'den conflict analizi istenir; ancak gerçek dosya çözümü Codex veya geliştirici tarafından repo üzerinde yapılır.
7. Conflict çözüldükten sonra dosya tekrar okunur ve davranışın doğru birleştiği kontrol edilir.

Temel ilke:

> Conflict çözmenin amacı yalnızca Git'i memnun etmek değil, iki değişikliği doğru şekilde birleştirmektir.

Conflict sonrası doğrulama:

- `pnpm run typecheck`
- gerekiyorsa `pnpm run build`
- ilgili ekran veya API için manuel test
- `git diff` ile conflict çözümünün review edilmesi

Conflict çözümü normal kod değişikliği gibi değerlendirilmelidir. Tenant, auth, generated dosya, package ve migration etkileri conflict sırasında da aynı titizlikle kontrol edilmelidir.

## 10. AI Araçları ile Git Kullanımı

### ChatGPT

ChatGPT karar ve analiz asistanıdır.

ChatGPT:

- Git stratejisi önerebilir.
- Commit mesajı taslağı hazırlayabilir.
- Risk analizi yapabilir.
- Değişiklikleri yorumlayabilir.
- Codex'e verilecek Git kontrol promptunu hazırlayabilir.

ChatGPT commit veya push yapmaz.

### Codex

Codex repo içinde komut çalıştırabilir ve dosya değiştirebilir.

Codex:

- `git status --short` çalıştırabilir.
- `git diff` inceleyebilir.
- Değişen dosyaları raporlayabilir.
- Commit mesajı önerebilir.
- Kullanıcı açıkça isterse commit atabilir.
- Kullanıcı açıkça isterse push yapabilir.

Codex kullanıcı istemedikçe commit veya push yapmaz. Ayrıca `force push`, rebase, branch silme veya history rewrite gibi işlemleri açık onay olmadan yapmaz.

### Kullanıcı

Kullanıcı nihai karar vericidir.

Kullanıcı:

- Hangi değişikliğin kabul edileceğine karar verir.
- Commit atılıp atılmayacağını belirler.
- Push yapılacak zamanı belirler.
- Riskli Git işlemlerine onay verir veya reddeder.
- GitHub üzerindeki repository durumunu nihai kaynak olarak kabul eder.

### Tek Geliştirici Çalışma Modeli

EnYS şu anda tek geliştirici tarafından AI destekli geliştirilmektedir. Bu modelde Git süreci, ekip içi onaydan çok kişisel disiplin, izlenebilirlik ve GitHub'a güvenli aktarım üzerine kuruludur.

Önerilen akış:

```text
İhtiyaç
  ->
ChatGPT
  ->
Analiz
  ->
Prompt
  ->
Codex
  ->
Kod
  ->
Typecheck
  ->
Build
  ->
Manuel Test
  ->
Review
  ->
Commit
  ->
Push
```

Adımların Git sürecindeki amacı:

| Adım | Amaç |
| --- | --- |
| İhtiyaç | Yapılacak işin ürün hedefini ve beklenen sonucu tanımlamak. |
| ChatGPT | Karar, kapsam, risk ve kalite açısından düşünce desteği almak. |
| Analiz | Tenant, auth, DB, API, frontend ve dokümantasyon etkisini anlamak. |
| Prompt | Codex'e verilecek görevi sınırlı, net ve doğrulanabilir hale getirmek. |
| Codex | Repo üzerinde uygulama yapmak, ilgili dosyaları okumak ve değişiklikleri hazırlamak. |
| Kod | En küçük güvenli değişiklikle işi tamamlamak. |
| Typecheck | Tip, import ve proje referans hatalarını yakalamak. |
| Build | Geliştirmenin paketlenebilir ve çalıştırılabilir kaldığını doğrulamak. |
| Manuel Test | Etkilenen ekran veya API akışının kullanıcı açısından doğru çalıştığını görmek. |
| Review | `git diff`, tenant/auth etkisi ve gereksiz dosya değişikliklerini kontrol etmek. |
| Commit | Tek mantıksal değişikliği okunabilir mesajla Git geçmişine almak. |
| Push | Onaylanan çalışmayı GitHub'daki gerçek kaynak depoya göndermek. |

Bu modelde ChatGPT karar ve kalite danışmanıdır. Codex repo üzerinde uygulayıcı geliştiricidir. Kullanıcı ürün sahibidir ve commit/push kararını verir. GitHub ise gerçek kaynak kod deposudur.

### AI Destekli Git Akışı

EnYS'te AI destekli Git süreci şu sırayla ele alınmalıdır:

```text
ChatGPT
  ->
Codex
  ->
Kullanıcı
  ->
Git
  ->
Push
```

Bu akışta ChatGPT; değişikliğin amacı, riskleri, commit kapsamı ve Codex promptu konusunda danışmanlık yapar. Codex repo üzerinde `git status`, `git diff`, typecheck/build ve değişen dosya analizini yapabilir. Kullanıcı hangi değişikliğin kabul edileceğine, commit atılıp atılmayacağına ve push zamanına karar verir.

Codex'in varsayılan davranışı commit veya push yapmamak olmalıdır. Commit veya push yalnızca kullanıcı açıkça isterse ve önce `git status`, `git diff`, typecheck/build/test durumu raporlandıysa yapılmalıdır.

## 11. Acil Durumlar

Git acil durumlarında acele komut çalıştırılmamalıdır. Önce durum analiz edilmeli, sonra en az riskli geri alma yolu seçilmelidir.

### Yanlış Dosya Değişikliği

Henüz commit edilmemiş yanlış değişikliklerde amaç, yalnızca ilgili dosyayı geri almaktır.

Kullanılabilecek komut:

```bash
git restore <dosya>
```

Risk:

- Dosyadaki yerel değişiklikler kaybolur.
- Kullanıcının yaptığı değişiklikler de aynı dosyadaysa silinebilir.

AI araçları, kullanıcının değişikliklerini silme riski varsa restore yapmadan önce açık onay almalıdır.

### Yanlış Commit

Yanlış commit henüz push edilmediyse birkaç seçenek vardır:

- Yeni düzeltme commit'i atmak.
- Commit'i yumuşak şekilde geri almak.
- Commit içeriğini düzenlemek.

`git reset` geçmişi değiştirebilir. Bu yüzden dikkatli kullanılmalıdır.

### Yanlış Push

Yanlış commit GitHub'a push edildiyse önerilen güvenli yol çoğu durumda `git revert` kullanmaktır:

```bash
git revert <commit>
```

`revert`, geçmişi silmeden ters commit oluşturur. Ekip çalışması için genellikle `reset` ve force push'tan daha güvenlidir.

### Restore, Revert ve Reset Farkları

`git restore`:

- Commit edilmemiş dosya değişikliklerini geri almak için kullanılır.
- Dosya seviyesinde etki eder.
- Yanlış dosyada kullanılırsa yerel çalışma kaybolabilir.

`git revert`:

- Commit edilmiş değişikliği tersine çeviren yeni commit oluşturur.
- Git geçmişini bozmaz.
- Push edilmiş değişiklikler için güvenli tercihtir.

`git reset`:

- Branch pointer'ını değiştirir.
- Commit geçmişini değiştirebilir.
- `--hard` kullanılırsa çalışma ağacındaki değişiklikleri siler.
- Ekip çalışmasında risklidir ve açık onay olmadan kullanılmamalıdır.

Basit rollback tercihi:

- Commit edilmemiş tek dosya hatalıysa önce `git restore <dosya>` düşünülür.
- Commit edilmiş ama henüz push edilmemiş küçük hata varsa yeni düzeltme commit'i çoğu zaman en anlaşılır yoldur.
- Push edilmiş hatalı commit varsa genellikle `git revert <commit>` tercih edilir.
- `git reset` yalnızca yerel geçmişi bilinçli düzenlemek gerekiyorsa ve riskler netse kullanılmalıdır.
- `git reset --hard` ve force push, kullanıcıdan açık onay olmadan yapılmamalıdır.

### Acil Durum Kuralı

Riskli Git işlemlerinden önce:

```bash
git status --short
git diff
```

çıktıları incelenmeli ve hangi dosyaların etkileneceği netleştirilmelidir.

## 12. Son Hatırlatma

EnYS projesinde Git kullanımının ana ilkeleri:

- GitHub ana kaynaktır.
- Küçük commitler tercih edilir.
- Önce test.
- Sonra commit.
- Sonra push.
- Tenant izolasyonu ve auth davranışı commit öncesi kontrol edilir.
- Migration ve package değişiklikleri açık talep olmadan yapılmaz.
- Generated dosyalar elle değiştirilmez.
- Kullanıcı istemedikçe AI commit ve push yapmaz.

### Git Kalite Kontrol Listesi

Çalışma bitmeden önce kısa kontrol:

- [ ] `git status --short` kontrol edildi.
- [ ] `git diff` satır bazında incelendi.
- [ ] Değişen dosyalar bu işle ilgili.
- [ ] `pnpm run typecheck` geçti veya çalıştırılamama nedeni açık.
- [ ] Gerekliyse `pnpm run build` geçti veya çalıştırılamama nedeni açık.
- [ ] İlgili ekran/API manuel test edildi.
- [ ] Tenant izolasyonu ve auth davranışı kontrol edildi.
- [ ] Migration, package ve generated dosya değişiklikleri bilinçli.
- [ ] Commit tek mantıksal değişikliği temsil ediyor.
- [ ] Commit mesajı anlamlı.
- [ ] Push için kullanıcı onayı var.

Git geçmişi, EnYS'in teknik hafızasıdır. Bu hafıza açık, düzenli ve güvenilir tutulmalıdır.

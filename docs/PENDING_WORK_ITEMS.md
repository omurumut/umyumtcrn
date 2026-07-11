# Bekleyen İşler Modülü

## 1. Modülün Amacı

Bekleyen İşler modülü, ISO 50001 SaaS uygulamasında kullanıcıya "hangi kritik iş eksik?" sorusunun yanıtını verir. Bu ekran manuel bir görev listesi değildir; mevcut ISO 50001 verilerini anlık olarak okuyarak eksik, gecikmiş veya dikkat gerektiren işleri dinamik şekilde üretir.

Temel entegrasyon noktaları:

- Backend endpoint: `GET /api/pending-work-items`
- Backend dosyası: `artifacts/api-server/src/routes/pending-work-items.ts`
- Frontend sayfası: `artifacts/ems-dashboard/src/pages/PendingWorkItems.tsx`
- Frontend route: `/bekleyen-isler`

## 2. Manuel Tasks Yaklaşımı Kullanılmayacak

Bu modül eski manuel görev/todo yaklaşımını kullanmaz ve kullanmayacak.

Kesinlikle kapsam dışı olan yapılar:

- `tasksTable` yok.
- `/api/tasks` yok.
- `Tasks.tsx` yok.
- Manuel görev oluşturma, düzenleme, silme veya tamamlama yok.
- Yeni migration gerektiren görev tablosu yok.
- Bekleyen işler için yeni DB tablosu yok.

Bekleyen işler, mevcut ISO 50001 kayıtlarından türetilir.

## 3. Response Shape

Her bekleyen iş ortak olarak şu alanlarla döner:

```ts
{
  id: string;
  type: string;
  severity: "info" | "warning" | "critical";
  title: string;
  description: string;
  sourceModule: string;
  sourceRecordId: number | null;
  unitId: number | null;
  unitName: string | null;
  dueDate: string | null;
  actionUrl: string | null;
}
```

## 4. Rol ve Tenant Güvenliği

Tenant kapsamı backend tarafında korunur.

- `companyId` sadece `req.user.companyId` üzerinden alınır.
- Standart kullanıcı sadece kendi `unitId` kapsamını görür.
- `admin` ve `kontrol_admin`, kendi şirketinde şirket geneli veya seçili birim kapsamında bekleyen işleri görür.
- Standart kullanıcı query ile başka `unitId` gönderse bile backend bunu güvenilir kabul etmez.
- `superadmin` için Bekleyen İşler menüsü görünmez; mevcut görünmeme davranışı korunur.

## 5. Mevcut Kontrol Tipleri

### Tüketim

- Eksik aylık tüketim verisi.
- İlk fazlarda önceki ay kontrol edilir.
- Eksik tüketim uyarıları yıl/ay ve birim bazında gruplanır.

### Aksiyon Planları

- Gecikmiş aksiyon planı.
- Yaklaşan terminli aksiyon planı.

### ÖEK / EnRÇ / EnPG

- Kabul edilmiş resmi ÖEK için aktif/geçerli EnRÇ modeli yok.
- Aktif/geçerli EnRÇ için ilgili yılda EnPG izleme sonucu yok.

### Enerji Hedefleri

- Aktif/geçerli hedef için aksiyon planı yok.
- Geçmiş hedef yılı için sonuç/progress değerlendirmesi yok.

### VAP

- VAP projesi gecikmiş.
- Tamamlanan VAP projesinde tasarruf sonucu yok.

### Enerji Gözden Geçirme

- Seçili yıl/birim için enerji gözden geçirme kaydı yok.
- Seçili yıl/birim kaydı taslak durumda.
- Soft-deleted completed kayıtlar güncel kayıt sayılmaz.
- Aynı yıl/kapsam için mükerrer kayıt oluşturma backend tarafında engellenmiştir.

### Risk & Fırsat

- Yüksek risk için aksiyon/önlem planı yok.
- Kural:
  - `type = "risk"`
  - `status != "kapali"`
  - `score >= 15`
  - `responseType != "aksiyon"` veya `mitigationPlan` boş/null/trim sonrası boş

## 6. Deep-Link Destekleri

Bekleyen iş kartlarındaki `actionUrl`, kullanıcıyı mümkün olduğunca ilgili ekran ve bağlama götürür.

Desteklenen bağlantı kalıpları:

- `/tuketim?year=...&month=...&unitId=...&meterId=...`
- `/performans-gostergeleri?seuItemId=...&baselineId=...&year=...&tab=...`
- `/hedefler?targetId=...&actionPlanId=...`
- `/vap-projeler?vapProjectId=...&actionPlanId=...`
- `/enerji-gozden-gecirme?tab=records&year=...&unitId=...&reviewRecordId=...`
- `/riskler?riskId=...&unitId=...&type=risk`

Deep-link davranışları genellikle ayrı küçük fazlarda eklenir. Backend kontrolü ile frontend odaklama/vurgulama aynı fazda olmak zorunda değildir.

## 7. Kapsam Dışı Bırakılan Kontroller

Aşağıdaki kontroller mevcut veri modeli nedeniyle bu modülde yoktur:

- Risk gözden geçirme tarihi geçmiş kontrolü yok; modelde `reviewDate` veya `followUpDate` yok.
- Risk aksiyonu tamamlandı ama kalan risk değerlendirilmedi kontrolü yok; gerçek aksiyon tamamlanma ilişkisi yok.
- Manuel task yönetimi yok.
- Yeni pending work tablosu yok.
- Pending work için migration yok.

## 8. Yeni Kontrol Ekleme Kuralları

Yeni bir bekleyen iş kontrolü eklenmeden önce mimari analiz yapılır.

Kurallar:

- Veri modeli güvenilir değilse kontrol eklenmez.
- `companyId` güvenliği bozulmaz.
- Standart kullanıcının `unitId` sınırı korunur.
- Query ile gelen `unitId`, standart kullanıcı için güvenilir kabul edilmez.
- Mümkünse sadece `artifacts/api-server/src/routes/pending-work-items.ts` değiştirilir.
- Deep-link desteği ayrı küçük faz olarak ele alınır.
- OpenAPI/Orval/generated client dosyaları gereksiz yere değiştirilmez.
- DB/schema/migration gerektiren tasarımlardan kaçınılır.
- Gereksiz refactor yapılmaz.
- Eski `tasks` altyapısı oluşturulmaz veya kullanılmaz.

## 9. Sonraki Faz Önerileri

Gelecekte değerlendirilebilecek kontroller:

- SWOT kontrolü.
- Değişken verisi eksikliği.
- Sayaç lokasyon/MGM eşleşme eksikliği.
- Hedef hesaplama için veri yeterliliği.
- EnRÇ değişken veri bütünlüğü.

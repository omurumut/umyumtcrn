# Rapor Altyapisi Production Migration Hazirligi

Bu not, rapor ayarlari, snapshot altyapisi ve Faz 4A rapor arsivi icin production oncesi denetim ve migration hazirligini ozetler. Scheduled report, retry queue ve retention job bu kapsamda yoktur.

## Mimari

Rapor ayarlari kod tabanli `REPORT_TYPE_REGISTRY` ile baslar. Firma geneli profil, rapor turu ayarlari ve section ayarlari DB'de tutulur; renderer calismadan once `resolveEffectiveCompanyReportSettings` bu katmanlari tek effective modele indirger.

Desteklenen rapor turleri:

| Kod | Endpoint | Cikti |
| --- | --- | --- |
| `annual_energy_performance` | `POST /api/reports/generate` | HTML arsiv dosyasi ve response-only data URL |
| `energy_targets_management` | `GET /api/reports/energy-targets/pdf` | PDF |
| `energy_performance_monitoring` | `GET /api/reports/energy-performance/pdf` | PDF |

Precedence sirası:

1. Registry defaultlari
2. Firma rapor profili
3. Firma rapor turu ayarlari
4. Firma section ayarlari
5. Request-scope legacy override

Legacy override DB ayarlarini mutate etmez; yalniz ilgili request snapshot'inda gorunur.

## Snapshot Lifecycle

Beklenen akis:

1. Request validation ve auth
2. Tenant/company/unit scope cozumleme
3. Rapor verisinin yuklenmesi
4. Effective settings cozumleme
5. Conditional evaluator kararlari
6. `report_generation_snapshots` icin `generating` kaydi
7. Started audit
8. HTML/PDF render
9. `report_archives` icin `generating` kaydi
10. HTML/PDF binary'nin storage provider'a yazilmasi
11. Size ve SHA-256 checksum dogrulamasi
12. Snapshot `completed` ve `storage_status='stored'` update
13. Archive `completed` update ve completed audit
14. Hata halinde snapshot/archive `failed` update ve failed audit

Snapshot JSON'u karar kaydidir; tam HTML, data URL, PDF binary veya buyuk veri seti saklamaz. Completed kayitlar uygulama tarafindan immutable kabul edilir. Faz 4A'dan sonra yeni rapor binary'leri `reports.download_url` icinde saklanmaz; arama ve indirme icin `report_archives` kullanilir. Annual HTML response'u geriye donuk e2e/istemci uyumu icin gecici `dataUrl` dondurur, ancak bu deger DB'ye yazilmaz.

## Migration 0028/0029/0030/0031

`0028_company_report_settings.sql` su tablolari ekler:

- `company_report_profiles`
- `company_report_type_settings`
- `company_report_section_settings`

`0029_report_generation_snapshots.sql` su tabloyu ekler:

- `report_generation_snapshots`

`0030_report_archives.sql` su degisiklikleri ekler:

- `report_archives`
- `report_generation_snapshots.storage_status` icin `stored` ve `storage_failed` degerleri
- tenant, status, generated date ve storage key indexleri

`0031_report_archive_retention.sql` su degisiklikleri ekler:

- `company_report_retention_settings`
- `report_archives` lifecycle kolonlari: `deleted_at`, `deleted_by`, `delete_reason`, `purge_eligible_at`, `purged_at`, `purged_by`, `purge_failure_category`, `retention_expires_at`, `deletion_locked`, `previous_status`, `lifecycle_version`
- `deleted`, `purging`, `purged`, `purge_failed` status degerleri
- retention ve purge aday sorgulari icin tenant/status/date indexleri

Production oncesi disposable dry-run zorunludur:

```powershell
pnpm.cmd --filter @workspace/scripts run test:report-migration-readiness
pnpm.cmd run test:db:smoke
pnpm.cmd run test:audit-restore
pnpm.cmd run test:operational-readiness
```

Bu komutlar production DB kullanmaz; `test-db.ts` tarafindan dogrulanan localhost disposable PostgreSQL uzerinde calisir.

## Production Uygulama Sirasi

1. Dogru branch ve commit'i dogrula.
2. Backup/PITR durumunu dogrula.
3. Production benzeri clone/branch uzerinde dry-run yap.
4. Maintenance veya traffic kararini ver.
5. `0028_company_report_settings.sql` migration'ini uygula.
6. `0029_report_generation_snapshots.sql` migration'ini uygula.
7. `0030_report_archives.sql` migration'ini uygula.
8. `0031_report_archive_retention.sql` migration'ini uygula.
9. Constraint ve indexleri dogrula.
10. Report storage provider env'lerini dogrula.
11. Backend deploy et.
12. Frontend deploy et.
13. Settings API smoke test yap.
14. Uc rapor turu icin smoke test yap.
15. Archive list/download/delete/restore smoke test yap.
16. Audit event, snapshot ve archive insert kontrolu yap.
17. Monitoring izle.
18. Rollback veya devam kararini ver.

## Report Archive Storage

Faz 4A ile yeni rapor ciktisi once immutable snapshot'a, sonra storage-backed archive kaydina baglanir. API response'lari storage bucket, local path veya internal key dondurmez. Kullaniciya yalniz `/api/reports/archive/:id/download` gibi auth gerektiren uygulama endpoint'i verilir.

Zorunlu production env sozlesmesi:

- `REPORT_STORAGE_PROVIDER`: Production icin acikca tanimli olmalidir. Desteklenen local adapter yalniz development/test ve disposable production-like smoke icindir.
- `REPORT_STORAGE_PROVIDER=s3`: S3 uyumlu kalici object storage adapter'ini acar.
- `REPORT_STORAGE_BUCKET`: `s3` icin zorunludur. Bucket private kalmali; uygulama public ACL veya signed/public URL uretmez.
- `REPORT_STORAGE_REGION`: `s3` icin zorunludur. S3 uyumlu servis sentetik region istiyorsa operasyon tarafindan acikca set edilir.
- `REPORT_STORAGE_ENDPOINT`: Standart AWS S3 disindaki S3 uyumlu servisler icin opsiyonel custom endpoint.
- `REPORT_STORAGE_ACCESS_KEY_ID` / `REPORT_STORAGE_SECRET_ACCESS_KEY`: Birlikte set edilirse explicit static credential kullanilir; yalniz biri varsa config gecersizdir. Ikisi de yoksa runtime AWS credential chain kullanilir.
- `REPORT_STORAGE_SESSION_TOKEN`: Gecici credential icin opsiyoneldir.
- `REPORT_STORAGE_FORCE_PATH_STYLE`: Yalniz `true` veya `false` kabul edilir.
- `REPORT_STORAGE_PREFIX`: Server kontrollu opsiyonel prefix; leading/trailing slash normalize edilir, `..`, backslash ve kontrol karakterleri reddedilir.
- `REPORT_STORAGE_REQUEST_TIMEOUT_MS`: Bounded timeout, varsayilan 5000 ms.
- `REPORT_STORAGE_MAX_DOWNLOAD_BYTES`: Bounded archive boyutu, varsayilan 50 MiB.
- `REPORT_STORAGE_LOCAL_ROOT`: Local adapter kullaniliyorsa kok klasor. Production'da kalici object storage adapter'i hazir olmadan local adapter kullanilmaz.
- `REPORT_ARCHIVE_STORAGE_REQUIRED`: Varsayilan davranis storage readiness fail-closed. Sadece gecici operasyonel tanida `false` yapilabilir.

S3 adapter guvenlik sinirlari:

- Storage key uygulama tarafindan uretilir ve `companies/...` tenant yapisini korur; request ile provider veya key secilemez.
- Upload `Content-Type`, `Content-Length` ve SHA-256 metadata yazar; basarili upload sonrasi `HeadObject` ile size/checksum dogrular.
- Download `GetObject` stream'i kullanir; object tamamen memory'ye alinmaz ve endpoint public/signed URL redirect yapmaz.
- `HeadBucket` readiness read-only'dir; her readiness request'inde put/delete yapilmaz.
- Hata kategorileri `storage_config_invalid`, `storage_access_denied`, `storage_object_not_found`, `storage_timeout` gibi guvenli degerlere indirgenir.
- Bucket, endpoint, access key, secret, session token, raw SDK error, full key veya header response/audit metadata icine yazilmaz.
- Provider-managed encryption yeterli kabul edilir; customer-managed key ve multipart upload bu fazda zorunlu degildir.

Local adapter guvenlik sinirlari:

- Storage key uygulama tarafindan uretilir; kullanici path'i kabul edilmez.
- `..`, backslash, root disina cikis ve symlink escape denemeleri reddedilir.
- Yazimdan sonra size ve SHA-256 checksum DB metadata'siyle dogrulanir.
- Indirme endpoint'i auth, tenant scope ve archive status kontrolu yapar.

Opsiyonel S3 smoke:

```powershell
pnpm.cmd run test:report-storage-s3-smoke
```

Bu komut varsayilan `skipped: not_configured` sonucuyla cikar. Remote write yalniz `REPORT_STORAGE_S3_SMOKE_ENABLE=true` ve `REPORT_STORAGE_S3_SMOKE_ACK=test-bucket` ile, ayrica `REPORT_STORAGE_PROVIDER=s3` ve test bucket env'leri set edildiginde yapilir.

Legacy `reports.download_url` icinde daha once saklanmis data URL kayitlari destructive migration ile tasinmadi. Eski kayitlar eski history ekraninda kalabilir; yeni raporlar archive tablosundan indirilir.

## Retention, Delete, Restore ve Purge Lifecycle

Faz 4C retention modeli tenant-scoped ve varsayilan kapali gelir. Yeni sirket kaydi olmadiginda effective default:

- `retentionEnabled=false`
- `completedRetentionDays=3650`
- `failedRetentionDays=90`
- `deletedGraceDays=30`
- `automaticCleanupAllowed=false`

Bounds bilerek destructive olmayan sekilde genistir: completed 365-36500 gun, failed 30-3650 gun, deleted grace 7-365 gun. Retention kapaliyken completed/failed archive kayitlari retention nedeniyle purge adayi sayilmaz. Soft-delete grace ayari retention kapali olsa bile manuel silinen kayitlarin purge eligible tarihini belirler.

Expiry materialized davranir. Archive `completed` veya `failed` oldugunda o andaki company policy okunur ve `retention_expires_at` hesaplanir. Sonradan policy degisirse eski archive kayitlari otomatik recalculation yapmaz; ayrica recalculation operasyonu sonraki faza birakildi. Tum gun hesabi UTC epoch millisecond uzerinden deterministic yapilir.

Soft-delete storage object'i silmez. `DELETE /api/reports/archive/:id` yalniz admin/superadmin icindir, `completed` ve `failed` kayitlari `deleted` durumuna alir, `previous_status`, `deleted_at`, `deleted_by`, `delete_reason` ve `purge_eligible_at` yazar. `kontrol_admin` ve standard user mutate edemez. Download yalniz `completed` icin aciktir; `deleted`, `purging`, `purged`, `purge_failed` ve `failed` indirilemez.

Restore `POST /api/reports/archive/:id/restore` ile yalniz `deleted` kayit icin calisir. Storage object `exists` kontrolu gecmeden restore yapilmaz; object eksikse missing-object diagnostics ile gorunur. Restore eski guvenli statuye (`completed` veya `failed`) doner ve soft-delete timestamp alanlarini temizler; audit history korunur.

Purge iki kontrollu yoldan calisir:

- Tek kayit: `POST /api/reports/archive/:id/purge`, explicit `ack=PURGE_ARCHIVE_<id>` ister.
- Batch ops: `pnpm --filter @workspace/scripts run report-archive-cleanup -- --company-id <id>` varsayilan dry-run calisir.

Purge once DB status claim yapar, sonra storage delete calisir, sonra tombstone kaydi `purged` olur. DB row hard-delete edilmez. Storage hatasinda status `purge_failed` ve guvenli failure category yazilir. `deletion_locked=true` kayitlar silme/purge icin reddedilir; tam legal hold UI sonraki faz kapsamidir.

Batch execute icin guard'lar:

```powershell
pnpm.cmd --filter @workspace/scripts run report-archive-cleanup -- --company-id 1 --execute --ack EXECUTE_REPORT_ARCHIVE_CLEANUP_1 --max-count 25 --max-bytes 52428800
```

Remote DB write icin ek olarak `REPORT_ARCHIVE_CLEANUP_REMOTE_ACK=EXECUTE_REPORT_ARCHIVE_CLEANUP_<companyId>` gerekir. Production'da bu komut yalniz backup/PITR, storage readiness ve aday plan review tamamlandiktan sonra calistirilmelidir. Bu fazda cron, scheduler, retry queue veya nightly cleanup yoktur.

Missing-object diagnostics `GET /api/reports/archive/diagnostics/missing` ile DB adaylari uzerinde bounded `exists` kontrolu yapar; full bucket scan yoktur. Orphan diagnostics `GET /api/reports/archive/diagnostics/orphans` ile yalniz `companies/<companyId>/reports/` prefix'i altinda bounded provider listing kullanir, object identifier hash/redacted doner, default davranis dry-run/read-only'dir. Orphan cleanup execute bu fazda UI veya API olarak acilmamistir.

Backup/restore notu: DB backup tek basina storage object'lerini geri getirmez. Object storage versioning ve bucket lifecycle korunumu tavsiye edilir. DB restore sonrasi missing-object diagnostics ve rapor archive smoke calistirilmalidir.

## Smoke Testler

- Login ve tenant secimi.
- `Company Settings > Reports` profil okuma ve admin update.
- Required section gizleme denemesinin reddedilmesi.
- Annual HTML rapor uretimi ve `report_generation_snapshots` completed kaydi.
- Energy targets PDF uretimi ve audit started/completed eventleri.
- Energy performance PDF uretimi ve tenant scope dogrulamasi.
- Archive listesinde yalniz kullanicinin tenant/unit kapsamindaki raporlarin gorunmesi.
- Archive download endpoint'inin completed olmayan veya baska tenant'a ait kayitlari reddetmesi.
- Archive soft-delete sonrasi kaydin varsayilan listeden cikmasi ve download'un 409 donmesi.
- Deleted archive restore icin storage object `exists` kontrolunun gecmesi.
- Purge dry-run planinin storage key, bucket veya endpoint sizdirmamasi.
- Indirme audit event'inin storage key, local path veya bucket bilgisi icermemesi.
- Standard kullanicinin kendi unit scope disina cikamamasi.
- Superadmin icin explicit company context zorunlulugu.

## Rollback Yaklasimi

Uygulama rollback'i onceki guvenli commit'e donmektir. Yeni tablolar eski uygulama tarafindan okunmadigi icin DB'de kalmalari normalde eski uygulamayi bozmaz.

DB rollback destructive kabul edilir. `0030` geri alinirse archive metadata'si ve indirme gecmisi, `0029` geri alinirse snapshot kayitlari, `0028` geri alinirse firma rapor ayarlari kaybolur. Drop oncesi ilgili tablolar export edilmelidir. FK sirasina gore once `report_archives`, sonra `report_generation_snapshots`, sonra `company_report_section_settings`, `company_report_type_settings`, `company_report_profiles` dusunulur. Production'da destructive rollback yerine forward-fix tercih edilmelidir.

Stuck `generating` kayitlarini bulmak icin:

```sql
SELECT id, company_id, unit_id, report_type, year, filename, generated_at, generated_by
FROM report_generation_snapshots
WHERE status = 'generating'
  AND generated_at < now() - interval '30 minutes'
ORDER BY generated_at;
```

Manuel `failed` isaretleme yalniz uygulama loglari, audit durumu ve kullanici etkisi incelendikten sonra dusunulmelidir.

Faz 3D itibariyla operasyonel, read-only diagnostics icin `GET /api/admin/report-snapshots/diagnostics` kullanilir. Varsayilan stale `generating` esigi 30 dakikadir; query ile yalniz 5-1440 dakika araliginda sinirli deger kabul edilir. Endpoint tam `settings_snapshot_json`, HTML/PDF icerigi, local path veya secret dondurmez. Admin ve kontrol_admin yalniz kendi sirketini gorur; superadmin explicit `companyId` ile calisir.

## Bilinen Eksikler

- Distributed lock ve idempotency key yok; ayni kullanici ayni raporu es zamanli uretirse duplicate snapshot kabul edilir.
- Otomatik stale-generating cleanup/retry yok.
- Renderer crash ve completed update failure icin daha hedefli fault-injection testleri eklenebilir.
- Snapshot JSON boyutu icin DB check constraint yok; helper'lar buyuk binary/HTML saklamayacak sekilde sinirli veri yazar.
- Automatic scheduler, retry queue, orphan cleanup execution UI, multipart upload esigi ve customer-managed encryption key sonraki operasyonel faz kapsamidir.

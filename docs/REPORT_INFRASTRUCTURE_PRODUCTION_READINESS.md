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

## Migration 0028/0029/0030

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
8. Constraint ve indexleri dogrula.
9. Report storage provider env'lerini dogrula.
10. Backend deploy et.
11. Frontend deploy et.
12. Settings API smoke test yap.
13. Uc rapor turu icin smoke test yap.
14. Archive list/download smoke test yap.
15. Audit event, snapshot ve archive insert kontrolu yap.
16. Monitoring izle.
17. Rollback veya devam kararini ver.

## Report Archive Storage

Faz 4A ile yeni rapor ciktisi once immutable snapshot'a, sonra storage-backed archive kaydina baglanir. API response'lari storage bucket, local path veya internal key dondurmez. Kullaniciya yalniz `/api/reports/archive/:id/download` gibi auth gerektiren uygulama endpoint'i verilir.

Zorunlu production env sozlesmesi:

- `REPORT_STORAGE_PROVIDER`: Production icin acikca tanimli olmalidir. Desteklenen local adapter yalniz development/test ve disposable production-like smoke icindir.
- `REPORT_STORAGE_LOCAL_ROOT`: Local adapter kullaniliyorsa kok klasor. Production'da kalici object storage adapter'i hazir olmadan local adapter kullanilmaz.
- `REPORT_ARCHIVE_STORAGE_REQUIRED`: Varsayilan davranis storage readiness fail-closed. Sadece gecici operasyonel tanida `false` yapilabilir.

Local adapter guvenlik sinirlari:

- Storage key uygulama tarafindan uretilir; kullanici path'i kabul edilmez.
- `..`, backslash, root disina cikis ve symlink escape denemeleri reddedilir.
- Yazimdan sonra size ve SHA-256 checksum DB metadata'siyle dogrulanir.
- Indirme endpoint'i auth, tenant scope ve archive status kontrolu yapar.

Legacy `reports.download_url` icinde daha once saklanmis data URL kayitlari destructive migration ile tasinmadi. Eski kayitlar eski history ekraninda kalabilir; yeni raporlar archive tablosundan indirilir.

## Smoke Testler

- Login ve tenant secimi.
- `Company Settings > Reports` profil okuma ve admin update.
- Required section gizleme denemesinin reddedilmesi.
- Annual HTML rapor uretimi ve `report_generation_snapshots` completed kaydi.
- Energy targets PDF uretimi ve audit started/completed eventleri.
- Energy performance PDF uretimi ve tenant scope dogrulamasi.
- Archive listesinde yalniz kullanicinin tenant/unit kapsamindaki raporlarin gorunmesi.
- Archive download endpoint'inin completed olmayan veya baska tenant'a ait kayitlari reddetmesi.
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
- Kalici object storage adapter'i ve retention policy sonraki operasyonel faz kapsamidir; Faz 4A local adapter'i production-like disposable smoke icindir.

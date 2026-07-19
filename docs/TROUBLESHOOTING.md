# Troubleshooting

Bu doküman, EnYS projesinde geliştirme sırasında karşılaşılabilecek yaygın sorunları ve çözüm yollarını tek yerde toplar. İçerik genel internet tavsiyesi olarak değil; bu repoda kullanılan gerçek mimari, Windows geliştirme ortamı, pnpm workspace yapısı, Express API, React/Vite frontend, Drizzle/PostgreSQL ve Neon bağlantısı dikkate alınarak hazırlanmıştır.

## 1. Amaç

Bu dokümanın amacı, sorun yaşandığında geliştiricinin hızlı ama güvenli şekilde teşhis yapmasını sağlamaktır.

Temel yaklaşım:

```text
Önce teşhis
  ->
Sonra çözüm
```

EnYS'te aceleyle kod değiştirmek çoğu zaman yeni sorun üretir. Özellikle authentication, tenant izolasyonu, migration, OpenAPI/generated client ve package değişiklikleri dikkat gerektirir.

Sorun çözme ilkeleri:

- Önce log okunur.
- Sonra typecheck/build ile hata sınırı belirlenir.
- İlgili dosyalar okunmadan kod değiştirilmez.
- En küçük güvenli çözüm uygulanır.
- Çözümden sonra aynı hata tekrar test edilir.
- Git diff kontrol edilmeden iş tamamlanmış sayılmaz.

### Troubleshooting Felsefesi

Bu rehberin amacı, EnYS'te sorun yaşandığında paniğe kapılmadan aynı teşhis disiplinini uygulamaktır. Hızlı çözüm aramak doğaldır, ancak yanlış kök neden üzerine yapılan hızlı değişiklikler özellikle tenant izolasyonu, auth, migration ve generated client alanlarında daha büyük sorunlar doğurabilir.

Temel yaklaşım:

- Panik yapma.
- Önce problemi doğrula.
- Sonra kök nedeni bul.
- Sonra en küçük güvenli çözümü uygula.
- Son olarak doğrulama yap.

Önemli ilke:

> Belirti ile kök neden aynı şey değildir.

Örneğin frontend'de boş liste görünmesi bir belirti olabilir; kök neden React Query key'i, API `403`, eksik `companyId` filtresi, yanlış `unitId` bağlamı veya DB sorgusu olabilir. Çözüm, belirtiyi gizlemek değil kök nedeni düzeltmek olmalıdır.

## 2. Genel Sorun Giderme Yaklaşımı

Standart sorun giderme sırası:

```text
Problemi Oku
  ->
Logları İncele
  ->
Typecheck
  ->
Build
  ->
Git Diff
  ->
İlgili Dosyaları Oku
  ->
Çözümü Uygula
  ->
Tekrar Test Et
```

Uygulanacak pratik adımlar:

1. Hata mesajını tam oku.
2. Hatanın backend, frontend, DB, OpenAPI veya Git kaynaklı olup olmadığını ayır.
3. `pnpm run typecheck` çalıştır.
4. Gerekirse `pnpm run build` çalıştır.
5. `git status --short` ve `git diff` ile mevcut değişiklikleri kontrol et.
6. İlgili route, page, context, schema veya generated client dosyasını oku.
7. Küçük ve hedefli çözüm uygula.
8. Aynı komutu veya ekran akışını tekrar test et.

### Standart Sorun Giderme Akışı

```text
Belirti
  ->
Log
  ->
Tekrar Üret
  ->
Kök Neden
  ->
Çözüm
  ->
Typecheck
  ->
Build
  ->
Manuel Test
```

Adımların amacı:

| Adım | Amaç |
| --- | --- |
| Belirti | Kullanıcının gördüğü hatayı veya komut çıktısını netleştirmek. |
| Log | Backend terminali, browser console, network tab veya build çıktısındaki gerçek hatayı okumak. |
| Tekrar Üret | Sorunun rastgele mi yoksa belirli adımlarla tekrar edilebilir mi olduğunu görmek. |
| Kök Neden | Hatanın frontend, API, DB, auth, tenant, build veya Git kaynaklı olduğunu ayırmak. |
| Çözüm | En küçük güvenli değişikliği uygulamak. |
| Typecheck | Tip, import ve project reference hatalarının düzelip düzelmediğini doğrulamak. |
| Build | Runtime'a gidecek paketlerin üretilebilir kaldığını doğrulamak. |
| Manuel Test | Kullanıcının gerçek akışında hatanın çözüldüğünü görmek. |

Bu akış her zaman aynı ağırlıkta uygulanmayabilir. Sadece doküman değişikliğinde build gerekmeyebilir; API, frontend veya DB davranışı değiştiyse doğrulama adımları atlanmamalıdır.

### Karar Ağacı

Aşağıdaki karar ağacı, rastgele çözüm denemek yerine doğru teşhis yönünü bulmak için kullanılmalıdır. Amaç tek bir kesin çözüm vermek değil, geliştiricinin düşünme sırasını düzenlemektir.

```text
Uygulama çalışmıyor
  ->
Typecheck geçti mi?

Hayır
  -> Önce TypeScript hatasını çöz.

Evet
  ->
Build geçti mi?

Hayır
  -> Build çıktısını incele.
  -> Hata API build mi, frontend build mi, native package mı ayır.

Evet
  ->
Sorun backend mi?

Evet
  -> Route var mı?
  -> Auth token gidiyor mu?
  -> Role guard doğru mu?
  -> Tenant filtresi korunuyor mu?
  -> Validation geçiyor mu?
  -> DB sorgusu doğru mu?
  -> Response frontend'in beklediği yapıda mı?

Hayır
  ->
Sorun frontend mi?

Evet
  -> Console hatası var mı?
  -> Network response ne dönüyor?
  -> React Query key doğru mu?
  -> Context değerleri doğru mu?
  -> Component loading/error/empty state doğru mu?

Hayır
  ->
Sorun native package veya workspace mi?

Evet
  -> pnpm install çıktısını oku.
  -> optional dependency durumunu kontrol et.
  -> lockfile beklenmeden değişti mi bak.
  -> pnpm workspace filter ve package adlarını doğrula.
```

Karar ağacı, kök nedeni bulmayı hızlandırmak için kullanılır. Bir adımda belirsizlik varsa, çözüm uygulamadan önce ilgili log, dosya veya komut çıktısı tekrar incelenmelidir.

### Yaygın Hatalı Yaklaşımlar

Sorun görüldüğü anda aşağıdaki işlemler refleks olarak yapılmamalıdır. EnYS'te rastgele çözüm denemek, kök nedeni bulmaktan daha uzun sürer.

> Rastgele çözüm denemek, kök nedeni bulmaktan daha uzun sürer.

| Hatalı Yaklaşım | Neden Sakıncalı? |
| --- | --- |
| Package eklemek | Basit bir import, build veya kullanım hatasını dependency ile gizleyebilir; package/lockfile değişikliği release riskidir. |
| Migration çalıştırmak | DB state'i ve tenant verisini etkileyebilir; migration yalnızca açık ihtiyaç ve planla yapılmalıdır. |
| Gereksiz refactor yapmak | Kök nedeni gizler, diff'i büyütür ve review/rollback sürecini zorlaştırır. |
| `node_modules` silmek | Sorunun kaynağını kanıtlamadan ortamı değiştirir; native dependency veya lockfile analizini bulanıklaştırır. |
| Lockfile silmek | Tüm dependency çözümlemesini değiştirir ve ilgisiz package değişiklikleri üretebilir. |
| Cache temizlemek | Geçici rahatlama sağlayabilir ama kök nedeni kanıtlamaz; önce hata tekrar üretilebilir olmalıdır. |
| Generated dosyaları elle değiştirmek | Kaynak OpenAPI veya schema ile generated çıktı ayrışır; sonraki codegen değişikliği ezer. |
| Auth koduna dokunmak | Login, logout, token ve role davranışını zincirleme bozabilir; auth son çare olarak ele alınmalıdır. |
| Tenant filtresini kaldırmak | Company/unit izolasyonunu kırar ve güvenlik riski oluşturur. |
| Sorunu doğrulamadan çözüm uygulamak | Belirtiyi bastırabilir ama gerçek hata backend, frontend, DB veya ortam tarafında kalır. |

Önce problem doğrulanmalı, sonra log ve ilgili dosyalar okunmalı, ardından en küçük güvenli çözüm uygulanmalıdır.

## 3. Kurulum Sorunları

### Node Sürümü

**Belirti**

- `pnpm install`, `vite`, `tsx`, `tsc` veya build komutları beklenmedik hata verir.
- Modern ESM, Vite veya TypeScript özellikleri çalışmaz.

**Muhtemel Sebep**

- Eski Node sürümü kullanılıyor olabilir.
- Terminal PATH farklı Node kurulumunu görüyor olabilir.

**Çözüm**

```bash
node -v
pnpm -v
```

Node LTS veya proje ile uyumlu güncel Node sürümü kullanılmalıdır. VS Code terminali, PowerShell ve Git Bash aynı Node/Pnpm kurulumunu görmelidir.

### pnpm

**Belirti**

- `npm install` veya `yarn` kullanıldığında kurulum reddedilir.
- `Use pnpm instead` mesajı görülür.

**Muhtemel Sebep**

Root `package.json` içindeki `preinstall` scripti yalnızca pnpm kullanımına izin verir.

**Çözüm**

```bash
pnpm install
```

`package-lock.json` veya `yarn.lock` oluşturulmamalıdır.

### Git

**Belirti**

- `git status`, `git pull`, `git push` çalışmaz.
- Commit sırasında user bilgisi hatası alınır.

**Muhtemel Sebep**

- Git kurulu değildir.
- Git PATH içinde değildir.
- `user.name` veya `user.email` ayarlı değildir.

**Çözüm**

```bash
git --version
git config --global user.name
git config --global user.email
```

Eksikse ayarlayın:

```bash
git config --global user.name "Ad Soyad"
git config --global user.email "email@example.com"
```

### Git Bash

**Belirti**

- PowerShell'de çalışan bazı shell ifadeleri Git Bash'te farklı davranır veya tersi olur.
- API `dev` scriptindeki `export NODE_ENV=development` Windows PowerShell'de doğrudan uyumsuz görünebilir.

**Muhtemel Sebep**

- Script'ler farklı shell söz dizimlerine sahiptir.
- Windows ortamında PowerShell ve Git Bash davranışı farklıdır.

**Çözüm**

Windows için proje kökündeki scriptler tercih edilir:

```powershell
.\start-api.ps1
.\start-web.ps1
```

veya:

```bat
.\start-enys.bat
```

### PowerShell

**Belirti**

- `start-api.ps1` çalışmaz.
- Script execution policy hatası alınır.

**Muhtemel Sebep**

- PowerShell script çalıştırma politikası kısıtlıdır.

**Çözüm**

`start-enys.bat`, PowerShell'i `-ExecutionPolicy Bypass` ile açar. Manuel çalıştırırken gerekirse:

```powershell
powershell -ExecutionPolicy Bypass -File .\start-api.ps1
```

### PATH

**Belirti**

- `node`, `pnpm`, `git` veya `code` komutları tanınmaz.
- VS Code terminalinde çalışan komut normal PowerShell'de çalışmaz.

**Muhtemel Sebep**

- PATH güncel değildir.
- Farklı terminal farklı environment görüyor olabilir.

**Çözüm**

Terminali kapatıp açın. Şunları doğrulayın:

```bash
where node
where pnpm
where git
```

### esbuild approve-builds

**Belirti**

- `esbuild` native binary çalışmaz.
- `pnpm install` sonrası build aşamasında esbuild hatası alınır.

**Muhtemel Sebep**

- pnpm build script onayı verilmemiş olabilir.
- Native package build'i engellenmiş olabilir.

**Çözüm**

`pnpm-workspace.yaml` içinde `allowBuilds` altında `esbuild: true` tanımlıdır. Gerekirse:

```bash
pnpm approve-builds
```

komutu ile izin verilen build paketleri kontrol edilir. Güvenlik ayarları rastgele gevşetilmemelidir.

### pnpm approve-builds

**Belirti**

- Native dependency kurulu görünür ama çalışma zamanı binary bulunamaz.
- Install sırasında build script uyarıları görülür.

**Muhtemel Sebep**

- pnpm build izinleri veya `onlyBuiltDependencies` ayarları nedeniyle native paket scriptleri çalışmamıştır.

**Çözüm**

`pnpm-workspace.yaml` içindeki `onlyBuiltDependencies` ve `allowBuilds` ayarlarını kontrol edin. Gerekirse:

```bash
pnpm approve-builds
pnpm install
```

Package ayarlarını değiştirmeden önce risk değerlendirmesi yapılmalıdır.

### pnpm Problemleri İçin Genel Yaklaşım

pnpm sorunlarında önce workspace yapısı ve lockfile durumu anlaşılmalıdır. EnYS pnpm workspace kullandığı için tek pakette görünen hata çoğu zaman root `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` veya native optional dependency davranışıyla ilişkilidir.

Kontrol sırası:

1. `pnpm -v` ile kullanılan pnpm sürümünü kontrol et.
2. `pnpm install` çıktısını tam oku.
3. `pnpm-lock.yaml` beklenmeden değişti mi kontrol et.
4. `pnpm-workspace.yaml` içinde package, override, `onlyBuiltDependencies` ve `allowBuilds` ayarlarını incele.
5. Hata workspace filtresiyle tek pakette tekrar üretilebiliyor mu kontrol et.
6. Native package hatalarında önce optional dependency ve approve-builds ihtimalini değerlendir.

Yaygın pnpm başlıkları:

- install sorunları: Node/pnpm sürümü, registry erişimi, lockfile veya native package kaynaklı olabilir.
- lockfile: Bilinçsiz lockfile değişikliği commit edilmemelidir.
- workspace: Paket adı, filter kullanımı veya workspace package listesi yanlış olabilir.
- dependency uyuşmazlığı: Önce mevcut dependency ağacı incelenmeli, yeni package eklemek son seçenek olmalıdır.
- optional dependency: Windows native paketleri bazen açık dependency olarak izlenmek zorunda kalabilir.
- native package: Rollup, Tailwind Oxide, lightningcss ve esbuild gibi paketler platform binary gerektirir.

Basit sorunlarda package değiştirmeden önce `pnpm install`, typecheck ve hedef paketin build komutu denenmelidir. Package ekleme veya lockfile düzeltme kararı açık kullanıcı onayı gerektirir.

## 4. Build Sorunları

Build problemlerinde hata kaynağı önce ayrıştırılmalıdır. `typecheck` geçiyor ama `build` geçmiyorsa sorun çoğunlukla Vite/Rollup/native binding, runtime import, generated dosya veya paket build scripti kaynaklıdır.

Genel build kontrol sırası:

1. `pnpm run typecheck` sonucunu kontrol et.
2. Root build yerine paket bazlı build ile kaynağı ayır:

```bash
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/ems-dashboard run build
```

3. Hata frontend ise Vite, generated client, import path ve native dependency kontrol edilir.
4. Hata API ise esbuild, route importları, DB schema importları ve dist migration kopyalama akışı kontrol edilir.
5. OpenAPI veya generated dosya etkisi varsa codegen zinciri tekrar değerlendirilir.
6. Build warning varsa release öncesi etkisi not edilir.

### Rollup Native Binding

**Belirti**

- Vite build sırasında Rollup native package hatası alınır.
- `@rollup/rollup-win32-x64-msvc` bulunamadı benzeri hata görülür.

**Sebep**

- Windows native Rollup binding kurulmamış veya pnpm optional dependency davranışı nedeniyle eksik kalmıştır.
- Bu repo yakın dönem geliştirmede Windows için `@rollup/rollup-win32-x64-msvc` dependency'sini root devDependencies altında açıkça taşır.

**Çözüm**

```bash
pnpm install
pnpm run build
```

Sorun sürerse `node_modules` ve lockfile durumunu kontrol edin. Package değişikliği yapmadan önce mevcut `pnpm-workspace.yaml` overrides ayarlarını okuyun.

### lightningcss Native Binding

**Belirti**

- Tailwind/Vite build sırasında `lightningcss` native binding hatası alınır.
- Windows binary bulunamadı hatası görülebilir.

**Sebep**

- `lightningcss-win32-x64-msvc` eksik veya yüklenmemiştir.
- Native binary, pnpm install sırasında doğru kurulmamış olabilir.

**Çözüm**

Bu repo Windows için `lightningcss-win32-x64-msvc` dependency'sini açıkça taşır.

```bash
pnpm install
pnpm --filter @workspace/ems-dashboard run build
```

### Tailwind Oxide Native Binding

**Belirti**

- Tailwind CSS build sırasında `@tailwindcss/oxide` binary hatası alınır.
- `oxide-win32-x64-msvc` bulunamadı benzeri hata görülebilir.

**Sebep**

- Tailwind native oxide binding kurulmamış olabilir.
- pnpm optional dependency veya approve-builds davranışı devreye girmiş olabilir.

**Çözüm**

Bu repo Windows için `@tailwindcss/oxide-win32-x64-msvc` dependency'sini root devDependencies altında taşır.

```bash
pnpm install
pnpm run build
```

### esbuild

**Belirti**

- API build sırasında `esbuild` binary hatası.
- `pnpm --filter @workspace/api-server run build` başarısız olur.

**Sebep**

- esbuild native binary eksik olabilir.
- pnpm build izni veya override uyumsuzluğu olabilir.

**Çözüm**

```bash
pnpm install
pnpm approve-builds
pnpm --filter @workspace/api-server run build
```

`pnpm-workspace.yaml` içinde esbuild override ve `allowBuilds` ayarları bulunduğu için bunlar rastgele değiştirilmemelidir.

### Build Script

**Belirti**

- Root build başarısız olur.
- API veya frontend tek başına build olurken root build hata verir.

**Sebep**

Root build önce typecheck çalıştırır, sonra workspace paketlerini build eder:

```bash
pnpm run typecheck
pnpm -r --filter "!@workspace/mockup-sandbox" --if-present run build
```

Hata typecheck veya alt paket build aşamasından geliyor olabilir.

**Çözüm**

Önce hata kaynağını ayırın:

```bash
pnpm run typecheck
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/ems-dashboard run build
```

### Build Warning

**Belirti**

- Build tamamlanır ama warning verir.

**Sebep**

- Vite, Rollup, chunk size, dynamic import veya dependency warning'i olabilir.

**Çözüm**

Warning'i görmezden gelmeden önce etkisini değerlendirin. Release öncesi warning kaynağı not edilmelidir.

### Chunk Warning

**Belirti**

- Frontend build sırasında büyük chunk uyarısı alınır.

**Sebep**

- Dashboard, grafik, Excel import veya büyük UI dependency'leri bundle boyutunu artırabilir.

**Çözüm**

Önce işlevsel hata olup olmadığını kontrol edin. Gerekirse lazy loading veya bölme planlanır; ancak küçük bug fix içine büyük bundle refactor eklenmez.

## 5. Backend Sorunları

Backend sorunlarında kontrol sırası, isteğin API içinde hangi aşamada kırıldığını bulmaya odaklanmalıdır.

API kontrol sırası:

1. Endpoint gerçekten var mı?
2. Route merkezi router'a ekli mi?
3. API server güncel kodla yeniden başladı mı?
4. Auth token gönderiliyor mu?
5. Role guard doğru mu?
6. Tenant filtresi doğru uygulanıyor mu?
7. Request params/body validation geçiyor mu?
8. DB sorgusu doğru tablo ve ilişkiyi kullanıyor mu?
9. Response formatı frontend'in beklediği yapıyla uyumlu mu?
10. API terminal logunda gerçek hata ne?

Bu sıra özellikle `404`, `401`, `403` ve `500` hatalarını birbirinden ayırmak için kullanılmalıdır.

### DATABASE_URL

**Belirti**

- API başlamaz.
- `DATABASE_URL must be set` hatası alınır.

**Muhtemel Sebep**

- `DATABASE_URL` ortam değişkeni set edilmemiştir.
- PowerShell penceresi doğru environment ile açılmamıştır.

**Çözüm**

`start-api.ps1` API için `DATABASE_URL` set eder. Manuel çalıştırırken:

```powershell
$env:DATABASE_URL="postgresql://..."
$env:PORT="8080"
pnpm.cmd --filter @workspace/api-server run start
```

Secret veya canlı connection string commit edilmemelidir.

### PORT

**Belirti**

- API başlarken `PORT environment variable is required` hatası verir.

**Muhtemel Sebep**

- API `src/index.ts`, `PORT` olmadan çalışmayı reddeder.

**Çözüm**

```powershell
$env:PORT="8080"
```

Frontend Vite proxy `/api` isteklerini `http://localhost:8080` adresine yönlendirir.

### Migration

**Belirti**

- API başlarken migration hatası verir.
- Build sonrası `dist/drizzle` bulunamadı veya migration uygulanamadı hatası alınır.

**Muhtemel Sebep**

- API build, `lib/db/drizzle` klasörünü `artifacts/api-server/dist/drizzle` altına kopyalamalıdır.
- Migration dosyaları eksik veya DB state ile uyumsuz olabilir.

**Çözüm**

```bash
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/api-server run start
```

Replit import veya normal geliştirme sırasında DB push/migration komutları çalıştırılmamalıdır.

### Drizzle

**Belirti**

- Drizzle sorgusunda type veya runtime hata.
- Insert/update sırasında kolon hatası.

**Muhtemel Sebep**

- `lib/db/src/schema/energy.ts` ile route kodu uyumsuz olabilir.
- Schema değişti ama typecheck veya build yenilenmedi.

**Çözüm**

```bash
pnpm run typecheck
```

Schema değişikliği gerekiyorsa migration etkisi ayrıca değerlendirilmelidir.

### API Başlamıyor

**Belirti**

- API process hemen kapanır.
- Browser `/api` isteklerinde connection refused alır.

**Muhtemel Sebep**

- `PORT` eksik.
- `DATABASE_URL` eksik.
- Migration hatası.
- Build çıktısı güncel değil.

**Çözüm**

```powershell
.\start-api.ps1
```

veya manuel:

```bash
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/api-server run start
```

### 404

**Belirti**

- Yeni endpoint `/api/...` 404 döner.

**Muhtemel Sebep**

- Route `src/routes/index.ts` içine eklenmemiştir.
- API server yeniden başlatılmamıştır.
- Frontend yanlış URL çağırıyordur.

**Çözüm**

- Route dosyasını ve `routes/index.ts` kaydını kontrol edin.
- API server'ı yeniden başlatın.
- Vite proxy path'inin `/api` ile başladığını doğrulayın.

### 401

**Belirti**

- API `401` döner.
- Frontend kullanıcıyı login ekranına atar.

**Muhtemel Sebep**

- Token yoktur veya geçersizdir.
- API restart sonrası memory session temizlenmiştir.
- `Authorization: Bearer <token>` header'ı gönderilmiyordur.

**Çözüm**

- Logout/login yapın.
- `AuthContext` içinde `setAuthTokenGetter` bağlantısını kontrol edin.
- Manuel fetch kullanan sayfalarda Authorization header var mı bakın.

### 403

**Belirti**

- Kullanıcı login olmasına rağmen işlem yapamaz.

**Muhtemel Sebep**

- Role yetkisi yetersizdir.
- Admin kendi company kapsamı dışında kayıt düzenlemeye çalışıyordur.
- User kendi unit kapsamı dışında veriye erişiyordur.

**Çözüm**

- Kullanıcının `role`, `companyId`, `unitId` değerlerini kontrol edin.
- Backend route içindeki `requireAdmin`, `requireSuperAdmin` ve tenant filtrelerini okuyun.

### 500

**Belirti**

- API `{ error: "Sunucu hatası" }` döner.

**Muhtemel Sebep**

- DB sorgu hatası.
- Parse hatası.
- Beklenmeyen null/undefined.
- Foreign key veya tenant ilişki hatası.

**Çözüm**

- API terminal logunu okuyun.
- Route dosyasında ilgili handler'ı bulun.
- Request payload ve query parametrelerini kontrol edin.
- Typecheck çalıştırın.

### Route Görünmüyor

**Belirti**

- Kodda route var ama çalışmıyor.

**Muhtemel Sebep**

- Route merkezi router'a eklenmedi.
- API build/start eski çıktıdan çalışıyor.

**Çözüm**

```bash
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/api-server run start
```

### Middleware

**Belirti**

- Auth beklenmeyen şekilde çalışır.
- Body boş gelir.

**Muhtemel Sebep**

- `app.ts` middleware sırası değişmiş olabilir.
- `express.json()` veya `authMiddleware` davranışı etkilenmiştir.

**Çözüm**

`artifacts/api-server/src/app.ts` içindeki sırayı kontrol edin. Global auth middleware korunmalıdır.

### Auth

**Belirti**

- Login başarılı ama sonraki istekler yetkisiz.

**Muhtemel Sebep**

- Token localStorage'a yazılmıyor.
- `setAuthTokenGetter` çalışmıyor.
- Doğrudan fetch kullanan sayfa token header eklemiyor.

**Çözüm**

`AuthContext.tsx` ve ilgili sayfanın API çağrılarını kontrol edin.

## 6. Frontend Sorunları

Frontend sorunlarında önce kullanıcının gördüğü belirti, sonra browser console ve network çıktısı kontrol edilmelidir. Ekrandaki boşluk her zaman frontend hatası değildir; API, auth, tenant veya React Query cache davranışı da aynı belirtiyi üretebilir.

Frontend kontrol sırası:

1. Sayfa gerçekten render oluyor mu?
2. Browser console'da hata var mı?
3. Network tab'de ilgili `/api` isteği gidiyor mu?
4. Response `200`, `401`, `403`, `404` veya `500` mi?
5. React Query query key doğru parametreleri içeriyor mu?
6. Query `enabled` koşulu yanlışlıkla kapalı mı?
7. `CompanyContext`, `UnitContext`, `YearContext` değerleri beklenen durumda mı?
8. Generated hook veya manuel fetch doğru endpoint'i çağırıyor mu?
9. Loading, error ve empty state ayrımı doğru mu?
10. Mutation sonrası doğru query invalidate ediliyor mu?

Bu kontrol tamamlanmadan UI'ı sadece görsel olarak düzeltmek, kök nedeni gizleyebilir.

### Vite

**Belirti**

- Frontend başlamaz veya port hatası verir.

**Sebep**

- Vite varsayılan `5000` portunu kullanır ve `strictPort: true` ayarlıdır.
- Port doluysa dev server başlamaz.

**Çözüm**

Portu boşaltın veya environment ile farklı port verin. Normal Windows akışı:

```powershell
.\start-web.ps1
```

### Proxy

**Belirti**

- Frontend açılır ama API istekleri başarısız olur.
- `/api` istekleri connection refused döner.

**Sebep**

- API `localhost:8080` üzerinde çalışmıyordur.
- Vite proxy `/api` isteklerini `http://localhost:8080` adresine yönlendirir.

**Çözüm**

Önce API'yi başlatın:

```powershell
.\start-api.ps1
```

Sonra frontend:

```powershell
.\start-web.ps1
```

### React Query

**Belirti**

- Veri güncellenir ama liste değişmez.
- Filtre değişir ama eski veri görünür.

**Sebep**

- Query key filtreleri içermiyordur.
- Mutation sonrası invalidate eksiktir.

**Çözüm**

İlgili sayfadaki `useQuery`, generated hook ve `queryClient.invalidateQueries` kullanımlarını kontrol edin. `companyId`, `unitId`, `year`, `meterId` gibi parametreler query key içinde olmalıdır.

### Context

**Belirti**

- Admin "Tüm Birimler" görmesi gerekirken tek birim görür.
- User birim değiştirebilir gibi görünür.
- Superadmin company filtresi çalışmaz.

**Sebep**

- `CompanyContext`, `UnitContext` veya `YearContext` yanlış kullanılmıştır.
- `unitId === null` anlamı bozulmuştur.

**Çözüm**

Context kaynaklarını kontrol edin:

- `AuthContext.tsx`
- `CompanyContext.tsx`
- `UnitContext.tsx`
- `YearContext.tsx`

### Loading

**Belirti**

- Sayfa boş görünür veya sonsuz loading kalır.

**Sebep**

- Query `enabled` koşulu yanlış olabilir.
- Gerekli token, unit veya year parametresi hazır değildir.

**Çözüm**

Query parametrelerini ve loading/error/empty state ayrımını kontrol edin.

### Toast

**Belirti**

- TypeScript `noImplicitReturns` veya TS7030 benzeri hata verir.

**Sebep**

- `return toast()` anti-pattern'i kullanılmış olabilir.

**Çözüm**

Şu kalıp kullanılmalıdır:

```ts
toast();
return;
```

### Generated Client

**Belirti**

- Generated hook bulunamaz.
- Hook parametre tipi backend ile uyumsuzdur.

**Sebep**

- OpenAPI güncellenmemiş veya codegen çalıştırılmamıştır.
- Generated dosya elle değiştirilmiş olabilir.

**Çözüm**

```bash
pnpm --filter @workspace/api-spec run codegen
pnpm run typecheck
```

Generated dosyalar elle düzeltilmez.

### OpenAPI

**Belirti**

- Frontend hook farklı response bekler.
- API runtime response ile TypeScript tipi uyuşmaz.

**Sebep**

- `lib/api-spec/openapi.yaml` gerçek backend davranışını yansıtmıyordur.

**Çözüm**

OpenAPI sözleşmesini ve route response'unu birlikte düzeltin. Sonra codegen çalıştırın.

## 7. Database Sorunları

Database sorunlarında migration çalıştırmadan önce problem mutlaka ayrıştırılmalıdır. EnYS multi-tenant veri modeliyle çalıştığı için yanlış schema veya migration müdahalesi company/unit izolasyonunu ve gerçek veriyi etkileyebilir.

Database kontrol sırası:

1. Hata schema, relation, migration veya data kaynaklı mı?
2. İlgili tablo `lib/db/src/schema/energy.ts` içinde nasıl tanımlı?
3. `companyId`, `unitId` ve parent-child ilişkileri doğru mu?
4. Backend route tenant filtrelerini DB sorgusuna ekliyor mu?
5. Foreign key hatası parent kaydın eksik olmasından mı kaynaklanıyor?
6. Schema değişikliği gerçekten gerekli mi?
7. Migration oluşturmadan çözülebilecek kod/validation hatası var mı?
8. Migration gerekiyorsa kullanıcı açıkça istedi mi?

Migration çalıştırmadan önce düşünülmesi gerekenler:

- Bu değişiklik mevcut veriyi etkiliyor mu?
- Company veya unit kapsamı bozulabilir mi?
- OpenAPI, generated client veya frontend form etkileniyor mu?
- Geri dönüş planı var mı?
- Değişiklik sadece local/dev ortamda mı test edilecek?

Migration, package veya DB push komutları teşhis aracı olarak kullanılmamalıdır; kontrollü karar sonrası uygulanmalıdır.

### Neon Bağlantısı

**Belirti**

- API DB'ye bağlanamaz.
- SSL veya connection timeout hatası.

**Sebep**

- `DATABASE_URL` yanlış, süresi geçmiş veya SSL parametresi uyumsuz olabilir.
- Ağ bağlantısı veya Neon erişimi sorunlu olabilir.

**Çözüm**

Connection string'i kontrol edin. Secret bilgileri commit etmeyin. `start-api.ps1` yalnızca local kullanım içindir; canlı secret yönetimi ayrı yapılmalıdır.

### Drizzle

**Belirti**

- Kolon yok, tablo yok veya type uyuşmazlığı.

**Sebep**

- Schema ve migration uyumsuz olabilir.
- DB state beklenen migration seviyesinde değildir.

**Çözüm**

Önce logu okuyun. Replit/import sırasında DB push çalıştırmayın. Schema değişikliği gerekiyorsa kontrollü migration planı oluşturun.

### Migration

**Belirti**

- API startup migration aşamasında durur.

**Sebep**

- Migration dosyası eksik, DB'de tablo zaten var veya migration history uyumsuz olabilir.

**Çözüm**

DB state'i manuel değiştirmeden önce durumu analiz edin. Özellikle şu komutları açık onay olmadan çalıştırmayın:

```bash
pnpm --filter @workspace/db run push
pnpm --filter @workspace/db run push-force
```

### Schema

**Belirti**

- Typecheck route dosyasında tablo alanı hatası verir.

**Sebep**

- `lib/db/src/schema/energy.ts` değişmiş ama kullanan kod güncellenmemiştir.

**Çözüm**

Schema, route, OpenAPI ve frontend etkisini birlikte kontrol edin.

### Foreign Key

**Belirti**

- Insert/update sırasında foreign key hatası.

**Sebep**

- Parent kayıt yoktur.
- `companyId`, `unitId`, `subUnitId`, `energySourceId`, `meterId` ilişkisi yanlış kurulmuştur.

**Çözüm**

Parent kaydı önce doğrulayın. Backend route içinde cross-company ve unit uyumluluğu kontrol edilmelidir.

### companyId

**Belirti**

- Admin başka firmanın verisini görür veya düzenleyebilir.

**Sebep**

- `companyId` filtresi eksiktir.

**Çözüm**

Route içinde `req.user!.companyId` ile filtre ekleyin. Superadmin davranışını ayrıca değerlendirin.

### unitId

**Belirti**

- Normal user kendi birimi dışındaki veriyi görür.

**Sebep**

- `unitId` filtresi eksiktir veya frontend filtresine güvenilmiştir.

**Çözüm**

Backend route içinde `sessionUnitId` kontrolü yapılmalıdır. UI filtresi güvenlik yerine geçmez.

### MGM Import

**Belirti**

- HDD/CDD verileri gelmez.
- MGM lookup fallback sonuç vermez.

**Sebep**

- MGM station mapping eksik olabilir.
- Resmi degree day verisi ilgili dönem için yoktur.
- Bootstrap/scheduler hata almış olabilir.

**Çözüm**

API loglarında MGM bootstrap ve sync mesajlarını kontrol edin. İlgili servisler:

- `mgm-bootstrap.ts`
- `mgm-sync.ts`
- `mgm-stations-data.ts`
- `mgm-official-sync.ts`

### Excel Import

**Belirti**

- Excel import sırasında format hatası.
- Veri eksik veya yanlış gelir.

**Sebep**

- Beklenen kolonlar yoktur.
- Tarih/sayı formatı farklıdır.
- Tenant ilişkileri import verisinde eksiktir.

**Çözüm**

Import script veya component'in beklediği kolonları kontrol edin. Import öncesi örnek dosya formatı doğrulanmalıdır.

## 8. Git Sorunları

Git sorunlarında önce çalışma ağacının mevcut durumu anlaşılmalıdır. Yanlış komut, kullanıcının veya Codex'in yaptığı yerel değişiklikleri silebilir.

Git kontrol sırası:

1. `git status --short` çalıştır.
2. `git diff` ile unstaged değişiklikleri incele.
3. Staged değişiklik varsa `git diff --staged` kontrol et.
4. Sorun identity, stage, commit, pull, push veya merge conflict kaynaklı mı ayır.
5. Geri alma gerekiyorsa `restore`, `revert`, `reset` farkını netleştir.

Tercih sırası:

- Yanlış dosya stage edildiyse önce stage'den çıkarma veya yeniden stage etme düşünülür.
- Commit edilmemiş yanlış dosya değişikliği için `git restore <dosya>` kullanılabilir; ancak yerel değişiklik siler.
- Push edilmiş hatalı commit için çoğu durumda `git revert <commit>` tercih edilir.
- `git reset` geçmişi değiştirdiği için dikkatli kullanılmalı, `git reset --hard` açık onay olmadan çalıştırılmamalıdır.
- Merge conflict varsa conflict marker'lar anlamadan silinmemelidir.

### user.name

**Belirti**

- Commit sırasında identity hatası.

**Sebep**

- Git kullanıcı adı ayarlı değildir.

**Çözüm**

```bash
git config --global user.name "Ad Soyad"
```

### user.email

**Belirti**

- Commit sırasında email hatası.

**Sebep**

- Git email ayarlı değildir.

**Çözüm**

```bash
git config --global user.email "email@example.com"
```

### push

**Belirti**

- Push reddedilir.

**Sebep**

- Remote branch güncel değildir.
- Yetki veya credential sorunu vardır.

**Çözüm**

Önce:

```bash
git status --short
git pull
```

Conflict varsa çözmeden push yapılmaz.

### restore

**Belirti**

- Yanlış dosya değişmiş ve commit edilmemiştir.

**Sebep**

- Yerel çalışma sırasında istemeden dosya değiştirilmiştir.

**Çözüm**

```bash
git restore <dosya>
```

Risk: Dosyadaki yerel değişiklik silinir. Kullanıcı değişikliği varsa önce onay alınmalıdır.

### reset

**Belirti**

- Commit geçmişini geri almak isteniyor.

**Sebep**

- Yanlış commit atılmış olabilir.

**Çözüm**

`git reset` geçmişi değiştirir. Özellikle `git reset --hard` risklidir ve açık kullanıcı onayı olmadan kullanılmamalıdır.

### revert

**Belirti**

- Push edilmiş commit güvenli şekilde geri alınmak isteniyor.

**Sebep**

- GitHub'a giden değişiklik tersine çevrilmelidir.

**Çözüm**

```bash
git revert <commit>
```

Bu yöntem geçmişi silmez, ters commit oluşturur.

### merge conflict

**Belirti**

- Pull veya merge sırasında conflict oluşur.

**Sebep**

- Aynı dosyanın aynı bölümleri farklı branch'lerde değişmiştir.

**Çözüm**

Conflict dosyalarını okuyun. Kod veya docs içeriğini anlamadan otomatik çözüm yapmayın. Çözüm sonrası:

```bash
pnpm run typecheck
pnpm run build
```

## 9. Windows Geliştirme Ortamı

Bu proje Windows geliştirme ortamında çalışacak şekilde desteklenmektedir.

Önerilen ortam:

- Windows 10 veya güncel Windows.
- PowerShell.
- Git Bash.
- VS Code.
- Node LTS.
- pnpm.
- Git.
- Neon PostgreSQL bağlantısı.
- Portable proje klasörü yapısı.

Gerçek proje çalışma yolu örneği:

```text
C:\Users\CerenUmut\Desktop\EnYS-Portable\Projeler\ISO50001-EMS
```

Başlangıç scriptleri:

```powershell
.\start-api.ps1
.\start-web.ps1
```

Tek komutla:

```bat
.\start-enys.bat
```

Notlar:

- API `PORT=8080` ile çalışır.
- Frontend varsayılan `5000` portunu kullanır.
- Vite proxy `/api` isteklerini `localhost:8080` adresine gönderir.
- PowerShell ve Git Bash environment farkları sorun çıkarabilir.
- Native binding paketleri Windows için özellikle önemlidir.

### Windows Ortamı İçin Genel Rehber

EnYS geliştirme ortamında şimdiye kadar sorun çıkarabilen başlıklar:

- Node sürümü: Node LTS tercih edilmeli, farklı terminallerin aynı Node kurulumunu gördüğü doğrulanmalıdır.
- pnpm: Proje pnpm workspace kullandığı için npm/yarn ile install yapılmamalıdır.
- PATH: PowerShell, Git Bash ve VS Code terminali farklı PATH görebilir.
- VS Code: Terminal profili, çalışma klasörü ve script başlatma davranışı kontrol edilmelidir.
- PowerShell: Execution policy nedeniyle `.ps1` scriptleri doğrudan çalışmayabilir; proje scriptleri bu durumu dikkate alır.
- Portable kullanım: Proje yolu taşınabilir olabilir; terminal mutlaka repo kökünde açılmalıdır.
- Çalıştırma scriptleri: API için `start-api.ps1`, frontend için `start-web.ps1`, birlikte başlatma için `start-enys.bat` tercih edilmelidir.

Windows sorunlarında önce ortam doğrulanmalıdır:

```bash
node -v
pnpm -v
git --version
where node
where pnpm
where git
```

Ardından API ve frontend ayrı ayrı başlatılarak hata kaynağı ayrıştırılmalıdır.

## 10. Gerçek Yaşanmış Problemler

Bu bölüm, EnYS geliştirme sürecinde karşılaşılan gerçek problem sınıflarını vaka başlıkları olarak tutar. Detaylar zamanla genişletilebilir; her vaka belirtiden kök nedene ve öğrenilen derse kadar izlenebilir kalmalıdır.

### Windows Optional Dependency

**Belirti**

- Build sırasında platforma özel native package bulunamadı hatası alınır.

**Olası Neden**

- pnpm optional dependency kurulumu Windows ortamında eksik kalmış olabilir.

**Çözüm Yaklaşımı**

- `pnpm install` tekrar çalıştırılır.
- `pnpm-workspace.yaml` içindeki native dependency ve approve-builds ayarları kontrol edilir.
- Package değişikliği yapılmadan önce mevcut lockfile ve workspace ayarları incelenir.

**Öğrenilen Ders**

- Windows native dependency sorunları sadece kod hatası gibi ele alınmamalıdır; install, optional dependency ve workspace ayarı birlikte değerlendirilmelidir.

### Tailwind Native Binding

**Belirti**

- Tailwind build sırasında oxide binary veya native binding hatası alınır.

**Olası Neden**

- `@tailwindcss/oxide` Windows binary eksik veya doğru kurulmamış olabilir.

**Çözüm Yaklaşımı**

- `pnpm install` ve frontend build tekrar denenir.
- Native package'ın root dependency ve workspace ayarlarıyla uyumu kontrol edilir.

**Öğrenilen Ders**

- Stil veya UI değişikliği yapılmasa bile frontend build native CSS tooling nedeniyle kırılabilir.

### LightningCSS

**Belirti**

- Vite/Tailwind build sırasında `lightningcss` native binding hatası görülür.

**Olası Neden**

- `lightningcss-win32-x64-msvc` paketi eksik veya optional dependency olarak kurulmamış olabilir.

**Çözüm Yaklaşımı**

- Frontend build paket bazlı çalıştırılır.
- `pnpm install` sonrası build tekrar denenir.
- Lockfile değişikliği bilinçli değilse commit kapsamına alınmaz.

**Öğrenilen Ders**

- Build hatasının kaynağı her zaman uygulama kodu değildir; native build araçları da release engeli olabilir.

### Git Identity

**Belirti**

- Commit sırasında `user.name` veya `user.email` eksik hatası alınır.

**Olası Neden**

- Git global identity ayarlanmamıştır veya portable ortam farklı Git config görüyordur.

**Çözüm Yaklaşımı**

- `git config --global user.name` ve `git config --global user.email` kontrol edilir.
- Eksikse kullanıcı bilgisi açıkça ayarlanır.

**Öğrenilen Ders**

- Commit hazırlığı sadece diff kontrolü değildir; yerel Git kimliği de geliştirme ortamının parçasıdır.

### VS Code Başlangıç Scriptleri

**Belirti**

- VS Code terminalinde API veya frontend beklenen şekilde başlamaz.

**Olası Neden**

- Terminal repo kökünde değildir.
- PowerShell execution policy veya PATH farkı vardır.
- API ve frontend ayrı portlarda beklenirken biri başlamamıştır.

**Çözüm Yaklaşımı**

- VS Code terminal çalışma klasörü repo kökü olarak doğrulanır.
- `start-api.ps1`, `start-web.ps1` veya `start-enys.bat` kullanılır.
- Gerekirse API ve frontend ayrı terminallerde başlatılır.

**Öğrenilen Ders**

- Başlatma sorunlarında önce terminal ortamı ve çalışma klasörü doğrulanmalıdır.

### API 8080 / Frontend 5000

**Belirti**

- Frontend açılır ama API istekleri başarısız olur.
- Network tab'de `/api` istekleri connection refused döner.

**Olası Neden**

- API `8080` portunda çalışmıyordur.
- Frontend `5000` portunda açılmıştır ama Vite proxy hedefi boş kalmıştır.

**Çözüm Yaklaşımı**

- Önce API başlatılır: `.\start-api.ps1`.
- Sonra frontend başlatılır: `.\start-web.ps1`.
- Network tab'de `/api` isteklerinin `localhost:8080` hedefine gittiği doğrulanır.

**Öğrenilen Ders**

- Frontend sorunu gibi görünen hata, çoğu zaman API server'ın çalışmaması veya yanlış port olabilir.

### pnpm Workspace

**Belirti**

- Komut doğru göründüğü halde paket bulunamaz veya script çalışmaz.

**Olası Neden**

- Yanlış package filter kullanılmıştır.
- Workspace paket adı ile klasör adı karıştırılmıştır.
- `pnpm-workspace.yaml` kapsamı veya root script davranışı yanlış anlaşılmıştır.

**Çözüm Yaklaşımı**

- `package.json` ve ilgili paket `package.json` dosyalarındaki script adları kontrol edilir.
- Paket bazlı komutlarda gerçek workspace adı kullanılır.

**Öğrenilen Ders**

- Monorepo'da komut problemi çözülürken önce hangi pakette çalışıldığı netleştirilmelidir.

## 11. Performans Sorunları

### Yavaş Build

**Sebep**

- Typecheck tüm workspace paketlerini kontrol eder.
- Frontend Vite build büyük bundle üretebilir.
- Native dependency veya cache etkisi olabilir.

**Çözüm**

Önce paket bazlı build ile kaynak ayırın:

```bash
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/ems-dashboard run build
```

### Yavaş Query

**Sebep**

- Tenant filtresi DB yerine JS tarafında yapılıyor olabilir.
- Büyük liste çekiliyor olabilir.

**Çözüm**

Sorguya `companyId`, `unitId`, `meterId`, `year` gibi filtreleri mümkün olduğunca DB seviyesinde ekleyin.

### React Render

**Sebep**

- Context değişimleri geniş ağaçları yeniden render ediyor olabilir.
- Query key veya inline object sürekli değişiyor olabilir.

**Çözüm**

Önce gerçek render sorununu belirleyin. Gereksiz `useMemo` eklemeyin; yalnızca ölçülebilir ihtiyaç varsa memoization kullanın.

### Large Bundle

**Sebep**

- Recharts, Excel, Radix UI veya büyük sayfalar bundle boyutunu artırabilir.

**Çözüm**

Küçük fix içinde büyük bundle refactor yapmayın. Gerekirse ayrı performans işi açın.

### N+1

**Sebep**

- Liste item'ları için ayrı ayrı API veya DB sorgusu yapılıyor olabilir.

**Çözüm**

Join veya toplu sorgu kullanımı değerlendirilir. Tenant filtresi korunmalıdır.

### Memory

**Sebep**

- Büyük Excel import/export veya rapor üretimi belleği zorlayabilir.

**Çözüm**

Büyük dosya işlemlerinde veri boyutu ve işlem süresi ölçülmelidir. UI thread'i kilitleyen işlemler ayrı ele alınmalıdır.

## 12. Sık Kullanılan Komutlar

| Komut | Amaç |
| --- | --- |
| `pnpm install` | Bağımlılıkları kurar. |
| `pnpm run typecheck` | Tüm workspace için TypeScript kontrolü yapar. |
| `pnpm run build` | Typecheck sonrası build çalıştırır. |
| `pnpm --filter @workspace/api-server run build` | API paketini build eder. |
| `pnpm --filter @workspace/api-server run start` | API build çıktısını başlatır. |
| `pnpm --filter @workspace/api-server run dev` | API dev akışını başlatır. |
| `pnpm --filter @workspace/ems-dashboard run dev` | Frontend Vite dev server'ı başlatır. |
| `pnpm --filter @workspace/ems-dashboard run build` | Frontend build alır. |
| `pnpm --filter @workspace/api-spec run codegen` | OpenAPI'den generated client/Zod üretir. |
| `pnpm exec playwright test` | Playwright testlerini çalıştırır. |
| `git status --short` | Kısa Git durumunu gösterir. |
| `git diff` | Unstaged değişiklikleri gösterir. |
| `git diff --staged` | Staged değişiklikleri gösterir. |
| `git restore <dosya>` | Commit edilmemiş dosya değişikliğini geri alır. |
| `git add <dosya>` | Dosyayı commit için stage eder. |
| `git commit -m "mesaj"` | Commit oluşturur. |
| `git push` | Commitleri remote GitHub branch'e gönderir. |

## 13. Kontrol Listesi

### Sorun Çözmeden Önce

- [ ] Hata mesajı tam okundu.
- [ ] Backend/frontend/DB/Git ayrımı yapıldı.
- [ ] Loglar incelendi.
- [ ] `pnpm run typecheck` çalıştırıldı veya neden çalıştırılmadığı biliniyor.
- [ ] Gerekirse `pnpm run build` çalıştırıldı.
- [ ] `git status --short` kontrol edildi.
- [ ] `git diff` kontrol edildi.
- [ ] İlgili dosyalar okundu.
- [ ] Tenant ve auth etkisi değerlendirildi.

### Sorun Çözdükten Sonra

- [ ] Aynı hata tekrar test edildi.
- [ ] `pnpm run typecheck` tekrar çalıştırıldı.
- [ ] Gerekliyse `pnpm run build` tekrar çalıştırıldı.
- [ ] İlgili ekran veya API manuel test edildi.
- [ ] `git diff` incelendi.
- [ ] İlgisiz dosya değişmedi.
- [ ] Migration oluşmadı veya açıkça istendi.
- [ ] Package değişmedi veya açıkça istendi.
- [ ] Generated dosya elle değiştirilmedi.
- [ ] Çözüm ve doğrulama sonucu raporlandı.

### Günlük Sorun Giderme Kontrol Listesi

Kısa günlük kontrol:

- [ ] Sorun tekrar üretildi.
- [ ] Belirti ile kök neden ayrıldı.
- [ ] Backend/API logu incelendi.
- [ ] Browser console kontrol edildi.
- [ ] Network tab kontrol edildi.
- [ ] İlgili route/page/context/schema dosyası okundu.
- [ ] Tenant ve auth etkisi değerlendirildi.
- [ ] `pnpm run typecheck` çalıştı.
- [ ] Gerekliyse `pnpm run build` çalıştı.
- [ ] Manuel test yapıldı.
- [ ] Kök neden bulundu.
- [ ] Çözüm en küçük güvenli değişiklik olarak uygulandı.
- [ ] `git status --short` kontrol edildi.
- [ ] `git diff` kontrol edildi.
- [ ] İlgisiz dosya değişmedi.

## 14. AI ile Sorun Çözme

### ChatGPT

ChatGPT analiz ve karar destek aracıdır.

Kullanılacağı durumlar:

- Hata kaynağı belirsizse.
- ISO 50001 etkisi tartışılacaksa.
- Codex'e verilecek prompt hazırlanacaksa.
- Risk ve çözüm alternatifi isteniyorsa.

### Codex

Codex repo içinde uygulama ve doğrulama yapar.

Kullanılacağı durumlar:

- İlgili dosyalar okunacaksa.
- Küçük kod veya doküman düzeltmesi yapılacaksa.
- Typecheck/build/test çalıştırılacaksa.
- Git status/diff kontrol edilecekse.

Codex kullanıcı istemedikçe commit veya push yapmaz.

### Kullanıcı

Kullanıcı nihai karar vericidir.

Kullanıcı karar verir:

- Migration yapılacak mı?
- Package eklenecek mi?
- Auth davranışı değişecek mi?
- Commit veya push yapılacak mı?
- Release yapılacak mı?

Standart AI akışı:

```text
Önce analiz
  ->
Sonra çözüm
  ->
Sonra doğrulama
```

## 15. Son Hatırlatma

EnYS sorun giderme ilkeleri:

- Önce log.
- Önce typecheck.
- Önce build.
- Küçük değişiklik.
- GitHub source of truth.
- Generated dosyalara elle dokunma.
- Migration dikkatli kullanılmalı.
- Package değişikliği açık talep gerektirir.
- Authentication korunmalı.
- Tenant izolasyonu korunmalı.
- Frontend filtresi backend güvenliği yerine geçmez.

Sorun çözmenin amacı yalnızca hatayı susturmak değildir. Amaç, EnYS'in denetlenebilir, sürdürülebilir ve ISO 50001 uyumlu davranışını koruyarak sorunu çözmektir.
## MGM file import operasyon notu

MGM Excel file-path import endpointleri varsayilan kapali gelir. Kontrollu staging veya bakim operasyonunda kullanmadan once:

- Import edilecek dosya yalniz `MGM_FILE_IMPORT_ROOT` altina konur.
- `ENABLE_MGM_FILE_IMPORT=true` sadece import penceresinde acilir ve is bitince kapatilir.
- Dosya checksum'i ve beklenen row count operasyonel olarak kaydedilir.
- Production'da import oncesi backup/PITR durumu dogrulanir.
- Absolute path, `..`, root disi symlink, `.xlsx/.xls` disi extension ve `MGM_FILE_IMPORT_MAX_BYTES` ustu dosyalar reddedilir.
- Response ve audit metadata tam local path dondurmez; yalniz guvenli dosya adi ve ozet sayilar kullanilir.
- Startup sirasinda otomatik file-path import yoktur. `drizzle-kit push` veya `push-force` import runbook'unun parcasi degildir.

## Report archive storage operasyon notu

Faz 4A sonrasi yeni annual HTML ve PDF raporlari `report_archives` metadata'si ve storage provider uzerinden indirilir. Sorun giderirken once su ayrimi yapin:

- Rapor uretimi 500 donuyorsa render, snapshot veya storage write asamasina bakilir.
- Rapor listede yoksa `GET /api/reports/archive` tenant/company/unit filtreleri ve `report_archives.status` kontrol edilir.
- Indirme 404 donuyorsa kullanici scope'u veya archive id/company eslesmesi kontrol edilir.
- Indirme 409 donuyorsa archive `completed` degildir veya storage metadata eksiktir.
- Indirme 500 donuyorsa storage object eksik, size mismatch veya checksum mismatch olasiligi incelenir.

Guvenli kontroller:

```sql
SELECT id, company_id, unit_id, report_type, report_year, status, storage_provider, size_bytes, generated_at, completed_at, failed_at, failure_category
FROM report_archives
ORDER BY generated_at DESC
LIMIT 20;
```

Readiness icin:

```bash
pnpm run test:operational-readiness
```

Production veya staging tanisinda `REPORT_STORAGE_PROVIDER`, provider'a ait env'ler ve `/api/readyz` icindeki `checks.reportStorage` sonucu birlikte incelenmelidir. Log, response veya audit metadata icine storage key, bucket, local path, token veya connection string yazilmamalidir.

S3 uyumlu provider icin ek tanilar:

- `storage_config_invalid`: Bucket/region eksik, partial credential, gecersiz boolean/timeout veya gecersiz prefix olabilir.
- `storage_access_denied`: Credential yetkileri, bucket policy veya provider endpoint yetkisi incelenir; access key loglanmaz.
- `storage_bucket_not_found`: Bucket adi veya endpoint/region eslesmesi operasyon tarafindan kontrol edilir.
- `storage_object_not_found`: Archive DB kaydi tamamlanmis olsa da object silinmis veya yanlis prefix ile aranmis olabilir.
- `storage_integrity_mismatch`: Size veya SHA-256 metadata DB kaydi ile uyusmamistir; ETag checksum kabul edilmez.
- `storage_timeout` veya `storage_network_error`: Endpoint erisimi, request timeout ve platform network kurallari incelenir.

Opsiyonel S3 smoke varsayilan olarak remote write yapmaz:

```bash
pnpm run test:report-storage-s3-smoke
```

`skipped: not_configured` beklenen guvenli varsayilandir. Remote test yalniz onayli test bucket ile `REPORT_STORAGE_PROVIDER=s3`, `REPORT_STORAGE_S3_SMOKE_ENABLE=true` ve `REPORT_STORAGE_S3_SMOKE_ACK=test-bucket` set edildiginde calistirilir.

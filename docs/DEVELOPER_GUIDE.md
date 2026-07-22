# Developer Guide

Bu dokuman, ISO50001-EMS projesini ilk kez acan bir gelistiricinin kurulumdan gunluk gelistirmeye, build kontrollerinden yayin oncesi hazirliklara kadar temel ihtiyaclarini tek yerde toplar.

## Projenin Amaci

ISO50001-EMS, ISO 50001 uyumlu cok birimli enerji yonetim sistemidir. Sistem; sayac bazli tuketim takibi, alt birim ve enerji kaynagi yonetimi, meteoroloji verileri, regresyon analizi, KPI panelleri, SWOT, risk ve firsat yonetimi, enerji performans gostergeleri, AI onerileri ve PDF raporlama gibi surecleri destekler.

Uygulama iki ana calisma yuzeyinden olusur:

- API: Express tabanli backend, PostgreSQL ve Drizzle ORM ile calisir.
- Frontend: React ve Vite tabanli EMS dashboard arayuzu.

## Teknoloji Yigini

- Package manager: `pnpm`
- Workspace: `pnpm workspaces`
- Dil: TypeScript 5.9
- Runtime: Node.js
- API: Express 5
- Veritabani: PostgreSQL
- ORM: Drizzle ORM
- Validasyon: Zod ve drizzle-zod
- API kontrati: OpenAPI
- API client uretimi: Orval
- Frontend: React 19, Vite, Wouter
- Veri cekme/cache: TanStack React Query
- UI: shadcn/ui tarzi Radix tabanli bilesenler, Tailwind CSS, lucide-react
- Grafikler: Recharts
- Build: esbuild ve Vite
- Test altyapisi: Playwright

## Proje Klasor Yapisi

```text
.
+-- artifacts/
|   +-- api-server/          # Express API uygulamasi
|   +-- ems-dashboard/       # React + Vite frontend
|   +-- mockup-sandbox/      # Build disinda tutulan sandbox alan
+-- lib/
|   +-- api-client-react/    # Orval ile uretilen React Query API client
|   +-- api-spec/            # OpenAPI kontrati ve codegen konfigi
|   +-- api-zod/             # API Zod ciktisi
|   +-- db/                  # Drizzle schema ve DB yardimcilari
|   +-- demo-data/           # Demo/veri yardimci alani
+-- scripts/                 # Seed, import/export ve MGM scriptleri
+-- docs/                    # Gelistirici dokumantasyonu
+-- attached_assets/         # Frontend asset alias'i icin kaynaklar
+-- package.json             # Root workspace scriptleri
+-- pnpm-workspace.yaml      # Workspace, catalog, override ve guvenlik ayarlari
+-- replit.md                # Replit/import/run kurallari
+-- start-api.ps1            # Windows API baslatma scripti
+-- start-web.ps1            # Windows frontend baslatma scripti
+-- start-enys.bat           # Windows API + frontend baslatma scripti
```

Onemli kaynak noktalar:

- `artifacts/api-server/src/app.ts`: Express app, global middleware ve `/api` router mount noktasi.
- `artifacts/api-server/src/index.ts`: API port kontrolu, migration calistirma ve server start akisi.
- `artifacts/api-server/src/routes/`: API route modulleri.
- `artifacts/api-server/src/middlewares/auth.ts`: Bearer token auth middleware.
- `artifacts/ems-dashboard/src/context/AuthContext.tsx`: Login/logout, token saklama ve API client token baglantisi.
- `artifacts/ems-dashboard/src/context/UnitContext.tsx`: Aktif birim secimi.
- `artifacts/ems-dashboard/src/context/YearContext.tsx`: Aktif yil secimi.
- `artifacts/ems-dashboard/src/pages/`: Uygulama ekranlari.
- `lib/db/src/schema/energy.ts`: Ana veritabani schema kaynagi.
- `lib/api-spec/openapi.yaml`: OpenAPI kontrati.
- `lib/api-client-react/src/generated/`: Orval uretimi. Elle duzenlenmemelidir.

## Calisma Alani ve Klasor Organizasyonu

Projeyi mumkun oldugunca sabit, kisa ve bosluk icermeyen bir klasor yolunda tutun. Windows portable kullanimda uzun path, Turkce karakterli klasor veya senkronizasyon klasorleri bazi native paketlerde ve build araclarinda sorun cikarabilir.

Onerilen yaklasim:

- Proje kokunu tek calisma alani olarak kabul edin.
- VS Code'u her zaman proje kokunden acin.
- Komutlari root dizinden calistirin.
- API, frontend, lib ve scripts paketlerini ayri repo gibi tasimayin.
- `lib/api-client-react/src/generated/` gibi uretilen alanlarda manuel duzenleme yapmayin.
- Deneme veya gecici notlari kod paketlerinin icine dagitmayin; kalici bilgi gerekiyorsa `docs/` altina ekleyin.
- Indirilen Excel, PDF veya test dosyalarini kalici asset ihtiyaci yoksa repoya dahil etmeyin.

Gelistirme sirasinda zihinsel model su sekilde olmalidir:

```text
docs/      -> kararlar ve gelistirici bilgisi
lib/       -> paylasilan kontrat, DB ve generated kutuphaneler
artifacts/ -> calisan API ve frontend uygulamalari
scripts/   -> veri aktarim, seed ve yardimci islemler
```

## Ilk Kurulum

1. Node.js ve `pnpm` kurulu olmalidir.
2. Proje kok dizininde bagimliliklari kurun:

```bash
pnpm install
```

3. Gerekli ortam degiskenlerini hazirlayin:

```env
DATABASE_URL=
PORT=8080
NODE_ENV=development
```

API `PORT` olmadan baslamaz. Local gelistirme icin frontend varsayilan olarak `5000` portunu kullanir ve `/api` isteklerini `http://localhost:8080` adresine proxy'ler.

AI provider baglantisi backend environment uzerinden yapilir. Gercek anahtar repo dosyalarina yazilmaz; local veya deployment secret olarak saglanir.

```env
AI_ENABLED=false
AI_PROVIDER=mock
AI_ALLOW_MOCK_PROVIDER=true
AI_TIMEOUT_MS=30000
AI_MAX_OUTPUT_TOKENS=4096
AI_DEVELOPMENT_DATA_POLICY=demo_only

GEMINI_API_KEY=
GEMINI_MODEL=
GEMINI_MAX_RETRIES=1
GEMINI_TEMPERATURE=0.2
GEMINI_API_VERSION=
```

`AI_PROVIDER=gemini` yalniz backend tarafinda Gemini provider'i etkinlestirir; frontend'e SDK veya secret gonderilmez. Gercek Gemini smoke testi otomatik suite'e dahil degildir; yalniz sentetik veriyle ve `RUN_GEMINI_SMOKE=true` verildiginde `pnpm run test:gemini-smoke` ile calisir.

4. Kurulumdan sonra temel kontrolu calistirin:

```bash
pnpm run typecheck
```

### Yeni Bilgisayarda Ilk Kurulum

Yeni bir bilgisayarda veya portable gelistirme ortaminda asagidaki sirayi izleyin:

1. Git, Node.js LTS, pnpm ve VS Code kurulumunu dogrulayin.
2. Projeyi kisa ve kalici bir klasore alin.
3. Terminali proje kokunde acin.
4. `node -v`, `pnpm -v` ve `git --version` komutlariyla araclari kontrol edin.
5. `pnpm install` calistirin.
6. Gerekirse native build izinleri icin `pnpm approve-builds` calistirin.
7. `.env` veya ilgili ortam degiskenlerinde `DATABASE_URL`, `PORT` ve `NODE_ENV` degerlerini hazirlayin.
8. `pnpm run typecheck` ile kurulumun saglikli oldugunu dogrulayin.
9. API ve frontend'i ayri terminallerde baslatin.
10. Login ve dashboard smoke testini tamamlayin.

Kurulum sirasinda `esbuild`, `rollup`, `lightningcss` veya Tailwind native binding hatasi alinirsa once bagimlilik kurulumu ve approve-builds sureci kontrol edilmelidir. Sorun devam ederse `docs/TROUBLESHOOTING.md` dosyasina bakin.

### Windows Portable Gelistirme Yaklasimi

Bu proje Windows ve PowerShell ortaminda portable calismaya uygundur. Portable yaklasimda amac, gelistirme ortamini mumkun oldugunca tasinabilir ve tekrar kurulabilir tutmaktir.

Dikkat edilmesi gerekenler:

- Proje klasorunu OneDrive, Dropbox veya otomatik senkronizasyon altinda tutmayin.
- PowerShell ve Git Bash kullanimini karistiriyorsaniz komut path farklarina dikkat edin.
- `start-api.ps1`, `start-web.ps1` ve `start-enys.bat` Windows gelistirme icin tercih edilen baslangic araclaridir.
- Ortam degiskenlerini terminal oturumu, PowerShell profile veya proje start scriptleri uzerinden tutarli yonetin.
- Native package hatalarinda once `pnpm install`, sonra `pnpm approve-builds`, sonra typecheck/build sirasi izlenmelidir.
- Portable klasoru farkli bilgisayara tasindiginda `node_modules` davranisi garanti edilmez; temiz `pnpm install` daha guvenlidir.

Replit ortaminda ilk import/run icin onerilen komutlar:

```bash
pnpm install --frozen-lockfile=false
pnpm run replit:check
pnpm run replit:start
```

Replit Secrets icinde `DATABASE_URL` bulunmalidir. Replit import sirasinda yeni database olusturmayin ve DB push/migration komutlari calistirmayin.

## Gunluk Gelistirme Akisi

Tipik gelistirme akisi:

1. Guncel branch'i alin ve bagimliliklarin kurulu oldugunu dogrulayin.
2. API'yi baslatin.
3. Frontend'i baslatin.
4. Degisiklikleri kucuk ve izlenebilir parcalar halinde yapin.
5. OpenAPI kontrati degistiyse codegen calistirin.
6. Typecheck ve gerekirse build/test calistirin.
7. Commit oncesi `git diff` ile sadece beklenen dosyalarin degistigini kontrol edin.

### Gunluk Gelistirme Rutini

Her gelistirme gunune kucuk bir saglik kontroluyle baslayin:

1. `git status --short` ile calisma alanini kontrol edin.
2. Gerekirse uzak depodaki guncel degisiklikleri alin.
3. Yapilacak isin kapsam dosyalarini belirleyin.
4. Ilgili dokumanlari ve mevcut kod patternlerini okuyun.
5. API ve frontend'i baslatin.
6. Degisikligi kucuk parcalar halinde uygulayin.
7. Her anlamli adimdan sonra ilgili ekrani veya endpoint'i kontrol edin.
8. Gun sonunda typecheck, gerekirse build ve git diff kontrolu yapin.

Kural basittir: once mevcut durumu anlayin, sonra en kucuk guvenli degisikligi yapin, sonra dogrulayin.

API:

```bash
pnpm --filter @workspace/api-server run dev
```

Frontend:

```bash
pnpm --filter @workspace/ems-dashboard run dev
```

Root kontroller:

```bash
pnpm run typecheck
pnpm run build
```

OpenAPI/Orval codegen:

```bash
pnpm --filter @workspace/api-spec run codegen
```

### Gun Sonu Kapanis Rutini

Gunu kapatmadan once asagidaki kontrolleri yapin:

1. Calisan terminal ve dev server'lari durdurun.
2. `git status --short` ile degisen dosyalari listeleyin.
3. `git diff` ile degisikligin kapsam disina tasip tasmadigini kontrol edin.
4. En az `pnpm run typecheck` calistirin.
5. Frontend veya API etkileniyorsa ilgili build ya da manuel smoke testi yapin.
6. Commit atilacaksa staged diff'i tekrar okuyun.
7. Commit atilmayacaksa yarim kalan isin notunu dokumana, issue'ya veya gorev takip alanina yazin.

Gunun sonunda calisma alaninda neyin degistigini bilmeden bilgisayari kapatmayin. Bu aliskanlik hem kayip degisikligi hem de ilgisiz dosya commit'ini onler.

## Gelistirme Buyuklugune Gore Calisma Stratejisi

Her gelistirme ayni sekilde ele alinmamalidir. Kucuk bir metin degisikligi ile yeni bir ISO 50001 modulu ayni planlama, test ve commit stratejisini gerektirmez. Isin buyuklugu arttikca analiz, parcalama, test ve entegrasyon kontrolu de artmalidir.

### Kucuk Duzeltme

Kucuk duzeltmeler dar kapsamli, hizli dogrulanabilir ve dusuk riskli islerdir.

Ornekler:

- kucuk UI duzeltmesi,
- metin degisikligi,
- basit bug fix,
- dokumantasyon netlestirmesi,
- tek component veya tek endpoint icinde lokal davranis duzeltmesi.

Izlenecek surec:

```text
Analiz
  ->
Kod
  ->
Typecheck
  ->
Manuel Test
  ->
Tek Commit
  ->
Push
```

Bu tur islerde amac, sorunu genisletmeden cozmek ve ilgisiz dosyalara dokunmamaktir. Kucuk duzeltme bahanesiyle refactor, package degisikligi veya migration baslatilmamalidir.

### Orta Olcekli Gelistirme

Orta olcekli gelistirmeler birden fazla dosyaya dokunabilir, ancak yine de sinirli bir modulu veya akisi hedeflemelidir.

Ornekler:

- yeni ekran,
- yeni API endpoint,
- yeni tablo,
- mevcut modulu gelistirme,
- OpenAPI ve generated client akisini etkileyen sinirli degisiklik.

Izlenecek surec:

```text
Analiz
  ->
Plan
  ->
2-3 kucuk adim
  ->
Her adimin testi
  ->
Typecheck
  ->
Build
  ->
Commit
  ->
Push
```

Orta olcekli islerde once etkilenecek route, component, context, schema, OpenAPI ve generated client iliskisi belirlenmelidir. Her adim kendi icinde test edilebilir olmalidir. Bir adim tamamlanmadan digerine gecmek, hatanin hangi katmanda olustugunu bulmayi zorlastirir.

### Buyuk Gelistirme

Buyuk gelistirmeler tek seferde yapilmamalidir. Yeni bir modul, kapsamli refactor veya buyuk ISO 50001 ozelligi; veri modeli, tenant izolasyonu, API kontrati, frontend akisi, test sureci ve kullanici deneyimini birlikte etkileyebilir.

Ornekler:

- yeni modul,
- kapsamli refactor,
- buyuk ISO 50001 ozelligi,
- raporlama veya enerji gozden gecirme gibi cok adimli is akislari,
- veritabani ve frontend/backend kontratini birlikte etkileyen degisiklikler.

Izlenecek surec:

```text
Ihtiyac Analizi
  ->
Mimari Plan
  ->
Kabul Kriterleri
  ->
Gorevlere Bolme
  ->
Her gorevi ayri gelistirme
  ->
Her gorev icin test
  ->
Kucuk commitler
  ->
Son entegrasyon testi
  ->
Push
```

Buyuk islerde once hedef ve kabul kriterleri netlestirilmelidir. Ardindan is; backend, frontend, OpenAPI, DB, test ve dokumantasyon adimlarina bolunmelidir. Her parca tek basina anlasilir, test edilebilir ve commit edilebilir olmalidir.

Ozellikle AI destekli gelistirmede buyuk isler tek prompt, tek kod degisikligi veya tek commit olarak ele alinmamalidir. Bu yaklasim review'u zorlastirir, tenant ve auth risklerini artirir, hatanin kaynagini belirsizlestirir.

## AI Destekli Gelistirme Dongusu

Bu proje AI destekli gelistirilmektedir. AI araclari gelistirme hizini artirir, ancak nihai sorumluluk ve karar kullanicidadir.

Gercek calisma modeli:

```text
Ihtiyac
  ->
ChatGPT
  ->
Analiz
  ->
Mimari degerlendirme
  ->
Prompt hazirlama
  ->
Codex
  ->
Kod analizi
  ->
Kod gelistirme
  ->
Typecheck
  ->
Build
  ->
Test
  ->
ChatGPT
  ->
Kod inceleme
  ->
Iyilestirme onerileri
  ->
Commit
  ->
Push
```

Roller:

- Kullanici: Ihtiyaci, is onceligini, kabul kriterlerini ve nihai karari belirler. Commit, push, release ve risk kabul karari kullaniciya aittir.
- ChatGPT: Mimari ve kalite danismanidir. Ihtiyaci netlestirir, ISO 50001 etkisini yorumlar, prompt hazirlar, alternatifleri tartisir ve kod inceleme icin kontrol listesi uretir.
- Codex: Repo uzerinde calisan gelistiricidir. Dosyalari okur, mevcut pattern'i analiz eder, kod veya dokuman degisikligi yapar, typecheck/build/test calistirir ve sonucu raporlar.

AI destekli calismada ideal sorumluluk ayrimi:

- ChatGPT karar ve kalite baglamini guclendirir.
- Codex uygulanabilir degisikligi repoda gerceklestirir.
- Kullanici kapsami, riski ve yayin kararini onaylar.

Bu dongu ozellikle orta ve buyuk gelistirmelerde kullanilmalidir. Kucuk duzeltmelerde surec daha kisa olabilir, ancak yine de analiz, dogrulama ve git kontrolu atlanmamalidir.

## VS Code Kullanimi

Projeyi VS Code ile kok dizinden acin. Workspace yapisi paketler arasi TypeScript referanslarini kullandigi icin editorun kok `tsconfig.json` ve alt paket `tsconfig.json` dosyalarini birlikte gormesi onemlidir.

Oneriler:

- Terminali proje kokunde acin.
- Komutlari root dizinden `pnpm --filter ...` ile calistirin.
- TypeScript hatalarinda once ilgili paketin `typecheck` komutunu, sonra root `pnpm run typecheck` komutunu calistirin.
- Generated client dosyalarinda hata gorurseniz once OpenAPI kontratini ve codegen ciktisini kontrol edin.
- Frontend import alias'lari icin `@` frontend `src` dizinine, `@assets` ise `attached_assets` dizinine gider.

### VS Code Calisma Duzeni

Onerilen pencere duzeni:

- Bir terminal API icin.
- Bir terminal frontend icin.
- Bir terminal git, typecheck ve build komutlari icin.
- Sol panelde Explorer yerine Source Control ve Search gorunumlerini aktif kullanin.
- Problems panelini acik tutun; TypeScript ve lint benzeri sinyalleri erken yakalayin.
- Frontend gelistirirken Browser DevTools console ve network panellerini birlikte izleyin.

Buyuk dosyalarda arama yaparken once `rg` veya VS Code Search kullanin. Tum projeyi okumak yerine route, page, context, schema ve generated client zincirini takip edin.

### Onerilen VS Code Eklentileri

Zorunlu degildir, ancak gelistirme deneyimini iyilestirir:

- ESLint: TypeScript ve frontend uyarilarini editor icinde gormek icin.
- Prettier: Markdown, JSON ve frontend dosyalarinda tutarli format icin.
- Tailwind CSS IntelliSense: Tailwind class onerileri ve hatalari icin.
- Playwright Test for VS Code: E2E testleri editor icinden calistirmak icin.
- GitLens: Degisiklik gecmisi ve blame incelemesi icin.
- Error Lens: TypeScript hatalarini satir uzerinde daha gorunur yapmak icin.
- DotENV: `.env` dosyalarinda okunabilirlik icin.
- YAML: OpenAPI ve YAML dosyalari icin.

Eklenti eklemek proje bagimliligi eklemek anlamina gelmez. VS Code eklentileri kisile ait editor tercihidir; package dosyalarina yansitilmaz.

## Start Scriptleri

Windows icin proje kokunde yardimci scriptler vardir:

```powershell
.\start-api.ps1
```

API icin `NODE_ENV=development`, `PORT=8080` ve `DATABASE_URL` set ederek `@workspace/api-server` paketini baslatir.

```powershell
.\start-web.ps1
```

Frontend Vite dev server'i baslatir.

```bat
.\start-enys.bat
```

API ve frontend icin ayri PowerShell pencereleri acar, kisa bekleme sonrasi `http://localhost:5000` adresini baslatir.

Root package scriptleri:

```bash
pnpm run replit:start
pnpm run replit:api
pnpm run replit:web
```

Replit start komutu API'yi, web komutu frontend'i calistirir.

## Build

Tum proje build:

```bash
pnpm run build
```

Bu komut once typecheck calistirir, sonra `@workspace/mockup-sandbox` haricindeki paketlerin build scriptlerini calistirir.

API build:

```bash
pnpm --filter @workspace/api-server run build
```

Frontend build:

```bash
pnpm --filter @workspace/ems-dashboard run build
```

Frontend build ciktisi:

```text
artifacts/ems-dashboard/dist/public
```

## Typecheck

Root typecheck:

```bash
pnpm run typecheck
```

Bu komut iki asamadan olusur:

- `pnpm run typecheck:libs`: TypeScript project references ile `lib` paketlerini kontrol eder.
- `pnpm -r --filter "./artifacts/**" --filter "./scripts" --if-present run typecheck`: Uygulama ve script paketlerini kontrol eder.

Paket bazli kontroller:

```bash
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/ems-dashboard run typecheck
pnpm --filter @workspace/scripts run typecheck
```

## Onerilen Debug Yaklasimi

Debug yaparken once belirtiden baslayin, sonra veri akisinin hangi katmanda koptugunu bulun.

Genel siralama:

```text
Frontend belirti
  -> Browser console
  -> Network istegi
  -> API response
  -> API loglari
  -> Route / middleware
  -> DB sorgusu
  -> Schema / veri iliskisi
```

Frontend sorunlarinda:

- Browser console'daki hatayi ilk sinyal olarak alin.
- Network panelinde istek URL, status code ve response body'sini kontrol edin.
- React Query cache davranisini ve query key'leri inceleyin.
- `AuthContext`, `UnitContext` ve `YearContext` etkisini kontrol edin.
- Loading, empty ve error state'lerin birbirine karismadigindan emin olun.

Backend sorunlarinda:

- API server loglarini okuyun.
- Route'un `app.ts` ve ilgili router icinde kayitli oldugunu dogrulayin.
- `authMiddleware`, `requireAuth` ve `requireAdmin` akisini kontrol edin.
- `companyId`, `unitId` ve ilgili tenant filtrelerinin sorguda kullanildigini dogrulayin.
- Drizzle sorgusunun beklenen tablo ve iliskileri kullandigini kontrol edin.

Veritabani sorunlarinda:

- `DATABASE_URL` dogru ortama mi baglaniyor kontrol edin.
- Schema ile calisan veritabani arasinda uyumsuzluk olup olmadigini inceleyin.
- Foreign key, tenant alani ve tarih/yil filtrelerini ozellikle kontrol edin.

Debug sirasinda tahminle genis refactor yapmayin. Once hatayi izole edin, sonra en kucuk duzeltmeyi uygulayin.

## Test Sureci

Projede Playwright bagimliligi ve kokte `login.spec.ts` bulunur. Test calistirmadan once API ve frontend'in ayakta oldugundan emin olun.

Varsayilan test kullanicilari:

```text
admin / admin123
kontrol_admin / admin123
```

Onerilen manuel smoke test:

1. API'yi baslatin.
2. Frontend'i baslatin.
3. `http://localhost:5000` adresini acin.
4. Login sayfasinin geldigini dogrulayin.
5. Varsayilan kullanicilardan biriyle giris yapin.
6. Dashboard, Birim Yonetimi, Sayac Yonetimi ve Tuketim Verileri ekranlarini hizlica kontrol edin.

Playwright testleri icin paket scripti tanimli degilse dogrudan Playwright CLI kullanilabilir:

```bash
pnpm exec playwright test
```

## Git Calisma Duzeni

Her is icin ayri branch kullanin:

```bash
git checkout -b feature/kisa-aciklama
```

Commit oncesi kontrol listesi:

```bash
git status --short
git diff
pnpm run typecheck
```

Genel prensipler:

- Degisiklikleri kucuk ve amaca odakli tutun.
- Ilgisiz refactor yapmayin.
- Kullanici ya da baska gelistirici tarafindan yapilmis degisiklikleri geri almayin.
- Generated dosyalari yalnizca ilgili codegen komutu urettiyse commit edin.
- DB schema degisikligi gerekiyorsa bunu ayri, acik ve kontrollu bir is olarak ele alin.

## Commit Kurallari

Commit mesajlari kisa, emir kipinde ve degisiklik amacini anlatir sekilde yazilmalidir.

Onerilen format:

```text
type(scope): kisa aciklama
```

Ornekler:

```text
docs: add developer guide
fix(api): handle missing unit filter
feat(dashboard): add yearly comparison chart
chore: update generated api client
```

Yaygin type degerleri:

- `feat`: Yeni ozellik
- `fix`: Hata duzeltmesi
- `docs`: Dokumantasyon
- `refactor`: Davranis degistirmeyen kod duzenleme
- `test`: Test ekleme veya guncelleme
- `chore`: Bakim, tooling, generated ciktisi

Commit'e dahil etmeden once `git diff --staged` ile staged degisiklikleri kontrol edin.

## Yayin Oncesi Kontroller

Yayin veya merge oncesi asgari kontroller:

```bash
pnpm run typecheck
pnpm run build
```

OpenAPI kontrati degistiyse:

```bash
pnpm --filter @workspace/api-spec run codegen
pnpm run typecheck
```

Frontend etkileniyorsa:

```bash
pnpm --filter @workspace/ems-dashboard run build
```

API etkileniyorsa:

```bash
pnpm --filter @workspace/api-server run build
```

Manuel kontrol:

- Login sayfasi aciliyor mu?
- `admin / admin123` ile giris yapilabiliyor mu?
- API `/api` route'lari beklenen cevaplari veriyor mu?
- Frontend console'da bariz hata var mi?
- Yeni veya degisen ekranlarda query cache invalidation dogru mu?
- Role ve birim bazli yetkiler korunuyor mu?

## Verimlilik ve Performans Onerileri

Gelistirme sirasinda hem uygulama performansini hem de gelistirici zamanini korumak gerekir.

Gelistirici verimliligi icin:

- Ilgili dosyayi bulmak icin once `rg`, VS Code Search veya mevcut route/page isimlerini kullanin.
- Tum projeyi okumak yerine veri akisini takip edin: page -> hook/client -> API route -> service/query -> schema.
- Her degisiklikten sonra tum build yerine once ilgili paketin typecheck/build komutunu calistirin; merge oncesi root kontrolleri calistirin.
- Native dependency sorunlarinda ayni komutu tekrar tekrar denemeden once hata mesajini okuyun.
- Buyuk islerde once dosya listesini ve kabul kriterlerini netlestirin.

Uygulama performansi icin:

- React tarafinda gereksiz state ve gereksiz render olusturmayin.
- React Query query key ve invalidation davranisini bilincli yonetin.
- Buyuk listelerde filtreleme, sayfalama veya server-side sorgu ihtiyacini degerlendirin.
- Backend'de N+1 sorgu olusturabilecek dongulerden kacinin.
- Tenant filtrelerini performans bahanesiyle kaldirmayin.
- Gereksiz API cagrilarini onlemek icin mevcut hook ve cache patternlerini kullanin.

Performans iyilestirmesi yapmadan once olcum veya belirgin belirti olmalidir. Sadece varsayimla mimari degistirmeyin.

## Gelistirici Icin Best Practices

EnYS uzerinde saglikli gelistirme icin su aliskanliklari koruyun:

- Her isten once `docs/AI_CONTEXT.md`, `docs/ARCHITECTURE.md` ve `docs/CODING_RULES.md` icindeki ilgili kisimlari hatirlayin.
- Degisikligi tek amaca odaklayin.
- Tenant izolasyonunu tasarimin ilk adiminda dusunun.
- Auth ve role davranislarini UI kolayligi icin gevsetmeyin.
- Backend dogrulamasini frontend form validasyonuna emanet etmeyin.
- OpenAPI degisikligi varsa generated client surecini unutmayin.
- Generated dosyalarda manuel patch yapmayin.
- Migration, package ve auth degisikliklerini ayri karar olarak ele alin.
- Commit oncesi `git diff` okumayi zorunlu aliskanlik haline getirin.
- Bir sorunu cozerken fark ettiginiz ilgisiz sorunlari ayni degisiklige eklemeyin; not alin ve ayri is olarak planlayin.
- Kullanici deneyimini ISO 50001 surecinin parcasi olarak degerlendirin.

## Dikkat Edilmesi Gereken Kurallar

### Package ve Dependency

- Bu proje `pnpm` kullanir. `npm install` veya `yarn` kullanmayin.
- Root `preinstall` scripti pnpm disindaki package manager'lari engeller.
- `pnpm-workspace.yaml` icindeki `minimumReleaseAge: 1440` guvenlik ayarini kapatmayin.
- Yeni dependency eklemeden once gercekten gerekli oldugunu ve workspace catalog yapisina uygunlugunu kontrol edin.

### Database

- `DATABASE_URL` zorunludur.
- Replit import sirasinda database push, migration generate veya migration reset calistirmayin.
- Asagidaki komutlar sadece local/dev database gelistirmesi icindir ve bilincli kullanilmalidir:

```bash
pnpm --filter @workspace/db run push
pnpm --filter @workspace/db run push-force
```

- Tablolar zaten varsa migration state'i manuel degistirmeden once durumu analiz edin.
- Schema degisikliklerinde `lib/db` TypeScript ciktisini ve kullanan paketleri typecheck edin.

### API

- Yeni route ekledikten sonra API server'i yeniden baslatin; aksi halde yeni route 404 donebilir.
- `authMiddleware` global olarak `app.ts` icinde uygulanir.
- Route bazinda `requireAuth` ve `requireAdmin` kurallarini koruyun.
- Express 5'te `req.params.id` tipi `string | string[]` olabilir; parse ederken gerekli cast'i yapin:

```ts
const id = parseInt(req.params.id as string, 10);
```

### Frontend

- Token `localStorage` icinde saklanir ve `setAuthTokenGetter` ile API client'a baglanir.
- Birim izolasyonu `UnitContext` ile yonetilir.
- `unitId === null` "Tum Birimler" gorunumudur.
- Birim filtreli hook cagrilarinda `null` yerine `undefined` kullanilmasi beklenir.
- Orval hook kalibi:

```ts
useHookName(params, { query: { queryKey: getHookNameQueryKey(params) } });
```

- `return toast()` anti-pattern'inden kacinin. Bunun yerine:

```ts
toast();
return;
```

### Generated Dosyalar

- `lib/api-client-react/src/generated/` dosyalarini elle duzenlemeyin.
- OpenAPI degisikliginden sonra codegen calistirin.
- Generated degisiklikleri commit etmeden once kontrat degisikligiyle uyumlu oldugunu kontrol edin.

### Replit

Replit import/run sirasinda amac yalnizca projenin kurulmasi, build edilmesi ve baslamasidir. Bu surecte:

- Mimari degistirmeyin.
- Refactor yapmayin.
- Auth veya business logic degistirmeyin.
- DB schema degistirmeyin.
- Migration olusturmayin.
- Yeni dependency eklemeyin.

## Hizli Komut Ozeti

```bash
pnpm install
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/ems-dashboard run dev
pnpm run typecheck
pnpm run build
pnpm --filter @workspace/api-spec run codegen
pnpm exec playwright test
```

Windows:

```powershell
.\start-api.ps1
.\start-web.ps1
```

veya:

```bat
.\start-enys.bat
```

# 1. EnYS Documentation

Bu doküman seti, EnYS projesinde geliştirme yapan kişilerin ve AI araçlarının aynı bağlamla çalışması için oluşturulmuştur. Amaç; proje amacını, mimari kararları, kodlama kurallarını, Git akışını, release kontrollerini ve sorun giderme yaklaşımını tek bir ortak referans düzeninde toplamaktır.

Bu rehberler yeni geliştiriciler, proje sahibi, Codex, ChatGPT, Copilot, Gemini, Claude ve ileride projeye katılacak tüm teknik paydaşlar için hazırlanmıştır. Dokümanlar birlikte okunmalıdır; çünkü EnYS'te kod, ISO 50001 yaklaşımı, tenant güvenliği, kullanıcı deneyimi ve release disiplini birbirinden ayrı düşünülemez.

## 2. EnYS Hakkında

EnYS; ISO 50001 Enerji Yönetim Sistemi odağında geliştirilen, multi-tenant çalışan, React, Node.js, PostgreSQL, Drizzle ve pnpm Workspace tabanlı uzun ömürlü kurumsal bir üründür.

## 3. Yeni Geliştirici Nereden Başlamalı?

```text
README
  ->
AI_CONTEXT
  ->
DEVELOPER_GUIDE
  ->
ARCHITECTURE
  ->
CODING_RULES
  ->
CODEX_PROMPTS
  ->
CHATGPT_GUIDE
  ->
GIT_WORKFLOW
  ->
RELEASE_CHECKLIST
  ->
TROUBLESHOOTING
```

- README: Doküman setinin giriş noktasıdır.
- AI_CONTEXT: Projenin ortak AI hafızasını ve temel ilkelerini açıklar.
- DEVELOPER_GUIDE: Yeni geliştiricinin kuruluma ve günlük geliştirmeye başlamasını sağlar.
- ARCHITECTURE: Teknik mimariyi ve katman ilişkilerini açıklar.
- CODING_RULES: Kod yazarken uyulacak standartları tanımlar.
- CODEX_PROMPTS: Codex görevlerini güvenli ve tekrar kullanılabilir hale getirir.
- CHATGPT_GUIDE: ChatGPT'nin danışmanlık ve kalite rolünü açıklar.
- GIT_WORKFLOW: Git ve GitHub çalışma düzenini tanımlar.
- RELEASE_CHECKLIST: Yayın öncesi kalite kapılarını listeler.
- TROUBLESHOOTING: Sorun giderme yaklaşımını ve yaygın problem sınıflarını toplar.

## 4. Doküman Haritası

| Doküman | Amacı | Kim okumalı? |
| --- | --- | --- |
| [AI_CONTEXT.md](AI_CONTEXT.md) | Ortak proje hafızasını, AI çalışma ilkelerini ve EnYS felsefesini açıklar. | Tüm AI araçları ve geliştiriciler. |
| [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md) | Kurulum, geliştirme rutini, komutlar ve çalışma düzenini anlatır. | Yeni geliştiriciler ve Codex. |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Monorepo, backend, frontend, DB, OpenAPI ve tenant mimarisini açıklar. | Geliştiriciler, Codex, teknik karar vericiler. |
| [CODING_RULES.md](CODING_RULES.md) | Backend, frontend, DB, API ve TypeScript kodlama standartlarını tanımlar. | Kod yazan herkes ve AI geliştiriciler. |
| [CODEX_PROMPTS.md](CODEX_PROMPTS.md) | EnYS için standart Codex görev şablonlarını içerir. | Codex kullanan geliştiriciler. |
| [CHATGPT_GUIDE.md](CHATGPT_GUIDE.md) | ChatGPT'nin karar, prompt, review ve ISO 50001 danışmanlığı rolünü açıklar. | Kullanıcı, ChatGPT ve proje yönetenler. |
| [GIT_WORKFLOW.md](GIT_WORKFLOW.md) | GitHub merkezli commit, push, branch, rollback ve review kurallarını tanımlar. | Geliştiriciler ve Codex. |
| [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) | Yayın öncesi teknik, ISO 50001, güvenlik ve kullanıcı deneyimi kontrollerini listeler. | Release hazırlayan herkes. |
| [TROUBLESHOOTING.md](TROUBLESHOOTING.md) | Yaygın sorunları, karar ağacını ve çözüm yaklaşımını açıklar. | Sorun gideren geliştiriciler ve AI araçları. |

## 5. AI Araçlarının Rolleri

| Araç | En uygun kullanım |
| --- | --- |
| ChatGPT | Mimari düşünme, ISO 50001 yorumu, risk analizi, prompt hazırlama ve kalite değerlendirme. |
| Codex | Repo analizi, dosya düzenleme, typecheck/build/test çalıştırma ve sonuç raporlama. |
| Copilot | IDE içinde küçük kod tamamlama ve tekrar eden lokal geliştirme desteği. |
| Gemini | Geniş bağlamlı doküman inceleme, alternatif akış karşılaştırma ve özetleme. |
| Claude | Uzun doküman okuma, karar metni sadeleştirme ve süreç dokümanı değerlendirme. |

## 6. Günlük Geliştirme Akışı

```text
İhtiyaç
  ->
ChatGPT
  ->
Prompt
  ->
Codex
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

Günlük akışta ChatGPT ihtiyaç ve kalite tarafını netleştirir, Codex repo üzerinde kontrollü uygulama yapar, geliştirici typecheck/build/test ile doğrular ve GitHub'a yalnızca gözden geçirilmiş küçük değişiklikler gönderilir.

## 7. Temel İlkeler

- Tenant izolasyonu korunur.
- Küçük değişiklik tercih edilir.
- Gereksiz refactor yapılmaz.
- Migration bilinçli yapılır.
- Package değişiklikleri bilinçli yapılır.
- Generated dosya elle değiştirilmez.
- Typecheck kalite kapısıdır.
- Build kalite kapısıdır.
- Kullanıcı deneyimi önceliklidir.
- ISO 50001 yaklaşımı korunur.
- GitHub source of truth kabul edilir.
- Kullanıcı onayı olmadan commit, push veya release yapılmaz.

## 8. Doküman Güncelleme Politikası

Dokümanlar şu durumlarda güncellenmelidir:

- yeni modül eklendiğinde,
- yeni mimari karar alındığında,
- yeni AI çalışma yöntemi benimsendiğinde,
- yeni troubleshooting deneyimi yaşandığında,
- yeni release süreci veya kalite kapısı tanımlandığında,
- Git, package, migration veya generated client akışı değiştiğinde.

## 9. Son Mesaj

EnYS yalnızca çalışan kod üretmeyi hedefleyen bir proje değildir. Amaç; güvenilir, denetlenebilir, sürdürülebilir ve kullanıcı dostu bir ISO 50001 platformu geliştirmektir.

Bu doküman seti; geliştiriciler, AI araçları ve gelecekte projeye katılacak kişiler için ortak çalışma kültürünü temsil eder.

# Project History
PROJECT_HISTORY.md Taslak
Bu belge teknik bir changelog değildir.

Amaç, EnYS projesinin neden bugünkü yapısına ulaştığını anlatmaktır. Kod değişebilir, teknoloji değişebilir; ancak bu belgede anlatılan kararların arkasındaki düşünce uzun ömürlüdür.

1. EnYS'nin Doğuşu

EnYS, yalnızca enerji tüketimlerini kaydeden bir yazılım olarak tasarlanmadı. İlk günden itibaren hedef, ISO 50001 Enerji Yönetim Sistemi'nin gerçek hayattaki uygulanışını dijital ortama taşımaktı. Kullanıcının standardı ezberlemesi değil, yazılımın kullanıcıyı doğru sürece yönlendirmesi amaçlandı.

2. Ürün Felsefesi

Temel ilke şuydu:
'Kullanıcı mümkün olduğunca az düşünmeli, sistem doğru işi doğru zamanda önermelidir.'

Bu nedenle geliştirilen her modül yalnızca kendi ekranından sorumlu değildir. Bir tüketim kaydı; EnPI, SEU, hedefler, aksiyonlar, enerji gözden geçirme ve raporlamayı etkileyen ortak veri olarak ele alınmıştır.

3. Neden Multi-tenant?

EnYS tek şirket için değil, farklı kuruluşların aynı altyapıyı güvenle kullanabilmesi için tasarlandı. Company sınırı en önemli güvenlik kararıdır. Unit ve SubUnit ise operasyonel sorumluluk katmanlarıdır.

4. Kullanıcı Deneyimi Kararı

Proje boyunca en çok tekrar edilen tasarım ilkesi:
'Mühendis olmayan kullanıcı bile sistemi rahat kullanabilmeli.'

Bu nedenle gereksiz seçeneklerden, teknik jargonlardan ve karmaşık iş akışlarından kaçınılması temel ilke haline geldi.

5. Replit Dönemi

İlk geliştirmeler Replit üzerinde yapıldı. Hızlı prototipleme açısından verimliydi; ancak yüksek token tüketimi, import süreleri ve maliyetler büyüyen proje için sürdürülebilir değildi. Bu deneyim daha kontrollü bir geliştirme modeline geçilmesine neden oldu.

6. VS Code + GitHub + Codex

Daha sonra geliştirme modeli GitHub merkezli hale getirildi. GitHub 'source of truth' olarak kabul edildi. VS Code ana geliştirme ortamı, Codex repo üzerinde çalışan uygulayıcı, ChatGPT ise ürün ve mimari danışmanı rolünü üstlendi.

7. AI Destekli Geliştirme

EnYS'de AI araçlarının rolleri bilinçli biçimde ayrıldı:
- ChatGPT: ürün, mimari, ISO 50001 ve kalite danışmanlığı.
- Codex: repo analizi, kod değişikliği ve doğrulama.
- Kullanıcı: kapsam, öncelik, commit, push ve release kararları.

8. Dokümantasyon Kültürü

Projede hazırlanan dokümanlar yalnızca açıklama amacıyla değil, AI araçlarının aynı bağlamla çalışmasını sağlamak amacıyla oluşturuldu. Böylece farklı oturumlar ve farklı AI modelleri arasında bilgi sürekliliği hedeflendi.

9. Değiştirilmemesi Gereken İlkeler

- Tenant izolasyonu korunur.
- Küçük ve kontrollü değişiklik tercih edilir.
- Gereksiz refactor yapılmaz.
- Generated dosyalar elle değiştirilmez.
- Migration bilinçli yapılır.
- ISO 50001 süreç bütünlüğü korunur.
- Kullanıcı deneyimi teknik tercihler kadar önemlidir.

10. Geleceğe Not

EnYS'nin değeri kullandığı teknoloji değil, kararlarının tutarlılığıdır. Yeni modüller, yeni AI araçları ve yeni teknolojiler eklense bile; kullanıcıyı doğru yönlendiren, denetlenebilir ve sürdürülebilir bir yönetim sistemi oluşturma amacı korunmalıdır.

Bu belge yaşayan bir proje hafızasıdır. Büyük mimari kararlar, önemli yön değişiklikleri ve öğrenilen dersler ortaya çıktıkça güncellenmelidir.


import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Lock, Info, AlertTriangle } from "lucide-react";

const PRIORITY_RULES = [
  { label: "Pay ≥ %20 + Fırsat Var", priority: 1, color: "bg-red-500/20 text-red-400 border-red-500/30" },
  { label: "Pay ≥ %20 + Fırsat Yok", priority: 2, color: "bg-orange-500/20 text-orange-400 border-orange-500/30" },
  { label: "Pay %10–20 + Fırsat Var", priority: 2, color: "bg-orange-500/20 text-orange-400 border-orange-500/30" },
  { label: "Pay %10–20 + Fırsat Yok", priority: 3, color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" },
  { label: "Pay %5–10 + Fırsat Var", priority: 3, color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" },
  { label: "Pay %5–10 + Fırsat Yok", priority: 4, color: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  { label: "Pay <%5 + Fırsat Var", priority: 4, color: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  { label: "Pay <%5 + Fırsat Yok", priority: null, color: "bg-muted text-muted-foreground" },
];

interface Props {
  isAdmin?: boolean;
  isSuperAdmin?: boolean;
}

export default function SeuMethodTab({ isAdmin = false, isSuperAdmin = false }: Props) {
  return (
    <div className="space-y-5">

      {/* Aktif Metot Durum Kartı */}
      <Card className="border-teal-500/30 bg-teal-500/5">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-teal-400 shrink-0" />
            <CardTitle className="text-base text-teal-300">Aktif ÖEK Belirleme Metodu</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2 text-sm">
            <div className="flex items-center justify-between gap-2 py-1 border-b border-border/40">
              <span className="text-muted-foreground">Metot adı</span>
              <span className="font-medium text-right">Tüketim Payı × Fırsat Matrisi</span>
            </div>
            {isSuperAdmin && (
              <div className="flex items-center justify-between gap-2 py-1 border-b border-border/40">
                <span className="text-muted-foreground">Metot kodu</span>
                <code className="text-xs bg-muted/40 px-1.5 py-0.5 rounded font-mono">consumption_share_opportunity_matrix</code>
              </div>
            )}
            <div className="flex items-center justify-between gap-2 py-1 border-b border-border/40">
              <span className="text-muted-foreground">Durum</span>
              <Badge variant="outline" className="text-xs border-teal-500/30 text-teal-400">Sistem varsayılan metodu</Badge>
            </div>
            {isSuperAdmin && (
              <div className="flex items-center justify-between gap-2 py-1 border-b border-border/40">
                <span className="text-muted-foreground">Değiştirilebilirlik</span>
                <Badge variant="outline" className="text-xs border-border text-muted-foreground gap-1">
                  <Lock className="h-2.5 w-2.5" /> Salt okunur
                </Badge>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Rol bazlı bilgi kutusu */}
      {isAdmin ? (
        <div className="flex items-start gap-3 p-3.5 rounded-md border border-amber-500/30 bg-amber-500/5 text-sm text-amber-300">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            ÖEK belirleme metodu firma yöneticisi tarafından değiştirilemez. Firma özelinde farklı bir ÖEK metodolojisi
            kullanmak istiyorsanız <span className="text-amber-200 font-medium">sistem yöneticisi / platform sahibi</span> ile iletişime geçiniz.
          </span>
        </div>
      ) : (
        <div className="flex items-start gap-3 p-3.5 rounded-md border border-border/60 bg-muted/10 text-sm text-muted-foreground">
          <Info className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            Bu metot şirketiniz için tanımlı aktif ÖEK belirleme metodudur. ÖEK analizleri ve karar kayıtları bu metoda
            göre oluşturulur.
          </span>
        </div>
      )}

      {/* Mevcut içerik — korundu */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Metot: Tüketim Payı × Fırsat Matrisi</CardTitle>
          {isSuperAdmin && (
            <CardDescription>consumption_share_opportunity_matrix — ISO 50001 uyumlu ÖEK belirleme metodu</CardDescription>
          )}
        </CardHeader>
        <CardContent className="text-sm space-y-3 text-muted-foreground">
          <p>Bu metot, enerji tüketiminin belirli bir kırılım seviyesindeki payını ve ilgili iyileştirme fırsatını birleştirerek önem önceliğini hesaplar.</p>
          <p><span className="text-foreground font-medium">Toplam TEP:</span> Seçili birimin ilgili yıl/dönemindeki tüm consumption kayıtlarının TEP toplamıdır. Firma geneli değil, birim geneli kullanılır.</p>
          {isSuperAdmin && (
            <p><span className="text-foreground font-medium">Pay hesabı:</span> energyUseGroupTotalTep / selectedUnitTotalTep × 100</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Öncelik Matrisi</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-1.5">
            {PRIORITY_RULES.map((rule, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{rule.label}</span>
                <Badge variant="outline" className={rule.priority !== null ? rule.color : "bg-muted text-muted-foreground"}>
                  {rule.priority !== null ? `Öncelik ${rule.priority} — ÖEK Adayı` : "ÖEK Dışı"}
                </Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Kullanıcı Kararları</CardTitle></CardHeader>
        <CardContent className="text-sm space-y-2 text-muted-foreground">
          <p><span className="text-green-400 font-medium">ÖEK Olarak Kabul Et:</span> Sistem önerisiyle veya öneriye rağmen ÖEK olarak tanımlar.</p>
          <p><span className="text-red-400 font-medium">ÖEK Dışı:</span> ÖEK adayı önerilen bir kalemi dışarıda bırakır. Gerekçe girilmesi zorunludur.</p>
          <p><span className="text-yellow-400 font-medium">İzle:</span> Henüz ÖEK tanımlamadan takibe alır. Gerekçe zorunludur (sistem önerisiyle çelişiyorsa).</p>
          <p className="pt-1 border-t border-border">Kullanıcı kararı sistem önerisinden farklıysa <span className="text-foreground">karar gerekçesi zorunludur</span>. Bu bilgi ISO 50001 denetimlerinde kullanılır.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Analiz Seviyeleri</CardTitle></CardHeader>
        <CardContent className="text-sm space-y-1.5 text-muted-foreground">
          <p><span className="text-foreground">Enerji Kullanım Grubu (varsayılan):</span> ISO 50001 ana analiz seviyesi. Sayaçların atandığı kullanım gruplarına göre kırılım.</p>
          <p><span className="text-foreground">Sayaç:</span> Bireysel sayaç bazında tüketim ve pay hesabı.</p>
          <p><span className="text-foreground">Alt Birim:</span> Lokasyon veya departman bazında kırılım.</p>
          <p><span className="text-foreground">Enerji Kaynağı:</span> Elektrik, doğalgaz, buhar vb. kaynak bazında karşılaştırma.</p>
          <p><span className="text-foreground">Birim:</span> Tek birim için özet analiz (tek satır).</p>
        </CardContent>
      </Card>
    </div>
  );
}

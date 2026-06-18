import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import {
  useListCompanies,
  useCreateCompany,
  useUpdateCompany,
  useDeleteCompany,
  getListCompaniesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Building2, Plus, Pencil, Trash2, ShieldAlert } from "lucide-react";

type Company = {
  id: number;
  name: string;
  subdomain: string;
  isActive: boolean;
  createdAt: string;
};

const EMPTY_FORM = { name: "", subdomain: "", isActive: true };

export default function Companies() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: companies = [], isLoading } = useListCompanies({
    query: { queryKey: getListCompaniesQueryKey() },
  });

  const createMutation = useCreateCompany();
  const updateMutation = useUpdateCompany();
  const deleteMutation = useDeleteCompany();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Company | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<Company | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: getListCompaniesQueryKey() });

  function openCreate() {
    setEditTarget(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  }

  function openEdit(c: Company) {
    setEditTarget(c);
    setForm({ name: c.name, subdomain: c.subdomain, isActive: c.isActive });
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!form.name.trim() || !form.subdomain.trim()) {
      toast({ title: "Hata", description: "Firma adı ve subdomain zorunludur.", variant: "destructive" });
      return;
    }
    try {
      if (editTarget) {
        await updateMutation.mutateAsync({ id: editTarget.id, data: form });
        toast({ title: "Firma güncellendi" });
      } else {
        await createMutation.mutateAsync({ data: form });
        toast({ title: "Firma oluşturuldu" });
      }
      invalidate();
      setDialogOpen(false);
    } catch (err: any) {
      toast({
        title: "Hata",
        description: err?.response?.data?.error ?? "İşlem başarısız",
        variant: "destructive",
      });
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await deleteMutation.mutateAsync({ id: deleteTarget.id });
      toast({ title: "Firma silindi" });
      invalidate();
      setDeleteTarget(null);
    } catch (err: any) {
      toast({
        title: "Hata",
        description: err?.response?.data?.error ?? "Silinemedi",
        variant: "destructive",
      });
    }
  }

  const isBusy = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Building2 className="h-6 w-6 text-teal-400" />
            <h1 className="text-2xl font-bold">Firma Yönetimi</h1>
            <span className="flex items-center gap-1 text-[11px] bg-amber-500/15 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded-full ml-1">
              <ShieldAlert className="h-3 w-3" />
              Sistem Yöneticisi
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            Sisteme kayıtlı tüm firmaları buradan yönetin. Bu panel yalnızca sistem yöneticisine görünür.
          </p>
        </div>
        <Button onClick={openCreate} className="gap-2">
          <Plus className="h-4 w-4" />
          Yeni Firma
        </Button>
      </div>

      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">ID</TableHead>
              <TableHead>Firma Adı</TableHead>
              <TableHead>Subdomain</TableHead>
              <TableHead>Durum</TableHead>
              <TableHead>Oluşturulma</TableHead>
              <TableHead className="text-right">İşlem</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-10 text-muted-foreground">
                  Yükleniyor...
                </TableCell>
              </TableRow>
            ) : (companies as Company[]).length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-10 text-muted-foreground">
                  Henüz firma kaydı yok.
                </TableCell>
              </TableRow>
            ) : (
              (companies as Company[]).map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="text-muted-foreground text-xs">{c.id}</TableCell>
                  <TableCell className="font-medium">
                    {c.name}
                    {c.id === 1 && (
                      <span className="ml-2 text-[10px] bg-teal-600/20 text-teal-400 border border-teal-600/30 px-1.5 py-0.5 rounded">
                        Varsayılan
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-sm text-muted-foreground">
                    {c.subdomain}
                  </TableCell>
                  <TableCell>
                    {c.isActive ? (
                      <Badge variant="outline" className="border-green-600/40 text-green-400 bg-green-600/10">
                        Aktif
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="border-red-600/40 text-red-400 bg-red-600/10">
                        Pasif
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(c.createdAt).toLocaleDateString("tr-TR")}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => openEdit(c)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        disabled={c.id === 1}
                        title={c.id === 1 ? "Varsayılan firma silinemez" : "Sil"}
                        onClick={() => setDeleteTarget(c)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editTarget ? "Firma Düzenle" : "Yeni Firma"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Firma Adı *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Örn: ABC Enerji A.Ş."
              />
            </div>
            <div className="space-y-1.5">
              <Label>Subdomain *</Label>
              <Input
                value={form.subdomain}
                onChange={(e) =>
                  setForm((f) => ({ ...f, subdomain: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") }))
                }
                placeholder="Örn: abc-enerji"
              />
              <p className="text-xs text-muted-foreground">Yalnızca küçük harf, rakam ve tire kullanın.</p>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                checked={form.isActive}
                onCheckedChange={(v) => setForm((f) => ({ ...f, isActive: v }))}
              />
              <Label>Firma Aktif</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>İptal</Button>
            <Button onClick={handleSave} disabled={isBusy}>
              {isBusy ? "Kaydediliyor..." : editTarget ? "Güncelle" : "Oluştur"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Firmayı Sil</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deleteTarget?.name}</strong> firmasını silmek istediğinize emin misiniz?
              Bu işlem geri alınamaz ve firmaya ait tüm veriler etkilenebilir.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>İptal</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Sil
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

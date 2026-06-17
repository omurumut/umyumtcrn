import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useListUnits, getListUnitsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Plus, Pencil, Trash2, User, ShieldCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

interface UserRecord { id: number; username: string; name: string; role: string; unitId: number | null; active: boolean; }
interface UserForm { username: string; password: string; name: string; role: string; unitId: string; active: boolean; }
const EMPTY: UserForm = { username: "", password: "", name: "", role: "user", unitId: "", active: true };

const API = (token: string | null, method: string, body?: unknown, id?: number) =>
  fetch(id ? `/api/users/${id}` : "/api/users", {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }).then(r => r.ok ? (r.status === 204 ? null : r.json()) : r.json().then((e: any) => { throw new Error(e.error); }));

export default function UsersTab({ unitFilter }: { unitFilter?: number }) {
  const { token } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<UserForm>(EMPTY);

  const { data: allUnits } = useListUnits({ query: { queryKey: getListUnitsQueryKey() } });
  const qKey = ["users"];
  const { data: allUsers, isLoading } = useQuery<UserRecord[]>({
    queryKey: qKey,
    queryFn: () => fetch("/api/users", { headers: token ? { Authorization: `Bearer ${token}` } : {} }).then(r => r.json()),
  });
  const users = unitFilter !== undefined
    ? (allUsers ?? []).filter(u => u.unitId === unitFilter || (u.role === "admin"))
    : allUsers;

  const createMut = useMutation({
    mutationFn: (d: UserForm) => API(token, "POST", { username: d.username, password: d.password, name: d.name, role: d.role, unitId: d.unitId || undefined }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: qKey }); setOpen(false); toast({ title: "Kullanıcı oluşturuldu" }); },
    onError: (e: any) => toast({ title: e.message, variant: "destructive" }),
  });
  const updateMut = useMutation({
    mutationFn: (d: UserForm) => API(token, "PATCH", { name: d.name, role: d.role, unitId: d.unitId || undefined, active: d.active, ...(d.password ? { password: d.password } : {}) }, editingId!),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: qKey }); setOpen(false); toast({ title: "Güncellendi" }); },
    onError: (e: any) => toast({ title: e.message, variant: "destructive" }),
  });
  const deleteMut = useMutation({
    mutationFn: (id: number) => API(token, "DELETE", undefined, id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: qKey }); toast({ title: "Kullanıcı silindi" }); },
    onError: (e: any) => toast({ title: e.message, variant: "destructive" }),
  });

  function openCreate() { setEditingId(null); setForm(EMPTY); setOpen(true); }
  function openEdit(u: UserRecord) { setEditingId(u.id); setForm({ username: u.username, password: "", name: u.name, role: u.role, unitId: u.unitId?.toString() ?? "", active: u.active }); setOpen(true); }
  function handleSave() {
    if (!form.name || (!editingId && !form.username) || (!editingId && !form.password)) {
      toast({ title: "Zorunlu alanlar eksik", variant: "destructive" }); return;
    }
    editingId ? updateMut.mutate(form) : createMut.mutate(form);
  }

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground">Sisteme erişecek kullanıcıları yönetin</p>
        <Button onClick={openCreate} className="gap-2"><Plus className="h-4 w-4" /> Kullanıcı Ekle</Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : (
        <div className="space-y-2">
          {(users ?? []).map(u => (
            <Card key={u.id} className="group">
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-full bg-secondary flex items-center justify-center">
                    {u.role === "admin" ? <ShieldCheck className="h-4 w-4 text-teal-400" /> : <User className="h-4 w-4 text-muted-foreground" />}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{u.name}</span>
                      <Badge variant="outline" className={`text-xs ${u.role === "admin" ? "text-teal-400 border-teal-500/30" : ""}`}>{u.role === "admin" ? "Yönetici" : "Kullanıcı"}</Badge>
                      {!u.active && <Badge variant="outline" className="text-xs text-muted-foreground">Pasif</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {u.username}
                      {u.unitId && allUnits && <span className="ml-2">• {(allUnits as any[]).find((un: any) => un.id === u.unitId)?.name ?? `Birim #${u.unitId}`}</span>}
                    </div>
                  </div>
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => openEdit(u)}><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => { if (confirm("Silinsin mi?")) deleteMut.mutate(u.id); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{editingId ? "Kullanıcı Düzenle" : "Yeni Kullanıcı"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Ad Soyad *</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="ör. Ahmet Yılmaz" />
            </div>
            {!editingId && (
              <div className="space-y-1.5">
                <Label>Kullanıcı Adı *</Label>
                <Input value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} placeholder="ör. ahmet.yilmaz" />
              </div>
            )}
            <div className="space-y-1.5">
              <Label>{editingId ? "Yeni Şifre (boş bırakılırsa değişmez)" : "Şifre *"}</Label>
              <Input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="••••••••" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Rol</Label>
                <Select value={form.role} onValueChange={v => setForm(f => ({ ...f, role: v, unitId: v === "admin" ? "" : f.unitId }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Yönetici</SelectItem>
                    <SelectItem value="user">Kullanıcı</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {form.role !== "admin" && (
                <div className="space-y-1.5">
                  <Label>Birim</Label>
                  <Select value={form.unitId} onValueChange={v => setForm(f => ({ ...f, unitId: v }))}>
                    <SelectTrigger><SelectValue placeholder="Birim seçin" /></SelectTrigger>
                    <SelectContent>{(allUnits ?? []).map((u: any) => <SelectItem key={u.id} value={u.id.toString()}>{u.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}
            </div>
            {editingId && (
              <div className="flex items-center gap-3">
                <Switch checked={form.active} onCheckedChange={v => setForm(f => ({ ...f, active: v }))} />
                <Label>{form.active ? "Aktif" : "Pasif"}</Label>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>İptal</Button>
            <Button onClick={handleSave} disabled={createMut.isPending || updateMut.isPending}>{editingId ? "Güncelle" : "Ekle"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

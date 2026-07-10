import { ReactNode, useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useYear } from "../context/YearContext";
import { useUnit } from "../context/UnitContext";
import { useCompany } from "../context/CompanyContext";
import { useAuth } from "../context/AuthContext";
import { useListUnits, getListUnitsQueryKey, useListCompanies, getListCompaniesQueryKey } from "@workspace/api-client-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton,
  SidebarMenuBadge, SidebarMenuItem, SidebarProvider,
} from "@/components/ui/sidebar";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Activity, AlertTriangle, BarChart2, Building2, FileText,
  ClipboardList, Gauge, Home, LayoutDashboard, Lightbulb, ShieldAlert, Target, User, LogOut, Globe, Building, Layers, Variable, TrendingUp, Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const ADMIN_NAV = [
  {
    title: "Veri Yönetimi",
    items: [
      { title: "Birim Yönetimi", url: "/birimler", icon: Building2 },
      { title: "Enerji Kullanım Grupları", url: "/enerji-kullanim-gruplari", icon: Layers },
      { title: "Sayaç Yönetimi", url: "/sayaclar", icon: Gauge },
      { title: "Tüketim Verileri", url: "/tuketim", icon: Activity },
      { title: "Değişken Yönetimi", url: "/degiskenler", icon: Variable },
    ],
  },
];

const USER_NAV = [
  {
    title: "Veri Yönetimi",
    items: [
      { title: "Birim Yönetimi", url: "/birimler", icon: Building2 },
      { title: "Enerji Kullanım Grupları", url: "/enerji-kullanim-gruplari", icon: Layers },
      { title: "Sayaç Yönetimi", url: "/sayaclar", icon: Gauge },
      { title: "Tüketim Verileri", url: "/tuketim", icon: Activity },
      { title: "Değişken Yönetimi", url: "/degiskenler", icon: Variable },
    ],
  },
];

const COMMON_NAV = [
  {
    title: "ISO 50001",
    items: [
      { title: "Enerji Hedefleri", url: "/hedefler", icon: Target },
      { title: "Verimlilik Artırıcı Projeler", url: "/vap-projeler", icon: Zap },
      { title: "SWOT Analizi", url: "/swot", icon: Target },
      { title: "Risk & Fırsat", url: "/riskler", icon: ShieldAlert },
      { title: "Önemli Enerji Kullanımları", url: "/oek", icon: AlertTriangle },
      { title: "Performans Göstergeleri", url: "/performans-gostergeleri", icon: TrendingUp },
      { title: "Enerji Gözden Geçirme", url: "/enerji-gozden-gecirme", icon: BarChart2 },
    ],
  },
  {
    title: "Raporlar & Sistem",
    items: [
      { title: "AI Önerileri", url: "/oneriler", icon: Lightbulb },
      { title: "Raporlar", url: "/raporlar", icon: FileText },
    ],
  },
];

interface PendingWorkItemCountRecord {
  severity?: string;
}

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { year, setYear } = useYear();
  const { unitId, setUnitId } = useUnit();
  const { companyId, setCompanyId } = useCompany();
  const { user, token, logout } = useAuth();
  const [pendingWorkItemCount, setPendingWorkItemCount] = useState<number | null>(null);

  const isSuperAdmin = user?.role === "superadmin";
  const isCompanyAdmin = user?.role === "admin" || user?.role === "kontrol_admin";
  const isAdmin = isCompanyAdmin || isSuperAdmin;
  const isStandardUser = user?.role === "user";

  const { data: companies } = useListCompanies({ query: { queryKey: getListCompaniesQueryKey(), enabled: isSuperAdmin } });

  const unitsParams = isSuperAdmin && companyId ? { companyId } : {};
  const { data: units } = useListUnits(
    unitsParams as any,
    { query: { queryKey: [...getListUnitsQueryKey(), companyId] } }
  );
  const years = Array.from({ length: 10 }, (_, i) => new Date().getFullYear() - i);
  const topNavItems = isAdmin ? ADMIN_NAV : USER_NAV;
  const navItems = [...topNavItems, ...COMMON_NAV];

  useEffect(() => {
    if (!token || !isStandardUser) {
      setPendingWorkItemCount(null);
      return;
    }

    const controller = new AbortController();
    const params = new URLSearchParams({ year: String(year) });

    fetch(`/api/pending-work-items?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<PendingWorkItemCountRecord[]>;
      })
      .then((items) => {
        const visibleCount = items.filter((item) => item.severity === "critical" || item.severity === "warning").length;
        setPendingWorkItemCount(visibleCount);
      })
      .catch((err) => {
        if (err?.name !== "AbortError") setPendingWorkItemCount(null);
      });

    return () => controller.abort();
  }, [isStandardUser, token, year]);

  const effectiveUnitName = isAdmin
    ? (unitId !== null ? units?.find((u: any) => u.id === unitId)?.name : "Tüm Birimler")
    : (user?.unitId ? units?.find((u: any) => u.id === user.unitId)?.name : "");

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background dark text-foreground">
        <Sidebar variant="sidebar" className="border-r border-sidebar-border bg-sidebar">
          <SidebarHeader className="border-b border-sidebar-border p-4">
            <Link href="/" className="flex items-center gap-2 font-bold text-lg text-sidebar-primary">
              <Activity className="h-6 w-6" />
              <span>Enerji Yönetimi</span>
            </Link>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={location === "/"}>
                      <Link href="/"><Home className="h-4 w-4" /><span>Anasayfa</span></Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  {!isSuperAdmin && (
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        asChild
                        isActive={location === "/bekleyen-isler"}
                        className={isStandardUser && pendingWorkItemCount ? "pr-8" : undefined}
                      >
                        <Link href="/bekleyen-isler">
                          <ClipboardList className="h-4 w-4" />
                          <span>Bekleyen İşler</span>
                        </Link>
                      </SidebarMenuButton>
                      {isStandardUser && pendingWorkItemCount !== null && pendingWorkItemCount > 0 && (
                        <SidebarMenuBadge className="bg-red-500/20 text-red-400 border border-red-500/30">
                          {pendingWorkItemCount > 99 ? "99+" : pendingWorkItemCount}
                        </SidebarMenuBadge>
                      )}
                    </SidebarMenuItem>
                  )}
                  {isAdmin && (
                    <SidebarMenuItem>
                      <SidebarMenuButton asChild isActive={location === "/ozet"}>
                        <Link href="/ozet"><LayoutDashboard className="h-4 w-4" /><span>Çok Birimli Özet</span></Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )}
                  {isSuperAdmin && (
                    <SidebarMenuItem>
                      <SidebarMenuButton asChild isActive={location === "/firmalar"}>
                        <Link href="/firmalar"><Globe className="h-4 w-4" /><span>Firma Yönetimi</span></Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            {navItems.map((group) => (
              <SidebarGroup key={group.title}>
                <SidebarGroupLabel>{group.title}</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {group.items.map((item) => (
                      <SidebarMenuItem key={item.title}>
                        <SidebarMenuButton asChild isActive={location === item.url}>
                          <Link href={item.url}>
                            <item.icon className="h-4 w-4" />
                            <span>{item.title}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            ))}
          </SidebarContent>
          <SidebarFooter className="border-t border-sidebar-border p-4 space-y-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="w-full justify-start gap-2 h-9 px-2">
                  <div className="h-6 w-6 rounded-full bg-teal-600/30 flex items-center justify-center shrink-0">
                    <User className="h-3.5 w-3.5 text-teal-400" />
                  </div>
                  <div className="flex-1 text-left min-w-0">
                    <div className="text-xs font-medium truncate">{user?.name}</div>
                    <div className="text-[10px] text-muted-foreground">
                    {isSuperAdmin ? "Sistem Yöneticisi" : isAdmin ? "Yönetici" : "Kullanıcı"}
                  </div>
                  </div>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-48">
                <DropdownMenuItem disabled>
                  <User className="h-3.5 w-3.5 mr-2" />
                  {user?.username}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={logout} className="text-destructive">
                  <LogOut className="h-3.5 w-3.5 mr-2" />
                  Çıkış Yap
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarFooter>
        </Sidebar>

        <main className="flex-1 flex flex-col min-w-0">
          <header className="h-16 border-b bg-card px-6 flex items-center justify-between shrink-0">
            <div className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <span>ISO 50001 EnYS</span>
              {effectiveUnitName && (
                <span className="text-xs bg-teal-600/20 text-teal-400 border border-teal-600/30 px-2 py-0.5 rounded-full">
                  {effectiveUnitName}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              {isSuperAdmin && (
                <Select
                  value={companyId !== null ? companyId.toString() : "0"}
                  onValueChange={(val) => {
                    setCompanyId(val === "0" ? null : parseInt(val));
                    setUnitId(null);
                  }}
                >
                  <SelectTrigger className="w-48 bg-background">
                    <Building className="h-3.5 w-3.5 text-muted-foreground mr-1" />
                    <SelectValue placeholder="Firma Seç" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">Tüm Firmalar</SelectItem>
                    {(companies ?? []).map((c: any) => (
                      <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {isAdmin && (
                <Select
                  value={unitId !== null ? unitId.toString() : "0"}
                  onValueChange={(val) => setUnitId(val === "0" ? null : parseInt(val))}
                >
                  <SelectTrigger className="w-48 bg-background">
                    <Building2 className="h-3.5 w-3.5 text-muted-foreground mr-1" />
                    <SelectValue placeholder="Birim Seç" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">Tüm Birimler</SelectItem>
                    {(units ?? []).map((u: any) => (
                      <SelectItem key={u.id} value={u.id.toString()}>{u.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Select
                value={year.toString()}
                onValueChange={(val) => setYear(parseInt(val, 10))}
              >
                <SelectTrigger className="w-32 bg-background">
                  <SelectValue placeholder="Yıl Seçin" />
                </SelectTrigger>
                <SelectContent>
                  {years.map((y) => (
                    <SelectItem key={y} value={y.toString()}>{y} Yılı</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </header>
          <div className="flex-1 p-6 overflow-auto">
            {children}
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}

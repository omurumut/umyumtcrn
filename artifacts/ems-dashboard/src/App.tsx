import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider, QueryCache } from "@tanstack/react-query";
import { useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { YearProvider } from "@/context/YearContext";
import { UnitProvider } from "@/context/UnitContext";
import { CompanyProvider } from "@/context/CompanyContext";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { Layout } from "@/components/Layout";
import NotFound from "@/pages/not-found";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Meters from "@/pages/Meters";
import Equipment from "@/pages/Equipment";
import Consumption from "@/pages/Consumption";
import Swot from "@/pages/Swot";
import Risks from "@/pages/Risks";
import Seu from "@/pages/Seu";
import AiSuggestions from "@/pages/AiSuggestions";
import Reports from "@/pages/Reports";
import Units from "@/pages/Units";
import Summary from "@/pages/Summary";
import Targets from "@/pages/Targets";
import Companies from "@/pages/Companies";
import CompanySettings from "@/pages/CompanySettings";
import EnergyUseGroups from "@/pages/EnergyUseGroups";
import Variables from "@/pages/Variables";
import EnergyPerformance from "@/pages/EnergyPerformance";
import VapProjects from "@/pages/VapProjects";
import EnergyReview from "@/pages/EnergyReview";
import PendingWorkItems from "@/pages/PendingWorkItems";
import AuditEvents from "@/pages/AuditEvents";
import AiOperations from "@/pages/AiOperations";

const logoutRef = { fn: () => {} };

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error: unknown) => {
      if ((error as any)?.status === 401) {
        logoutRef.fn();
      }
    },
  }),
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => (error as any)?.status === 401 ? false : failureCount < 1,
      staleTime: 30_000,
    },
  },
});

function AdminRoute({ component: Component }: { component: React.ComponentType }) {
  const { user } = useAuth();
  if (user?.role !== "admin" && user?.role !== "kontrol_admin" && user?.role !== "superadmin") return <Redirect to="/" />;
  return <Component />;
}

function SuperAdminRoute({ component: Component }: { component: React.ComponentType }) {
  const { user } = useAuth();
  if (user?.role !== "superadmin") return <Redirect to="/" />;
  return <Component />;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/ozet">
        {() => <AdminRoute component={Summary} />}
      </Route>
      <Route path="/birimler" component={Units} />
      <Route path="/enerji-kullanim-gruplari" component={EnergyUseGroups} />
      <Route path="/sayaclar" component={Meters} />
      <Route path="/equipment" component={Equipment} />
      <Route path="/tuketim" component={Consumption} />
      <Route path="/meteoroloji">{() => <Redirect to="/" />}</Route>
      <Route path="/analiz">{() => <Redirect to="/" />}</Route>
      <Route path="/swot" component={Swot} />
      <Route path="/riskler" component={Risks} />
      <Route path="/oek" component={Seu} />
      <Route path="/oneriler" component={AiSuggestions} />
      <Route path="/raporlar" component={Reports} />
      <Route path="/hedefler" component={Targets} />
      <Route path="/vap-projeler" component={VapProjects} />
      <Route path="/bekleyen-isler" component={PendingWorkItems} />
      <Route path="/audit">
        {() => <AdminRoute component={AuditEvents} />}
      </Route>
      <Route path="/admin/ai-operations">
        {() => <AdminRoute component={AiOperations} />}
      </Route>
      <Route path="/firmalar">
        {() => <SuperAdminRoute component={Companies} />}
      </Route>
      <Route path="/firma-ayarlari">
        {() => <AdminRoute component={CompanySettings} />}
      </Route>
      <Route path="/degiskenler" component={Variables} />
      <Route path="/performans-gostergeleri" component={EnergyPerformance} />
      <Route path="/enerji-gozden-gecirme" component={EnergyReview} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AppInner() {
  const { user, isLoading, logout } = useAuth();

  useEffect(() => {
    logoutRef.fn = logout;
  }, [logout]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background dark text-foreground flex items-center justify-center">
        <div className="text-muted-foreground text-sm">Yükleniyor...</div>
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  return (
    <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
      <Layout>
        <Router />
      </Layout>
    </WouterRouter>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <YearProvider>
            <CompanyProvider>
              <UnitProvider>
                <AppInner />
              </UnitProvider>
            </CompanyProvider>
          </YearProvider>
        </AuthProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;

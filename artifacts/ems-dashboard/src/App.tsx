import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider, QueryCache } from "@tanstack/react-query";
import { useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { YearProvider } from "@/context/YearContext";
import { UnitProvider } from "@/context/UnitContext";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { Layout } from "@/components/Layout";
import NotFound from "@/pages/not-found";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Meters from "@/pages/Meters";
import Consumption from "@/pages/Consumption";
import Weather from "@/pages/Weather";
import Analysis from "@/pages/Analysis";
import Swot from "@/pages/Swot";
import Risks from "@/pages/Risks";
import Seu from "@/pages/Seu";
import AiSuggestions from "@/pages/AiSuggestions";
import Reports from "@/pages/Reports";
import Units from "@/pages/Units";
import Summary from "@/pages/Summary";
import Targets from "@/pages/Targets";

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
  if (user?.role !== "admin") return <Redirect to="/" />;
  return <Component />;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/ozet">
        {() => <AdminRoute component={Summary} />}
      </Route>
      <Route path="/birimler" component={Units} />
      <Route path="/sayaclar" component={Meters} />
      <Route path="/tuketim" component={Consumption} />
      <Route path="/meteoroloji" component={Weather} />
      <Route path="/analiz" component={Analysis} />
      <Route path="/swot" component={Swot} />
      <Route path="/riskler" component={Risks} />
      <Route path="/oek" component={Seu} />
      <Route path="/oneriler" component={AiSuggestions} />
      <Route path="/raporlar" component={Reports} />
      <Route path="/hedefler" component={Targets} />
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
            <UnitProvider>
              <AppInner />
            </UnitProvider>
          </YearProvider>
        </AuthProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;

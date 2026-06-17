import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { useAuth } from "./AuthContext";

interface UnitContextType {
  unitId: number | null;
  setUnitId: (id: number | null) => void;
}

const UnitContext = createContext<UnitContextType | undefined>(undefined);

export function UnitProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [unitId, setUnitIdState] = useState<number | null>(null);

  useEffect(() => {
    if (user?.role === "user" && user.unitId !== null) {
      setUnitIdState(user.unitId);
    } else if (user?.role === "admin") {
      setUnitIdState(null);
    }
  }, [user]);

  function setUnitId(id: number | null) {
    if (user?.role !== "admin") return;
    setUnitIdState(id);
  }

  return (
    <UnitContext.Provider value={{ unitId, setUnitId }}>
      {children}
    </UnitContext.Provider>
  );
}

export function useUnit() {
  const ctx = useContext(UnitContext);
  if (ctx === undefined) throw new Error("useUnit must be used within a UnitProvider");
  return ctx;
}

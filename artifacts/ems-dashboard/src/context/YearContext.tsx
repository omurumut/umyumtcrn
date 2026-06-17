import { createContext, useContext, useState, ReactNode } from "react";

interface YearContextType {
  year: number;
  setYear: (year: number) => void;
}

const YearContext = createContext<YearContextType | undefined>(undefined);

export function YearProvider({ children }: { children: ReactNode }) {
  const [year, setYear] = useState<number>(new Date().getFullYear());

  return (
    <YearContext.Provider value={{ year, setYear }}>
      {children}
    </YearContext.Provider>
  );
}

export function useYear() {
  const context = useContext(YearContext);
  if (context === undefined) {
    throw new Error("useYear must be used within a YearProvider");
  }
  return context;
}

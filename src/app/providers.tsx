"use client";

import { LayoutProvider } from "@/layout/context/layoutcontext";
import { PrimeReactProvider } from "primereact/api";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <PrimeReactProvider>
      <LayoutProvider>{children}</LayoutProvider>
    </PrimeReactProvider>
  );
}

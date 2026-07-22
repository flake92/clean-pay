"use client";

import Layout from "@/frontend/layout/layout";

export function AppShell({ children }: { children: React.ReactNode }) {
  return <Layout>{children}</Layout>;
}

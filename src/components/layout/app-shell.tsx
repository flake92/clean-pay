"use client";

import Layout from "@/layout/layout";

export function AppShell({ children }: { children: React.ReactNode }) {
  return <Layout>{children}</Layout>;
}

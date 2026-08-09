import { loadNavigationShell } from "@/application/navigation/load-navigation";
import { requestAuthProfileGateway } from "@/app/_composition/request-scoped-readers";
import Layout from "@/frontend/layout/layout";
import { redirect } from "next/navigation";

export async function AppShell({
  children,
  requireAuth = false,
}: {
  children: React.ReactNode;
  requireAuth?: boolean;
}) {
  const navigation = await loadNavigationShell(requestAuthProfileGateway);
  if (requireAuth && !navigation.authenticated) redirect("/login");
  return <Layout navigation={navigation}>{children}</Layout>;
}

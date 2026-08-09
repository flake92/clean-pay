import { loadNavigationShell } from "@/application/navigation/load-navigation";
import { requestAuthProfileGateway } from "@/app/_composition/request-scoped-readers";
import Layout from "@/frontend/layout/layout";

export async function AppShell({ children }: { children: React.ReactNode }) {
  const navigation = await loadNavigationShell(requestAuthProfileGateway);
  return <Layout navigation={navigation}>{children}</Layout>;
}

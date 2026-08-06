import { loadNavigation } from "@/backend/application/navigation/load-navigation";
import { productionNavigationReader } from "@/backend/integrations/navigation/navigation-reader";
import Layout from "@/frontend/layout/layout";

export async function AppShell({ children }: { children: React.ReactNode }) {
  const navigation = await loadNavigation(productionNavigationReader);
  return <Layout navigation={navigation}>{children}</Layout>;
}

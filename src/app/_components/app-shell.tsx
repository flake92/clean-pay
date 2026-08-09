import { loadNavigation } from "@/application/navigation/load-navigation";
import { productionNavigationReader } from "@/backend/integrations/navigation/navigation-reader";
import { productionAuthProfileGateway } from "@/backend/integrations/auth/auth-profile-gateway";
import Layout from "@/frontend/layout/layout";

export async function AppShell({ children }: { children: React.ReactNode }) {
  const navigation = await loadNavigation(productionNavigationReader, productionAuthProfileGateway);
  return <Layout navigation={navigation}>{children}</Layout>;
}

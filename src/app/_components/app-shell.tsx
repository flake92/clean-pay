import { loadNavigationShell } from "@/application/navigation/load-navigation";
import { requestAuthProfileGateway } from "@/app/_composition/request-scoped-readers";
import { createChatwootWidgetConfig } from "@/backend/integrations/support/chatwoot-widget";
import {
  ChatwootGuestBoundary,
  ChatwootWidget,
} from "@/frontend/components/chatwoot-widget";
import Layout from "@/frontend/layout/layout";
import { sessionRefreshPath } from "@/shared/auth/session-navigation";
import { redirect } from "next/navigation";

export async function AppShell({
  children,
  requireAuth = false,
  returnTo = "/cabinet",
}: {
  children: React.ReactNode;
  requireAuth?: boolean;
  returnTo?: string;
}) {
  const shell = await loadNavigationShell(requestAuthProfileGateway);
  if (requireAuth && !shell.navigation.authenticated) {
    redirect(sessionRefreshPath(returnTo));
  }
  const chatwoot = createChatwootWidgetConfig(shell.supportIdentity);

  return (
    <>
      <Layout navigation={shell.navigation}>{children}</Layout>
      {chatwoot ? <ChatwootWidget config={chatwoot} /> : <ChatwootGuestBoundary />}
    </>
  );
}

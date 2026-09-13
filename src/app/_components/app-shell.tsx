import { loadNavigationShell } from "@/application/navigation/load-navigation";
import { requestAuthProfileGateway } from "@/app/_composition/request-scoped-readers";
import { createChatwootWidgetConfig } from "@/app/_composition/support-runtime";
import {
  SupportChatGuestBoundary,
  SupportChatRuntime,
} from "@/frontend/components/chatwoot-widget";
import { SupportChatSessionBoundary } from "@/frontend/components/chatwoot-session-context";
import Layout from "@/frontend/layout/layout";
import { sessionRefreshPath } from "@/shared/auth/session-navigation";
import { redirect } from "next/navigation";
import { connection } from "next/server";

export async function AppShell({
  children,
  requireAuth = false,
  returnTo = "/cabinet",
}: {
  children: React.ReactNode;
  requireAuth?: boolean;
  returnTo?: string;
}) {
  // Session-backed shells are request-scoped and must never be evaluated by
  // the static prerender worker, where request APIs intentionally bail out.
  await connection();
  const shell = await loadNavigationShell(requestAuthProfileGateway);
  if (requireAuth && !shell.navigation.authenticated) {
    redirect(sessionRefreshPath(returnTo));
  }
  const chatwoot = createChatwootWidgetConfig(shell.supportIdentity);

  return (
    <SupportChatSessionBoundary
      authenticated={shell.navigation.authenticated}
      chatwootConfig={chatwoot}
    >
      <Layout navigation={shell.navigation}>{children}</Layout>
      {chatwoot ? <SupportChatRuntime config={chatwoot} /> : <SupportChatGuestBoundary />}
    </SupportChatSessionBoundary>
  );
}

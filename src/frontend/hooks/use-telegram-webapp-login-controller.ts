import { useEffect, useState } from "react";

import { authenticateTelegramWebAppAction as authenticateTelegramWebAppActionDependency } from "@/app/actions/telegram";
import {
  getTelegramWebApp,
  loadTelegramWebAppScript,
  markTelegramWebAppSession,
} from "@/frontend/lib/telegram-webapp";
import {
  normalizeTelegramWebAppInitData,
  telegramWebAppFallbackUrl,
  telegramWebAppLoginErrorMessage,
} from "@/frontend/lib/telegram-webapp-login-transitions";

export type TelegramWebAppLoginControllerDependencies = {
  authenticateTelegramWebAppAction: typeof authenticateTelegramWebAppActionDependency;
  getLocationOrigin: () => string;
  getTelegramWebApp: typeof getTelegramWebApp;
  loadTelegramWebAppScript: typeof loadTelegramWebAppScript;
  markTelegramWebAppSession: typeof markTelegramWebAppSession;
  replaceLocation: (destination: string) => void;
};

export const telegramWebAppLoginComposition = {
  authenticateTelegramWebAppAction: authenticateTelegramWebAppActionDependency,
  getLocationOrigin: () => window.location.origin,
  getTelegramWebApp,
  loadTelegramWebAppScript,
  markTelegramWebAppSession,
  replaceLocation: (redirectTo: string) => window.location.replace(redirectTo),
};

function authenticateTelegramWebAppAction(initData: string) {
  return telegramWebAppLoginComposition.authenticateTelegramWebAppAction(initData);
}

function replaceLocation(redirectTo: string) {
  telegramWebAppLoginComposition.replaceLocation(redirectTo);
}

const productionTelegramWebAppLoginDependencies: TelegramWebAppLoginControllerDependencies = {
  authenticateTelegramWebAppAction,
  getLocationOrigin: telegramWebAppLoginComposition.getLocationOrigin,
  getTelegramWebApp: telegramWebAppLoginComposition.getTelegramWebApp,
  loadTelegramWebAppScript:
    telegramWebAppLoginComposition.loadTelegramWebAppScript,
  markTelegramWebAppSession:
    telegramWebAppLoginComposition.markTelegramWebAppSession,
  replaceLocation,
};

export function useTelegramWebAppLoginController({
  dependencies = productionTelegramWebAppLoginDependencies,
  redirectTo,
}: {
  dependencies?: TelegramWebAppLoginControllerDependencies;
  redirectTo: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [fallbackStarted, setFallbackStarted] = useState(false);

  useEffect(() => {
    let alive = true;

    async function login() {
      try {
        await dependencies.loadTelegramWebAppScript();

        const webApp = dependencies.getTelegramWebApp();
        webApp?.ready?.();
        webApp?.expand?.();

        const initData = normalizeTelegramWebAppInitData(webApp?.initData);

        if (!initData) {
          setFallbackStarted(true);
          dependencies.replaceLocation(telegramWebAppFallbackUrl(
            dependencies.getLocationOrigin(),
            redirectTo,
          ));
          return;
        }

        dependencies.markTelegramWebAppSession();

        const result = await dependencies.authenticateTelegramWebAppAction(
          initData,
        );
        if (!result.ok) throw new Error(result.message);
        dependencies.replaceLocation(redirectTo);
      } catch (nextError) {
        if (alive) {
          setError(telegramWebAppLoginErrorMessage(nextError));
        }
      }
    }

    void login();

    return () => {
      alive = false;
    };
  }, [dependencies, redirectTo]);

  return { error, fallbackStarted };
}

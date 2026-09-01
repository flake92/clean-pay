type PasskeyLoginFailure = {
  code: string;
  message: string;
  ok: false;
};

type PasskeyLoginStartResult<Options> =
  | PasskeyLoginFailure
  | { ok: true; options: Options };

type PasskeyLoginVerificationResult =
  | PasskeyLoginFailure
  | { ok: true };

export type PasskeyLoginOrchestratorDependencies<Options, Assertion> = {
  beginLogin(input: {
    email: string;
    turnstileToken?: string;
  }): Promise<PasskeyLoginStartResult<Options>>;
  navigate(destination: string): void;
  resetTurnstile?: () => void;
  startAuthentication(input: { optionsJSON: Options }): Promise<Assertion>;
  verifyLogin(assertion: Assertion): Promise<PasskeyLoginVerificationResult>;
};

export async function executePasskeyLogin<Options, Assertion>({
  dependencies,
  destination,
  email,
  turnstileToken,
}: {
  dependencies: PasskeyLoginOrchestratorDependencies<Options, Assertion>;
  destination: string;
  email: string;
  turnstileToken: string | null;
}): Promise<PasskeyLoginVerificationResult> {
  const optionsResult = await dependencies.beginLogin({
    email,
    ...(turnstileToken ? { turnstileToken } : {}),
  });
  dependencies.resetTurnstile?.();

  if (!optionsResult.ok) {
    return optionsResult;
  }

  const assertion = await dependencies.startAuthentication({
    optionsJSON: optionsResult.options,
  });
  const verificationResult = await dependencies.verifyLogin(assertion);

  if (!verificationResult.ok) {
    return verificationResult;
  }

  dependencies.navigate(destination);
  return verificationResult;
}

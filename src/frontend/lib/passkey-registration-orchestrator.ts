type PasskeyRegistrationFailure = {
  message: string;
  ok: false;
};

type PasskeyRegistrationStartResult<Options> =
  | PasskeyRegistrationFailure
  | { ok: true; options: Options };

type PasskeyRegistrationVerificationResult =
  | PasskeyRegistrationFailure
  | { ok: true };

export type PasskeyRegistrationOrchestratorDependencies<
  Options,
  Attestation extends object,
> = {
  beginRegistration(): Promise<PasskeyRegistrationStartResult<Options>>;
  navigateTo(destination: string): void;
  startRegistration(input: { optionsJSON: Options }): Promise<Attestation>;
  supportsWebAuthn(): boolean;
  verifyRegistration(
    response: Attestation & { name?: string },
  ): Promise<PasskeyRegistrationVerificationResult>;
};

export async function executePasskeyRegistration<
  Options,
  Attestation extends object,
>({
  dependencies,
  destination,
  name,
  unsupportedMessage,
}: {
  dependencies: PasskeyRegistrationOrchestratorDependencies<Options, Attestation>;
  destination: string;
  name: string;
  unsupportedMessage: string;
}): Promise<PasskeyRegistrationVerificationResult> {
  if (!dependencies.supportsWebAuthn()) {
    return { ok: false, message: unsupportedMessage };
  }

  const optionsResult = await dependencies.beginRegistration();
  if (!optionsResult.ok) {
    return optionsResult;
  }

  const attestation = await dependencies.startRegistration({
    optionsJSON: optionsResult.options,
  });
  const verificationResult = await dependencies.verifyRegistration({
    ...attestation,
    name: name.trim() || undefined,
  });
  if (!verificationResult.ok) {
    return verificationResult;
  }

  dependencies.navigateTo(destination);
  return verificationResult;
}

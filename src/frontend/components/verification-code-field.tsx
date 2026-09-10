import { InputText } from "primereact/inputtext";

/**
 * The six-digit e-mail confirmation input, shared by the registration and the
 * standalone verification form. Both stated the same constraints separately,
 * so a change to the code length or the numeric keypad hint had to be made in
 * two places to stay consistent.
 */
export function VerificationCodeField({ label = "Код подтверждения" }: { label?: string }) {
  return (
    <label className="flex flex-column gap-2">
      <span className="text-sm font-medium text-700">{label}</span>
      <InputText
        inputMode="numeric"
        maxLength={6}
        minLength={6}
        name="code"
        pattern="[0-9]{6}"
        placeholder="000000"
        required
      />
    </label>
  );
}

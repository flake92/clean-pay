import {
  Button,
  InputText,
} from "@/frontend/components/sakai/form-foundation";

type VerifyEmailCodeFieldsProps = {
  loading: string | null;
};

export function VerifyEmailCodeFields({
  loading,
}: VerifyEmailCodeFieldsProps) {
  return (
    <>
      <label className="flex flex-column gap-2">
        <span className="text-sm font-medium text-700">Код подтверждения</span>
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
      <Button
        disabled={loading !== null}
        label="Подтвердить e-mail"
        loading={loading === "confirm"}
        type="submit"
      />
    </>
  );
}

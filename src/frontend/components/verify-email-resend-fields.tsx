import {
  Button,
  InputText,
} from "@/frontend/components/sakai/form-foundation";

type VerifyEmailResendFieldsProps = {
  loading: string | null;
};

export function VerifyEmailResendFields({
  loading,
}: VerifyEmailResendFieldsProps) {
  return (
    <>
      <label className="flex flex-column gap-2">
        <span className="text-sm font-medium text-700">E-mail</span>
        <InputText name="email" placeholder="user@example.com" type="email" />
      </label>
      <Button
        disabled={loading !== null}
        label="Отправить код повторно"
        loading={loading === "request"}
        severity="info"
        type="submit"
      />
    </>
  );
}

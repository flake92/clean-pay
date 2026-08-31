import {
  Button,
  InputText,
} from "@/frontend/components/sakai/form-foundation";

export function CabinetPromocodeFields({
  disabled,
  loading,
  onValueChange,
  value,
}: {
  disabled: boolean;
  loading: boolean;
  onValueChange: (value: string) => void;
  value: string;
}) {
  return (
    <>
      <label className="text-sm font-medium text-700" htmlFor="promocode">
        Введите промокод
      </label>
      <div className="p-inputgroup">
        <InputText
          id="promocode"
          onChange={(event) => onValueChange(event.target.value)}
          placeholder="Введите код"
          value={value}
        />
        <Button
          disabled={disabled}
          label="Активировать"
          loading={loading}
          type="submit"
        />
      </div>
    </>
  );
}

import { describe, expect, test } from "vitest";

import { Button as PrimeButton } from "primereact/button";
import { Dropdown as PrimeDropdown } from "primereact/dropdown";
import { InputText as PrimeInputText } from "primereact/inputtext";
import { Message as PrimeMessage } from "primereact/message";
import { Password as PrimePassword } from "primereact/password";

import {
  Button,
  Dropdown,
  InputText,
  Message,
  Password,
} from "@/frontend/components/sakai/form-foundation";

describe("Sakai form foundation", () => {
  test("keeps the exact PrimeReact control implementations", () => {
    expect(Button).toBe(PrimeButton);
    expect(Dropdown).toBe(PrimeDropdown);
    expect(InputText).toBe(PrimeInputText);
    expect(Message).toBe(PrimeMessage);
    expect(Password).toBe(PrimePassword);
  });
});

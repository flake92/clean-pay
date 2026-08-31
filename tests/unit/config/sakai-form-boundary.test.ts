import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "vitest";

const sourceRoot = path.join(process.cwd(), "src");
const foundationPath = "frontend/components/sakai/form-foundation.tsx";
const expectedFormOwners = [
  "frontend/components/auth-forms.tsx",
  "frontend/components/cabinet-panel.tsx",
  "frontend/components/link-account-panel.tsx",
  "frontend/components/profile-panel.tsx",
  "frontend/components/register-email-confirm-form.tsx",
  "frontend/components/verify-email-panel.tsx",
];
const directPrimeFormControl = /from\s+["']primereact\/(?:button|calendar|checkbox|dropdown|inputmask|inputnumber|inputswitch|inputtext|message|multiselect|password|radiobutton|selectbutton|textarea)["']/;

async function sourceFiles(directory = sourceRoot): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [target] : [];
  }));
  return nested.flat();
}

test("routes every form and PrimeReact form control through the Sakai foundation", async () => {
  const nativeFormOwners: string[] = [];
  const directPrimeControlOwners: string[] = [];

  for (const file of await sourceFiles()) {
    const relative = path.relative(sourceRoot, file).replaceAll(path.sep, "/");
    const source = await readFile(file, "utf8");
    if (relative === foundationPath) continue;
    if (/<\/?form\b/.test(source)) {
      nativeFormOwners.push(relative);
      expect(source).toContain(
        'from "@/frontend/components/sakai/form-foundation"',
      );
    }
    if (directPrimeFormControl.test(source)) directPrimeControlOwners.push(relative);
  }

  expect(nativeFormOwners.sort()).toEqual(expectedFormOwners);
  expect(directPrimeControlOwners).toEqual([]);
});

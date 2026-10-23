import { existsSync } from "node:fs";
import { join } from "node:path";

// Owner brand files live in public/brand/. git ignores the directory, so menu
// updates (which require a clean checkout) keep it, and the image build copies
// it with the rest of public/. Every file is optional: a missing one falls back
// to the bundled Clean Pay asset.
const BRAND_DIRECTORY = join(process.cwd(), "public", "brand");

function brandFile(fileName: string) {
  return existsSync(join(BRAND_DIRECTORY, fileName)) ? `/brand/${fileName}` : null;
}

export function brandIcons() {
  const apple = brandFile("apple-touch-icon.png");
  return {
    favicon: brandFile("favicon.ico") ?? "/favicon.ico",
    faviconSvg: brandFile("favicon.svg"),
    apple: apple
      ? { url: apple, sizes: "180x180" }
      : { url: "/clean-pay-icon-192.png?v=3", sizes: "192x192" },
    icon192: brandFile("icon-192.png") ?? "/clean-pay-icon-192.png",
    icon512: brandFile("icon-512.png") ?? "/clean-pay-icon-512.png",
    maskable512: brandFile("icon-maskable-512.png") ?? "/clean-pay-icon-maskable-512.png",
  };
}

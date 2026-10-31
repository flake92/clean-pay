import type { Metadata, Viewport } from "next";
import "primereact/resources/primereact.css";
import "primeicons/primeicons.css";
import "primeflex/primeflex.css";
import "../../public/themes/lara-light-indigo/theme.css";
import "../frontend/styles/layout/layout.scss";
import "./globals.css";
import "../frontend/styles/visual.css";
import "../frontend/styles/dark.css";
import { Providers } from "./providers";
import { brandIcons } from "./_composition/brand-assets";
import { getBranding } from "@/shared/branding";

const branding = getBranding();
const icons = brandIcons();

export const metadata: Metadata = {
  title: branding.name,
  description: `${branding.name} payment and subscription cabinet`,
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: branding.name,
  },
  icons: {
    icon: [
      { url: icons.favicon, sizes: "any" },
      ...(icons.faviconSvg ? [{ url: icons.faviconSvg, type: "image/svg+xml" }] : []),
    ],
    apple: [{ ...icons.apple, type: "image/png" }],
  },
};

// Colors the iOS status bar of the installed app to match the page.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f7ff" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1020" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

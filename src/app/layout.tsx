import type { Metadata } from "next";
import "primereact/resources/primereact.css";
import "primeicons/primeicons.css";
import "primeflex/primeflex.css";
import "../../public/themes/lara-light-indigo/theme.css";
import "../frontend/styles/layout/layout.scss";
import "./globals.css";
import { Providers } from "./providers";
import { getBranding } from "@/shared/branding";

const branding = getBranding();

export const metadata: Metadata = {
  title: branding.name,
  description: `${branding.name} payment and subscription cabinet`,
  icons: {
    apple: [{ url: "/clean-pay-icon-192.png?v=3", sizes: "192x192", type: "image/png" }],
  },
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

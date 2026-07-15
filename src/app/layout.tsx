import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "primereact/resources/primereact.css";
import "primeicons/primeicons.css";
import "primeflex/primeflex.css";
import "../../public/themes/lara-light-indigo/theme.css";
import "../frontend/styles/layout/layout.scss";
import "./globals.css";
import { Providers } from "./providers";
import { getBranding } from "@/shared/branding";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const branding = getBranding();

export const metadata: Metadata = {
  title: branding.name,
  description: `${branding.name} payment and subscription cabinet`,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ru"
      className={`${geistSans.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

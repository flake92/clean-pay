import type { MetadataRoute } from "next";

import { getBranding } from "@/shared/branding";

export default function manifest(): MetadataRoute.Manifest {
  const branding = getBranding();

  return {
    name: branding.name,
    short_name: branding.name,
    description: `${branding.name} payment and subscription cabinet`,
    start_url: "/cabinet",
    display: "standalone",
    // The manifest is JSON, so these cannot reference the CSS design tokens
    // and must repeat the literals. theme_color must stay in step with
    // --cp-primary: it paints the Android status bar and task switcher, and
    // was a leftover teal that matched nothing else in the product.
    background_color: "#ffffff",
    theme_color: "#6366f1",
    icons: [
      { src: "/clean-pay-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/clean-pay-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/clean-pay-icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

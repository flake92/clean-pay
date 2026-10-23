import type { MetadataRoute } from "next";

import { brandIcons } from "./_composition/brand-assets";
import { getBranding } from "@/shared/branding";

export default function manifest(): MetadataRoute.Manifest {
  const branding = getBranding();
  const icons = brandIcons();

  return {
    name: branding.name,
    short_name: branding.name,
    description: `${branding.name} payment and subscription cabinet`,
    start_url: "/cabinet",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#0e7490",
    icons: [
      { src: icons.icon192, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: icons.icon512, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: icons.maskable512, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

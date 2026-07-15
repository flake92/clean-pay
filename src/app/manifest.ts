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
    background_color: "#ffffff",
    theme_color: "#0e7490",
    icons: [{ src: branding.logoUrl, purpose: "any" }],
  };
}

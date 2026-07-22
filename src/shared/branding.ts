const defaultBranding = {
  name: "Clean Pay",
  logoUrl: "/clean-pay-logo.png",
};

type BrandingEnv = Record<string, string | undefined>;

export type Branding = typeof defaultBranding;

function optional(value: string | undefined) {
  return value?.trim() || null;
}

function publicPath(name: string, value: string | null) {
  if (!value) {
    return defaultBranding.logoUrl;
  }

  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\") || value.includes("\0")) {
    throw new Error(`${name} must be a root-relative public path like /brand/logo.png`);
  }

  return value;
}

export function resolveBranding(env: BrandingEnv = process.env) {
  const name = optional(env.NEXT_PUBLIC_BRAND_NAME) ?? defaultBranding.name;

  if (name.length > 80) {
    throw new Error("NEXT_PUBLIC_BRAND_NAME must be 80 characters or less");
  }

  return {
    name,
    logoUrl: publicPath("NEXT_PUBLIC_BRAND_LOGO_URL", optional(env.NEXT_PUBLIC_BRAND_LOGO_URL)),
  };
}

export function getBranding() {
  return resolveBranding();
}

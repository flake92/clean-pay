import { getBranding } from "@/shared/branding";

export default function Head() {
  const branding = getBranding();

  return (
    <>
      <meta name="apple-mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-status-bar-style" content="default" />
      <meta name="apple-mobile-web-app-title" content={branding.name} />
      <link rel="apple-touch-icon" href="/clean-pay-icon-512.png" />
    </>
  );
}

"use client";

import { useEffect } from "react";

import { replaceWith } from "@/frontend/lib/browser-navigation";

export function useAccountActionRequiredController({
  action,
  linkEmailHref,
  recoveryHref,
}: {
  action: "login" | "recover-session" | "linkEmail";
  linkEmailHref: string;
  recoveryHref: string;
}) {
  useEffect(() => {
    if (action === "linkEmail") {
      replaceWith(linkEmailHref);
    }
    if (action === "recover-session") {
      replaceWith(recoveryHref);
    }
  }, [action, linkEmailHref, recoveryHref]);
}

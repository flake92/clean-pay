"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import type { NavigationViewModel } from "@/application/models/navigation";
import { useCleanPayMenu } from "./useCleanPayMenu";

// Short labels for the phone tab bar; the destinations come from the same menu
// model as the sidebar, so the bar never offers a route the menu does not.
const TAB_LABELS: Record<string, string> = {
  "/cabinet": "Кабинет",
  "/tariffs": "Тарифы",
  "/extend": "Продлить",
  "/referral": "Друзья",
  "/profile": "Профиль",
};

export default function MobileBottomNav({ navigation }: { navigation: NavigationViewModel }) {
  const { flatItems } = useCleanPayMenu(navigation);
  const pathname = usePathname();
  const tabs = flatItems.filter((item) => item.to && item.to in TAB_LABELS);
  if (!navigation.authenticated || tabs.length === 0) return null;

  return (
    <nav aria-label="Быстрая навигация" className="mobile-bottom-nav">
      {tabs.map((item) => {
        const active = pathname === item.to;
        return (
          <Link
            aria-current={active ? "page" : undefined}
            className={active ? "mobile-bottom-nav__item is-active" : "mobile-bottom-nav__item"}
            href={item.to!}
            key={item.to}
          >
            <i aria-hidden="true" className={item.icon} />
            <span>{TAB_LABELS[item.to!]}</span>
          </Link>
        );
      })}
    </nav>
  );
}

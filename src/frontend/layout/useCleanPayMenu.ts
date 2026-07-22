"use client";

import { useEffect, useState } from "react";
import type { AppMenuItem } from "@/frontend/types";
import { hasRenewOffer } from "@/frontend/lib/subscription-offers";
import { getBranding } from "@/shared/branding";
import type { SubscriptionOffersResponse } from "@/shared/remnashop/types";
import { getCachedBffJson } from "@/frontend/lib/bff-cache";

type MenuUser = {
    email: string | null;
    emailVerified: boolean;
    telegramId: string | null;
};

export function useCleanPayMenu() {
    const branding = getBranding();
    const [user, setUser] = useState<MenuUser | null>(null);
    const [offers, setOffers] = useState<SubscriptionOffersResponse | null>(null);
    const [profileLoaded, setProfileLoaded] = useState(false);

    useEffect(() => {
        let alive = true;

        async function loadMenuState() {
            try {
                const profileResponse = await getCachedBffJson<{ user: MenuUser }>("/api/bff/auth/me");
                const nextUser = profileResponse.ok
                    ? profileResponse.data?.user ?? null
                    : null;

                let nextOffers: SubscriptionOffersResponse | null = null;
                if (nextUser) {
                    const offersResponse = await getCachedBffJson<SubscriptionOffersResponse>("/api/bff/subscription/offers");
                    nextOffers = offersResponse.ok
                        ? offersResponse.data
                        : null;
                }

                if (!alive) {
                    return;
                }

                setUser(nextUser);
                setOffers(nextOffers);
                setProfileLoaded(true);
            } catch {
                if (alive) {
                    setProfileLoaded(true);
                }
            }
        }

        void loadMenuState();

        return () => {
            alive = false;
        };
    }, []);

    async function logout() {
        await fetch("/api/bff/auth/logout", { method: "POST", cache: "no-store" }).catch(() => null);
        window.location.replace("/login");
    }

    const shouldShowVerifyEmail = profileLoaded && user !== null && Boolean(user.email) && !user.emailVerified;
    const shouldShowLinkAccount = profileLoaded && user !== null;
    const canRenewSubscription = hasRenewOffer(offers);
    const hasSubscription = Boolean(offers?.has_current_subscription);
    const accountItems: AppMenuItem[] = [
        { label: "Профиль", icon: "pi pi-fw pi-user", to: "/profile" },
        ...(shouldShowVerifyEmail
            ? [{ label: "Подтвердить e-mail", icon: "pi pi-fw pi-envelope", to: "/verify-email" }]
            : []),
        ...(shouldShowLinkAccount
            ? [{ label: "Связать аккаунт", icon: "pi pi-fw pi-link", to: "/link-account" }]
            : []),
    ];

    const cleanPayItems: AppMenuItem[] = [
        { label: "Кабинет", icon: "pi pi-fw pi-home", to: "/cabinet" },
        {
            label: hasSubscription ? "Изменить тариф" : "Тарифы",
            icon: "pi pi-fw pi-tags",
            to: "/tariffs",
        },
        ...(canRenewSubscription
            ? [{ label: "Продление", icon: "pi pi-fw pi-refresh", to: "/extend" }]
            : []),
    ];

    const model: AppMenuItem[] = [
        {
            label: branding.name,
            items: cleanPayItems,
        },
        {
            label: "Аккаунт",
            items: accountItems,
        },
        {
            label: "Помощь",
            items: [
                { label: "Поддержка", icon: "pi pi-fw pi-question-circle", to: "/support" },
                {
                    label: "Выйти",
                    icon: "pi pi-fw pi-sign-out",
                    command: ({ originalEvent }) => {
                        originalEvent.preventDefault();
                        void logout();
                    },
                },
            ],
        },
    ];

    const flatItems = model.flatMap((section) => section.items ?? []);

    return { model, flatItems };
}

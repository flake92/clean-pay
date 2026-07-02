"use client";

import { useEffect, useState } from "react";
import type { AppMenuItem } from "@/frontend/types";

type MenuUser = {
    email: string | null;
    emailVerified: boolean;
    telegramId: string | null;
};

export function useCleanPayMenu() {
    const [user, setUser] = useState<MenuUser | null>(null);
    const [profileLoaded, setProfileLoaded] = useState(false);

    useEffect(() => {
        let alive = true;

        fetch("/api/me")
            .then(async (response) => {
                if (!response.ok) {
                    return null;
                }

                const body = await response.json().catch(() => null);

                return body?.user as MenuUser | null;
            })
            .then((nextUser) => {
                if (!alive) {
                    return;
                }

                setUser(nextUser);
                setProfileLoaded(true);
            })
            .catch(() => {
                if (alive) {
                    setProfileLoaded(true);
                }
            });

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
    const accountItems: AppMenuItem[] = [
        { label: "Профиль", icon: "pi pi-fw pi-user", to: "/profile" },
        ...(shouldShowVerifyEmail
            ? [{ label: "Подтвердить e-mail", icon: "pi pi-fw pi-envelope", to: "/verify-email" }]
            : []),
        ...(shouldShowLinkAccount
            ? [{ label: "Связать аккаунт", icon: "pi pi-fw pi-link", to: "/link-account" }]
            : []),
    ];

    const model: AppMenuItem[] = [
        {
            label: "Clean Pay",
            items: [
                { label: "Кабинет", icon: "pi pi-fw pi-home", to: "/cabinet" },
                { label: "Тарифы", icon: "pi pi-fw pi-tags", to: "/tariffs" },
                { label: "Продление", icon: "pi pi-fw pi-refresh", to: "/extend" },
            ],
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

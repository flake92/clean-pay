"use client";

import type { AppMenuItem } from "@/frontend/types";
import { getBranding } from "@/shared/branding";
import { logoutAction } from "@/app/actions/session";
import type { NavigationViewModel } from "@/shared/presentation/navigation";

export function useCleanPayMenu(navigation: NavigationViewModel) {
    const branding = getBranding();

    async function logout() {
        await logoutAction();
    }

    const shouldShowVerifyEmail = navigation.emailVerificationRequired;
    const shouldShowLinkAccount = navigation.authenticated;
    const canRenewSubscription = navigation.canRenewSubscription;
    const hasSubscription = navigation.hasSubscription;
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

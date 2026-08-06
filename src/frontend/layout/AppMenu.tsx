"use client";

import React from "react";
import { getBranding } from "@/shared/branding";
import AppMenuitem from "./AppMenuitem";
import { MenuProvider } from "./context/menucontext";
import { useCleanPayMenu } from "./useCleanPayMenu";
import type { NavigationViewModel } from "@/shared/presentation/navigation";

const AppMenu = ({ navigation }: { navigation: NavigationViewModel }) => {
    const { model } = useCleanPayMenu(navigation);
    const branding = getBranding();

    return (
        <MenuProvider>
            <ul className="layout-menu">
                {model.map((item, i) => {
                    return !item?.seperator ? <AppMenuitem item={item} root={true} index={i} key={item.label} /> : <li className="menu-separator"></li>;
                })}

                <li className="mt-4 px-3 py-3 border-round surface-ground">
                    <div className="text-900 font-medium mb-2">{branding.name}</div>
                    <div className="text-600 text-sm line-height-3">Оплата, продление и профиль в едином web-кабинете.</div>
                </li>
            </ul>
        </MenuProvider>
    );
};

export default AppMenu;

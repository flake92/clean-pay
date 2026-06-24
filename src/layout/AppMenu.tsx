"use client";

import React from "react";
import AppMenuitem from "./AppMenuitem";
import { MenuProvider } from "./context/menucontext";
import { useCleanPayMenu } from "./useCleanPayMenu";

const AppMenu = () => {
    const { model } = useCleanPayMenu();

    return (
        <MenuProvider>
            <ul className="layout-menu">
                {model.map((item, i) => {
                    return !item?.seperator ? <AppMenuitem item={item} root={true} index={i} key={item.label} /> : <li className="menu-separator"></li>;
                })}

                <li className="mt-4 px-3 py-3 border-round surface-ground">
                    <div className="text-900 font-medium mb-2">CleanVPN</div>
                    <div className="text-600 text-sm line-height-3">Оплата, продление и профиль в едином web-кабинете.</div>
                </li>
            </ul>
        </MenuProvider>
    );
};

export default AppMenu;

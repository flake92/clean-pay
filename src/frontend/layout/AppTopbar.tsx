/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { classNames } from "primereact/utils";
import React, { forwardRef, useContext, useImperativeHandle, useRef } from "react";
import { AppTopbarRef } from "@/frontend/types";
import { LayoutContext } from "./context/layoutcontext";
import { useCleanPayMenu } from "./useCleanPayMenu";

const AppTopbar = forwardRef<AppTopbarRef>((props, ref) => {
    const { layoutState, onMenuToggle, showProfileSidebar } = useContext(LayoutContext);
    const { flatItems } = useCleanPayMenu();
    const menubuttonRef = useRef(null);
    const topbarmenuRef = useRef(null);
    const topbarmenubuttonRef = useRef(null);

    useImperativeHandle(ref, () => ({
        menubutton: menubuttonRef.current,
        topbarmenu: topbarmenuRef.current,
        topbarmenubutton: topbarmenubuttonRef.current,
    }));

    return (
        <div className="layout-topbar">
            <Link href="/" className="layout-topbar-logo">
                <img src="/clean_vpn_logo.jpg" width="40" height="40" alt="CleanVPN logo" />
                <span>Clean Pay</span>
            </Link>

            <button ref={menubuttonRef} type="button" className="p-link layout-menu-button layout-topbar-button" onClick={onMenuToggle}>
                <i className="pi pi-bars" />
            </button>

            <button ref={topbarmenubuttonRef} type="button" className="p-link layout-topbar-menu-button layout-topbar-button" onClick={showProfileSidebar}>
                <i className="pi pi-ellipsis-v" />
            </button>

            <div ref={topbarmenuRef} className={classNames("layout-topbar-menu", { "layout-topbar-menu-mobile-active": layoutState.profileSidebarVisible })}>
                {flatItems.map((item) => {
                    if (item.to) {
                        return (
                            <Link key={`${item.label}-${item.to}`} href={item.to} className="p-link layout-topbar-button" title={item.label}>
                                <i className={item.icon}></i>
                                <span>{item.label}</span>
                            </Link>
                        );
                    }

                    if (item.command) {
                        return (
                            <button
                                key={item.label}
                                type="button"
                                className="p-link layout-topbar-button"
                                title={item.label}
                                onClick={(event) => item.command?.({ originalEvent: event, item })}
                            >
                                <i className={item.icon}></i>
                                <span>{item.label}</span>
                            </button>
                        );
                    }

                    return null;
                })}
            </div>
        </div>
    );
});

AppTopbar.displayName = "AppTopbar";

export default AppTopbar;

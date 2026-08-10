import Image from "next/image";
import Link from "next/link";
import { classNames } from "primereact/utils";
import { forwardRef, useContext, useImperativeHandle, useRef } from "react";
import { AppTopbarRef } from "@/frontend/types";
import { getBranding } from "@/shared/branding";
import { LayoutContext } from "./context/layoutcontext";
import { useCleanPayMenu } from "./useCleanPayMenu";
import type { NavigationViewModel } from "@/application/models/navigation";

const AppTopbar = forwardRef<AppTopbarRef, { navigation: NavigationViewModel }>(({ navigation }, ref) => {
    const { layoutState, onMenuToggle, showProfileSidebar } = useContext(LayoutContext);
    const { flatItems } = useCleanPayMenu(navigation);
    const menubuttonRef = useRef(null);
    const topbarmenuRef = useRef(null);
    const topbarmenubuttonRef = useRef(null);
    const branding = getBranding();

    useImperativeHandle(ref, () => ({
        menubutton: menubuttonRef.current,
        topbarmenu: topbarmenuRef.current,
        topbarmenubutton: topbarmenubuttonRef.current,
    }));

    return (
        <div className="layout-topbar">
            <Link href="/" className="layout-topbar-logo">
                <Image src={branding.logoUrl} width={40} height={40} alt={`${branding.name} logo`} unoptimized />
                <span>{branding.name}</span>
            </Link>

            <button
                ref={menubuttonRef}
                type="button"
                className="p-link layout-menu-button layout-topbar-button"
                aria-label="Главное меню"
                aria-controls="app-sidebar"
                aria-expanded={layoutState.staticMenuMobileActive || layoutState.overlayMenuActive || !layoutState.staticMenuDesktopInactive}
                onClick={onMenuToggle}
            >
                <i className="pi pi-bars" aria-hidden="true" />
            </button>

            <button
                ref={topbarmenubuttonRef}
                type="button"
                className="p-link layout-topbar-menu-button layout-topbar-button"
                aria-label="Меню профиля"
                aria-controls="app-topbar-menu"
                aria-expanded={layoutState.profileSidebarVisible}
                onClick={showProfileSidebar}
            >
                <i className="pi pi-ellipsis-v" aria-hidden="true" />
            </button>

            <div id="app-topbar-menu" ref={topbarmenuRef} className={classNames("layout-topbar-menu", { "layout-topbar-menu-mobile-active": layoutState.profileSidebarVisible })}>
                {flatItems.map((item) => {
                    if (item.to) {
                        return (
                            <Link key={`${item.label}-${item.to}`} href={item.to} prefetch={false} className="p-link layout-topbar-button" title={item.label}>
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

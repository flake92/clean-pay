"use client";

import { usePathname } from "next/navigation";
import { useEventListener } from "primereact/hooks";
import { classNames } from "primereact/utils";
import { useContext, useEffect, useRef } from "react";

import type { NavigationViewModel } from "@/application/models/navigation";
import type { AppTopbarRef, ChildContainerProps, LayoutState } from "@/frontend/types";
import AppFooter from "./AppFooter";
import AppMenu from "./AppMenu";
import AppTopbar from "./AppTopbar";
import { LayoutContext } from "./context/layoutcontext";

function blockBodyScroll() {
  document.body.classList.add("blocked-scroll");
}

function unblockBodyScroll() {
  document.body.classList.remove("blocked-scroll");
}

const Layout = ({
  children,
  navigation,
}: ChildContainerProps & { navigation: NavigationViewModel }) => {
  const { layoutState, setLayoutState } = useContext(LayoutContext);
  const topbarRef = useRef<AppTopbarRef>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const pathname = usePathname();

  const [bindMenuOutsideClickListener, unbindMenuOutsideClickListener] = useEventListener({
    type: "click",
    listener: (event) => {
      const isOutsideClicked = !(
        sidebarRef.current?.contains(event.target as Node)
        || topbarRef.current?.menubutton?.contains(event.target as Node)
      );

      if (isOutsideClicked) {
        setLayoutState((previous: LayoutState) => ({
          ...previous,
          staticMenuMobileActive: false,
        }));
      }
    },
  });

  const [bindProfileMenuOutsideClickListener, unbindProfileMenuOutsideClickListener] = useEventListener({
    type: "click",
    listener: (event) => {
      const isOutsideClicked = !(
        topbarRef.current?.topbarmenu?.contains(event.target as Node)
        || topbarRef.current?.topbarmenubutton?.contains(event.target as Node)
      );

      if (isOutsideClicked) {
        setLayoutState((previous: LayoutState) => ({
          ...previous,
          profileSidebarVisible: false,
        }));
      }
    },
  });

  useEffect(() => {
    setLayoutState((previous: LayoutState) => ({
      ...previous,
      profileSidebarVisible: false,
      staticMenuMobileActive: false,
    }));
  }, [pathname, setLayoutState]);

  useEffect(() => {
    const closeMobileMenuOnDesktop = () => {
      if (window.innerWidth <= 991) return;
      setLayoutState((previous: LayoutState) =>
        previous.staticMenuMobileActive
          ? { ...previous, staticMenuMobileActive: false }
          : previous
      );
    };

    closeMobileMenuOnDesktop();
    window.addEventListener("resize", closeMobileMenuOnDesktop);
    return () => window.removeEventListener("resize", closeMobileMenuOnDesktop);
  }, [setLayoutState]);

  useEffect(() => {
    if (!layoutState.staticMenuMobileActive) {
      unblockBodyScroll();
      return;
    }

    bindMenuOutsideClickListener();
    blockBodyScroll();
    return () => {
      unbindMenuOutsideClickListener();
      unblockBodyScroll();
    };
  }, [
    bindMenuOutsideClickListener,
    layoutState.staticMenuMobileActive,
    unbindMenuOutsideClickListener,
  ]);

  useEffect(() => {
    if (!layoutState.staticMenuMobileActive) return;

    const handleKeyboardNavigation = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setLayoutState((previous: LayoutState) => ({
          ...previous,
          staticMenuMobileActive: false,
        }));
        topbarRef.current?.menubutton?.focus();
        return;
      }

      if (event.key !== "Tab") return;

      const menuButton = topbarRef.current?.menubutton;
      const sidebar = sidebarRef.current;
      if (!menuButton || !sidebar) return;
      const sidebarControls = Array.from(
        sidebar.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => {
        const style = window.getComputedStyle(element);
        return style.display !== "none" && style.visibility !== "hidden";
      });
      const firstControl = sidebarControls[0];
      const lastControl = sidebarControls.at(-1);
      if (!firstControl || !lastControl) return;

      if (event.shiftKey && document.activeElement === menuButton) {
        event.preventDefault();
        lastControl.focus();
      } else if (!event.shiftKey && document.activeElement === menuButton) {
        event.preventDefault();
        firstControl.focus();
      } else if (event.shiftKey && document.activeElement === firstControl) {
        event.preventDefault();
        menuButton.focus();
      } else if (!event.shiftKey && document.activeElement === lastControl) {
        event.preventDefault();
        menuButton.focus();
      } else if (
        document.activeElement !== menuButton &&
        !sidebar.contains(document.activeElement)
      ) {
        event.preventDefault();
        firstControl.focus();
      }
    };

    document.addEventListener("keydown", handleKeyboardNavigation);
    return () => document.removeEventListener("keydown", handleKeyboardNavigation);
  }, [layoutState.staticMenuMobileActive, setLayoutState]);

  useEffect(() => {
    if (
      !layoutState.profileSidebarVisible ||
      layoutState.staticMenuMobileActive
    ) return;

    bindProfileMenuOutsideClickListener();
    const closeProfileMenu = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setLayoutState((previous: LayoutState) => ({
        ...previous,
        profileSidebarVisible: false,
      }));
      topbarRef.current?.topbarmenubutton?.focus();
    };
    document.addEventListener("keydown", closeProfileMenu);
    return () => {
      unbindProfileMenuOutsideClickListener();
      document.removeEventListener("keydown", closeProfileMenu);
    };
  }, [
    bindProfileMenuOutsideClickListener,
    layoutState.profileSidebarVisible,
    layoutState.staticMenuMobileActive,
    setLayoutState,
    unbindProfileMenuOutsideClickListener,
  ]);

  const containerClass = classNames("layout-wrapper", {
    "layout-static": true,
    "layout-static-inactive": layoutState.staticMenuDesktopInactive,
    "layout-mobile-active": layoutState.staticMenuMobileActive,
    "p-ripple-disabled": true,
  });

  return (
    <div className={containerClass}>
      <AppTopbar navigation={navigation} ref={topbarRef} />
      <nav
        aria-label="Основная навигация"
        className="layout-sidebar"
        id="app-sidebar"
        ref={sidebarRef}
      >
        <AppMenu navigation={navigation} />
      </nav>
      <div className="layout-main-container">
        <main className="layout-main">{children}</main>
        <AppFooter />
      </div>
      <div className="layout-mask" />
    </div>
  );
};

export default Layout;

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
  const sidebarRef = useRef<HTMLDivElement>(null);
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
    if (!layoutState.profileSidebarVisible) return;

    bindProfileMenuOutsideClickListener();
    return unbindProfileMenuOutsideClickListener;
  }, [
    bindProfileMenuOutsideClickListener,
    layoutState.profileSidebarVisible,
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
      <div id="app-sidebar" ref={sidebarRef} className="layout-sidebar">
        <AppMenu navigation={navigation} />
      </div>
      <div className="layout-main-container">
        <div className="layout-main">{children}</div>
        <AppFooter />
      </div>
      <div className="layout-mask" />
    </div>
  );
};

export default Layout;

"use client";

import { createContext, useState } from "react";

import type {
  ChildContainerProps,
  LayoutContextProps,
  LayoutState,
} from "@/frontend/types";

export const LayoutContext = createContext({} as LayoutContextProps);

export const LayoutProvider = ({ children }: ChildContainerProps) => {
  const [layoutState, setLayoutState] = useState<LayoutState>({
    staticMenuDesktopInactive: false,
    profileSidebarVisible: false,
    staticMenuMobileActive: false,
  });

  const onMenuToggle = () => {
    if (window.innerWidth > 991) {
      setLayoutState((previous) => ({
        ...previous,
        staticMenuDesktopInactive: !previous.staticMenuDesktopInactive,
      }));
    } else {
      setLayoutState((previous) => ({
        ...previous,
        staticMenuMobileActive: !previous.staticMenuMobileActive,
      }));
    }
  };

  const showProfileSidebar = () => {
    setLayoutState((previous) => ({
      ...previous,
      profileSidebarVisible: !previous.profileSidebarVisible,
    }));
  };

  return (
    <LayoutContext.Provider value={{
      layoutState,
      setLayoutState,
      onMenuToggle,
      showProfileSidebar,
    }}>
      {children}
    </LayoutContext.Provider>
  );
};

import type { Dispatch, MouseEvent, SetStateAction } from "react";

export type LayoutState = {
  staticMenuDesktopInactive: boolean;
  profileSidebarVisible: boolean;
  staticMenuMobileActive: boolean;
};

export interface LayoutContextProps {
  layoutState: LayoutState;
  setLayoutState: Dispatch<SetStateAction<LayoutState>>;
  onMenuToggle: () => void;
  showProfileSidebar: () => void;
}

export interface MenuContextProps {
  activeMenu: string;
  setActiveMenu: Dispatch<SetStateAction<string>>;
}

export interface AppTopbarRef {
  menubutton?: HTMLButtonElement | null;
  topbarmenu?: HTMLDivElement | null;
  topbarmenubutton?: HTMLButtonElement | null;
}

type CommandProps = {
  originalEvent: MouseEvent<HTMLElement>;
  item: AppMenuItem;
};

export interface AppMenuItem {
  label: string;
  icon?: string;
  items?: AppMenuItem[];
  to?: string;
  replaceUrl?: boolean;
  command?: ({ originalEvent, item }: CommandProps) => void;
}

export interface AppMenuItemProps {
  item: AppMenuItem;
  parentKey?: string;
  index?: number;
  root?: boolean;
}

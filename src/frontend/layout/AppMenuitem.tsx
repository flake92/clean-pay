"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Ripple } from "primereact/ripple";
import { classNames } from "primereact/utils";
import { useContext, useEffect, type MouseEvent } from "react";
import { CSSTransition } from "react-transition-group";

import type { AppMenuItemProps } from "@/frontend/types";
import { MenuContext } from "./context/menucontext";

const AppMenuitem = (props: AppMenuItemProps) => {
  const pathname = usePathname();
  const { activeMenu, setActiveMenu } = useContext(MenuContext);
  const { item } = props;
  const key = props.parentKey ? `${props.parentKey}-${props.index}` : String(props.index);
  const isActiveRoute = item.to && pathname === item.to;
  const active = activeMenu === key || activeMenu.startsWith(`${key}-`);

  useEffect(() => {
    if (item.to === pathname) setActiveMenu(key);
  }, [item.to, key, pathname, setActiveMenu]);

  const itemClick = (event: MouseEvent<HTMLElement>) => {
    item.command?.({ originalEvent: event, item });
    setActiveMenu(item.items && active ? (props.parentKey ?? "") : key);
  };

  const subMenu = item.items && (
    <CSSTransition
      classNames="layout-submenu"
      in={props.root || active}
      key={item.label}
      timeout={{ enter: 1000, exit: 450 }}
    >
      <ul>
        {item.items.map((child, index) => (
          <AppMenuitem
            index={index}
            item={child}
            key={child.label}
            parentKey={key}
          />
        ))}
      </ul>
    </CSSTransition>
  );

  return (
    <li className={classNames({ "layout-root-menuitem": props.root, "active-menuitem": active })}>
      {props.root ? <div className="layout-menuitem-root-text">{item.label}</div> : null}
      {!item.to || item.items ? (
        <button
          aria-expanded={item.items ? active : undefined}
          className="p-ripple"
          onClick={itemClick}
          type="button"
        >
          <i aria-hidden="true" className={classNames("layout-menuitem-icon", item.icon)} />
          <span className="layout-menuitem-text">{item.label}</span>
          {item.items ? <i aria-hidden="true" className="pi pi-fw pi-angle-down layout-submenu-toggler" /> : null}
          <Ripple />
        </button>
      ) : null}

      {item.to && !item.items ? (
        <Link
          className={classNames("p-ripple", { "active-route": isActiveRoute })}
          href={item.to}
          aria-current={isActiveRoute ? "page" : undefined}
          onClick={itemClick}
          prefetch={false}
          replace={item.replaceUrl}
        >
          <i aria-hidden="true" className={classNames("layout-menuitem-icon", item.icon)} />
          <span className="layout-menuitem-text">{item.label}</span>
          <Ripple />
        </Link>
      ) : null}

      {subMenu}
    </li>
  );
};

export default AppMenuitem;

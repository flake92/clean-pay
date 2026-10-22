"use client";

import { useAnimate } from "motion/react";
import { useLayoutEffect, useRef } from "react";

import { prefersReducedMotion } from "@/frontend/lib/reduced-motion";

// Purely visual: on client-side navigation the new page content fades and
// rises in. The first paint is never hidden (CSS handles the initial entrance),
// and the animation is completed on cleanup so no partial style remains.
export function useRouteEntrance<T extends HTMLElement>(pathname: string) {
  const [scope, animate] = useAnimate<T>();
  const previousPathname = useRef(pathname);

  useLayoutEffect(() => {
    const root = scope.current;
    const routeChanged = previousPathname.current !== pathname;
    previousPathname.current = pathname;
    if (!root || !routeChanged || prefersReducedMotion()) return;

    const fade = animate(
      root,
      { opacity: [0, 1], y: [16, 0] },
      { duration: 0.45, ease: [0.2, 0.8, 0.2, 1] },
    );

    return () => {
      fade.complete();
    };
  }, [animate, pathname, scope]);

  return scope;
}

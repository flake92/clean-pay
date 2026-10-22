"use client";

import { animate as animeAnimate, stagger } from "animejs";
import { useAnimate } from "motion/react";
import { useLayoutEffect, useRef } from "react";

import { prefersReducedMotion } from "@/frontend/lib/reduced-motion";

// Purely visual: content is never hidden on the first paint, and every
// inline style the animations leave behind is completed or reverted.
export function useRouteEntrance<T extends HTMLElement>(pathname: string) {
  const [scope, animate] = useAnimate<T>();
  const previousPathname = useRef(pathname);

  useLayoutEffect(() => {
    const root = scope.current;
    const routeChanged = previousPathname.current !== pathname;
    previousPathname.current = pathname;
    if (!root || prefersReducedMotion()) return;

    const fade = routeChanged
      ? animate(root, { opacity: [0, 1], y: [10, 0] }, { duration: 0.28, ease: "easeOut" })
      : undefined;
    const cards = root.querySelectorAll<HTMLElement>(".card");
    const wave = cards.length > 0
      ? animeAnimate(cards, {
        translateY: [{ to: -6 }, { to: 0 }],
        duration: 560,
        delay: stagger(60),
        ease: "outQuad",
        onComplete: (self) => self.revert(),
      })
      : undefined;

    return () => {
      fade?.complete();
      wave?.revert();
    };
  }, [animate, pathname, scope]);

  return scope;
}

"use client";

import { createTimeline, stagger } from "animejs";
import { useEffect, useRef } from "react";

import { prefersReducedMotion } from "@/frontend/lib/reduced-motion";

export function AuthCardContent({ children }: { children: React.ReactNode }) {
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const content = contentRef.current;
    if (!content || prefersReducedMotion()) return;

    const timeline = createTimeline({
      defaults: { ease: "outQuad" },
      onComplete: (self) => self.revert(),
    });
    const logo = content.querySelector<HTMLElement>(".clean-auth-logo");
    if (logo) {
      timeline.add(logo, {
        scale: [{ to: 1.08 }, { to: 1 }],
        rotate: [{ to: -6 }, { to: 0 }],
        duration: 640,
        ease: "outBack",
      });
    }
    timeline.add(Array.from(content.children), {
      translateY: [{ to: -4 }, { to: 0 }],
      duration: 480,
      delay: stagger(70),
    }, logo ? "-=420" : 0);

    return () => {
      timeline.revert();
    };
  }, []);

  return (
    <div className="auth-card-content" ref={contentRef}>
      {children}
    </div>
  );
}

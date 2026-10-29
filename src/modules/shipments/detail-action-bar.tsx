"use client";

// UX-14 item 2: below 640 px the issued shipment's actions stay in thumb reach in a bar pinned to the
// bottom of the screen. While the bar is shown, the page's bottom scroll padding equals its height, so a
// control that receives focus is scrolled clear of it and never sits underneath (WCAG 2.4.11).
import { useEffect, useRef } from "react";

export function StickyActionBar({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const bar = ref.current;
    if (!bar) return;
    const root = document.documentElement;
    const update = () => {
      // display:none (>= 640 px) reports 0, which clears the padding.
      root.style.scrollPaddingBottom = bar.offsetHeight ? `${bar.offsetHeight + 8}px` : "";
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(bar);
    return () => {
      observer.disconnect();
      root.style.scrollPaddingBottom = "";
    };
  }, []);
  return (
    <div
      ref={ref}
      role="region"
      aria-label="Tindakan pengiriman"
      data-testid="detail-action-bar"
      className="sticky bottom-0 z-20 -mx-4 -mb-6 flex flex-wrap items-center gap-2 border-t border-border bg-card px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:hidden"
    >
      {children}
    </div>
  );
}

"use client";

// A bar pinned to the bottom of the screen must never hide the control that receives keyboard focus
// (WCAG 2.4.11). While the bar is shown, the page's bottom scroll padding equals its height so a focused
// control is scrolled clear of it; a hidden bar (display:none reports 0) clears the padding.
import { useEffect, type RefObject } from "react";

export function useStickyScrollPadding(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const bar = ref.current;
    if (!bar) return;
    const root = document.documentElement;
    const update = () => {
      root.style.scrollPaddingBottom = bar.offsetHeight ? `${bar.offsetHeight + 8}px` : "";
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(bar);
    return () => {
      observer.disconnect();
      root.style.scrollPaddingBottom = "";
    };
  }, [ref]);
}

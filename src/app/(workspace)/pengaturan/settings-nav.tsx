"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type SettingsSection = { id: string; label: string };

// C8: in-page navigation for the grouped settings sections. A vertical list beside the content on
// >=1024 and a row of segmented anchor links below it; the section nearest the top of the viewport is
// marked current (aria-current) as the page scrolls. Plain anchors, so it works before hydration.
export function SettingsNav({ sections }: { sections: SettingsSection[] }) {
  const [current, setCurrent] = useState(sections[0]?.id ?? "");
  const rowRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const targets = sections.map((s) => document.getElementById(s.id)).filter((el): el is HTMLElement => el !== null);
    if (targets.length === 0) return;
    const pick = () => {
      // The last section whose top has passed a line a little below the top bar; at the page end, the last
      // one. A section just jumped to (the URL hash) stays current while its top sits at that line, even when
      // the page end keeps a later section on screen.
      const line = 120;
      const jumped = targets.find((el) => `#${el.id}` === window.location.hash);
      const jumpedTop = jumped?.getBoundingClientRect().top;
      if (jumped && jumpedTop !== undefined && jumpedTop >= -4 && jumpedTop <= line) {
        setCurrent(jumped.id);
        return;
      }
      let active = targets[0].id;
      for (const el of targets) if (el.getBoundingClientRect().top <= line) active = el.id;
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) active = targets[targets.length - 1].id;
      setCurrent(active);
    };
    pick();
    window.addEventListener("scroll", pick, { passive: true });
    window.addEventListener("resize", pick);
    window.addEventListener("hashchange", pick);
    return () => {
      window.removeEventListener("scroll", pick);
      window.removeEventListener("resize", pick);
      window.removeEventListener("hashchange", pick);
    };
  }, [sections]);

  // Below 1024 the links are one scrollable row: keep the current one in view (horizontally only).
  useEffect(() => {
    const row = rowRef.current;
    const link = row?.querySelector<HTMLElement>(`a[href="#${current}"]`);
    if (!row || !link || row.scrollWidth <= row.clientWidth) return;
    const left = link.offsetLeft - row.offsetLeft;
    if (left < row.scrollLeft || left + link.offsetWidth > row.scrollLeft + row.clientWidth) {
      row.scrollLeft = left - 8;
    }
  }, [current]);

  return (
    <nav aria-label="Bagian pengaturan" className="min-w-0 lg:sticky lg:top-8 lg:self-start">
      <ul ref={rowRef} className="flex gap-1 overflow-x-auto rounded-full bg-foreground/6 p-1 lg:flex-col lg:overflow-visible lg:rounded-none lg:bg-transparent lg:p-0">
        {sections.map((s) => {
          const active = s.id === current;
          return (
            <li key={s.id} className="shrink-0">
              <a
                href={`#${s.id}`}
                aria-current={active ? "true" : undefined}
                onClick={() => setCurrent(s.id)}
                className={cn(
                  "flex min-h-11 items-center whitespace-nowrap rounded-full px-4 text-[15px] text-muted-foreground transition-colors hover:text-foreground lg:rounded-sm lg:px-3",
                  active && "bg-card text-foreground ring-1 ring-border lg:bg-foreground/6 lg:ring-0",
                )}
              >
                {s.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

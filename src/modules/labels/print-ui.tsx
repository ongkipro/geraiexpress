// Imported by the client workbenches only (it uses hooks); not a "use client" entry of its own so the
// callback props stay plain props.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { SEGMENT_ITEM, SEGMENT_TRACK } from "./segment-styles";

// Shared pieces of the print surface (C6, UI-6): the segmented control used by the label and invoice
// workbenches, the neutral desk that frames the preview, and a scaled sheet that is shown at fit or at
// actual size on screen and always prints at its real size (every scaling rule is screen-only).

export type SegmentOption<T extends string> = { value: T; label: ReactNode; disabled?: boolean };

// A single-choice segmented control. Radix renders a radiogroup of role="radio" buttons; a click on the
// selected segment would clear the value, so an empty value is ignored. `stretch` fills the row with
// equal segments whose text may wrap.
export function SegmentedControl<T extends string>({
  value, onChange, options, labelledBy, label, stretch = false, className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: SegmentOption<T>[];
  labelledBy?: string;
  label?: string;
  stretch?: boolean;
  className?: string;
}) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(next) => { if (next) onChange(next as T); }}
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : label}
      spacing={1}
      className={cn(SEGMENT_TRACK, stretch && "flex w-full flex-nowrap", className)}
    >
      {options.map((option) => (
        <ToggleGroupItem
          key={option.value}
          value={option.value}
          disabled={option.disabled}
          className={cn(
            SEGMENT_ITEM,
            "h-auto data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:ring-1 data-[state=on]:ring-border",
            stretch && "min-w-0 flex-1 py-2 text-center whitespace-normal",
          )}
        >
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

export type Zoom = "fit" | "actual";
export const ZOOM_OPTIONS: SegmentOption<Zoom>[] = [
  { value: "fit", label: "Pas" },
  { value: "actual", label: "100%" },
];

// The neutral desk the sheets lie on. Screen only: in print it adds no box, colour or spacing.
export function PreviewDesk({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col items-stretch gap-6 rounded-lg bg-foreground/5 p-3 sm:p-6 print:block print:rounded-none print:bg-transparent print:p-0", className)}>
      {children}
    </div>
  );
}

// One sheet on the desk. "fit" scales it to the desk width (and, for the thermal label on >=1024 where it
// sits beside the controls, to the first screen); "actual" shows it at 1:1 CSS millimetres, scrolling
// inside the desk when wider. The scale lives in CSS variables read only by screen rules, so the print
// output is the unscaled sheet.
export function ScaledSheet({ zoom, label, fitHeight = false, children, className }: {
  zoom: Zoom;
  label: string;
  fitHeight?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ availW: number; availH: number; w: number; h: number } | null>(null);

  useEffect(() => {
    const o = outer.current, i = inner.current;
    if (!o || !i) return;
    const measure = () => setBox({
      availW: o.clientWidth,
      availH: window.matchMedia("(min-width: 1024px)").matches
        ? Math.max(320, window.innerHeight - (o.getBoundingClientRect().top + window.scrollY) - 48)
        : Number.POSITIVE_INFINITY,
      w: i.offsetWidth,
      h: i.offsetHeight,
    });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(o);
    observer.observe(i);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  const scale = !box || box.w === 0 || zoom === "actual"
    ? 1
    : Math.min(box.availW / box.w, fitHeight ? box.availH / box.h : Number.POSITIVE_INFINITY, 1.25);
  const style = box
    ? ({ "--sheet-w": `${box.w * scale}px`, "--sheet-h": `${box.h * scale}px` } as CSSProperties)
    : undefined;
  // At 100% on a narrow screen the sheet scrolls sideways inside this labelled region (WCAG 1.4.10), which
  // then takes keyboard focus so it can be scrolled without a pointer.
  const scrolls = box !== null && box.w * scale > box.availW + 1;

  return (
    <div
      ref={outer}
      role="region"
      aria-label={label}
      tabIndex={scrolls ? 0 : undefined}
      className={cn("w-full min-w-0 overflow-x-auto print:overflow-visible", className)}
    >
      <div style={style} className="mx-auto [height:var(--sheet-h,auto)] [width:var(--sheet-w,fit-content)] print:m-0 print:[height:auto] print:[width:auto]">
        <div
          ref={inner}
          style={{ "--sheet-scale": scale } as CSSProperties}
          className="w-fit origin-top-left [transform:scale(var(--sheet-scale,1))] print:[transform:none]"
        >
          {children}
        </div>
      </div>
    </div>
  );
}

// Swaps a button label for its pending label in one grid cell, so the button keeps the width of the
// longer one (UX-13). The hidden label is invisible and so not part of the accessible name.
export function PendingLabel({ pending, label, pendingLabel }: { pending: boolean; label: ReactNode; pendingLabel: ReactNode }) {
  return (
    <span className="inline-grid">
      <span className={cn("col-start-1 row-start-1", pending && "invisible")}>{label}</span>
      <span aria-hidden={!pending} className={cn("col-start-1 row-start-1", !pending && "invisible")}>{pendingLabel}</span>
    </span>
  );
}

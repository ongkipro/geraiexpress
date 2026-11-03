import { AlertTriangle, CheckCircle2, Info, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const TONES: Record<"success" | "danger" | "warning" | "info", { icon: LucideIcon; box: string; iconClass: string }> = {
  success: { icon: CheckCircle2, box: "bg-success-soft", iconClass: "text-success" },
  danger: { icon: AlertTriangle, box: "bg-danger-soft", iconClass: "text-danger" },
  warning: { icon: AlertTriangle, box: "bg-warning-soft", iconClass: "text-warning" },
  info: { icon: Info, box: "bg-info-soft", iconClass: "text-info" },
};

// One-level message: tone + icon + text (never colour alone). Errors are alerts; everything else is a
// polite status.
export function Notice({ tone, children, className, ...props }: {
  tone: keyof typeof TONES;
  children: React.ReactNode;
  className?: string;
} & Omit<React.ComponentProps<"div">, "children">) {
  const { icon: Icon, box, iconClass } = TONES[tone];
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("flex items-start gap-3 rounded-md px-4 py-3 text-base", box, className)} {...props}>
      <Icon className={cn("mt-0.5 size-5 shrink-0", iconClass)} aria-hidden="true" />
      <div className="min-w-0 flex-1 break-words">{children}</div>
    </div>
  );
}

// F3 / UX-1: a failed read is not an empty result. Pages render this instead of "nothing here",
// default values or 404, and withhold the forms that depend on the data that did not load.
export function LoadError({ title, what }: { title: string; what: string }) {
  return (
    <div className="flex max-w-[680px] flex-col gap-4">
      <h1 className="text-3xl tracking-tight">{title}</h1>
      <Notice tone="danger" data-testid="load-error">
        {what} belum bisa dimuat. Muat ulang halaman; jika berulang, hubungi admin GeraiExpress.
      </Notice>
    </div>
  );
}

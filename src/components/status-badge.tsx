import { AlertTriangle, CheckCircle2, CircleDashed, Clock, FileText, Wallet, XCircle } from "lucide-react";
import { SUBMISSION_LABEL } from "@/lib/format";

// UI-2: status uses neutral surfaces, text and distinct icons; never color alone.
const ICONS = {
  draft: FileText,
  estimated: CircleDashed,
  queued: Clock,
  in_flight: Clock,
  unknown: AlertTriangle,
  awaiting_payment: Wallet,
  issued: CheckCircle2,
  failed: XCircle,
} as const;

export function StatusBadge({ state }: { state: string }) {
  const Icon = ICONS[state as keyof typeof ICONS] ?? CircleDashed;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-muted px-2.5 py-1 text-sm text-foreground ring-1 ring-border">
      <Icon className="size-4" aria-hidden="true" />
      {SUBMISSION_LABEL[state] ?? state}
    </span>
  );
}

import { AlertTriangle, CheckCircle2, CircleDashed, Clock, FileText, Wallet, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SUBMISSION_LABEL } from "@/lib/format";

// UI-2: a status is a tone, an icon and a text label together, never color alone. Uncertain provider
// outcomes (unknown) read as a warning, not as a failure: nothing is known to have gone wrong.
const STATES = {
  draft: { icon: FileText, variant: "neutral" },
  estimated: { icon: CircleDashed, variant: "info" },
  queued: { icon: Clock, variant: "info" },
  in_flight: { icon: Clock, variant: "pending" },
  unknown: { icon: AlertTriangle, variant: "warning" },
  awaiting_payment: { icon: Wallet, variant: "warning" },
  issued: { icon: CheckCircle2, variant: "success" },
  failed: { icon: XCircle, variant: "destructive" },
} as const;

export function StatusBadge({ state }: { state: string }) {
  const { icon: Icon, variant } = STATES[state as keyof typeof STATES] ?? { icon: CircleDashed, variant: "neutral" as const };
  return (
    <Badge variant={variant}>
      <Icon aria-hidden="true" />
      {SUBMISSION_LABEL[state] ?? state}
    </Badge>
  );
}

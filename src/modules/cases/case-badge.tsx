import { AlertTriangle, Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { CASE_COPY } from "./copy";

// UX-20 item 1: "Retur" for a provider return state (delivery_state 'returned', set once T-045
// ingests it) or a non-closed return case; any other non-closed case reads "Kasus terbuka".
// Tone, icon and text together (UI-2).
export type CaseMark = "return" | "case" | null;

export function caseMark(deliveryState: string | null | undefined, openCaseType: string | null | undefined): CaseMark {
  if (deliveryState === "returned" || openCaseType === "return") return "return";
  return openCaseType ? "case" : null;
}

export function CaseBadge({ mark }: { mark: CaseMark }) {
  if (!mark) return null;
  return mark === "return" ? (
    <Badge variant="warning" data-testid="return-badge"><Undo2 aria-hidden="true" />{CASE_COPY.returnBadge}</Badge>
  ) : (
    <Badge variant="warning" data-testid="case-badge"><AlertTriangle aria-hidden="true" />{CASE_COPY.openCaseBadge}</Badge>
  );
}

import Link from "next/link";
import { CheckCircle2, Circle, Clock, TriangleAlert, XCircle, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatWib } from "@/lib/format";
import { cn } from "@/lib/utils";

type Tone = "done" | "current" | "upcoming" | "success" | "warning" | "danger";
type Step = { label: string; tone: Tone; detail?: React.ReactNode };

const ICON: Record<Tone, LucideIcon> = {
  done: CheckCircle2, current: Clock, upcoming: Circle, success: CheckCircle2, warning: TriangleAlert, danger: XCircle,
};
const COLOR: Record<Tone, string> = {
  done: "text-primary", current: "text-info", upcoming: "text-muted-foreground",
  success: "text-success", warning: "text-warning", danger: "text-danger",
};
const STATE_TEXT: Record<Tone, string> = {
  done: "selesai", current: "sedang berjalan", upcoming: "belum", success: "selesai", warning: "perlu tindakan", danger: "selesai",
};

const OUTCOME: Record<string, { label: string; tone: Tone }> = {
  approved: { label: "Disetujui", tone: "success" },
  changes_requested: { label: "Perlu perbaikan", tone: "warning" },
  rejected: { label: "Ditolak", tone: "danger" },
};

// UX-7: Diajukan -> Ditinjau -> Disetujui / Perlu perbaikan / Ditolak, from the application's own
// timestamps. Each step is icon + text; the outcome carries its tone.
export function ReviewTimeline({ status, submittedAt, reviewedAt, reason }: {
  status: string; submittedAt: string | null; reviewedAt: string | null; reason: string | null;
}) {
  const outcome = OUTCOME[status];
  const steps: Step[] = [
    { label: "Diajukan", tone: "done", detail: submittedAt ? <span className="tabular">{formatWib(submittedAt)}</span> : null },
    outcome
      ? { label: "Ditinjau", tone: "done", detail: reviewedAt ? <span className="tabular">{formatWib(reviewedAt)}</span> : null }
      : { label: "Ditinjau", tone: "current", detail: "Tim GeraiExpress sedang memeriksa data gerai." },
    outcome
      ? { label: outcome.label, tone: outcome.tone, detail: reason ? <>Catatan peninjau: {reason}</> : null }
      : { label: "Keputusan", tone: "upcoming", detail: "Disetujui, perlu perbaikan, atau ditolak." },
  ];
  return (
    <ol aria-label="Riwayat pengajuan" className="flex flex-col">
      {steps.map((step, i) => {
        const Icon = ICON[step.tone];
        const last = i === steps.length - 1;
        return (
          <li key={step.label} className="relative flex gap-3 pb-5 last:pb-0">
            {last ? null : <span aria-hidden="true" className="absolute top-7 bottom-1 left-[11px] w-px bg-border" />}
            <Icon aria-hidden="true" className={cn("size-6 shrink-0", COLOR[step.tone])} />
            <div className="flex min-w-0 flex-col gap-0.5 pt-0.5">
              <p className={cn("font-semibold", step.tone === "upcoming" && "font-normal text-muted-foreground")}>
                {step.label}<span className="sr-only"> ({STATE_TEXT[step.tone]})</span>
              </p>
              {step.detail ? <p className="text-[15px] break-words text-muted-foreground">{step.detail}</p> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// The one permitted next action for each review state, named.
export function NextStep({ status, registrationOpen }: { status: string; registrationOpen: boolean }) {
  const label = <span className="font-semibold">Langkah berikutnya: </span>;
  if (status === "approved") {
    return (
      <div className="flex flex-col gap-3">
        <p>{label}buka ruang kerja gerai. Anda adalah admin gerainya; akun Mengantar dihubungkan sesudahnya.</p>
        <Button asChild className="self-start max-sm:w-full"><Link href="/">Buka ruang kerja</Link></Button>
      </div>
    );
  }
  if (status === "submitted") return <p>{label}tunggu keputusan peninjau. Ruang kerja gerai terbuka setelah disetujui. Selama menunggu, Anda masih bisa membatalkan pengajuan.</p>;
  if (status === "changes_requested") return <p>{label}perbaiki data gerai di bawah sesuai catatan peninjau, lalu ajukan lagi.</p>;
  return <p>{label}{registrationOpen ? "ajukan gerai baru dengan data yang sudah diperbaiki di bawah." : "pengajuan baru bisa dikirim setelah pendaftaran dibuka lagi."}</p>;
}

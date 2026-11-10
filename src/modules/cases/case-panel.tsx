import Link from "next/link";
import { Notice } from "@/components/notice";
import { Badge } from "@/components/ui/badge";
import { courierName, formatIdr, formatWib } from "@/lib/format";
import { CaseDialog } from "./case-dialog";
import { CloseCaseDialog } from "./close-case-dialog";
import {
  ANCHOR_LABEL, CASE_COPY, CASE_STATE_LABEL, CASE_TYPE_LABEL, CLAIM_TYPE_LABEL, DECIDED_BY_LABEL, OUTCOME_LABEL,
  REGION_LABEL, UNIT_LABEL,
} from "./copy";
import { calendarDaysBetween, deadlineStatus, workingDaysBetween, type ClaimRule } from "./deadline";
import type { CaseEvent, CaseRecord } from "./types";

const SOURCE_DATE = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const who = (id: string | null, viewer: string) => (id === viewer ? "Anda" : id ? "staf lain" : "tidak diketahui");

// UX-20 item 3: the filing deadline with source and date, its age and the 80% warning; every unknown
// says which input is missing. The stored deadline_at (computed in SQL) is authoritative.
export function CaseDeadline({ record, rule, courier, now, viewerId }: {
  record: CaseRecord; rule: ClaimRule | null; courier: string | null; now: Date; viewerId: string;
}) {
  const status = deadlineStatus({ rule, anchorAt: record.anchor_at, deadlineAt: record.deadline_at, now });
  const needsRegion = !rule && courier === "JNE" && !record.region;
  return (
    <section aria-labelledby={`deadline-${record.id}`} className="flex flex-col gap-2 rounded-md bg-muted/50 p-4" data-testid="case-deadline">
      <h3 id={`deadline-${record.id}`} className="text-base font-semibold">{CASE_COPY.deadlineTitle}</h3>
      {status.kind === "known" ? (
        <>
          <p className="text-lg font-semibold tabular" data-testid="case-deadline-value">{formatWib(status.deadline)}</p>
          {status.overdue ? <Notice tone="warning">{CASE_COPY.deadlineOverdue}</Notice>
            : status.warning ? <Notice tone="warning" data-testid="case-deadline-warning">{CASE_COPY.deadlineWarning}</Notice> : null}
        </>
      ) : (
        <p data-testid="case-deadline-value"><span className="font-semibold">{CASE_COPY.deadlineUnknown}.</span>{" "}
          {needsRegion ? CASE_COPY.deadlineNeedsRegion : status.kind === "no_rule" ? CASE_COPY.deadlineNoRule
            : status.kind === "no_anchor_event" ? CASE_COPY.deadlineNoAnchorEvent : CASE_COPY.deadlineNoAnchor}
        </p>
      )}
      {rule ? (
        <p className="text-sm text-muted-foreground">
          Aturan {courier ? courierName(courier) : "kurir"}: {rule.window_value} {UNIT_LABEL[rule.window_unit]}
          {rule.anchor ? ` sejak ${ANCHOR_LABEL[rule.anchor]}` : ""}{rule.region_note ? ` (${rule.region_note})` : ""}.{" "}
          <a href={rule.source_url} target="_blank" rel="noreferrer" className="text-primary underline-offset-4 hover:underline">Aturan Mengantar</a>, diperbarui {SOURCE_DATE.format(new Date(`${rule.source_updated_at}T00:00:00Z`))}.
        </p>
      ) : null}
      {rule?.window_unit === "working_days" ? <p className="text-sm text-muted-foreground">{CASE_COPY.workingDaysNote}</p> : null}
      {record.anchor_at ? (
        <p className="text-sm text-muted-foreground" data-testid="case-anchor">
          Titik awal {formatWib(record.anchor_at)} ({CASE_COPY.anchorEnteredByStaff}: {who(record.anchor_entered_by, viewerId)}
          {record.anchor_entered_at ? `, ${formatWib(record.anchor_entered_at)}` : ""}) · umur{" "}
          <span className="tabular">{workingDaysBetween(record.anchor_at, now.toISOString())}</span> hari kerja
          (<span className="tabular">{calendarDaysBetween(record.anchor_at, now.toISOString())}</span> hari kalender)
        </p>
      ) : null}
    </section>
  );
}

// UX-20 items 4 and 6: the provider facts as information, the decision note, the exclusions as guidance.
export function CaseGuidance() {
  return (
    <section aria-label="Ketentuan klaim" className="flex flex-col gap-3 text-sm" data-testid="case-guidance">
      <p className="font-semibold">{CASE_COPY.decisionNote}</p>
      <p className="text-muted-foreground">{CASE_COPY.processingInfo} <span className="whitespace-nowrap">{CASE_COPY.processingSource}.</span></p>
      <div>
        <p className="font-semibold">{CASE_COPY.exclusionsTitle}</p>
        <ul className="mt-1 list-disc pl-5 text-muted-foreground">{CASE_COPY.exclusions.map((item) => <li key={item}>{item}</li>)}</ul>
        <p className="mt-1 text-muted-foreground">{CASE_COPY.exclusionsSource}</p>
      </div>
    </section>
  );
}

const EVENT_LABEL = { opened: "Kasus dibuka", updated: "Kasus diperbarui", closed: "Kasus ditutup" } as const;

export function CasePanel({ record, reference, courier, rule, events, now, viewerId, isAdmin, isDemo, reloadHref, showShipmentLink }: {
  record: CaseRecord; reference: string; courier: string | null; rule: ClaimRule | null; events: CaseEvent[];
  now: Date; viewerId: string; isAdmin: boolean; isDemo: boolean; reloadHref: string; showShipmentLink?: boolean;
}) {
  const closed = record.state === "closed";
  return (
    <article className="flex flex-col gap-4 rounded-lg bg-card p-5 ring-1 ring-border sm:p-6" data-testid="case-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="text-xl">Kasus {CASE_TYPE_LABEL[record.case_type]}</h2>
          <p className="text-sm text-muted-foreground">
            {CLAIM_TYPE_LABEL[record.claim_type]} · {courier ? courierName(courier) : "Kurir tidak diketahui"} · dibuka {formatWib(record.opened_at)} oleh {who(record.opened_by, viewerId)}
          </p>
        </div>
        <Badge variant={closed ? "neutral" : record.state === "submitted" ? "info" : "warning"} data-testid="case-state">{CASE_STATE_LABEL[record.state]}</Badge>
      </div>
      <dl className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><dt className="text-sm text-muted-foreground">{CASE_COPY.descriptionLabel}</dt><dd className="break-words whitespace-pre-line">{record.description}</dd></div>
        <div><dt className="text-sm text-muted-foreground">Bukti</dt><dd className="break-words">{record.evidence_refs.length ? <ul className="list-disc pl-5">{record.evidence_refs.map((e) => <li key={e}>{e}</li>)}</ul> : "Belum ada"}</dd></div>
        <div><dt className="text-sm text-muted-foreground">Tiket Mengantar</dt><dd className="tabular break-words">{record.provider_ticket ?? "Belum ada"}</dd></div>
        {record.region ? <div><dt className="text-sm text-muted-foreground">Wilayah tujuan</dt><dd>{REGION_LABEL[record.region]}</dd></div> : null}
      </dl>
      {closed ? (
        <dl className="grid gap-3 border-t pt-4 sm:grid-cols-3" data-testid="case-outcome">
          <div><dt className="text-sm text-muted-foreground">Hasil</dt><dd className="font-semibold">{record.outcome ? OUTCOME_LABEL[record.outcome] : "—"}</dd></div>
          {record.outcome === "compensated" ? <>
            <div><dt className="text-sm text-muted-foreground">Nilai yang diputuskan</dt><dd className="tabular">{formatIdr(record.decided_amount_idr)}{isDemo ? " (contoh)" : ""}</dd></div>
            <div><dt className="text-sm text-muted-foreground">Diputuskan oleh</dt><dd>{record.decided_by_party ? DECIDED_BY_LABEL[record.decided_by_party] : "—"}</dd></div>
          </> : null}
          <div className="sm:col-span-3 text-sm text-muted-foreground">Ditutup {formatWib(record.closed_at)} oleh {who(record.closed_by, viewerId)}</div>
        </dl>
      ) : <CaseDeadline record={record} rule={rule} courier={courier} now={now} viewerId={viewerId} />}
      <CaseGuidance />
      {events.length ? (
        <div>
          <h3 className="text-base font-semibold">Riwayat kasus</h3>
          <ol className="mt-2 flex flex-col gap-1 text-sm text-muted-foreground" data-testid="case-events">
            {events.map((e) => <li key={e.id}><span className="text-foreground">{EVENT_LABEL[e.kind]}</span> · {CASE_STATE_LABEL[e.state]} · {formatWib(e.at)} · oleh {who(e.actor, viewerId)}{e.note ? ` · ${e.note}` : ""}</li>)}
          </ol>
        </div>
      ) : null}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {showShipmentLink ? <Link href={`/pengiriman/${record.shipment_id}`} className="inline-flex min-h-11 items-center text-primary hover:underline">Lihat pengiriman {reference}</Link> : null}
        {!closed ? <CaseDialog shipmentId={record.shipment_id} reference={reference} isJne={courier === "JNE"} existing={record} reloadHref={reloadHref} /> : null}
        {!closed && isAdmin ? <CloseCaseDialog record={record} reference={reference} reloadHref={reloadHref} isDemo={isDemo} /> : null}
      </div>
      {!closed && !isAdmin ? <p className="text-sm text-muted-foreground">{CASE_COPY.closeAdminOnly}</p> : null}
    </article>
  );
}

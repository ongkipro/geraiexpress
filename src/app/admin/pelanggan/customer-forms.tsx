"use client";

// T-093 / DEC-024 (a): customer-data reads for `customer_data_review`. Every read is a POST with a
// required reason; the database writes one audit row per call. Results live only in this page's state.
import Link from "next/link";
import { useActionState } from "react";
import { Notice } from "@/components/notice";
import { SubmitButton } from "@/components/submit-button";
import { Badge } from "@/components/ui/badge";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatWib, SUBMISSION_LABEL } from "@/lib/format";
import {
  customerLookupAction, tenantCustomersAction, type CustomerLookupState, type TenantCustomersState,
} from "@/lib/platform-actions";

function Reason({ id }: { id: string }) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>Alasan membuka data pelanggan (dicatat di audit)</FieldLabel>
      <Textarea id={id} name="reason" rows={2} required minLength={5} maxLength={500} />
      <FieldDescription>Minimal 5 karakter. Setiap pembukaan tercatat dengan nama Anda.</FieldDescription>
    </Field>
  );
}

const LINK = "font-semibold text-primary underline-offset-4 hover:underline";

export function CustomerLookupForm() {
  const [state, action] = useActionState<CustomerLookupState, FormData>(customerLookupAction, {});
  const r = state.result;
  return (
    <div className="flex flex-col gap-6">
      <form action={action} className="flex flex-col gap-5 rounded-lg bg-card p-5 ring-1 ring-border md:p-6">
        {state.error ? <Notice tone="danger">{state.error}</Notice> : null}
        <FieldGroup className="gap-4">
          <Field>
            <FieldLabel htmlFor="customer-phone">Nomor HP pelanggan</FieldLabel>
            <Input id="customer-phone" name="phone" type="tel" inputMode="tel" autoComplete="off" required maxLength={20} placeholder="081234567890" />
            <FieldDescription>Penerima atau pengirim. +62 dan 0 dianggap sama.</FieldDescription>
          </Field>
          <Reason id="customer-reason" />
        </FieldGroup>
        <SubmitButton className="self-start" pendingLabel="Mencari…">Cari pelanggan</SubmitButton>
      </form>

      {r ? (
        <section aria-labelledby="customer-result-heading" className="flex flex-col gap-4" data-testid="customer-profile">
          <h2 id="customer-result-heading" className="text-xl font-semibold tracking-tight">
            Riwayat <span className="font-mono">{r.phone}</span>
          </h2>
          {r.shipments === 0 ? (
            <p className="rounded-lg bg-card p-5 ring-1 ring-border">Tidak ada kiriman dengan nomor ini di gerai mana pun.</p>
          ) : (
            <>
              <dl className="grid gap-px overflow-hidden rounded-lg bg-border ring-1 ring-border sm:grid-cols-4" data-testid="customer-totals">
                {([["Kiriman", r.shipments], ["Resi terbit", r.issued], ["Sebagai penerima", r.as_recipient], ["Sebagai pengirim", r.as_sender]] as const).map(([label, value]) => (
                  <div key={label} className="flex flex-col gap-1 bg-card p-4">
                    <dt className="text-sm text-muted-foreground">{label}</dt>
                    <dd className="text-xl font-semibold tabular">{value}</dd>
                  </div>
                ))}
              </dl>
              <p className="text-sm text-muted-foreground">Di {r.gerai_count} gerai. Satu gerai = satu cabang.</p>
              <ul className="divide-y divide-border rounded-lg bg-card px-5 ring-1 ring-border">
                {r.gerai.map((g) => (
                  <li key={`${g.tenant_id}-${g.outlet_name}`} className="flex flex-col gap-1 py-3" data-testid="customer-gerai">
                    <Link href={`/admin/pelanggan/${g.tenant_id}`} className={`${LINK} inline-flex min-h-11 items-center self-start break-words`}>{g.tenant_name}</Link>
                    <span className="text-sm text-muted-foreground">
                      Cabang {g.outlet_name} · {g.shipments} kiriman ({g.as_recipient} penerima, {g.as_sender} pengirim) · {g.issued} resi
                    </span>
                    <span className="text-sm text-muted-foreground">Pertama {formatWib(g.first_at)} · terakhir {formatWib(g.last_at)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      ) : null}
    </div>
  );
}

export function TenantCustomersPanel({ tenantId }: { tenantId: string }) {
  const [state, action] = useActionState<TenantCustomersState, FormData>(tenantCustomersAction, {});
  const rows = state.rows;
  return (
    <div className="flex flex-col gap-4">
      {rows ? null : (
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="tenant_id" value={tenantId} />
          {state.error ? <Notice tone="danger">{state.error}</Notice> : null}
          <Reason id="tenant-customers-reason" />
          <SubmitButton variant="outline" className="self-start" pendingLabel="Membuka…">Buka data pelanggan</SubmitButton>
        </form>
      )}
      {rows ? (
        <>
          <p className="text-sm text-muted-foreground" data-testid="tenant-customers-count">
            {state.tenantName ? <span className="font-semibold text-foreground">{state.tenantName}. </span> : null}
            Menampilkan {rows.length} dari {state.total} kiriman, terbaru dulu. Alasan: {state.reason}
          </p>
          {rows.length === 0 ? <p>Belum ada kiriman.</p> : (
            <ul className="divide-y divide-border rounded-lg bg-card px-5 ring-1 ring-border" data-testid="tenant-customers">
              {rows.map((s) => (
                <li key={s.id} className="flex flex-col gap-1 py-3" data-testid="tenant-customer">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-semibold">{s.reference}</span>
                    <Badge variant="neutral">{SUBMISSION_LABEL[s.submission_state] ?? s.submission_state}</Badge>
                    <span className="text-sm text-muted-foreground">{formatWib(s.created_at)} · {s.outlet_name}</span>
                  </span>
                  <span className="break-words">Penerima: {s.recipient_name ?? "—"} · {s.recipient_phone ?? "—"}</span>
                  <span className="text-sm break-words text-muted-foreground">
                    {[s.recipient_address, s.recipient_area, s.recipient_postal_code].filter(Boolean).join(", ") || "Alamat belum diisi"}
                  </span>
                  <span className="text-sm break-words">Pengirim: {s.sender_name ?? "—"} · {s.sender_phone ?? "—"}</span>
                </li>
              ))}
            </ul>
          )}
          {state.error ? <Notice tone="danger">{state.error}</Notice> : null}
          {state.total !== undefined && rows.length < state.total ? (
            <form action={action}>
              <input type="hidden" name="tenant_id" value={tenantId} />
              <input type="hidden" name="more" value="1" />
              <SubmitButton variant="outline" pendingLabel="Memuat…">Muat berikutnya (dicatat di audit)</SubmitButton>
            </form>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

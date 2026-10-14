"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { revokeGrantAction, setGrantAction, setTenantLifecycleAction, type FormState } from "@/lib/platform-actions";
import { reviewApplicationAction, setRegistrationAction } from "@/lib/registration-actions";

function Status({ state }: { state: FormState }) {
  if (state.error) return <p role="alert" className="rounded-md bg-card p-3 ring-1 ring-foreground"><span aria-hidden="true">⚠ </span>{state.error}</p>;
  if (state.ok) return <p role="status" className="rounded-md bg-card p-3 ring-1 ring-border">{state.ok}</p>;
  return null;
}

// Secondary, collapsed action: the trigger stays small and the form opens beneath it.
const SUMMARY = "inline-flex min-h-11 cursor-pointer list-none items-center rounded-sm px-3 text-sm font-semibold ring-1 ring-border hover:bg-accent [&::-webkit-details-marker]:hidden";

function Reason({ id }: { id: string }) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>Alasan (dicatat di audit)</Label>
      <Textarea id={id} name="reason" rows={2} required minLength={5} maxLength={500} />
    </div>
  );
}

export function LifecycleForm({ tenantId, tenantName, lifecycle }: { tenantId: string; tenantName: string; lifecycle: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(setTenantLifecycleAction, {});
  const target = lifecycle === "active" ? "suspended" : "active";
  const verb = target === "suspended" ? "Bekukan" : "Aktifkan kembali";
  return (
    <details className="group">
      <summary className={SUMMARY}>{verb}<span className="sr-only"> {tenantName}</span>…</summary>
      <form action={action} className="mt-3 flex flex-col gap-3 rounded-md bg-muted p-4">
        <Status state={state} />
        <input type="hidden" name="tenant_id" value={tenantId} />
        <input type="hidden" name="expected" value={lifecycle} />
        <input type="hidden" name="lifecycle" value={target} />
        <Reason id={`reason-${tenantId}`} />
        <p className="text-sm text-muted-foreground">
          {target === "suspended"
            ? "Anggota gerai tidak bisa membuka ruang kerja selama dibekukan. Riwayat pengiriman tetap tersimpan."
            : "Anggota gerai bisa kembali memakai ruang kerjanya."}
        </p>
        <Button type="submit" variant={target === "suspended" ? "destructive" : "default"} disabled={pending} className="self-start">
          {verb}
        </Button>
      </form>
    </details>
  );
}

export function GrantForm({ capabilities }: { capabilities: { value: string; label: string }[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(setGrantAction, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <Status state={state} />
      <div className="flex flex-col gap-2">
        <Label htmlFor="grant-email">Email akun terverifikasi</Label>
        <Input id="grant-email" name="email" type="email" autoComplete="off" required />
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-semibold">Kemampuan</legend>
        {capabilities.map((c) => (
          <label key={c.value} className="flex min-h-11 items-center gap-3">
            <Checkbox name="capabilities" value={c.value} /> {c.label}
          </label>
        ))}
      </fieldset>
      <Reason id="grant-reason" />
      <Button type="submit" disabled={pending} className="self-start">Simpan akses</Button>
    </form>
  );
}

export function RevokeForm({ userId, email, revision }: { userId: string; email: string; revision: number }) {
  const [state, action, pending] = useActionState<FormState, FormData>(revokeGrantAction, {});
  return (
    <details className="group">
      <summary className={SUMMARY}>Cabut akses<span className="sr-only"> {email}</span>…</summary>
      <form action={action} className="mt-3 flex flex-col gap-3 rounded-md bg-muted p-4">
        <Status state={state} />
        <input type="hidden" name="user_id" value={userId} />
        <input type="hidden" name="revision" value={revision} />
        <Reason id={`revoke-${userId}`} />
        <Button type="submit" variant="destructive" disabled={pending} className="self-start">Cabut akses</Button>
      </form>
    </details>
  );
}

const DECISIONS = [
  { value: "approve", label: "Setujui", variant: "default" },
  { value: "request_changes", label: "Minta perbaikan", variant: "outline" },
  { value: "reject", label: "Tolak", variant: "destructive" },
] as const;

// PR-15 / PR-30: one decision per submitted revision, with a reason recorded in the audit.
export function ReviewForm({ id, revision, name }: { id: string; revision: number; name: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(reviewApplicationAction, {});
  return (
    <details className="group">
      <summary className={SUMMARY}>Tinjau<span className="sr-only"> {name}</span>…</summary>
      <form action={action} className="mt-3 flex flex-col gap-3 rounded-md bg-muted p-4">
        <Status state={state} />
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="revision" value={revision} />
        <Reason id={`review-${id}`} />
        <p className="text-sm text-muted-foreground">Menyetujui membuat gerai aktif dengan pemohon sebagai admin gerai. Tidak ada akun Mengantar yang dibuat.</p>
        <div className="flex flex-wrap gap-3">
          {DECISIONS.map((d) => (
            <Button key={d.value} type="submit" name="decision" value={d.value} variant={d.variant} disabled={pending}>{d.label}</Button>
          ))}
        </div>
      </form>
    </details>
  );
}

export function RegistrationSwitch({ open }: { open: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(setRegistrationAction, {});
  return (
    <details className="group">
      <summary className={SUMMARY}>{open ? "Tutup pendaftaran" : "Buka pendaftaran"}…</summary>
      <form action={action} className="mt-3 flex flex-col gap-3 rounded-md bg-muted p-4">
        <Status state={state} />
        <input type="hidden" name="open" value={String(!open)} />
        <Reason id="registration-reason" />
        {open ? null : (
          <p className="text-sm">Buka hanya setelah pengiriman email kode (SMTP) terbukti sampai ke inbox. Tanpa itu, pendaftar tidak menerima kode.</p>
        )}
        <Button type="submit" disabled={pending} className="self-start">{open ? "Tutup pendaftaran" : "Buka pendaftaran"}</Button>
      </form>
    </details>
  );
}

"use client";

import { useActionState, useState } from "react";
import { CheckCircle2, MessageSquareWarning, XCircle } from "lucide-react";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { revokeGrantAction, setGrantAction, setTenantLifecycleAction, type FormState } from "@/lib/platform-actions";
import { reviewApplicationAction, setRegistrationAction } from "@/lib/registration-actions";
import { Notice } from "@/components/notice";

function Status({ state }: { state: FormState }) {
  if (state.error) return <Notice tone="danger">{state.error}</Notice>;
  if (state.ok) return <Notice tone="success">{state.ok}</Notice>;
  return null;
}

function Reason({ id }: { id: string }) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>Alasan (dicatat di audit)</FieldLabel>
      <Textarea id={id} name="reason" rows={3} required minLength={5} maxLength={500} />
      <FieldDescription>Minimal 5 karakter. Tidak bisa diubah setelah disimpan.</FieldDescription>
    </Field>
  );
}

// A dialog that closes itself once its action reports success; an error keeps it open with the
// typed reason intact (UX-1). Adjusts state during render when a new action result arrives.
function useDialogUntilSuccess(state: FormState) {
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    if (state.ok) setOpen(false);
  }
  return [open, setOpen] as const;
}

function DialogActions({ children }: { children: React.ReactNode }) {
  return (
    <DialogFooter className="gap-3">
      <DialogClose asChild><Button type="button" variant="ghost">Batal</Button></DialogClose>
      {children}
    </DialogFooter>
  );
}

// Suspend or reactivate: the trigger names the gerai; the dialog states the effect and needs a reason.
export function LifecycleForm({ tenantId, tenantName, lifecycle }: { tenantId: string; tenantName: string; lifecycle: string }) {
  const [state, action] = useActionState<FormState, FormData>(setTenantLifecycleAction, {});
  const [open, setOpen] = useDialogUntilSuccess(state);
  const target = lifecycle === "active" ? "suspended" : "active";
  const verb = target === "suspended" ? "Bekukan" : "Aktifkan kembali";
  return (
    <div className="flex flex-col items-start gap-2 md:items-end">
      <Button type="button" variant="outline" size="sm" className="md:min-w-[156px]" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <span>{verb}<span className="sr-only"> {tenantName}</span>…</span>
      </Button>
      {state.ok && !open ? <p role="status" className="text-sm text-success">{state.ok}</p> : null}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader className="pr-12">
            <DialogTitle>{verb} {tenantName}?</DialogTitle>
            <DialogDescription>
              {target === "suspended"
                ? "Anggota gerai tidak bisa membuka ruang kerja selama dibekukan. Riwayat pengiriman tetap tersimpan."
                : "Anggota gerai bisa kembali memakai ruang kerjanya."}
            </DialogDescription>
          </DialogHeader>
          <form action={action} className="flex flex-col gap-5">
            {state.error ? <Notice tone="danger">{state.error}</Notice> : null}
            <input type="hidden" name="tenant_id" value={tenantId} />
            <input type="hidden" name="expected" value={lifecycle} />
            <input type="hidden" name="lifecycle" value={target} />
            <Reason id={`reason-${tenantId}`} />
            <DialogActions>
              <SubmitButton pendingLabel="Menyimpan…" variant={target === "suspended" ? "destructive" : "default"}>{verb}</SubmitButton>
            </DialogActions>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function GrantForm({ capabilities }: { capabilities: { value: string; label: string }[] }) {
  const [state, action] = useActionState<FormState, FormData>(setGrantAction, {});
  return (
    <form action={action} className="flex flex-col gap-6">
      <Status state={state} />
      <FieldGroup className="gap-5">
        <Field>
          <FieldLabel htmlFor="grant-email">Email akun terverifikasi</FieldLabel>
          <Input id="grant-email" name="email" type="email" autoComplete="off" required />
          <FieldDescription>Akun harus sudah terdaftar dan emailnya terverifikasi.</FieldDescription>
        </Field>
        <FieldSet className="gap-2">
          <FieldLegend variant="label" className="mb-1 font-semibold">Kemampuan</FieldLegend>
          <FieldDescription>Pilih minimal satu. Menyimpan untuk akun yang sudah ada menggantikan kemampuannya.</FieldDescription>
          <div className="grid gap-x-6 sm:grid-cols-2">
            {capabilities.map((c) => (
              <label key={c.value} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-sm text-base">
                <Checkbox name="capabilities" value={c.value} />
                <span>{c.label}</span>
              </label>
            ))}
          </div>
        </FieldSet>
        <Reason id="grant-reason" />
      </FieldGroup>
      <SubmitButton pendingLabel="Menyimpan…" className="self-start max-sm:w-full">Simpan akses</SubmitButton>
    </form>
  );
}

export function RevokeForm({ userId, email, revision }: { userId: string; email: string; revision: number }) {
  const [state, action] = useActionState<FormState, FormData>(revokeGrantAction, {});
  const [open, setOpen] = useDialogUntilSuccess(state);
  return (
    <div className="flex flex-col items-start gap-2 md:items-end">
      <Button type="button" variant="outline" size="sm" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <span>Cabut akses<span className="sr-only"> {email}</span>…</span>
      </Button>
      {state.ok && !open ? <p role="status" className="text-sm text-success">{state.ok}</p> : null}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader className="pr-12">
            <DialogTitle>Cabut akses {email}?</DialogTitle>
            <DialogDescription>
              Akun ini kehilangan semua kemampuan Super Admin. Akunnya sendiri tetap ada.
            </DialogDescription>
          </DialogHeader>
          <form action={action} className="flex flex-col gap-5">
            {state.error ? <Notice tone="danger">{state.error}</Notice> : null}
            <input type="hidden" name="user_id" value={userId} />
            <input type="hidden" name="revision" value={revision} />
            <Reason id={`revoke-${userId}`} />
            <DialogActions>
              <SubmitButton pendingLabel="Mencabut…" variant="destructive">Cabut akses</SubmitButton>
            </DialogActions>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const DECISIONS = {
  approve: {
    label: "Setujui", Icon: CheckCircle2, variant: "default",
    effect: "Gerai langsung aktif dengan pemohon sebagai admin gerai. Tidak ada akun Mengantar yang dibuat.",
  },
  request_changes: {
    label: "Minta perbaikan", Icon: MessageSquareWarning, variant: "outline",
    effect: "Pemohon diminta memperbaiki data.",
  },
  reject: {
    label: "Tolak", Icon: XCircle, variant: "destructive",
    effect: "Pengajuan ditolak. Pemohon melihat alasannya.",
  },
} as const;
type Decision = keyof typeof DECISIONS;

// PR-15 / PR-30: one decision per submitted revision. Three grouped actions; each opens a
// confirmation that states the effect and requires a reason recorded in the audit.
export function ReviewForm({ id, revision, name }: { id: string; revision: number; name: string }) {
  const [state, action] = useActionState<FormState, FormData>(reviewApplicationAction, {});
  const [decision, setDecision] = useState<Decision | null>(null);
  const chosen = decision ? DECISIONS[decision] : null;
  return (
    <div className="flex flex-col gap-3">
      {state.error && !decision ? <Notice tone="danger">{state.error}</Notice> : null}
      <div role="group" aria-label={`Keputusan untuk ${name}`} className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        {(Object.keys(DECISIONS) as Decision[]).map((key) => {
          const d = DECISIONS[key];
          return (
            <Button key={key} type="button" variant={d.variant} aria-haspopup="dialog" onClick={() => setDecision(key)}>
              <d.Icon aria-hidden="true" /><span>{d.label}<span className="sr-only"> {name}</span>…</span>
            </Button>
          );
        })}
      </div>
      <Dialog open={decision !== null} onOpenChange={(next) => { if (!next) setDecision(null); }}>
        <DialogContent className="sm:max-w-lg">
          {chosen ? (
            <>
              <DialogHeader className="pr-12">
                <DialogTitle>{chosen.label}: {name}?</DialogTitle>
                <DialogDescription>{chosen.effect}</DialogDescription>
              </DialogHeader>
              <form action={action} className="flex flex-col gap-5">
                {state.error ? <Notice tone="danger">{state.error}</Notice> : null}
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="revision" value={revision} />
                <input type="hidden" name="decision" value={decision!} />
                <Reason id={`review-${id}`} />
                <DialogActions>
                  <SubmitButton pendingLabel="Menyimpan…" variant={chosen.variant === "outline" ? "default" : chosen.variant}>{chosen.label}</SubmitButton>
                </DialogActions>
              </form>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// The public registration gate as a switch. Flipping it never acts directly: a confirmation states
// the effect and needs a reason; the switch shows the stored state until the server confirms.
export function RegistrationSwitch({ open }: { open: boolean }) {
  const [state, action] = useActionState<FormState, FormData>(setRegistrationAction, {});
  const [confirming, setConfirming] = useDialogUntilSuccess(state);
  const verb = open ? "Tutup pendaftaran" : "Buka pendaftaran";
  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="text-sm text-muted-foreground">{open ? "Terbuka" : "Tertutup"}</span>
        <Switch
          checked={open}
          onCheckedChange={() => setConfirming(true)}
          aria-label="Pendaftaran publik"
          // The shared switch is 48x28 with an invisible hit area; this page's touch-target check measures
          // the element itself, so the gate gets a 44px-tall track with the thumb geometry to match.
          className="h-11 w-[76px] [&>span]:size-9! [&>span[data-state=checked]]:translate-x-[34px]! [&>span[data-state=unchecked]]:translate-x-[2px]!"
        />
      </div>
      {state.ok && !confirming ? <p role="status" className="text-sm text-success">{state.ok}</p> : null}
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader className="pr-12">
            <DialogTitle>{verb}?</DialogTitle>
            <DialogDescription>
              {open
                ? "Pendaftar baru tidak bisa mengajukan gerai. Akun yang sudah ada dan demo tetap bisa masuk."
                : "Siapa pun dengan email terverifikasi bisa mengajukan gerai untuk ditinjau."}
            </DialogDescription>
          </DialogHeader>
          <form action={action} className="flex flex-col gap-5">
            {state.error ? <Notice tone="danger">{state.error}</Notice> : null}
            <input type="hidden" name="open" value={String(!open)} />
            {open ? null : (
              <Notice tone="warning">Buka hanya setelah pengiriman email kode (SMTP) terbukti sampai ke inbox. Tanpa itu, pendaftar tidak menerima kode.</Notice>
            )}
            <Reason id="registration-reason" />
            <DialogActions>
              <SubmitButton pendingLabel="Menyimpan…" variant={open ? "destructive" : "default"}>{verb}</SubmitButton>
            </DialogActions>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

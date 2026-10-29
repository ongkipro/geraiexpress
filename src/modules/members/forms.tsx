"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/submit-button";
import {
  acceptInvitationAction, deactivateAction, inviteAction, revokeInvitationAction, setRoleAction, type MemberState,
} from "./actions";
import { ROLE_LABEL } from "./labels";

const ROLE_HINT: Record<string, string> = {
  operator: "Membuat dan menerbitkan pengiriman.",
  tenant_admin: "Juga mengatur anggota dan pemulihan pengiriman.",
};

function Status({ state }: { state: MemberState }) {
  if (state.error) return <p role="alert" className="rounded-md bg-danger-soft p-3 text-[15px] text-danger"><span aria-hidden="true">⚠ </span>{state.error}</p>;
  if (state.ok) return <p role="status" className="rounded-md bg-success-soft p-3 text-[15px] text-success">{state.ok}</p>;
  return null;
}

// Grouped radio list: each option is a full-width row (>=44px) with the role and what it allows.
function RoleChoice({ name, defaultValue }: { name: string; defaultValue: string }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm font-semibold">Peran</legend>
      <div className="divide-y divide-border overflow-hidden rounded-md ring-1 ring-border">
        {Object.entries(ROLE_LABEL).map(([value, label]) => (
          <label key={value} className="flex min-h-11 cursor-pointer items-center gap-3 bg-card px-3 py-2.5 has-checked:bg-accent">
            <input type="radio" name={name} value={value} defaultChecked={value === defaultValue} className="size-5 shrink-0 accent-primary" />
            <span className="flex min-w-0 flex-col">
              <span>{label}</span>
              <span className="text-sm text-muted-foreground">{ROLE_HINT[value]}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function InviteForm({ signUpUrl }: { signUpUrl: string }) {
  const [state, action, pending] = useActionState<MemberState, FormData>(inviteAction, {});
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <Status state={state} />
      {state.invitedEmail ? (
        <p className="rounded-md bg-muted p-3 text-[15px]">
          Kirim tautan <span className="font-semibold break-all">{signUpUrl}</span> ke staf. Ia masuk atau mendaftar
          dengan email <span className="font-semibold break-all">{state.invitedEmail}</span>, lalu menerima undangan. Berlaku 7 hari.
        </p>
      ) : null}
      <div className="flex flex-col gap-2">
        <Label htmlFor="invite-email">Email staf</Label>
        <Input id="invite-email" name="email" type="email" autoComplete="off" inputMode="email" required />
      </div>
      <RoleChoice name="role" defaultValue="operator" />
      <Button type="submit" disabled={pending} className="w-full sm:w-auto sm:self-start">Buat undangan</Button>
    </form>
  );
}

export function RevokeInvitationForm({ id, revision, email }: { id: string; revision: number; email: string }) {
  const [state, action, pending] = useActionState<MemberState, FormData>(revokeInvitationAction, {});
  return (
    <form action={action} className="flex flex-col items-start gap-2 md:items-end">
      <Status state={state} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="revision" value={revision} />
      <Button type="submit" variant="ghost" size="sm" disabled={pending}>
        Cabut undangan<span className="sr-only"> untuk {email}</span>
      </Button>
    </form>
  );
}

// Role change and deactivation each confirm in a dialog; the server actions are unchanged.
export function MemberControls({ userId, email, role, revision }: { userId: string; email: string; role: string; revision: number }) {
  const [roleOpen, setRoleOpen] = useState(false);
  const [roleState, roleAction] = useActionState<MemberState, FormData>(async (prev, form) => {
    const next = await setRoleAction(prev, form);
    if (next.ok) setRoleOpen(false);
    return next;
  }, {});
  const [offState, offAction] = useActionState<MemberState, FormData>(deactivateAction, {});
  return (
    <div className="flex flex-wrap gap-2 md:justify-end">
      <Dialog open={roleOpen} onOpenChange={setRoleOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm">Ubah peran<span className="sr-only"> {email}</span></Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader className="pr-12">
            <DialogTitle>Ubah peran</DialogTitle>
            <DialogDescription className="break-all">{email}</DialogDescription>
          </DialogHeader>
          <form action={roleAction} className="flex flex-col gap-5">
            <Status state={roleState} />
            <input type="hidden" name="user_id" value={userId} />
            <input type="hidden" name="revision" value={revision} />
            <RoleChoice name="role" defaultValue={role} />
            <DialogFooter>
              <DialogClose asChild><Button type="button" variant="ghost">Batal</Button></DialogClose>
              <SubmitButton pendingLabel="Menyimpan…">Simpan peran</SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog>
        <DialogTrigger asChild>
          <Button variant="ghost" size="sm" className="text-danger">Nonaktifkan<span className="sr-only"> {email}</span></Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader className="pr-12">
            <DialogTitle>Nonaktifkan anggota?</DialogTitle>
            <DialogDescription>
              <span className="font-semibold break-all text-foreground">{email}</span> langsung kehilangan akses ke gerai ini.
            </DialogDescription>
          </DialogHeader>
          <form action={offAction} className="flex flex-col gap-5">
            <Status state={offState} />
            <input type="hidden" name="user_id" value={userId} />
            <input type="hidden" name="revision" value={revision} />
            <DialogFooter>
              <DialogClose asChild><Button type="button" variant="ghost">Batal</Button></DialogClose>
              <SubmitButton variant="destructive" pendingLabel="Menonaktifkan…">Nonaktifkan</SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function AcceptInvitationForm({ id, tenantName }: { id: string; tenantName: string }) {
  const [state, action, pending] = useActionState<MemberState, FormData>(acceptInvitationAction, {});
  return (
    <form action={action} className="flex flex-col gap-2">
      <Status state={state} />
      <input type="hidden" name="id" value={id} />
      <Button type="submit" disabled={pending} className="self-start">
        Terima<span className="sr-only"> undangan {tenantName}</span>
      </Button>
    </form>
  );
}

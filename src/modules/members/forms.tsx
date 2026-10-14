"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  acceptInvitationAction, deactivateAction, inviteAction, revokeInvitationAction, setRoleAction, type MemberState,
} from "./actions";
import { ROLE_LABEL } from "./labels";

const SUMMARY = "inline-flex min-h-11 cursor-pointer list-none items-center rounded-sm px-3 text-sm font-semibold ring-1 ring-border hover:bg-accent [&::-webkit-details-marker]:hidden";

function Status({ state }: { state: MemberState }) {
  if (state.error) return <p role="alert" className="rounded-md bg-card p-3 ring-1 ring-foreground"><span aria-hidden="true">⚠ </span>{state.error}</p>;
  if (state.ok) return <p role="status" className="rounded-md bg-card p-3 ring-1 ring-border">{state.ok}</p>;
  return null;
}


function RoleChoice({ name, defaultValue }: { name: string; defaultValue: string }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-semibold">Peran</legend>
      {Object.entries(ROLE_LABEL).map(([value, label]) => (
        <label key={value} className="flex min-h-11 items-center gap-3">
          <input type="radio" name={name} value={value} defaultChecked={value === defaultValue} className="size-5 accent-primary" />
          {label}
        </label>
      ))}
    </fieldset>
  );
}

export function InviteForm({ signUpUrl }: { signUpUrl: string }) {
  const [state, action, pending] = useActionState<MemberState, FormData>(inviteAction, {});
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <Status state={state} />
      {state.invitedEmail ? (
        <p className="rounded-md bg-muted p-3 text-sm">
          Kirim tautan <span className="font-semibold break-all">{signUpUrl}</span> ke staf. Ia masuk atau mendaftar
          dengan email <span className="font-semibold break-all">{state.invitedEmail}</span>, lalu menerima undangan. Berlaku 7 hari.
        </p>
      ) : null}
      <div className="flex flex-col gap-2">
        <Label htmlFor="invite-email">Email staf</Label>
        <Input id="invite-email" name="email" type="email" autoComplete="off" inputMode="email" required />
      </div>
      <RoleChoice name="role" defaultValue="operator" />
      <Button type="submit" disabled={pending} className="self-start">Buat undangan</Button>
    </form>
  );
}

export function RevokeInvitationForm({ id, revision, email }: { id: string; revision: number; email: string }) {
  const [state, action, pending] = useActionState<MemberState, FormData>(revokeInvitationAction, {});
  return (
    <form action={action} className="flex flex-col gap-2">
      <Status state={state} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="revision" value={revision} />
      <Button type="submit" variant="ghost" size="sm" disabled={pending} className="self-start">
        Cabut undangan<span className="sr-only"> untuk {email}</span>
      </Button>
    </form>
  );
}

export function MemberControls({ userId, email, role, revision }: { userId: string; email: string; role: string; revision: number }) {
  const [roleState, roleAction, rolePending] = useActionState<MemberState, FormData>(setRoleAction, {});
  const [offState, offAction, offPending] = useActionState<MemberState, FormData>(deactivateAction, {});
  return (
    <details className="group sm:ml-auto sm:max-w-[420px]">
      <summary className={`${SUMMARY} sm:float-right`}>Atur<span className="sr-only"> {email}</span>…</summary>
      <div className="mt-3 flex flex-col gap-4 rounded-md bg-muted p-4 sm:clear-both">
        <form action={roleAction} className="flex flex-col gap-3">
          <Status state={roleState} />
          <input type="hidden" name="user_id" value={userId} />
          <input type="hidden" name="revision" value={revision} />
          <RoleChoice name="role" defaultValue={role} />
          <Button type="submit" disabled={rolePending} className="self-start">Simpan peran</Button>
        </form>
        <form action={offAction} className="flex flex-col gap-3">
          <Status state={offState} />
          <input type="hidden" name="user_id" value={userId} />
          <input type="hidden" name="revision" value={revision} />
          <p className="text-sm text-muted-foreground">Anggota nonaktif langsung kehilangan akses ke gerai ini.</p>
          <Button type="submit" variant="destructive" disabled={offPending} className="self-start">Nonaktifkan</Button>
        </form>
      </div>
    </details>
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

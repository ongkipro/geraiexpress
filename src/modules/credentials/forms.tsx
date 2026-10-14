"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { removeSellerKeyAction, setPartnerIdAction, storeSellerKeyAction, type CredentialState } from "./actions";

function Status({ state }: { state: CredentialState }) {
  if (state.error) return <p role="alert" className="rounded-md bg-card p-3 ring-1 ring-foreground"><span aria-hidden="true">⚠ </span>{state.error}</p>;
  if (state.ok) return <p role="status" className="rounded-md bg-card p-3 ring-1 ring-border">{state.ok}</p>;
  return null;
}

export function SellerKeyForm({ latestVersion, replacing }: { latestVersion: number; replacing: boolean }) {
  const [state, action, pending] = useActionState<CredentialState, FormData>(storeSellerKeyAction, {});
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <Status state={state} />
      <input type="hidden" name="latest_version" value={latestVersion} />
      <div className="flex flex-col gap-2">
        <Label htmlFor="api-key">Kunci API Mengantar</Label>
        <p id="api-key-hint" className="text-sm text-muted-foreground">Salin dari dashboard Mengantar akun bisnis Anda. Kunci disimpan terenkripsi dan tidak bisa ditampilkan lagi.</p>
        <Input id="api-key" name="api_key" type="password" autoComplete="off" spellCheck={false} aria-describedby="api-key-hint" />
      </div>
      <label className="flex min-h-11 items-start gap-3">
        <Checkbox name="owner_confirm" className="mt-1" />
        <span>Akun Mengantar ini milik bisnis saya dan saya berwenang menghubungkannya.</span>
      </label>
      <Button type="submit" disabled={pending} className="self-start">{replacing ? "Ganti kunci" : "Simpan kunci"}</Button>
    </form>
  );
}

export function RemoveSellerKeyForm({ version }: { version: number }) {
  const [state, action, pending] = useActionState<CredentialState, FormData>(removeSellerKeyAction, {});
  return (
    <form action={action} className="flex flex-col gap-2">
      <Status state={state} />
      <input type="hidden" name="version" value={version} />
      <Button type="submit" variant="ghost" size="sm" disabled={pending} className="self-start">Hapus kunci</Button>
    </form>
  );
}

export function PartnerIdForm({ current }: { current: string | null }) {
  const [state, action, pending] = useActionState<CredentialState, FormData>(setPartnerIdAction, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <Status state={state} />
      <div className="flex flex-col gap-2">
        <Label htmlFor="partner-id">Partner ID (bukan rahasia)</Label>
        <Input id="partner-id" name="partner_id" defaultValue={current ?? ""} autoComplete="off" spellCheck={false} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="partner-reason">Alasan (dicatat di audit)</Label>
        <Textarea id="partner-reason" name="reason" rows={2} required minLength={5} maxLength={500} />
      </div>
      <Button type="submit" disabled={pending} className="self-start">Simpan Partner ID</Button>
    </form>
  );
}

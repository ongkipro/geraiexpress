"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  recoverPartnerSellerKeyAction,
  registerPartnerSellerAction,
  removeSellerKeyAction,
  setPartnerIdAction,
  storeSellerKeyAction,
  type CredentialState,
} from "./actions";

export type PartnerOnboardingStatus = {
  connection_mode: string;
  onboarding_state: string;
  partner_seller_id: string | null;
  owner_name: string | null;
  owner_email: string | null;
  owner_phone: string | null;
  consent_recorded_at: string | null;
  last_error_code: string | null;
  retry_after_at: string | null;
};

function Status({ state }: { state: CredentialState }) {
  if (state.error) return <p role="alert" className="rounded-md bg-card p-3 ring-1 ring-foreground"><span aria-hidden="true">⚠ </span>{state.error}</p>;
  if (state.ok) return <p role="status" className="rounded-md bg-card p-3 ring-1 ring-border">{state.ok}</p>;
  return null;
}

export function PartnerSellerOnboardingForm({ onboarding }: { onboarding: PartnerOnboardingStatus }) {
  const [registerState, registerAction, registerPending] = useActionState<CredentialState, FormData>(
    registerPartnerSellerAction,
    {},
  );
  const [recoverState, recoverAction, recoverPending] = useActionState<CredentialState, FormData>(
    recoverPartnerSellerKeyAction,
    {},
  );

  const isPartnerConnected =
    onboarding.connection_mode === "partner_managed" && onboarding.onboarding_state === "connected";

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-md bg-muted p-4 text-sm text-muted-foreground">
        <p className="font-semibold text-foreground">Kepemilikan akun, saldo &amp; dana COD (PR-20)</p>
        <p className="mt-1">
          Akun penjual, saldo pengiriman, dan pencairan dana COD dimiliki penuh oleh pemilik bisnis gerai ini.
          Login pertama ke dashboard web Mengantar dilakukan melalui menu <span className="font-semibold text-foreground">Lupa Password</span> menggunakan email pemilik yang didaftarkan.
          GeraiExpress tidak pernah meminta atau menyimpan kata sandi Mengantar Anda.
        </p>
      </div>

      {isPartnerConnected ? (
        <div className="flex flex-col gap-1 rounded-md bg-muted p-4 text-sm" data-testid="partner-onboarding-status">
          <p className="font-semibold">Terdaftar melalui Partner Mengantar</p>
          <p className="text-muted-foreground">
            ID Penjual: <span className="font-mono text-foreground">{onboarding.partner_seller_id ?? "—"}</span>
            {onboarding.owner_email ? ` · Pemilik: ${onboarding.owner_email}` : ""}
          </p>
        </div>
      ) : null}

      {onboarding.onboarding_state === "registered_key_pending" ? (
        <div className="flex flex-col gap-3 rounded-md bg-muted p-4 text-sm" data-testid="partner-onboarding-status">
          <p>
            Akun penjual Mengantar (<span className="font-mono">{onboarding.partner_seller_id ?? "—"}</span>) sudah dibuat,
            tetapi kunci API belum selesai disiapkan saat pendaftaran awal. Gunakan tombol di bawah untuk mengambil kunci API
            tanpa membuat identitas penjual baru.
          </p>
          <form action={recoverAction} className="flex flex-col gap-3" noValidate>
            <Status state={recoverState} />
            <input type="hidden" name="owner_name" value={onboarding.owner_name ?? ""} />
            <input type="hidden" name="owner_email" value={onboarding.owner_email ?? ""} />
            <input type="hidden" name="owner_phone" value={onboarding.owner_phone ?? ""} />
            <input type="hidden" name="terms_version" value="2026-10" />
            <input type="hidden" name="privacy_version" value="2026-10" />
            <Button type="submit" disabled={recoverPending} className="self-start">
              Ambil kunci API
            </Button>
          </form>
        </div>
      ) : null}

      {onboarding.onboarding_state === "existing_account_required" ? (
        <div className="rounded-md bg-muted p-4 text-sm" data-testid="partner-onboarding-status">
          <p className="font-semibold">Email sudah terdaftar di Mengantar</p>
          <p className="mt-1 text-muted-foreground">
            Akun dengan email {onboarding.owner_email ?? "tersebut"} sudah ada di Mengantar. Masuk ke dashboard Mengantar Anda,
            salin kunci API, lalu hubungkan melalui formulir <span className="font-semibold text-foreground">Akun Mengantar (kunci API sendiri)</span> di bawah.
          </p>
        </div>
      ) : null}

      {onboarding.onboarding_state === "quota_wait" ? (
        <div className="rounded-md bg-muted p-4 text-sm" data-testid="partner-onboarding-status">
          <p className="font-semibold">Menunggu kuota pendaftaran Mengantar</p>
          <p className="mt-1 text-muted-foreground">
            Batas permintaan pendaftaran Partner Mengantar sedang tercapai. Tunggu beberapa saat lalu kirim ulang formulir ini;
            identitas gerai tetap sama dan tidak akan menggandakan akun.
          </p>
        </div>
      ) : null}

      {onboarding.onboarding_state === "provider_restricted" ? (
        <div className="rounded-md bg-muted p-4 text-sm" data-testid="partner-onboarding-status">
          <p className="font-semibold">Akses dibatasi oleh Mengantar</p>
          <p className="mt-1 text-muted-foreground">
            Akun penjual atau integrasi Partner sedang dibatasi oleh Mengantar ({onboarding.last_error_code ?? "RESTRICTED"}).
            Hubungi dukungan Mengantar untuk pemeriksaan akun.
          </p>
        </div>
      ) : null}

      {onboarding.onboarding_state === "configuration_blocked" ? (
        <div className="rounded-md bg-muted p-4 text-sm" data-testid="partner-onboarding-status">
          <p className="font-semibold">Pendaftaran Partner belum aktif di server</p>
          <p className="mt-1 text-muted-foreground">
            Konfigurasi Partner Mengantar belum tersedia di lingkungan ini. Anda tetap dapat menghubungkan akun menggunakan formulir kunci API sendiri (BYOK) di bawah.
          </p>
        </div>
      ) : null}

      {!isPartnerConnected ? (
        <form action={registerAction} className="flex flex-col gap-4" noValidate>
          <Status state={registerState} />
          <input type="hidden" name="terms_version" value="2026-10" />
          <input type="hidden" name="privacy_version" value="2026-10" />
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="partner-owner-name">Nama pemilik akun Mengantar</Label>
              <Input
                id="partner-owner-name"
                name="owner_name"
                defaultValue={onboarding.owner_name ?? ""}
                autoComplete="name"
                maxLength={100}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="partner-owner-email">Email pemilik</Label>
              <Input
                id="partner-owner-email"
                name="owner_email"
                type="email"
                defaultValue={onboarding.owner_email ?? ""}
                autoComplete="email"
                spellCheck={false}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="partner-owner-phone">No. HP pemilik (08...)</Label>
              <Input
                id="partner-owner-phone"
                name="owner_phone"
                type="tel"
                defaultValue={onboarding.owner_phone ?? ""}
                autoComplete="tel"
                placeholder="081234567890"
              />
            </div>
          </div>
          <label className="flex min-h-11 items-start gap-3">
            <Checkbox name="consent_agreed" className="mt-1" />
            <span>
              Saya menyatakan data pemilik bisnis di atas benar, akun penjual beserta saldo dan dana COD dimiliki oleh bisnis gerai ini,
              serta menyetujui Ketentuan Layanan dan Kebijakan Privasi Mengantar.
            </span>
          </label>
          <Button type="submit" disabled={registerPending} className="self-start">
            Daftarkan akun Mengantar baru
          </Button>
        </form>
      ) : null}
    </div>
  );
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

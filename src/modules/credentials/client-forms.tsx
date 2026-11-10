"use client";

import { useActionState, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Clock, Info, type LucideIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SubmitButton } from "@/components/submit-button";
import { formatWib } from "@/lib/format";
import type { PartnerConsentDocuments } from "@/lib/mengantar/partner-onboarding";
import {
  recoverPartnerSellerKeyAction,
  registerPartnerSellerAction,
  removeSellerKeyAction,
  setPartnerIdAction,
  storeSellerKeyAction,
  storeWebhookSecretAction,
  type CredentialState,
} from "./actions";
import { recoverRotatedPartnerKeyAction, regeneratePartnerKeyAction } from "./rotation-actions";

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
  if (state.error) {
    return (
      <Alert variant="destructive" className="border-0 bg-danger-soft">
        <AlertTriangle aria-hidden="true" />
        <AlertDescription className="text-foreground">{state.error}</AlertDescription>
      </Alert>
    );
  }
  if (state.ok) {
    return (
      <Alert role="status" className="border-0 bg-success-soft">
        <CheckCircle2 className="text-success" aria-hidden="true" />
        <AlertDescription className="text-foreground">{state.ok}</AlertDescription>
      </Alert>
    );
  }
  return null;
}

// Provider-state panels inside the Mengantar card: a soft tone fill (no nested border) and a title that
// carries an icon with the text, so the state never reads by colour alone (UI-2).
const PANEL = {
  warning: "rounded-md bg-warning-soft p-4 text-sm",
  info: "rounded-md bg-info-soft p-4 text-sm",
  success: "rounded-md bg-success-soft p-4 text-sm",
  pending: "rounded-md bg-pending-soft p-4 text-sm",
} as const;
const PANEL_ICON: Record<keyof typeof PANEL, { Icon: LucideIcon; className: string }> = {
  warning: { Icon: AlertTriangle, className: "text-warning" },
  info: { Icon: Info, className: "text-info" },
  success: { Icon: CheckCircle2, className: "text-success" },
  pending: { Icon: Clock, className: "text-pending" },
};
function PanelTitle({ tone, children }: { tone: keyof typeof PANEL; children: ReactNode }) {
  const { Icon, className } = PANEL_ICON[tone];
  return (
    <p className="flex items-start gap-2 font-semibold">
      <Icon className={`mt-0.5 size-4 shrink-0 ${className}`} aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

// T-039 / UX-2 / UX-8: regenerating retires the old key at Mengantar at once and pauses shipments until the new
// key is stored, so it needs an explicit confirmation naming both effects. Tenant administrators of
// Partner-managed gerai only (the parent renders it for them); the action refuses everyone else.
function RegenerateKeyControl({ action, pending }: { action: (data: FormData) => void; pending: boolean }) {
  const [open, setOpen] = useState(false);
  // The confirm button submits a form through SubmitButton, which refuses a second click in the same tick.
  function confirm(data: FormData) {
    setOpen(false);
    action(data);
  }
  return (
    <div className="flex flex-col gap-2" data-testid="partner-key-regenerate">
      {pending ? <p role="status" className="text-sm text-muted-foreground">Membuat ulang kunci API di Mengantar dan menyimpannya. Jangan tutup halaman ini.</p> : null}
      <Button type="button" variant="outline" disabled={pending} aria-busy={pending} aria-haspopup="dialog" onClick={() => setOpen(true)} className="self-start">
        Buat ulang kunci API
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Buat ulang kunci API Mengantar?</DialogTitle>
            <DialogDescription>
              Kunci lama berhenti berlaku seketika di Mengantar. Cek ongkir, penerbitan resi, dan pengiriman gerai ini dijeda sampai kunci baru
              tersimpan; jika hasilnya belum pasti, pengiriman tetap dijeda sampai Anda memilih Ambil kunci terbaru.
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Kunci baru disimpan terenkripsi dan tidak ditampilkan. Alamat pickup gerai tidak berubah. Pastikan tidak ada aplikasi lain
            yang masih memakai kunci lama.
          </p>
          <form action={confirm}>
            <input type="hidden" name="confirm_regenerate" value="yes" />
            <DialogFooter className="gap-3">
              <DialogClose asChild><Button type="button" variant="outline">Batal</Button></DialogClose>
              <SubmitButton variant="destructive" pendingLabel="Membuat ulang…" data-testid="partner-key-regenerate-confirm">Ya, buat ulang kunci</SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// T-039 / UX-8: the rotation outcome is unknown or the key is paused after a refusal. Shipments stay paused
// until the current key is fetched. Fetching never rotates the key again.
function RotationUnknownPanel({ onboarding, action }: {
  onboarding: PartnerOnboardingStatus;
  action: (data: FormData) => void;
}) {
  return (
    <div className={`flex flex-col gap-3 ${PANEL.warning}`} data-testid="partner-rotation-unknown">
      <PanelTitle tone="warning">Kunci API dijeda: hasil pembuatan ulang belum pasti</PanelTitle>
      <p className="text-muted-foreground">
        Pengiriman, cek ongkir, dan penerbitan resi dijeda sampai kunci terbaru diambil dari Mengantar. Tombol di bawah
        hanya mengambil kunci yang berlaku sekarang; kunci tidak dibuat ulang lagi.
        {onboarding.retry_after_at ? ` Mengantar meminta menunggu sampai ${formatWib(onboarding.retry_after_at)}.` : ""}
      </p>
      <form action={action} className="flex flex-col gap-3" noValidate>
        <SubmitButton pendingLabel="Mengambil kunci…" className="self-start">Ambil kunci terbaru</SubmitButton>
      </form>
    </div>
  );
}

export function PartnerSellerOnboardingFields({ onboarding, documents }: {
  onboarding: PartnerOnboardingStatus;
  documents: PartnerConsentDocuments | null;
}) {
  const [registerState, registerAction] = useActionState<CredentialState, FormData>(
    registerPartnerSellerAction,
    {},
  );
  const [recoverState, recoverAction] = useActionState<CredentialState, FormData>(
    recoverPartnerSellerKeyAction,
    {},
  );
  // The two rotation actions live here, not in their panels: a lost or refused regeneration switches
  // the visible panel, and the outcome message must survive that switch.
  const [regenerateState, regenerateAction, regeneratePending] = useActionState<CredentialState, FormData>(
    regeneratePartnerKeyAction,
    {},
  );
  const [rotationRecoverState, rotationRecoverAction] = useActionState<CredentialState, FormData>(
    recoverRotatedPartnerKeyAction,
    {},
  );

  const isPartnerConnected =
    onboarding.connection_mode === "partner_managed" && onboarding.onboarding_state === "connected";
  // A tenant that was Partner-connected and is now paused or stopped has its own recovery or stop panel;
  // the first-time registration form would only re-run onboarding for the same seller.
  const keyFlowStopped = onboarding.connection_mode === "partner_managed" && !isPartnerConnected;

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-md bg-muted p-4 text-sm text-muted-foreground">
        <p className="font-semibold text-foreground">Kepemilikan akun, saldo &amp; dana COD</p>
        <p className="mt-1">
          Akun penjual, saldo pengiriman, dan pencairan dana COD dimiliki penuh oleh pemilik bisnis gerai ini.
          Saat pertama kali masuk ke dashboard web Mengantar, gunakan menu <span className="font-semibold text-foreground">Lupa Password</span> dengan email pemilik yang didaftarkan.
          GeraiExpress tidak pernah meminta atau menyimpan kata sandi Mengantar Anda.
        </p>
      </div>

      {regenerateState.error || regenerateState.ok || rotationRecoverState.error || rotationRecoverState.ok ? (
        <div className="flex flex-col gap-2" data-testid="partner-key-feedback">
          <Status state={regenerateState} />
          <Status state={rotationRecoverState} />
        </div>
      ) : null}

      {isPartnerConnected ? (
        <div className={`flex flex-col gap-1 ${PANEL.success}`} data-testid="partner-onboarding-status">
          <PanelTitle tone="success">Terdaftar melalui Partner Mengantar</PanelTitle>
          <p className="text-muted-foreground">
            ID Penjual: <span className="font-mono text-foreground">{onboarding.partner_seller_id ?? "—"}</span>
            {onboarding.owner_email ? ` · Pemilik: ${onboarding.owner_email}` : ""}
          </p>
          <RegenerateKeyControl action={regenerateAction} pending={regeneratePending} />
        </div>
      ) : null}

      {onboarding.onboarding_state === "registered_key_pending" ? (
        <div className={`flex flex-col gap-3 ${PANEL.warning}`} data-testid="partner-onboarding-status">
          <p>
            Akun penjual Mengantar (<span className="font-mono">{onboarding.partner_seller_id ?? "—"}</span>) sudah dibuat,
            tetapi kunci API belum selesai disiapkan saat pendaftaran awal. Gunakan tombol di bawah untuk mengambil kunci API
            tanpa membuat identitas penjual baru.
          </p>
          <form action={recoverAction} className="flex flex-col gap-3" noValidate>
            <Status state={recoverState} />
            <SubmitButton pendingLabel="Mengambil kunci…" className="self-start">
              Ambil kunci API
            </SubmitButton>
          </form>
        </div>
      ) : null}

      {onboarding.onboarding_state === "rotation_unknown" ? (
        <RotationUnknownPanel onboarding={onboarding} action={rotationRecoverAction} />
      ) : null}

      {onboarding.onboarding_state === "existing_account_required" ? (
        <div className={PANEL.info} data-testid="partner-onboarding-status">
          <PanelTitle tone="info">Email sudah terdaftar di Mengantar</PanelTitle>
          <p className="mt-1 text-muted-foreground">
            Akun dengan email {onboarding.owner_email ?? "tersebut"} sudah ada di Mengantar. Masuk ke dashboard Mengantar Anda,
            salin kunci API, lalu hubungkan melalui formulir <span className="font-semibold text-foreground">Akun Mengantar (kunci API sendiri)</span> di bawah.
          </p>
        </div>
      ) : null}

      {onboarding.onboarding_state === "quota_wait" ? (
        <div className={PANEL.pending} data-testid="partner-onboarding-status">
          <PanelTitle tone="pending">Menunggu kuota pendaftaran Mengantar</PanelTitle>
          <p className="mt-1 text-muted-foreground">
            Batas permintaan pendaftaran Partner Mengantar sedang tercapai. Tunggu beberapa saat lalu kirim ulang formulir ini;
            identitas gerai tetap sama dan tidak akan menggandakan akun.
          </p>
        </div>
      ) : null}

      {onboarding.onboarding_state === "provider_restricted" ? (
        <div className={PANEL.warning} data-testid="partner-onboarding-status">
          <PanelTitle tone="warning">Akses dibatasi oleh Mengantar</PanelTitle>
          {onboarding.last_error_code === "SELLER_DEACTIVATED" || onboarding.last_error_code === "API_KEY_DISABLED" ? (
            <p className="mt-1 text-muted-foreground" data-testid="partner-key-stopped">
              {onboarding.last_error_code === "SELLER_DEACTIVATED"
                ? "Mengantar menonaktifkan akun penjual ini."
                : "Mengantar menonaktifkan kunci API akun penjual ini."}{" "}
              Pembuatan ulang kunci dihentikan dan tidak akan dicoba lagi, dan pengiriman tetap dijeda. Hubungi dukungan Mengantar,
              atau hubungkan akun dengan kunci API sendiri (BYOK) di bawah.
            </p>
          ) : (
            <p className="mt-1 text-muted-foreground">
              Akun penjual atau integrasi Partner sedang dibatasi oleh Mengantar ({onboarding.last_error_code ?? "RESTRICTED"}).
              Hubungi dukungan Mengantar untuk pemeriksaan akun.
            </p>
          )}
        </div>
      ) : null}

      {onboarding.onboarding_state === "configuration_blocked" ? (
        <div className={PANEL.warning} data-testid="partner-onboarding-status">
          {onboarding.last_error_code === "SELLER_BINDING_MISMATCH" ? (
            <>
              <PanelTitle tone="warning">Akun penjual tidak cocok dengan gerai ini</PanelTitle>
              <p className="mt-1 text-muted-foreground">
                Mengantar tidak mengonfirmasi akun penjual yang tersimpan sebagai milik gerai ini, jadi kunci API tidak diambil.
                Hubungi admin GeraiExpress, atau hubungkan akun menggunakan formulir kunci API sendiri (BYOK) di bawah.
              </p>
            </>
          ) : (
            <>
              <PanelTitle tone="warning">Pendaftaran Partner belum aktif di server</PanelTitle>
              <p className="mt-1 text-muted-foreground">
                Konfigurasi Partner Mengantar belum tersedia di lingkungan ini. Anda tetap dapat menghubungkan akun menggunakan formulir kunci API sendiri (BYOK) di bawah.
              </p>
            </>
          )}
        </div>
      ) : null}

      {!isPartnerConnected && !keyFlowStopped ? (
        <form action={registerAction} className="flex flex-col gap-4" noValidate>
          <Status state={registerState} />
          <div className="grid gap-4 sm:grid-cols-3 sm:items-end">
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
              serta menyetujui{" "}
              {documents ? <a href={documents.termsUrl} target="_blank" rel="noopener noreferrer" className="underline">Ketentuan Layanan Mengantar</a> : "Ketentuan Layanan Mengantar"}
              {" dan "}
              {documents ? <a href={documents.privacyUrl} target="_blank" rel="noopener noreferrer" className="underline">Kebijakan Privasi Mengantar</a> : "Kebijakan Privasi Mengantar"}.
            </span>
          </label>
          {!documents ? (
            <p id="partner-documents-missing" role="alert" className="text-sm text-muted-foreground">
              Dokumen Ketentuan Layanan dan Kebijakan Privasi Mengantar belum dikonfigurasi oleh admin GeraiExpress.
              Pendaftaran belum dapat dikirim; gunakan kunci API sendiri (BYOK) atau hubungi admin.
            </p>
          ) : null}
          <SubmitButton disabled={!documents} aria-describedby={documents ? undefined : "partner-documents-missing"}
            pendingLabel="Mendaftarkan…" className="max-w-full self-start whitespace-normal">
            Daftarkan akun Mengantar baru
          </SubmitButton>
        </form>
      ) : null}
    </div>
  );
}

// T-045 / ADR-0003: the Mengantar Webhook Secret, write-only (only a short hint is ever shown).
export function WebhookSecretForm({ secretVersion, replacing }: { secretVersion: number; replacing: boolean }) {
  const [state, action] = useActionState<CredentialState, FormData>(storeWebhookSecretAction, {});
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <Status state={state} />
      <input type="hidden" name="secret_version" value={secretVersion} />
      <div className="flex flex-col gap-2">
        <Label htmlFor="webhook-secret">Rahasia webhook (Webhook Secret)</Label>
        <p id="webhook-secret-hint" className="text-sm text-muted-foreground">Muncul di Mengantar setelah URL webhook disimpan. Disimpan terenkripsi dan tidak bisa ditampilkan lagi.</p>
        <Input id="webhook-secret" name="webhook_secret" type="password" autoComplete="off" spellCheck={false} aria-describedby="webhook-secret-hint" />
      </div>
      <SubmitButton pendingLabel="Menyimpan rahasia…" className="self-start">{replacing ? "Ganti rahasia" : "Simpan rahasia"}</SubmitButton>
    </form>
  );
}

export function SellerKeyForm({ latestVersion, replacing }: { latestVersion: number; replacing: boolean }) {
  const [state, action] = useActionState<CredentialState, FormData>(storeSellerKeyAction, {});
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
      <SubmitButton pendingLabel="Menyimpan kunci…" className="self-start">{replacing ? "Ganti kunci" : "Simpan kunci"}</SubmitButton>
    </form>
  );
}

// UX-13: removing the key stops shipping for the gerai, so it is confirmed first. The confirm button
// closes the dialog and starts the action once; while it runs the trigger is disabled and busy, so a
// repeated click cannot start a second removal.
export function RemoveSellerKeyForm({ version }: { version: number }) {
  const [state, action, pending] = useActionState<CredentialState, FormData>(removeSellerKeyAction, {});
  const [open, setOpen] = useState(false);
  function confirm(data: FormData) {
    setOpen(false);
    action(data);
  }
  return (
    <div className="flex flex-col gap-2">
      <Status state={state} />
      {pending ? <p role="status" className="text-sm text-muted-foreground">Menghapus kunci…</p> : null}
      <Button type="button" variant="ghost" size="sm" disabled={pending} aria-busy={pending} aria-haspopup="dialog" onClick={() => setOpen(true)} className="self-start">Hapus kunci</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg" data-testid="remove-key-dialog">
          <DialogHeader>
            <DialogTitle>Hapus kunci API Mengantar?</DialogTitle>
            <DialogDescription>
              Pengiriman gerai ini berhenti sampai kunci baru disimpan: cek ongkir, penerbitan resi, dan pembayaran batch tidak bisa dijalankan.
              Kunci yang dihapus tidak bisa ditampilkan lagi.
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Pesanan yang sudah dibuat di Mengantar tidak berubah, tetapi pemeriksaannya tertunda sampai ada kunci baru.
          </p>
          <form action={confirm}>
            <input type="hidden" name="version" value={version} />
            <DialogFooter className="gap-3">
              <DialogClose asChild><Button type="button" variant="outline">Batal</Button></DialogClose>
              <SubmitButton variant="destructive" pendingLabel="Menghapus…" data-testid="remove-key-confirm">Ya, hapus kunci</SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function PartnerIdForm({ current }: { current: string | null }) {
  const [state, action] = useActionState<CredentialState, FormData>(setPartnerIdAction, {});
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
      <SubmitButton pendingLabel="Menyimpan…" className="self-start">Simpan Partner ID</SubmitButton>
    </form>
  );
}

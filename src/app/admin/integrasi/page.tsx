import type { Metadata } from "next";
import { CheckCircle2, CircleSlash, HelpCircle } from "lucide-react";
import { formatWib } from "@/lib/format";
import { requirePlatform } from "@/lib/platform";
import { supabaseServer } from "@/lib/supabase/server";
import { workerSecret } from "@/lib/worker-secret";
import { PartnerIdForm } from "@/modules/credentials/forms";

export const metadata: Metadata = { title: "Integrasi Mengantar · Super Admin" };

type Row = { tenant_id: string; tenant_name: string; lifecycle: string; configured: boolean; mode: string | null; hint: string | null; version: number | null; stored_at: string | null };

function Badge({ ok, label }: { ok: boolean | null; label: string }) {
  const Icon = ok === null ? HelpCircle : ok ? CheckCircle2 : CircleSlash;
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-full bg-muted px-2.5 py-1 text-sm ring-1 ring-border">
      <Icon className="size-4" aria-hidden="true" /> {label}
    </span>
  );
}

// PR-26 / SEC-3: platform configuration and per-gerai seller connection state, never values.
// The Partner Secret is a Worker secret binding; this page only reports whether it is present.
export default async function IntegrationsPage() {
  await requirePlatform("integration_operations");
  const supabase = await supabaseServer();
  const [{ data: config }, { data: raw }] = await Promise.all([
    supabase.rpc("platform_partner_config"),
    supabase.rpc("platform_integrations"),
  ]);
  const partnerId = ((config ?? []) as { partner_id: string | null }[])[0]?.partner_id ?? null;
  const secretPresent = Boolean(workerSecret("MENGANTAR_PARTNER_SECRET"));
  const sealingPresent = Boolean(workerSecret("CREDENTIAL_KEY"));
  const rows = (raw ?? []) as Row[];

  return (
    <div className="flex max-w-[980px] flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl tracking-tight">Integrasi Mengantar</h1>
        <p className="text-muted-foreground">Kesiapan konfigurasi platform dan koneksi akun penjual tiap gerai. Nilai rahasia tidak pernah ditampilkan.</p>
      </div>

      <section aria-labelledby="platform-heading" className="flex flex-col gap-3">
        <h2 id="platform-heading" className="text-xl">Konfigurasi platform</h2>
        <ul className="divide-y divide-border rounded-lg bg-card ring-1 ring-border">
          <li className="flex flex-col gap-2 p-4 sm:flex-row sm:justify-between" data-testid="partner-id-status">
            <span><span className="font-semibold">Partner ID</span><span className="block text-sm text-muted-foreground">{partnerId ?? "Belum diisi."}</span></span>
            <Badge ok={Boolean(partnerId)} label={partnerId ? "Terisi" : "Belum diisi"} />
          </li>
          <li className="flex flex-col gap-2 p-4 sm:flex-row sm:justify-between" data-testid="partner-secret-status">
            <span><span className="font-semibold">Partner Secret</span><span className="block text-sm text-muted-foreground">Dipasang sebagai Worker secret oleh pemilik (<code>wrangler secret put MENGANTAR_PARTNER_SECRET</code>), tidak lewat halaman ini.</span></span>
            <Badge ok={secretPresent} label={secretPresent ? "Terpasang" : "Belum dipasang"} />
          </li>
          <li className="flex flex-col gap-2 p-4 sm:flex-row sm:justify-between" data-testid="sealing-key-status">
            <span><span className="font-semibold">Kunci enkripsi kredensial</span><span className="block text-sm text-muted-foreground">Worker secret <code>CREDENTIAL_KEY</code> untuk menyegel kunci API penjual.</span></span>
            <Badge ok={sealingPresent} label={sealingPresent ? "Terpasang" : "Belum dipasang"} />
          </li>
        </ul>
        <details className="group">
          <summary className="inline-flex min-h-11 cursor-pointer list-none items-center rounded-sm px-3 text-sm font-semibold ring-1 ring-border hover:bg-accent [&::-webkit-details-marker]:hidden">Ubah Partner ID…</summary>
          <div className="mt-3 rounded-md bg-muted p-4"><PartnerIdForm current={partnerId} /></div>
        </details>
      </section>

      <section aria-labelledby="sellers-heading" className="flex flex-col gap-3">
        <h2 id="sellers-heading" className="text-xl">Akun penjual per gerai</h2>
        <ul className="divide-y divide-border rounded-lg bg-card ring-1 ring-border">
          {rows.map((r) => (
            <li key={r.tenant_id} className="flex flex-col gap-2 p-4 sm:flex-row sm:justify-between" data-testid="seller-binding">
              <span>
                <span className="font-semibold">{r.tenant_name}</span>
                <span className="block text-sm text-muted-foreground">
                  {r.configured ? `Kunci sendiri (BYOK) berakhiran …${r.hint}, versi ${r.version}, disimpan ${formatWib(r.stored_at)}` : "Belum ada kunci API."}
                </span>
              </span>
              <Badge ok={r.configured ? null : false} label={r.configured ? "Tersimpan, belum diverifikasi" : "Belum terhubung"} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

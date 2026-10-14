import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { signOutAction } from "@/lib/auth-actions";
import { formatWib } from "@/lib/format";
import { supabaseServer } from "@/lib/supabase/server";
import { ApplicationForm, WithdrawForm } from "../forms";

export const metadata: Metadata = { title: "Pengajuan gerai" };

type Row = {
  id: string; status: string; revision: number; business_name: string | null; outlet_name: string | null;
  pickup_address: string | null; pickup_area: string | null; contact_phone: string | null;
  review_reason: string | null; submitted_at: string | null; reviewed_at: string | null;
};

// PR-30 / UX-7 / TEN-5: the applicant sees only their own application and its next step.
export default async function ApplicationPage() {
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user || auth.user.is_anonymous) redirect("/masuk");
  const [{ data: state }, { data: rows }] = await Promise.all([
    supabase.rpc("my_account_state"),
    supabase.from("tenant_applications")
      .select("id, status, revision, business_name, outlet_name, pickup_address, pickup_area, contact_phone, review_reason, submitted_at, reviewed_at")
      .order("created_at", { ascending: false }).limit(1),
  ]);
  const account = (state as { has_password: boolean; registration_open: boolean }[] | null)?.[0];
  if (!account) redirect("/masuk");
  if (!account.has_password) redirect("/daftar/kata-sandi");
  const latest = (rows?.[0] ?? null) as Row | null;
  const editable = latest && (latest.status === "draft" || latest.status === "changes_requested");
  const startNew = !latest || ["rejected", "withdrawn", "approved"].includes(latest.status);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[640px] flex-col gap-8 px-5 py-12">
      <header className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">GeraiExpress · {auth.user.email}</p>
        <h1 className="text-3xl tracking-tight">Pengajuan gerai</h1>
      </header>

      {latest?.status === "submitted" ? (
        <section role="status" className="flex flex-col gap-3 rounded-lg bg-card p-6 ring-1 ring-border">
          <h2 className="text-xl">Sedang ditinjau</h2>
          <p>Pengajuan <strong>{latest.business_name}</strong> dikirim {formatWib(latest.submitted_at)}. Ruang kerja gerai terbuka setelah disetujui; akun Mengantar dihubungkan sesudahnya.</p>
          <WithdrawForm id={latest.id} revision={latest.revision} />
        </section>
      ) : null}

      {latest?.status === "approved" ? (
        <section role="status" className="flex flex-col gap-3 rounded-lg bg-card p-6 ring-1 ring-border">
          <h2 className="text-xl">Disetujui</h2>
          <p><strong>{latest.business_name}</strong> sudah aktif dan Anda adalah admin gerainya.</p>
          <Button asChild className="self-start"><Link href="/pengiriman">Buka ruang kerja</Link></Button>
        </section>
      ) : null}

      {latest?.status === "rejected" ? (
        <section role="status" className="flex flex-col gap-2 rounded-lg bg-card p-6 ring-1 ring-foreground">
          <h2 className="text-xl">Pengajuan ditolak</h2>
          <p>Alasan: {latest.review_reason}</p>
        </section>
      ) : null}

      {latest?.status === "changes_requested" ? (
        <section role="status" className="flex flex-col gap-2 rounded-lg bg-card p-6 ring-1 ring-foreground">
          <h2 className="text-xl">Perlu perbaikan</h2>
          <p>Catatan peninjau: {latest.review_reason}</p>
        </section>
      ) : null}

      {editable || (startNew && account.registration_open) ? (
        <section aria-labelledby="form-heading" className="flex flex-col gap-4 rounded-lg bg-card p-6 ring-1 ring-border">
          <h2 id="form-heading" className="text-xl">{editable ? "Data gerai" : latest ? "Ajukan gerai baru" : "Data gerai"}</h2>
          <p className="text-sm text-muted-foreground">Tim GeraiExpress meninjau setiap pengajuan selama masa pilot. Draf tersimpan bisa dilanjutkan kapan saja.</p>
          <ApplicationForm application={editable ? latest : null} />
          {editable && latest ? <WithdrawForm id={latest.id} revision={latest.revision} /> : null}
        </section>
      ) : startNew ? (
        <p role="status" className="rounded-lg bg-card p-6 ring-1 ring-border">Pengajuan gerai baru sedang ditutup.</p>
      ) : null}

      <form action={signOutAction}>
        <Button type="submit" variant="ghost">Keluar</Button>
      </form>
    </main>
  );
}

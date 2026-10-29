import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthCard, AuthFooter, AuthHeading, AuthShell } from "@/components/auth/auth-shell";
import { RegistrationSteps } from "@/components/auth/registration-steps";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { signOutAction } from "@/lib/auth-actions";
import { currentUser, dbServer } from "@/lib/db/server";
import { ApplicationForm, WithdrawForm } from "../forms";
import { NextStep, ReviewTimeline } from "./review-timeline";

export const metadata: Metadata = { title: "Pengajuan gerai" };

type Row = {
  id: string; status: string; revision: number; business_name: string | null; outlet_name: string | null;
  pickup_address: string | null; pickup_area: string | null; contact_phone: string | null;
  review_reason: string | null; submitted_at: string | null; reviewed_at: string | null;
};

const STATUS_HEADING: Record<string, string> = {
  submitted: "Sedang ditinjau",
  approved: "Disetujui",
  changes_requested: "Perlu perbaikan",
  rejected: "Pengajuan ditolak",
};

// PR-30 / UX-7 / TEN-5: the applicant sees only their own application and its next step.
export default async function ApplicationPage() {
  const user = await currentUser();
  if (!user || user.isAnonymous) redirect("/masuk");
  const db = await dbServer();
  const [{ data: state }, { data: rows }] = await Promise.all([
    db.rpc("my_account_state"),
    db.from("tenant_applications")
      .select("id, status, revision, business_name, outlet_name, pickup_address, pickup_area, contact_phone, review_reason, submitted_at, reviewed_at")
      .order("created_at", { ascending: false }).limit(1),
  ]);
  const account = (state as { has_password: boolean; registration_open: boolean }[] | null)?.[0];
  if (!account) redirect("/masuk");
  if (!account.has_password) redirect("/daftar/kata-sandi");
  const latest = (rows?.[0] ?? null) as Row | null;
  const editable = latest && (latest.status === "draft" || latest.status === "changes_requested");
  const startNew = !latest || ["rejected", "withdrawn", "approved"].includes(latest.status);
  const showForm = Boolean(editable || (startNew && account.registration_open));
  const reviewed = latest && STATUS_HEADING[latest.status] ? latest : null;
  const stage = latest?.status === "approved" ? "selesai" : latest?.status === "submitted" || latest?.status === "rejected" ? "tinjauan" : "gerai";

  return (
    <AuthShell width="lg">
      <AuthCard className="overflow-visible">
        <RegistrationSteps current={stage} />
        <AuthHeading
          eyebrow={<>Masuk sebagai <span className="font-semibold text-foreground wrap-anywhere">{user.email}</span></>}
          title="Pengajuan gerai"
          description="Tim GeraiExpress meninjau setiap pengajuan selama masa pilot. Draf tersimpan bisa dilanjutkan kapan saja."
        />

        {reviewed ? (
          <section role="status" aria-labelledby="review-heading" className="flex flex-col gap-4">
            <h2 id="review-heading" className="text-xl font-semibold">{STATUS_HEADING[reviewed.status]}</h2>
            {reviewed.business_name ? <p className="break-words">Gerai <strong>{reviewed.business_name}</strong></p> : null}
            <ReviewTimeline status={reviewed.status} submittedAt={reviewed.submitted_at} reviewedAt={reviewed.reviewed_at} reason={reviewed.review_reason} />
            <NextStep status={reviewed.status} registrationOpen={account.registration_open} />
            {reviewed.status === "submitted" ? <WithdrawForm id={reviewed.id} revision={reviewed.revision} /> : null}
          </section>
        ) : null}

        {reviewed && (showForm || startNew) ? <Separator /> : null}

        {showForm ? (
          <section aria-labelledby="form-heading" className="flex flex-col gap-6">
            <h2 id="form-heading" className="text-xl font-semibold">{editable ? "Data gerai" : latest ? "Ajukan gerai baru" : "Data gerai"}</h2>
            <ApplicationForm application={editable ? latest : null} />
            {editable && latest ? <WithdrawForm id={latest.id} revision={latest.revision} /> : null}
          </section>
        ) : startNew ? (
          <p role="status" className="text-muted-foreground">Pengajuan gerai baru sedang ditutup. Coba lagi nanti, atau minta pemilik gerai yang sudah aktif mengundang email ini.</p>
        ) : null}
      </AuthCard>

      <AuthFooter>
        <form action={signOutAction}>
          <Button type="submit" variant="ghost">Keluar</Button>
        </form>
      </AuthFooter>
    </AuthShell>
  );
}

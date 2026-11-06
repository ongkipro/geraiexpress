import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthCard, AuthHeading, AuthShell } from "@/components/auth/auth-shell";
import { dbServer } from "@/lib/db/server";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/submit-button";
import { signOutAction } from "@/lib/auth-actions";
import { requestScope } from "@/lib/hosts";
import { loadPlatform } from "@/lib/platform";
import { loadWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "Belum ada akses" };

// A signed-in person without an active gerai: say why, and offer every way forward that exists
// for this account (invitation, own application, another account).
export default async function NoAccessPage() {
  const current = await loadWorkspace();
  if (current.kind === "anonymous") redirect("/masuk");
  if (current.kind === "ready") redirect("/");
  // The platform workspace is another host; only a host serving every audience may send a person there.
  if ((await requestScope()) === "shared" && (await loadPlatform())) redirect("/admin");
  const db = await dbServer();
  const [{ data: open }, { data: invites }, { data: applications }] = await Promise.all([
    db.rpc("registration_open"),
    db.rpc("my_invitations"),
    db.from("tenant_applications").select("status").order("created_at", { ascending: false }).limit(1),
  ]);
  const hasInvites = (invites ?? []).length > 0;
  // A draft is still "registering"; a sent application is something to look at.
  const pending = ["submitted", "changes_requested"].includes((applications?.[0] as { status: string } | undefined)?.status ?? "");
  const email = current.kind === "no-access" ? current.email : null;

  return (
    <AuthShell>
      <AuthCard>
        <AuthHeading
          eyebrow={email ? <>Masuk sebagai <span className="font-semibold text-foreground wrap-anywhere">{email}</span></> : undefined}
          title="Belum ada gerai untuk akun ini"
          description="Akun ini belum menjadi anggota gerai aktif. Staf masuk lewat undangan dari admin gerai; pemilik usaha bisa mendaftarkan gerainya sendiri."
        />
        <ul className="flex flex-col gap-3 text-[15px] text-muted-foreground">
          {hasInvites ? <li>Ada undangan gerai untuk email ini. Terima undangan untuk mulai bekerja.</li> : null}
          {pending ? <li>Pengajuan gerai Anda sedang diproses. Lihat statusnya dan langkah berikutnya.</li> : null}
          {!hasInvites && !pending ? (
            <li>{open
              ? "Diundang sebagai staf? Minta admin gerai mengundang email ini, lalu masuk lagi."
              : "Pendaftaran gerai baru sedang ditutup. Minta admin gerai mengundang email ini, lalu masuk lagi."}
            </li>
          ) : null}
        </ul>
        <div className="flex flex-col gap-3">
          {hasInvites ? <Button asChild className="w-full"><Link href="/undangan">Lihat undangan gerai</Link></Button> : null}
          {pending ? (
            <Button asChild variant={hasInvites ? "outline" : "default"} className="w-full"><Link href="/daftar/gerai">Lihat pengajuan gerai</Link></Button>
          ) : open ? (
            <Button asChild variant={hasInvites ? "outline" : "default"} className="w-full"><Link href="/daftar/gerai">Daftarkan gerai</Link></Button>
          ) : null}
          <form action={signOutAction}>
            <SubmitButton variant={hasInvites || pending || open ? "ghost" : "outline"} className="w-full" pendingLabel="Keluar…">Keluar</SubmitButton>
          </form>
        </div>
      </AuthCard>
    </AuthShell>
  );
}

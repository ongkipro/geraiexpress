import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AuthCard, AuthFooter, AuthHeading, AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { signOutAction } from "@/lib/auth-actions";
import { loadPlatform } from "@/lib/platform";
import { currentUser } from "@/lib/db/server";
import { TotpForm } from "./totp-form";

export const metadata: Metadata = { title: "Verifikasi dua langkah" };

// IAM-7: the platform workspace needs an aal2 session. A grant holder with a verified factor is
// challenged; one without a factor enrols an authenticator app first.
export default async function TwoFactorPage() {
  if (!(await currentUser())) redirect("/masuk");
  const session = await loadPlatform();
  if (!session) notFound();
  if (session.aal2) redirect("/admin");

  return (
    <AuthShell context="Super Admin">
      <AuthCard>
        <AuthHeading
          eyebrow={session.hasTotp ? "Verifikasi dua langkah" : "Pendaftaran autentikator"}
          title={session.hasTotp ? "Masukkan kode autentikator" : "Pasang autentikator"}
          description={session.hasTotp
            ? "Buka aplikasi autentikator untuk akun ini dan masukkan 6 digit kode yang sedang tampil."
            : "Ruang Super Admin wajib memakai verifikasi dua langkah. Pindai kode QR dengan aplikasi autentikator (misalnya Google Authenticator atau 1Password), lalu masukkan kodenya."}
        />
        <TotpForm enrolled={session.hasTotp} />
      </AuthCard>
      <AuthFooter>
        <form action={signOutAction}>
          <Button type="submit" variant="ghost">Keluar</Button>
        </form>
      </AuthFooter>
    </AuthShell>
  );
}

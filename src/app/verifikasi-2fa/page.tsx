import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { signOutAction } from "@/lib/auth-actions";
import { loadPlatform } from "@/lib/platform";
import { supabaseServer } from "@/lib/supabase/server";
import { TotpForm } from "./totp-form";

export const metadata: Metadata = { title: "Verifikasi dua langkah" };

// IAM-7: the platform workspace needs an aal2 session. A grant holder with a verified factor is
// challenged; one without a factor enrols an authenticator app first.
export default async function TwoFactorPage() {
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/masuk");
  const session = await loadPlatform();
  if (!session) notFound();
  if (session.aal2) redirect("/admin");

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[520px] flex-col justify-center gap-6 px-5 py-12">
      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">GeraiExpress · Super Admin</p>
        <h1 className="text-3xl tracking-tight">
          {session.hasTotp ? "Masukkan kode autentikator" : "Pasang autentikator"}
        </h1>
        <p className="text-muted-foreground">
          {session.hasTotp
            ? "Buka aplikasi autentikator untuk akun ini dan masukkan 6 digit kode yang sedang tampil."
            : "Ruang Super Admin wajib memakai verifikasi dua langkah. Pindai kode QR dengan aplikasi autentikator (misalnya Google Authenticator atau 1Password), lalu masukkan kodenya."}
        </p>
      </div>
      <TotpForm enrolled={session.hasTotp} />
      <form action={signOutAction}>
        <Button type="submit" variant="ghost">Keluar</Button>
      </form>
    </main>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { workerSecret } from "@/lib/worker-secret";
import { CodeFlow } from "./forms";

export const metadata: Metadata = { title: "Daftar" };

// PR-29 / DEC-007: verify the inbox first; password and the gerai application come after.
export default async function RegisterPage() {
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (auth.user && !auth.user.is_anonymous) redirect("/");
  const { data: open } = await supabase.rpc("registration_open");

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col justify-center gap-8 px-5 py-12">
      <header className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">GeraiExpress</p>
        <h1 className="text-3xl tracking-tight">Daftarkan gerai Anda</h1>
        <p className="text-muted-foreground">Mulai dengan email. Kami kirim kode 6 digit untuk memastikan email itu milik Anda.</p>
      </header>
      {open ? null : (
        <p role="status" className="rounded-lg bg-card p-4 ring-1 ring-border">
          Pendaftaran gerai baru belum dibuka. Jika Anda diundang sebagai staf, lanjutkan dengan email yang diundang.
        </p>
      )}
      <section aria-label="Verifikasi email" className="rounded-lg bg-card p-6 ring-1 ring-border">
        <CodeFlow siteKey={workerSecret("TURNSTILE_SITE_KEY")} />
      </section>
      <p className="text-sm text-muted-foreground">
        Sudah punya akun? <Link href="/masuk" className="inline-flex min-h-11 items-center font-semibold text-primary underline-offset-4 hover:underline">Masuk</Link>
      </p>
    </main>
  );
}

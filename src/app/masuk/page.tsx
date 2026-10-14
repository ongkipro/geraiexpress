import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { loadWorkspace } from "@/lib/workspace";
import { workerSecret } from "@/lib/worker-secret";
import { DemoEntry, SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Masuk" };

export default async function SignInPage() {
  const current = await loadWorkspace();
  if (current.kind === "ready") redirect("/pengiriman");
  if (current.kind === "choose") redirect("/pilih-gerai");
  if (current.kind === "no-access" && !current.isAnonymous) redirect("/");
  const { data: open } = await (await supabaseServer()).rpc("registration_open");

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col justify-center gap-8 px-5 py-12">
      <header className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">GeraiExpress</p>
        <h1 className="text-3xl tracking-tight">Masuk ke ruang kerja gerai</h1>
      </header>

      <section aria-labelledby="signin-heading" className="rounded-lg bg-card p-6 ring-1 ring-border">
        <h2 id="signin-heading" className="sr-only">Masuk dengan email</h2>
        <SignInForm siteKey={workerSecret("TURNSTILE_SITE_KEY")} />
      </section>

      <section aria-labelledby="demo-heading" className="flex flex-col gap-3">
        <h2 id="demo-heading" className="text-xl">Ingin mencoba dulu?</h2>
        <p className="text-muted-foreground">
          Demo membuka gerai contoh dengan kontak, pengiriman dan label contoh. Semua harga, resi dan
          label di demo adalah simulasi — tidak ada akun Mengantar, pembayaran atau data asli yang dipakai.
        </p>
        <DemoEntry siteKey={workerSecret("TURNSTILE_SITE_KEY")} />
      </section>

      {open ? (
        <p className="text-sm text-muted-foreground">
          Belum punya akun?{" "}
          <Link href="/daftar" className="inline-flex min-h-11 items-center font-semibold text-primary underline-offset-4 hover:underline">Daftarkan gerai</Link>
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          Pendaftaran gerai baru belum dibuka. Diundang sebagai staf?{" "}
          <Link href="/daftar" className="inline-flex min-h-11 items-center font-semibold text-primary underline-offset-4 hover:underline">Masuk dengan kode email</Link>
        </p>
      )}
    </main>
  );
}

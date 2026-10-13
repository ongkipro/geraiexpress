import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { loadWorkspace } from "@/lib/workspace";
import { DemoEntry, SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Masuk" };

export default async function SignInPage() {
  const current = await loadWorkspace();
  if (current.kind === "ready") redirect("/pengiriman");
  if (current.kind === "choose") redirect("/pilih-gerai");
  if (current.kind === "no-access" && !current.isAnonymous) redirect("/akses");

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col justify-center gap-8 px-5 py-12">
      <header className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">GeraiExpress</p>
        <h1 className="text-3xl tracking-tight">Masuk ke ruang kerja gerai</h1>
      </header>

      <section aria-labelledby="signin-heading" className="rounded-lg bg-card p-6 ring-1 ring-border">
        <h2 id="signin-heading" className="sr-only">Masuk dengan email</h2>
        <SignInForm />
      </section>

      <section aria-labelledby="demo-heading" className="flex flex-col gap-3">
        <h2 id="demo-heading" className="text-xl">Ingin mencoba dulu?</h2>
        <p className="text-muted-foreground">
          Demo membuka gerai contoh dengan kontak, pengiriman dan label contoh. Semua harga, resi dan
          label di demo adalah simulasi — tidak ada akun Mengantar, pembayaran atau data asli yang dipakai.
        </p>
        <DemoEntry />
      </section>

      <p className="text-sm text-muted-foreground">
        Pendaftaran gerai baru belum dibuka. Staf yang diundang dapat masuk dengan akun yang diberikan pemilik gerai.
      </p>
    </main>
  );
}

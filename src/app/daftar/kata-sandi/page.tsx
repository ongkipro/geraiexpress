import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { PasswordForm } from "../forms";

export const metadata: Metadata = { title: "Buat kata sandi" };

export default async function SetPasswordPage() {
  const supabase = await supabaseServer();
  const { data } = await supabase.rpc("my_account_state");
  const account = (data as { has_password: boolean }[] | null)?.[0];
  if (!account) redirect("/masuk");
  if (account.has_password) redirect("/");

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col justify-center gap-8 px-5 py-12">
      <header className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">GeraiExpress</p>
        <h1 className="text-3xl tracking-tight">Buat kata sandi</h1>
        <p className="text-muted-foreground">Email Anda sudah terverifikasi. Kata sandi ini dipakai untuk masuk ke GeraiExpress berikutnya — bukan kata sandi Mengantar.</p>
      </header>
      <section aria-label="Kata sandi" className="rounded-lg bg-card p-6 ring-1 ring-border">
        <PasswordForm />
      </section>
    </main>
  );
}

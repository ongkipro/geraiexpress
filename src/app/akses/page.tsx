import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { signOutAction } from "@/lib/auth-actions";
import { loadPlatform } from "@/lib/platform";
import { loadWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "Belum ada akses" };

export default async function NoAccessPage() {
  const current = await loadWorkspace();
  if (current.kind === "anonymous") redirect("/masuk");
  if (current.kind === "ready") redirect("/pengiriman");
  if (await loadPlatform()) redirect("/admin");
  const supabase = await supabaseServer();
  const [{ data: open }, { data: invites }] = await Promise.all([supabase.rpc("registration_open"), supabase.rpc("my_invitations")]);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[520px] flex-col justify-center gap-6 px-5 py-12">
      <h1 className="text-3xl tracking-tight">Belum ada gerai untuk akun ini</h1>
      <p className="text-muted-foreground">
        {current.kind === "no-access" && current.email ? <>Akun <strong>{current.email}</strong> </> : "Akun ini "}
        belum menjadi anggota gerai aktif. Minta pemilik gerai mengundang Anda, atau keluar dan coba demo.
      </p>
      {(invites ?? []).length > 0 ? (
        <Button asChild className="self-start"><Link href="/undangan">Lihat undangan gerai</Link></Button>
      ) : null}
      {open ? (
        <Button asChild className="self-start"><Link href="/daftar/gerai">Ajukan gerai Anda sendiri</Link></Button>
      ) : null}
      <form action={signOutAction}>
        <Button type="submit" variant="outline">Keluar</Button>
      </form>
    </main>
  );
}

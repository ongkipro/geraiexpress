import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { signOutAction } from "@/lib/auth-actions";
import { loadWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "Belum ada akses" };

export default async function NoAccessPage() {
  const current = await loadWorkspace();
  if (current.kind === "anonymous") redirect("/masuk");
  if (current.kind === "ready") redirect("/pengiriman");

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[520px] flex-col justify-center gap-6 px-5 py-12">
      <h1 className="text-3xl tracking-tight">Belum ada gerai untuk akun ini</h1>
      <p className="text-muted-foreground">
        {current.kind === "no-access" && current.email ? <>Akun <strong>{current.email}</strong> </> : "Akun ini "}
        belum menjadi anggota gerai aktif. Minta pemilik gerai mengundang Anda, atau keluar dan coba demo.
      </p>
      <form action={signOutAction}>
        <Button type="submit" variant="outline">Keluar</Button>
      </form>
    </main>
  );
}

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { chooseTenantAction } from "@/lib/auth-actions";
import { loadWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "Pilih gerai" };

export default async function ChooseTenantPage() {
  const current = await loadWorkspace();
  if (current.kind !== "choose") redirect("/");

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[520px] flex-col justify-center gap-6 px-5 py-12">
      <h1 className="text-3xl tracking-tight">Pilih gerai</h1>
      <p className="text-muted-foreground">Akun Anda terdaftar di beberapa gerai. Pilih gerai yang ingin dikelola sekarang.</p>
      <ul className="flex flex-col gap-3">
        {current.tenants.map((t) => (
          <li key={t.id}>
            <form action={chooseTenantAction}>
              <input type="hidden" name="tenant" value={t.id} />
              <Button type="submit" variant="outline" className="w-full justify-start">{t.name}</Button>
            </form>
          </li>
        ))}
      </ul>
    </main>
  );
}

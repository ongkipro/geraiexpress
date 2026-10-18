import type { Metadata } from "next";
import Link from "next/link";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabaseServer } from "@/lib/supabase/server";
import { requireWorkspace } from "@/lib/workspace";
import { NewContactForm } from "@/modules/contacts/forms";

export const metadata: Metadata = { title: "Kontak" };

export default async function ContactsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ws = await requireWorkspace();
  const q = ((await searchParams).q ?? "").replace(/[,()*%_\\]/g, " ").trim().slice(0, 80);
  const supabase = await supabaseServer();
  let query = supabase.from("contacts")
    .select("id, name, phone, is_sender, is_recipient, contact_addresses(area, is_primary, archived_at)", { count: "exact" })
    .eq("tenant_id", ws.tenant.id).is("archived_at", null).order("name").limit(100);
  if (q) query = query.or(`name.ilike.*${q}*,phone.ilike.*${q}*`);
  const { data: contacts, count, error } = await query;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl tracking-tight">Kontak</h1>
        <p className="text-muted-foreground">Pengirim dan penerima tersimpan milik {ws.tenant.name}. Kontak bukan akun login dan bukan akun Mengantar.</p>
      </div>

      <section aria-labelledby="list-heading" className="flex flex-col gap-4">
        <h2 id="list-heading" className="sr-only">Daftar kontak</h2>
        <form role="search" className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-[min(100%,280px)] flex-1 flex-col gap-2">
            <Label htmlFor="q">Cari kontak</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input id="q" name="q" defaultValue={q} placeholder="Nama atau nomor HP" className="rounded-full pl-10" />
            </div>
          </div>
          <Button type="submit" variant="outline">Cari</Button>
          {q ? <Button asChild variant="link"><Link href="/kontak">Hapus pencarian</Link></Button> : null}
        </form>
        {error ? (
          <p role="alert" className="rounded-md bg-card p-4 ring-1 ring-border">Kontak belum bisa dimuat. Muat ulang halaman.</p>
        ) : contacts && contacts.length > 0 ? (
          <ul className="divide-y divide-border rounded-lg bg-card ring-1 ring-border">
            {contacts.map((c) => {
              const area = c.contact_addresses?.find((a) => a.is_primary && !a.archived_at)?.area;
              const roles = [c.is_sender && "Pengirim", c.is_recipient && "Penerima"].filter(Boolean).join(" · ");
              return (
                <li key={c.id}>
                  <Link href={`/kontak/${c.id}`} prefetch={false} className="flex flex-wrap items-center justify-between gap-2 p-4">
                    <span className="flex min-w-0 flex-col">
                      <span className="font-semibold text-primary">{c.name}</span>
                      <span className="text-sm text-muted-foreground">{c.phone}{area ? ` · ${area}` : ""}</span>
                    </span>
                    <span className="text-sm">{roles}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : null}
        {contacts && count && count > contacts.length ? (
          <p className="text-sm text-muted-foreground">Menampilkan {contacts.length} dari {count} kontak. Persempit dengan pencarian.</p>
        ) : null}
        {error || (contacts && contacts.length > 0) ? null : q ? (
          <p className="rounded-lg bg-card p-6 ring-1 ring-border">Tidak ada kontak yang cocok dengan “{q}”.</p>
        ) : (
          <p className="rounded-lg bg-card p-6 ring-1 ring-border">Belum ada kontak. Simpan kontak dari formulir di bawah atau saat membuat pengiriman.</p>
        )}
      </section>

      <section aria-labelledby="new-heading" className="flex flex-col gap-4 rounded-lg bg-card p-6 ring-1 ring-border">
        <h2 id="new-heading" className="text-xl">Tambah kontak</h2>
        <NewContactForm />
      </section>
    </div>
  );
}

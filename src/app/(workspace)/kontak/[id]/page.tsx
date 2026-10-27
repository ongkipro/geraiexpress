import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabaseServer } from "@/lib/supabase/server";
import { requireWorkspace } from "@/lib/workspace";
import { archiveAddressAction } from "@/modules/contacts/actions";
import { AddAddressForm, ArchiveContactForm, EditContactForm } from "@/modules/contacts/forms";

export const metadata: Metadata = { title: "Kontak" };

export default async function ContactPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ baru?: string; alamat?: string }>;
}) {
  const ws = await requireWorkspace();
  const { id } = await params;
  const { baru: created, alamat } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await supabaseServer();
  const { data: c } = await supabase.from("contacts")
    .select("id, revision, name, phone, is_sender, is_recipient, archived_at, contact_addresses(id, label, address_line, area, postal_code, is_primary, archived_at)")
    .eq("tenant_id", ws.tenant.id).eq("id", id).maybeSingle();
  if (!c) notFound();
  const addresses = (c.contact_addresses ?? []).filter((a) => !a.archived_at)
    .sort((a, b) => Number(b.is_primary) - Number(a.is_primary));

  return (
    <div className="flex max-w-[980px] flex-col gap-6">
      <Link href="/kontak" className="inline-flex min-h-11 items-center gap-2 self-start text-primary">
        <ArrowLeft className="size-4" aria-hidden="true" /> Semua kontak
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-3xl tracking-tight break-words">{c.name}</h1>
        {c.archived_at ? (
          <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold ring-1 ring-border">Diarsipkan</span>
        ) : null}
      </div>
      {c.archived_at ? (
        <p role="status" className="rounded-md bg-muted p-4 ring-1 ring-border">
          Kontak ini sudah diarsipkan dan tidak muncul di daftar kontak aktif. Pengiriman yang sudah dikonfirmasi tidak berubah.
        </p>
      ) : null}
      {created ? <p role="status" className="rounded-md bg-card p-4 ring-1 ring-border">Kontak tersimpan.</p> : null}
      {alamat === "gagal" ? (
        <p role="alert" className="rounded-md bg-card p-4 ring-1 ring-foreground"><span aria-hidden="true">⚠ </span>Alamat belum tersimpan. Tambahkan lagi di bagian Alamat.</p>
      ) : alamat === "arsip-gagal" ? (
        <p role="alert" className="rounded-md bg-card p-4 ring-1 ring-foreground"><span aria-hidden="true">⚠ </span>Alamat tidak dapat diarsipkan. Muat ulang lalu coba lagi.</p>
      ) : alamat === "diarsipkan" ? (
        <p role="status" className="rounded-md bg-card p-4 ring-1 ring-border">Alamat diarsipkan. Pengiriman lama tidak berubah.</p>
      ) : null}

      <section aria-labelledby="edit-heading" className="flex flex-col gap-4 rounded-lg bg-card p-6 ring-1 ring-border">
        <h2 id="edit-heading" className="text-xl">Data kontak</h2>
        <EditContactForm contact={c} />
        {ws.role === "tenant_admin" && !c.archived_at ? (
          <div className="border-t border-border pt-4">
            <ArchiveContactForm contact={{ id: c.id, revision: c.revision }} />
          </div>
        ) : null}
      </section>

      <section aria-labelledby="addr-heading" className="flex flex-col gap-4 rounded-lg bg-card p-6 ring-1 ring-border">
        <h2 id="addr-heading" className="text-xl">Alamat</h2>
        {addresses.length > 0 ? (
          <ul className="divide-y divide-border">
            {addresses.map((a) => (
              <li key={a.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <span className="min-w-0">
                  <span className="font-semibold">{a.label ?? "Alamat"}{a.is_primary ? " · utama" : ""}</span>
                  <span className="block break-words text-muted-foreground">{[a.address_line, a.area, a.postal_code].filter(Boolean).join(", ")}</span>
                </span>
                <form action={archiveAddressAction}>
                  <input type="hidden" name="contact_id" value={c.id} />
                  <input type="hidden" name="address_id" value={a.id} />
                  <Button type="submit" variant="ghost" size="sm">Arsipkan</Button>
                </form>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">Belum ada alamat tersimpan.</p>
        )}
        <p className="text-sm text-muted-foreground">Mengarsipkan alamat tidak mengubah pengiriman yang sudah dikonfirmasi.</p>
        <h3 className="text-base font-semibold">Tambah alamat</h3>
        <AddAddressForm contactId={c.id} />
      </section>
    </div>
  );
}

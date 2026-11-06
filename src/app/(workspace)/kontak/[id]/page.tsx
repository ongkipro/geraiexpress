import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, Archive, CheckCircle2, MapPin } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { dbServer } from "@/lib/db/server";
import { requireWorkspace } from "@/lib/workspace";
import { AddAddressForm, ArchiveAddressForm, ArchiveContactForm, EditContactForm } from "@/modules/contacts/forms";

export const metadata: Metadata = { title: "Kontak" };

const SURFACE = "flex flex-col overflow-hidden rounded-lg bg-card ring-1 ring-border";
const SECTION_HEAD = "flex flex-col gap-1 border-b border-border px-5 py-4 sm:px-6";

function Notice({ tone, children }: { tone: "ok" | "error"; children: React.ReactNode }) {
  return tone === "error" ? (
    <Alert variant="destructive">
      <AlertTriangle aria-hidden="true" />
      <AlertDescription className="text-[15px] text-foreground"><span aria-hidden="true">⚠ </span>{children}</AlertDescription>
    </Alert>
  ) : (
    <Alert role="status">
      <CheckCircle2 aria-hidden="true" className="text-success" />
      <AlertDescription className="text-[15px] text-foreground">{children}</AlertDescription>
    </Alert>
  );
}

export default async function ContactPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ baru?: string; alamat?: string }>;
}) {
  const ws = await requireWorkspace();
  const { id } = await params;
  const { baru: created, alamat } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = await dbServer();
  const { data: c } = await db.from("contacts")
    .select("id, revision, name, phone, is_sender, is_recipient, archived_at, contact_addresses(id, label, address_line, area, postal_code, is_primary, archived_at)")
    .eq("tenant_id", ws.tenant.id).eq("id", id).maybeSingle();
  if (!c) notFound();
  const addresses = (c.contact_addresses ?? []).filter((a) => !a.archived_at)
    .sort((a, b) => Number(b.is_primary) - Number(a.is_primary));
  const canArchive = ws.role === "tenant_admin" && !c.archived_at;

  return (
    <div className="flex max-w-[1080px] flex-col gap-6">
      <Breadcrumb aria-label="Lokasi halaman">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild><Link href="/kontak" className="inline-flex min-h-11 items-center text-primary">Kontak</Link></BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem className="min-w-0">
            <BreadcrumbPage className="truncate">{c.name}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="min-w-0 text-3xl tracking-tight break-words">{c.name}</h1>
          {c.archived_at ? (
            <Badge variant="neutral"><Archive aria-hidden="true" />Diarsipkan</Badge>
          ) : null}
        </div>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[15px] text-muted-foreground">
          <span className="tabular">{c.phone}</span>
          <span aria-hidden="true">·</span>
          <span>{[c.is_sender && "Pengirim", c.is_recipient && "Penerima"].filter(Boolean).join(" dan ")}</span>
        </p>
      </header>

      {c.archived_at ? (
        <Alert role="status" className="bg-muted">
          <Archive aria-hidden="true" />
          <AlertDescription className="text-[15px] text-foreground">
            Kontak ini sudah diarsipkan dan tidak muncul di daftar kontak aktif. Pengiriman yang sudah dikonfirmasi tidak berubah.
          </AlertDescription>
        </Alert>
      ) : null}
      {created ? <Notice tone="ok">Kontak tersimpan.</Notice> : null}
      {alamat === "gagal" ? (
        <Notice tone="error">Alamat belum tersimpan. Tambahkan lagi di bagian Alamat.</Notice>
      ) : alamat === "arsip-gagal" ? (
        <Notice tone="error">Alamat tidak dapat diarsipkan. Muat ulang lalu coba lagi.</Notice>
      ) : alamat === "diarsipkan" ? (
        <Notice tone="ok">Alamat diarsipkan. Pengiriman lama tidak berubah.</Notice>
      ) : null}

      {/* Data, then addresses, then the archive action last on small screens; two columns on >=1024. */}
      <div className="grid items-start gap-6 lg:grid-cols-2 lg:grid-rows-[auto_1fr]">
        <section aria-labelledby="edit-heading" className={`${SURFACE} lg:col-start-1 lg:row-start-1`}>
          <div className={SECTION_HEAD}>
            <h2 id="edit-heading" className="text-xl">Data kontak</h2>
          </div>
          <div className="px-5 py-5 sm:px-6">
            <EditContactForm contact={c} />
          </div>
        </section>

        {canArchive ? (
          <section aria-labelledby="archive-heading" className={`${SURFACE} order-last lg:order-none lg:col-start-1 lg:row-start-2`}>
            <div className="flex flex-col gap-4 px-5 py-5 sm:px-6">
              <div className="flex flex-col gap-1">
                <h2 id="archive-heading" className="text-base">Arsipkan</h2>
                <p className="text-[15px] text-muted-foreground">
                  Menyembunyikan kontak dari daftar aktif tanpa mengubah pengiriman lama.
                </p>
              </div>
              <ArchiveContactForm contact={{ id: c.id, revision: c.revision, name: c.name }} />
            </div>
          </section>
        ) : null}

        <section aria-labelledby="addr-heading" className={`${SURFACE} lg:col-start-2 lg:row-span-2 lg:row-start-1`}>
          <div className={SECTION_HEAD}>
            <h2 id="addr-heading" className="text-xl">Alamat</h2>
            <p className="text-sm text-muted-foreground">Mengarsipkan alamat tidak mengubah pengiriman yang sudah dikonfirmasi.</p>
          </div>
          {addresses.length > 0 ? (
            <ul className="divide-y divide-border border-b border-border">
              {addresses.map((a) => (
                <li key={a.id} className="flex items-start gap-3 px-5 py-4 sm:px-6">
                  <MapPin className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-2 font-semibold">
                      {a.label ?? "Alamat"}
                      {a.is_primary ? <Badge variant="info" className="h-6"><span className="sr-only">· </span>Utama</Badge> : null}
                    </span>
                    <span className="text-[15px] break-words text-muted-foreground">{[a.address_line, a.area, a.postal_code].filter(Boolean).join(", ")}</span>
                  </span>
                  <ArchiveAddressForm contactId={c.id}
                    address={{ id: a.id, label: a.label, line: [a.address_line, a.area, a.postal_code].filter(Boolean).join(", ") }} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="border-b border-border px-5 py-5 text-[15px] text-muted-foreground sm:px-6">Belum ada alamat tersimpan. Tambahkan di bawah.</p>
          )}
          <div className="flex flex-col gap-4 px-5 py-5 sm:px-6">
            <h3 className="text-base font-semibold">Tambah alamat</h3>
            <AddAddressForm contactId={c.id} />
          </div>
        </section>
      </div>
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ChevronRight, Search, SearchX, Users, X } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { dbServer } from "@/lib/db/server";
import { requireWorkspace } from "@/lib/workspace";
import { NewContactSheet } from "@/modules/contacts/forms";

export const metadata: Metadata = { title: "Kontak" };

function Roles({ sender, recipient }: { sender: boolean; recipient: boolean }) {
  return (
    <span className="flex flex-wrap gap-1.5">
      {sender ? <Badge variant="neutral">Pengirim</Badge> : null}
      {recipient ? <Badge variant="neutral">Penerima</Badge> : null}
    </span>
  );
}

export default async function ContactsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ws = await requireWorkspace();
  const q = ((await searchParams).q ?? "").replace(/[,()*%_\\]/g, " ").trim().slice(0, 80);
  const db = await dbServer();
  let query = db.from("contacts")
    .select("id, name, phone, is_sender, is_recipient, contact_addresses(area, is_primary, archived_at)", { count: "exact" })
    .eq("tenant_id", ws.tenant.id).is("archived_at", null).order("name").limit(100);
  if (q) query = query.or(`name.ilike.*${q}*,phone.ilike.*${q}*`);
  const { data: contacts, count, error } = await query;
  const rows = (contacts ?? []).map((c) => ({
    ...c,
    area: c.contact_addresses?.find((a) => a.is_primary && !a.archived_at)?.area ?? null,
  }));

  return (
    <div className="flex flex-col gap-6 lg:gap-8">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-3xl tracking-tight">Kontak</h1>
          <p className="text-[15px] text-muted-foreground">
            Pengirim dan penerima tersimpan milik {ws.tenant.name}. Kontak bukan akun untuk masuk dan bukan akun Mengantar.
          </p>
        </div>
        <NewContactSheet className="w-full md:w-auto" />
      </header>

      <section aria-labelledby="list-heading" className="flex flex-col gap-4">
        <h2 id="list-heading" className="sr-only">Daftar kontak</h2>
        <form role="search" className="flex items-end gap-2">
          <div className="flex min-w-0 flex-1 flex-col gap-2 md:max-w-[480px]">
            <Label htmlFor="q" className="sr-only md:not-sr-only">Cari kontak</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input id="q" name="q" type="search" defaultValue={q} placeholder="Nama atau nomor HP" className="pl-9" enterKeyHint="search" />
            </div>
          </div>
          <Button type="submit" variant="outline">Cari</Button>
        </form>

        {q || (count != null && count > 0) ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            {q ? (
              <Link href="/kontak" className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-full bg-card pr-3 pl-4 text-sm ring-1 ring-border transition-colors hover:bg-muted">
                <span className="sr-only">Hapus pencarian </span>
                <span className="truncate">Cari: “{q}”</span>
                <X className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </Link>
            ) : <span />}
            {count != null && count > 0 ? (
              <p className="text-sm text-muted-foreground tabular">
                {count > rows.length ? `Menampilkan ${rows.length} dari ${count} kontak. Persempit dengan pencarian.` : `${count} kontak`}
              </p>
            ) : null}
          </div>
        ) : null}

        {error ? (
          <Alert variant="destructive">
            <AlertTriangle aria-hidden="true" />
            <AlertDescription className="text-[15px] text-foreground">Kontak belum bisa dimuat. Muat ulang halaman.</AlertDescription>
          </Alert>
        ) : rows.length > 0 ? (
          <>
            {/* Row links skip prefetch: each would render a dynamic page on the server. */}
            <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg bg-card ring-1 ring-border md:hidden">
              {rows.map((c) => (
                <li key={c.id}>
                  <Link href={`/kontak/${c.id}`} prefetch={false} className="flex min-h-14 items-center gap-3 px-4 py-3 active:bg-muted">
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="truncate font-semibold">{c.name}</span>
                      <span className="truncate text-sm text-muted-foreground">
                        <span className="tabular">{c.phone}</span>{c.area ? ` · ${c.area}` : ""}
                      </span>
                      <Roles sender={c.is_sender} recipient={c.is_recipient} />
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
            <div className="hidden overflow-hidden rounded-lg bg-card ring-1 ring-border md:block">
              <Table className="text-[15px]">
                <TableCaption className="sr-only">Kontak aktif, urut nama</TableCaption>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead scope="col" className="pl-4">Nama</TableHead>
                    <TableHead scope="col">No. HP</TableHead>
                    <TableHead scope="col">Alamat utama</TableHead>
                    <TableHead scope="col" className="pr-4">Dipakai sebagai</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((c) => (
                    <TableRow key={c.id} className="border-border">
                      <TableCell className="max-w-[260px] pl-4">
                        <Link href={`/kontak/${c.id}`} prefetch={false} className="inline-flex min-h-11 max-w-full items-center font-semibold text-primary hover:underline">
                          <span className="truncate">{c.name}</span>
                        </Link>
                      </TableCell>
                      <TableCell className="whitespace-nowrap tabular">{c.phone}</TableCell>
                      <TableCell className="max-w-[280px] truncate text-muted-foreground">{c.area ?? "—"}</TableCell>
                      <TableCell className="pr-4"><Roles sender={c.is_sender} recipient={c.is_recipient} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        ) : q ? (
          <Empty className="rounded-lg bg-card p-8 ring-1 ring-border">
            <EmptyHeader>
              <EmptyMedia variant="icon"><SearchX aria-hidden="true" /></EmptyMedia>
              <EmptyTitle>Tidak ada kontak yang cocok dengan “{q}”.</EmptyTitle>
              <EmptyDescription>Periksa ejaan atau cari dengan nomor HP.</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button asChild variant="outline"><Link href="/kontak">Hapus pencarian</Link></Button>
            </EmptyContent>
          </Empty>
        ) : (
          <Empty className="rounded-lg bg-card p-8 ring-1 ring-border">
            <EmptyHeader>
              <EmptyMedia variant="icon"><Users aria-hidden="true" /></EmptyMedia>
              <EmptyTitle>Belum ada kontak.</EmptyTitle>
              <EmptyDescription>Simpan pengirim dan penerima di sini, atau saat membuat pengiriman.</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <NewContactSheet label="Tambah kontak pertama" />
            </EmptyContent>
          </Empty>
        )}
      </section>
    </div>
  );
}

"use client";

import Link from "next/link";
import { ChevronDown, Search, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { SUBMISSION_LABEL } from "@/lib/format";

type Filters = { q: string; status: string; from: string; to: string };

// A native select styled like the Select trigger: it submits with the GET form without script and
// opens the platform picker on phones. (Radix Select adds a 1px hidden native select inside forms,
// which is no usable target and shows up as one before hydration.)
function StatusSelect({ id, defaultValue }: { id: string; defaultValue: string }) {
  return (
    <div className="relative">
      <select id={id} name="status" defaultValue={defaultValue}
        className="min-h-11 w-full appearance-none rounded-sm border border-input bg-card pr-9 pl-3 text-base text-foreground">
        <option value="">Semua status</option>
        {Object.entries(SUBMISSION_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
    </div>
  );
}

// C3 filter row: inline on >=768, search plus a "Filter" sheet below. Both submit the same GET
// parameters (q, status, from, to) to /pengiriman, which also resets the page.
export function ShipmentFilters({ q, status, from, to }: Filters) {
  const sheetCount = [status, from, to].filter(Boolean).length;

  return (
    <>
      <form action="/pengiriman" role="search" aria-label="Filter pengiriman" className="hidden items-end gap-3 md:grid md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
        <div className="flex min-w-0 flex-col gap-2 md:col-span-4 lg:col-span-1">
          <Label htmlFor="q">Cari</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input id="q" name="q" type="search" defaultValue={q} placeholder="Referensi, nama, atau resi" className="pl-9" />
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <Label htmlFor="status">Status</Label>
          <StatusSelect id="status" defaultValue={status} />
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <Label htmlFor="from">Dibuat dari</Label>
          <Input id="from" name="from" type="date" defaultValue={from} />
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <Label htmlFor="to">Dibuat sampai</Label>
          <Input id="to" name="to" type="date" defaultValue={to} />
        </div>
        <Button type="submit" variant="outline">Terapkan</Button>
      </form>
      <div className="flex items-center gap-2 md:hidden">
        <form action="/pengiriman" role="search" aria-label="Cari pengiriman" className="relative min-w-0 flex-1">
          <Label htmlFor="q-m" className="sr-only">Cari</Label>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input id="q-m" name="q" type="search" defaultValue={q} placeholder="Referensi, nama, resi" className="pl-9" enterKeyHint="search" />
          {status ? <input type="hidden" name="status" value={status} /> : null}
          {from ? <input type="hidden" name="from" value={from} /> : null}
          {to ? <input type="hidden" name="to" value={to} /> : null}
        </form>
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline" className="shrink-0 px-4">
              <SlidersHorizontal aria-hidden="true" />
              Filter
              {sheetCount > 0 ? (
                <span className="tabular rounded-full bg-primary px-2 text-sm text-primary-foreground">
                  {sheetCount}<span className="sr-only"> aktif</span>
                </span>
              ) : null}
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom" className="max-h-[90dvh] overflow-y-auto rounded-t-lg">
            <SheetHeader className="pr-16">
              <SheetTitle>Filter pengiriman</SheetTitle>
              <SheetDescription>Saring menurut status dan tanggal dibuat (WIB).</SheetDescription>
            </SheetHeader>
            <form action="/pengiriman" className="flex flex-col gap-4 px-6 pb-6">
              {q ? <input type="hidden" name="q" value={q} /> : null}
              <div className="flex flex-col gap-2">
                <Label htmlFor="status-m">Status</Label>
                <StatusSelect id="status-m" defaultValue={status} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex min-w-0 flex-col gap-2">
                  <Label htmlFor="from-m">Dibuat dari</Label>
                  <Input id="from-m" name="from" type="date" defaultValue={from} />
                </div>
                <div className="flex min-w-0 flex-col gap-2">
                  <Label htmlFor="to-m">Dibuat sampai</Label>
                  <Input id="to-m" name="to" type="date" defaultValue={to} />
                </div>
              </div>
              <Button type="submit" className="w-full">Terapkan</Button>
              {sheetCount > 0 || q ? (
                <Button asChild variant="ghost" className="w-full"><Link href="/pengiriman">Hapus semua filter</Link></Button>
              ) : null}
            </form>
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}

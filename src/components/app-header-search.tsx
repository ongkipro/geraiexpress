"use client";

import { useState } from "react";
import Form from "next/form";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

// UX-16 global search: a GET form that opens the shipment list filtered by reference, name or resi
// (`/pengiriman?q=`); Enter submits. No keyboard shortcut: a global key would collide with typing.
export function SearchForm({ id, className, onSubmit }: { id: string; className?: string; onSubmit?: () => void }) {
  return (
    <Form action="/pengiriman" role="search" aria-label="Pengiriman" onSubmit={onSubmit} className={cn("relative", className)}>
      <label htmlFor={id} className="sr-only">Cari pengiriman</label>
      <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <input
        id={id}
        name="q"
        type="search"
        enterKeyHint="search"
        autoComplete="off"
        placeholder="Referensi, nama, resi"
        className="min-h-11 w-full min-w-0 rounded-full border border-input bg-background pr-4 pl-10 text-[15px] text-foreground placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
      />
    </Form>
  );
}

// Below 768 px the search sits behind an icon button in the top bar and opens in a top sheet.
export function MobileSearch() {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Cari pengiriman" className="shrink-0">
          <Search aria-hidden="true" />
        </Button>
      </SheetTrigger>
      <SheetContent side="top" className="gap-3 px-4 pt-4 pb-5">
        <SheetHeader className="p-0 pr-14">
          <SheetTitle>Cari pengiriman</SheetTitle>
          <SheetDescription>Referensi, nama penerima atau nomor resi.</SheetDescription>
        </SheetHeader>
        <SearchForm id="gx-search-mobile" onSubmit={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}

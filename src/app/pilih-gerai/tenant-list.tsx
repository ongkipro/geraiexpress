"use client";

import { useId, useState } from "react";
import { Check, ChevronRight, Search } from "lucide-react";
import { SubmitButton } from "@/components/submit-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { chooseTenantAction } from "@/lib/auth-actions";

// A search field appears only when the list is long enough to need one.
const SEARCH_FROM = 6;

export function TenantList({ tenants, currentId }: { tenants: { id: string; name: string }[]; currentId: string | null }) {
  const [query, setQuery] = useState("");
  const searchId = useId();
  const q = query.trim().toLocaleLowerCase("id");
  const shown = q ? tenants.filter((t) => t.name.toLocaleLowerCase("id").includes(q)) : tenants;
  return (
    <div className="flex flex-col gap-4">
      {tenants.length >= SEARCH_FROM ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor={searchId}>Cari gerai</Label>
          <div className="relative">
            <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground" />
            <Input id={searchId} type="search" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-10"
              autoComplete="off" aria-describedby={`${searchId}-count`} />
          </div>
          <p id={`${searchId}-count`} role="status" className="text-sm text-muted-foreground tabular">
            {q ? `${shown.length} dari ${tenants.length} gerai` : `${tenants.length} gerai`}
          </p>
        </div>
      ) : null}
      {shown.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-md bg-muted p-4">
          <p className="text-[15px]">Tidak ada gerai bernama “{query.trim()}”.</p>
          <Button type="button" variant="outline" size="sm" onClick={() => setQuery("")}>Hapus pencarian</Button>
        </div>
      ) : (
        <ul className="-mx-2 flex flex-col divide-y divide-border">
          {shown.map((t) => {
            const current = t.id === currentId;
            return (
              <li key={t.id}>
                <form action={chooseTenantAction}>
                  <input type="hidden" name="tenant" value={t.id} />
                  <SubmitButton
                    variant="ghost"
                    className="h-auto min-h-16 w-full justify-start gap-3 rounded-md px-2 py-2.5 text-left whitespace-normal"
                    aria-current={current ? "true" : undefined}
                  >
                    <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-[15px] font-semibold text-primary ring-1 ring-border">
                      {t.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("")}
                    </span>
                    <span className="min-w-0 flex-1 break-words">
                      {t.name}
                      {current ? <span className="sr-only"> (sedang dipakai)</span> : null}
                    </span>
                    {current ? (
                      <Badge variant="success" aria-hidden="true"><Check />Sedang dipakai</Badge>
                    ) : (
                      <ChevronRight aria-hidden="true" className="size-5 text-muted-foreground" />
                    )}
                  </SubmitButton>
                </form>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

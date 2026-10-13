import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { supabaseServer } from "@/lib/supabase/server";
import { formatWib } from "@/lib/format";
import { requireWorkspace } from "@/lib/workspace";
import { createDraftAction } from "@/modules/shipments/actions";

export const metadata: Metadata = { title: "Buat pengiriman" };

// Starting a draft is an explicit POST; this page also lets staff resume saved drafts (UX-4).
export default async function NewShipmentPage() {
  const ws = await requireWorkspace();
  const supabase = await supabaseServer();
  const { data: drafts } = await supabase.from("shipments")
    .select("id, reference, sender_name, recipient_name, updated_at")
    .eq("tenant_id", ws.tenant.id).in("submission_state", ["draft", "estimated"])
    .order("updated_at", { ascending: false }).limit(10);

  return (
    <div className="flex max-w-[980px] flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl tracking-tight">Buat pengiriman</h1>
        <p className="text-muted-foreground">Draf baru dibuat untuk {ws.outlet.name}. Draf belum menjadi pesanan sampai Anda mengonfirmasi.</p>
      </div>
      <form action={createDraftAction}>
        <Button type="submit">Mulai draf baru</Button>
      </form>
      {drafts && drafts.length > 0 ? (
        <section aria-labelledby="drafts-heading" className="flex flex-col gap-3">
          <h2 id="drafts-heading" className="text-xl">Lanjutkan draf tersimpan</h2>
          <ul className="divide-y divide-border rounded-lg bg-card ring-1 ring-border">
            {drafts.map((d) => (
              <li key={d.id}>
                <Link href={`/pengiriman/${d.id}`} className="flex flex-wrap items-center justify-between gap-2 p-4">
                  <span className="flex min-w-0 flex-col">
                    <span className="font-semibold tabular text-primary">{d.reference}</span>
                    <span className="truncate text-sm text-muted-foreground">{d.sender_name ?? "Pengirim belum diisi"} → {d.recipient_name ?? "Penerima belum diisi"}</span>
                  </span>
                  <span className="text-sm text-muted-foreground">{formatWib(d.updated_at)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

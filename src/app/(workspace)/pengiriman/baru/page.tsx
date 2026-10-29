import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, FileText } from "lucide-react";
import { dbServer } from "@/lib/db/server";
import { formatWib } from "@/lib/format";
import { requireWorkspace } from "@/lib/workspace";
import { CreateDraftButton } from "@/modules/shipments/list-create";

export const metadata: Metadata = { title: "Buat pengiriman" };

// Starting a draft is an explicit POST (a page load never writes); this page also lets staff
// resume saved drafts (UX-4). The list page header starts a draft directly with the same action.
export default async function NewShipmentPage() {
  const ws = await requireWorkspace();
  const db = await dbServer();
  const { data: drafts } = await db.from("shipments")
    .select("id, reference, sender_name, recipient_name, updated_at")
    .eq("tenant_id", ws.tenant.id).in("submission_state", ["draft", "estimated"])
    .order("updated_at", { ascending: false }).limit(10);

  return (
    <div className="flex max-w-[760px] flex-col gap-8">
      <header className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl tracking-tight">Buat pengiriman</h1>
          <p className="text-[15px] text-muted-foreground">
            Draf baru dibuat untuk {ws.outlet.name}. Draf belum menjadi pesanan sampai Anda mengonfirmasi.
          </p>
        </div>
        <CreateDraftButton className="w-full sm:w-auto sm:self-start">Mulai draf baru</CreateDraftButton>
      </header>

      {drafts && drafts.length > 0 ? (
        <section aria-labelledby="drafts-heading" className="flex flex-col gap-3">
          <h2 id="drafts-heading" className="text-xl">Lanjutkan draf tersimpan</h2>
          <ul className="divide-y divide-border overflow-hidden rounded-lg bg-card ring-1 ring-border">
            {drafts.map((d) => (
              <li key={d.id}>
                <Link href={`/pengiriman/${d.id}`} prefetch={false} className="flex min-h-14 items-center gap-3 px-4 py-3 transition-colors hover:bg-muted">
                  <FileText className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="font-semibold text-primary tabular">{d.reference}</span>
                    <span className="truncate text-sm text-muted-foreground">
                      {d.sender_name ?? "Pengirim belum diisi"} → {d.recipient_name ?? "Penerima belum diisi"}
                    </span>
                    <span className="text-sm text-muted-foreground tabular sm:hidden">{formatWib(d.updated_at)}</span>
                  </span>
                  <span className="hidden shrink-0 text-sm text-muted-foreground tabular sm:block">{formatWib(d.updated_at)}</span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

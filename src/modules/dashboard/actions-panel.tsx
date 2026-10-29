import Link from "next/link";
import { CheckCircle2, ChevronRight, CircleDashed, PackagePlus, Printer, UserPlus } from "lucide-react";
import { SubmitButton } from "@/components/submit-button";
import { createDraftAction } from "@/modules/shipments/actions";
import { loadSetup } from "./load";
import { RegionHeading, Surface } from "./parts";

const ACTION_ROW = "flex min-h-14 w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-muted sm:px-6";
const ACTION_ICON = "flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-foreground";

function ActionText({ title, hint }: { title: string; hint: string }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="font-semibold">{title}</span>
      <span className="text-sm text-muted-foreground">{hint}</span>
    </span>
  );
}

// UX-16 (2) quick actions. "Buat pengiriman" posts the same createDraftAction as the header; the
// header keeps the only primary button, so these are plain rows.
export function QuickActions() {
  return (
    <Surface aria-labelledby="quick-heading" className="overflow-hidden" data-testid="dashboard-quick-actions">
      <RegionHeading id="quick-heading" title="Mulai dari sini" sample={false} />
      <ul className="mt-3 divide-y divide-border border-t border-border">
        <li>
          <form action={createDraftAction}>
            <SubmitButton variant="ghost" className={`h-auto justify-start rounded-none text-base whitespace-normal hover:bg-muted ${ACTION_ROW}`}>
              <span className={ACTION_ICON}><PackagePlus className="size-5" aria-hidden="true" /></span>
              <ActionText title="Buat pengiriman" hint="Draf baru, lalu cek ongkir" />
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </SubmitButton>
          </form>
        </li>
        <li>
          <Link href="/pengiriman?status=issued" prefetch={false} className={ACTION_ROW}>
            <span className={ACTION_ICON}><Printer className="size-5" aria-hidden="true" /></span>
            <ActionText title="Cetak label massal" hint="Pilih resi terbit di daftar" />
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </Link>
        </li>
        <li>
          <Link href="/kontak" prefetch={false} className={ACTION_ROW}>
            <span className={ACTION_ICON}><UserPlus className="size-5" aria-hidden="true" /></span>
            <ActionText title="Tambah kontak" hint="Pengirim atau penerima tetap" />
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </Link>
        </li>
      </ul>
    </Surface>
  );
}

// UX-16 (2) tenant administrators only: what is still missing before real orders can run. Shown only
// while at least one of the three facts is missing; each row opens its settings section.
export async function SetupCallout({ tenantId, mengantarPickupId }: { tenantId: string; mengantarPickupId: string | null }) {
  const checks = await loadSetup(tenantId, mengantarPickupId);
  if (checks === null) {
    return (
      <Surface aria-labelledby="setup-heading" className="gap-2 p-5 sm:p-6" data-testid="dashboard-setup">
        <h2 id="setup-heading" className="text-[19px] leading-tight tracking-tight">Pengaturan gerai</h2>
        <p className="text-[15px] text-muted-foreground">Status pengaturan belum bisa dibaca.</p>
        <Link href="/pengaturan" prefetch={false} className="inline-flex min-h-11 items-center self-start text-[15px] text-primary hover:underline">Buka Pengaturan</Link>
      </Surface>
    );
  }
  const done = checks.filter((c) => c.done).length;
  if (done === checks.length) return null;
  return (
    <Surface aria-labelledby="setup-heading" className="overflow-hidden" data-testid="dashboard-setup">
      <RegionHeading
        id="setup-heading"
        title="Lengkapi pengaturan gerai"
        sample={false}
        description={<span className="tabular">{done} dari {checks.length} siap. Pesanan asli butuh ketiganya.</span>}
      />
      <ul className="mt-3 divide-y divide-border border-t border-border">
        {checks.map((c) => (
          <li key={c.key}>
            {c.done ? (
              <p className="flex min-h-14 items-center gap-3 px-5 py-3 sm:px-6">
                <CheckCircle2 className="size-5 shrink-0 text-success" aria-hidden="true" />
                <span className="flex-1 font-semibold">{c.label}</span>
                <span className="text-sm text-success">Siap</span>
              </p>
            ) : (
              <Link href={`/pengaturan#${c.key}`} prefetch={false} className="flex min-h-14 items-center gap-3 px-5 py-3 transition-colors hover:bg-muted sm:px-6">
                <CircleDashed className="size-5 shrink-0 text-warning" aria-hidden="true" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex flex-wrap items-baseline gap-x-1.5">
                    <span className="font-semibold">{c.label}</span>
                    <span className="text-sm whitespace-nowrap text-warning">Belum siap</span>
                  </span>
                  <span className="text-sm text-muted-foreground">{c.todo}</span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </Link>
            )}
          </li>
        ))}
      </ul>
    </Surface>
  );
}

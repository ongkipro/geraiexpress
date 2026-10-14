import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CheckCircle2, CircleDashed, PauseCircle } from "lucide-react";
import { formatWib } from "@/lib/format";
import { requirePlatform } from "@/lib/platform";
import { supabaseServer } from "@/lib/supabase/server";
import { LifecycleForm, RegistrationSwitch } from "./forms";

export const metadata: Metadata = { title: "Gerai · Super Admin" };

const LIFECYCLE: Record<string, { label: string; Icon: typeof CheckCircle2 }> = {
  active: { label: "Aktif", Icon: CheckCircle2 },
  suspended: { label: "Dibekukan", Icon: PauseCircle },
  provisioning: { label: "Menunggu persetujuan", Icon: CircleDashed },
  archived: { label: "Diarsipkan", Icon: CircleDashed },
};

type TenantRow = { id: string; name: string; lifecycle: string; created_at: string; member_count: number; shipment_count: number };

// PR-15: business directory with lifecycle state; counts only, never customer records.
export default async function PlatformTenantsPage() {
  const session = await requirePlatform();
  // The platform landing page; an administrator without tenant governance goes to their first page.
  if (!session.capabilities.includes("tenant_governance")) {
    if (session.capabilities.includes("access_governance")) redirect("/admin/akses");
    if (session.capabilities.includes("audit_review")) redirect("/admin/audit");
    return (
      <div className="flex max-w-[680px] flex-col gap-2">
        <h1 className="text-3xl tracking-tight">Super Admin</h1>
        <p className="text-muted-foreground">Kemampuan Anda belum memiliki halaman di versi ini.</p>
      </div>
    );
  }
  const supabase = await supabaseServer();
  const [{ data: raw, error }, { data: open }] = await Promise.all([
    supabase.rpc("platform_tenants"),
    supabase.rpc("registration_open"),
  ]);
  const data = (raw ?? []) as TenantRow[];

  return (
    <div className="flex max-w-[980px] flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl tracking-tight">Gerai</h1>
        <p className="text-muted-foreground">Semua bisnis terdaftar (gerai demo tidak ditampilkan). Isi kontak dan pengiriman pelanggan tidak terlihat di sini.</p>
      </div>
      <section aria-labelledby="registration-heading" className="flex flex-col gap-3 rounded-lg bg-card p-4 ring-1 ring-border">
        <div className="flex flex-col gap-1">
          <h2 id="registration-heading" className="text-xl">Pendaftaran publik</h2>
          <p className="text-sm text-muted-foreground" data-testid="registration-state">
            {open ? "Terbuka: siapa pun dengan email terverifikasi bisa mengajukan gerai." : "Tertutup: hanya akun yang sudah ada dan demo yang bisa masuk."}
          </p>
        </div>
        <RegistrationSwitch open={Boolean(open)} />
      </section>
      {error ? (
        <p role="alert" className="rounded-md bg-card p-4 ring-1 ring-foreground"><span aria-hidden="true">⚠ </span>Daftar gerai belum bisa dimuat. Muat ulang halaman.</p>
      ) : data.length === 0 ? (
        <p className="rounded-lg bg-card p-6 ring-1 ring-border">Belum ada gerai terdaftar.</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg bg-card ring-1 ring-border">
          {data.map((t) => {
            const { label, Icon } = LIFECYCLE[t.lifecycle] ?? LIFECYCLE.archived;
            return (
              <li key={t.id} className="flex flex-col gap-3 p-4" data-testid="platform-tenant">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <span className="min-w-0">
                    <span className="font-semibold">{t.name}</span>
                    <span className="block text-sm text-muted-foreground">
                      {t.member_count} anggota aktif · {t.shipment_count} pengiriman · terdaftar {formatWib(t.created_at)}
                    </span>
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-full bg-muted px-2.5 py-1 text-sm ring-1 ring-border">
                    <Icon className="size-4" aria-hidden="true" /> {label}
                  </span>
                </div>
                {t.lifecycle === "active" || t.lifecycle === "suspended" ? (
                  <LifecycleForm tenantId={t.id} tenantName={t.name} lifecycle={t.lifecycle} />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

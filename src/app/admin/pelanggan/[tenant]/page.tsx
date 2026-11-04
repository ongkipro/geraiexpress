import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Notice } from "@/components/notice";
import { requirePlatform } from "@/lib/platform";
import { PageHeader } from "../../ui";
import { TenantCustomersPanel } from "../customer-forms";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The capability is checked here as well, so the tab title never reveals the page (see ../page.tsx).
export async function generateMetadata(): Promise<Metadata> {
  await requirePlatform("customer_data_review");
  return { title: "Data pelanggan gerai · Super Admin" };
}

// T-093 review P1: one gerai's shipment customer details for `customer_data_review` alone. It calls no
// monitoring RPC; the gerai name comes back with the audited read, so nothing is read before a reason.
export default async function TenantCustomerDataPage({ params }: { params: Promise<{ tenant: string }> }) {
  await requirePlatform("customer_data_review");
  const { tenant } = await params;
  if (!UUID.test(tenant)) notFound();
  return (
    <div className="flex max-w-[880px] flex-col gap-6">
      <PageHeader crumbs={[{ href: "/admin/pelanggan", label: "Data pelanggan" }]} current="Data pelanggan gerai" title="Data pelanggan gerai"
        description="Nama, nomor dan alamat pengirim/penerima per kiriman di satu gerai. Hanya untuk ditinjau." />
      <Notice tone="warning">Data pribadi. Setiap halaman yang dibuka tercatat di audit dengan alasan Anda.</Notice>
      <section className="flex flex-col gap-4 rounded-lg bg-card p-5 ring-1 ring-border md:p-6">
        <TenantCustomersPanel tenantId={tenant} />
      </section>
    </div>
  );
}

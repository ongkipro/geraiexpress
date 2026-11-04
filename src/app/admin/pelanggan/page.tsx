import type { Metadata } from "next";
import { Notice } from "@/components/notice";
import { requirePlatform } from "@/lib/platform";
import { PageHeader } from "../ui";
import { CustomerLookupForm } from "./customer-forms";

// The capability is checked here as well: a static `metadata` export is rendered even when the page
// calls notFound(), so the tab title would reveal this page to an administrator without access.
export async function generateMetadata(): Promise<Metadata> {
  await requirePlatform("customer_data_review");
  return { title: "Data pelanggan · Super Admin" };
}

// T-093 / DEC-024 (a): cross-gerai customer profile by phone, for `customer_data_review` only (plain 404
// otherwise, like every platform page). Nothing is read until the administrator submits a reason.
export default async function CustomerDataPage() {
  await requirePlatform("customer_data_review");
  return (
    <div className="flex max-w-[880px] flex-col gap-6">
      <PageHeader title="Data pelanggan"
        description="Cari satu nomor HP untuk melihat berapa kali ia mengirim atau menerima, dan di gerai/cabang mana. Hanya untuk ditinjau; tidak ada tindakan atas nama gerai." />
      <Notice tone="warning">
        Data pribadi. Buka hanya dengan alasan yang jelas; setiap pencarian tercatat di audit. Penggunaan di produksi menunggu tinjauan counsel (T-048).
      </Notice>
      <CustomerLookupForm />
    </div>
  );
}

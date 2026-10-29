import Link from "next/link";
import { FileQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia } from "@/components/ui/empty";

// UX-12: inside the workspace shell, so the navigation stays available. The page is also what a
// member sees for a record of another gerai (the same answer as a record that does not exist).
export default function WorkspaceNotFound() {
  return (
    <Empty className="mx-auto max-w-[640px] rounded-lg bg-card p-8 ring-1 ring-border sm:p-12">
      <EmptyHeader className="max-w-md">
        <EmptyMedia variant="icon"><FileQuestion aria-hidden="true" /></EmptyMedia>
        <h1 className="text-2xl tracking-tight">Halaman atau data tidak ditemukan</h1>
        <EmptyDescription className="text-[15px]">
          Data yang Anda cari tidak ada di gerai ini, atau Anda tidak punya akses ke sana. Kembali ke daftar pengiriman untuk melanjutkan.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button asChild><Link href="/pengiriman">Kembali ke Pengiriman</Link></Button>
      </EmptyContent>
    </Empty>
  );
}

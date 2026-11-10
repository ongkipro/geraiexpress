"use client";

import Link from "next/link";
import { AuthCard, AuthHeading, AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";

// UX-12: Bahasa Indonesia, no stack or message from the failure (those can hold identifiers or
// provider detail). The digest is an opaque hash that support can match to the server log.
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <AuthShell>
      <AuthCard>
        <AuthHeading title="Terjadi kesalahan" />
        <p role="alert" className="-mt-4 text-[15px] text-muted-foreground sm:text-base">
          Halaman ini tidak bisa ditampilkan. Kesalahan ini tidak mengubah data Anda. Coba lagi, atau kembali ke beranda.
        </p>
        {error.digest ? <p className="text-sm text-muted-foreground">Kode: <span className="tabular break-all">{error.digest}</span></p> : null}
        <div className="flex flex-col gap-3">
          <Button type="button" className="w-full" onClick={() => reset()}>Coba lagi</Button>
          <Button asChild variant="outline" className="w-full"><Link href="/">Kembali ke beranda</Link></Button>
        </div>
      </AuthCard>
    </AuthShell>
  );
}

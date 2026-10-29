"use client";

import "./globals.css";
import { AuthCard, AuthHeading, AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";

// Replaces the root layout when it fails, so it owns <html> and <body>. Plain anchor (not
// next/link): the router itself may be what broke. UX-12: Bahasa, no failure detail.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="id">
      <body className="min-h-dvh antialiased">
        <AuthShell>
          <AuthCard>
            <AuthHeading title="Terjadi kesalahan" />
            <p role="alert" className="-mt-4 text-[15px] text-muted-foreground sm:text-base">
              Aplikasi tidak bisa ditampilkan saat ini. Data Anda tidak berubah oleh kesalahan ini. Coba lagi, atau buka beranda.
            </p>
            {error.digest ? <p className="text-sm text-muted-foreground">Kode: <span className="tabular break-all">{error.digest}</span></p> : null}
            <div className="flex flex-col gap-3">
              <Button type="button" className="w-full" onClick={() => reset()}>Coba lagi</Button>
              <Button asChild variant="outline" className="w-full"><a href="/">Kembali ke beranda</a></Button>
            </div>
          </AuthCard>
        </AuthShell>
      </body>
    </html>
  );
}

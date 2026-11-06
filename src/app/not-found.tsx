import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard, AuthHeading, AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Halaman tidak ditemukan" };

// SEC-6 / T-055: this file is also the page of Next's `/_not-found` route, which answers every unknown
// path. Prerendered, that HTML carries no nonce and the enforced policy blocks its scripts, so the route
// renders per request. Only the `/_not-found` page reads this export (Next takes `dynamic` from a
// segment's layout or page module, never from its not-found boundary). The component stays synchronous:
// a `notFound()` page is painted on the client from this boundary, and awaiting `connection()` here
// delayed that paint.
export const dynamic = "force-dynamic";

// UX-12: Bahasa Indonesia on every host. A link back that exists on all of them.
export default function NotFound() {
  return (
    <AuthShell>
      <AuthCard>
        <AuthHeading
          title="Halaman tidak ditemukan"
          description="Alamat yang Anda buka tidak ada, sudah dipindahkan, atau bukan untuk akun ini. Periksa alamatnya, atau kembali ke beranda."
        />
        <Button asChild className="w-full"><Link href="/">Kembali ke beranda</Link></Button>
      </AuthCard>
    </AuthShell>
  );
}

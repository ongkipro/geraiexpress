import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard, AuthHeading, AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Halaman tidak ditemukan" };

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

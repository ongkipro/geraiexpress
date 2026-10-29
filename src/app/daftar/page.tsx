import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthCard, AuthFooter, AuthShell, authLinkClass } from "@/components/auth/auth-shell";
import { currentUser, dbServer } from "@/lib/db/server";
import { config } from "@/lib/config";
import { CodeFlow } from "./forms";

export const metadata: Metadata = { title: "Daftar" };

// PR-29 / DEC-007: verify the inbox first; password and the gerai application come after.
export default async function RegisterPage() {
  const user = await currentUser();
  if (user && !user.isAnonymous) redirect("/");
  const db = await dbServer();
  const { data: open } = await db.rpc("registration_open");

  return (
    <AuthShell>
      <AuthCard>
        <CodeFlow siteKey={config("TURNSTILE_SITE_KEY")} registrationOpen={Boolean(open)} />
      </AuthCard>
      <AuthFooter>
        <p>
          Sudah punya akun? <Link href="/masuk" className={authLinkClass}>Masuk</Link>
        </p>
      </AuthFooter>
    </AuthShell>
  );
}

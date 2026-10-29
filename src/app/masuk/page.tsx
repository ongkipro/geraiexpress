import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthCard, AuthFooter, AuthHeading, AuthShell, authLinkClass } from "@/components/auth/auth-shell";
import { Separator } from "@/components/ui/separator";
import { dbServer } from "@/lib/db/server";
import { requestScope } from "@/lib/hosts";
import { loadPlatform } from "@/lib/platform";
import { loadWorkspace } from "@/lib/workspace";
import { config } from "@/lib/config";
import { DemoEntry, SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Masuk" };

// The same sign-in serves the app host and the owner host (platform sign-in, then the second
// factor), each with its own host-only session (DEC-015). On the owner host a signed-in grant holder
// goes straight on, and the gerai-only entries (demo, registration) are not offered because the
// owner host does not serve those routes.
export default async function SignInPage() {
  const platformHost = (await requestScope()) === "platform";
  if (platformHost) {
    if (await loadPlatform()) redirect("/admin");
  } else {
    const current = await loadWorkspace();
    if (current.kind === "ready") redirect("/");
    if (current.kind === "choose") redirect("/pilih-gerai");
    if (current.kind === "no-access" && !current.isAnonymous) redirect("/");
  }
  const { data: open } = platformHost ? { data: null } : await (await dbServer()).rpc("registration_open");

  const siteKey = config("TURNSTILE_SITE_KEY");

  return (
    <AuthShell context={platformHost ? "Super Admin" : undefined}>
      <AuthCard>
        <AuthHeading
          title={platformHost ? "Masuk ke Super Admin" : "Masuk ke ruang kerja gerai"}
          description={platformHost
            ? "Masuk dengan akun Super Admin. Setelah itu Anda diminta kode autentikator."
            : "Masuk dengan email dan kata sandi GeraiExpress Anda — bukan kata sandi Mengantar."}
        />
        <section aria-labelledby="signin-heading">
          <h2 id="signin-heading" className="sr-only">Masuk dengan email</h2>
          <SignInForm siteKey={siteKey} codeEntry={!platformHost} />
        </section>

        {platformHost ? null : (
          <>
            <Separator />
            {/* UX-3: the demo stays discoverable on the sign-in page, as the secondary path. */}
            <section aria-labelledby="demo-heading" className="flex flex-col gap-3">
              <h2 id="demo-heading" className="text-lg font-semibold">Ingin mencoba dulu?</h2>
              <p className="text-[15px] text-muted-foreground">
                Demo membuka gerai contoh dengan kontak, pengiriman dan label contoh. Semua harga, resi dan
                label di demo adalah simulasi — tidak ada akun Mengantar, pembayaran atau data asli yang dipakai.
              </p>
              <DemoEntry siteKey={siteKey} />
            </section>
          </>
        )}
      </AuthCard>

      {platformHost ? null : (
        <AuthFooter>
          {open ? (
            <p>
              Belum punya akun?{" "}
              <Link href="/daftar" className={authLinkClass}>Daftarkan gerai</Link>
            </p>
          ) : (
            <p>
              Pendaftaran gerai baru belum dibuka. Diundang sebagai staf?{" "}
              <Link href="/daftar" className={authLinkClass}>Masuk dengan kode email</Link>
            </p>
          )}
        </AuthFooter>
      )}
    </AuthShell>
  );
}

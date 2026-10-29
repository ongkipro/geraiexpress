import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { MarketingHomePage } from "@/components/marketing/home-page";
import { WorkspaceFrame } from "@/components/workspace-frame";
import { requestScope } from "@/lib/hosts";
import { loadPlatform } from "@/lib/platform";
import { currentUser, dbServer } from "@/lib/db/server";
import { loadWorkspace } from "@/lib/workspace";
import { parsePeriod } from "@/modules/dashboard/aggregate";
import { DASHBOARD_TITLE, DashboardPage } from "@/modules/dashboard/dashboard-page";

const TITLE = "Kasir Loket Pengiriman Multi-Kurir · GeraiExpress";
const DESCRIPTION =
  "Bandingkan tarif banyak kurir dan buat kiriman drop-off dari satu layar di toko Anda. Kontak pelanggan tersimpan, dan ada demo simulasi untuk dicoba tanpa akun Mengantar.";

const MARKETING_METADATA: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  robots: { index: true, follow: true },
  alternates: { canonical: "/" },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "https://geraiexpress.com/",
    siteName: "GeraiExpress",
    locale: "id_ID",
    type: "website",
  },
};

// The apex always gets the public page's metadata; a signed-in gerai session on the app (or shared)
// host gets its private Dashboard, never indexed.
export async function generateMetadata(): Promise<Metadata> {
  const scope = await requestScope();
  if (scope !== "tenant" && scope !== "shared") return MARKETING_METADATA;
  const current = await loadWorkspace();
  return current.kind === "ready" ? { title: DASHBOARD_TITLE, robots: { index: false, follow: false } } : MARKETING_METADATA;
}

// PR-32, PR-36 & T-029 (UX-11, UX-16): `/` depends on the host. The apex is always the public page and
// reads no session. The owner host leads to the platform sign-in or the platform overview, and the
// app host to the gerai sign-in, the gerai Dashboard, or the next permitted action. A development or
// preview host that serves every audience keeps the combined behavior: public page when signed out,
// otherwise the Dashboard or the next permitted action.
export default async function Home({ searchParams }: { searchParams: Promise<{ hari?: string | string[] }> }) {
  const scope = await requestScope();
  if (scope === "public") return <MarketingHomePage />;
  if (scope === "platform") return platformEntry();

  const current = await loadWorkspace();
  if (current.kind === "anonymous") {
    if (scope === "tenant") redirect("/masuk");
    return <MarketingHomePage />;
  }
  if (current.kind === "no-access" && current.isAnonymous) redirect("/masuk");

  const db = await dbServer();
  const { data } = await db.rpc("my_account_state");
  const account = (data as { has_password: boolean; application_status: string | null }[] | null)?.[0];
  // An identity verified by email code sets its own password before anything else (DEC-007).
  if (account && !account.has_password) redirect("/daftar/kata-sandi");

  if (current.kind === "ready") {
    return (
      <WorkspaceFrame>
        <DashboardPage periodDays={parsePeriod((await searchParams).hari)} />
      </WorkspaceFrame>
    );
  }
  if (current.kind === "choose") redirect("/pilih-gerai");
  // The platform workspace is another host; the app host never sends a person there.
  if (scope === "shared" && (await loadPlatform())) redirect("/admin");
  const { data: invites } = await db.rpc("my_invitations");
  if ((invites ?? []).length > 0) redirect("/undangan");
  if (account?.application_status) redirect("/daftar/gerai");
  redirect("/akses");
}

// Owner host `/`: platform sign-in when signed out, the platform overview for a grant holder (its
// layout continues to the second factor), a plain 404 for any other signed-in identity.
async function platformEntry(): Promise<never> {
  if (!(await currentUser())) redirect("/masuk");
  if (await loadPlatform()) redirect("/admin");
  notFound();
}

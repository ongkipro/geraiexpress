import { redirect } from "next/navigation";
import { loadPlatform } from "@/lib/platform";
import { supabaseServer } from "@/lib/supabase/server";
import { loadWorkspace } from "@/lib/workspace";

// PR-32: route from current verified identity, own onboarding and memberships to the next
// permitted action.
export default async function Home() {
  const current = await loadWorkspace();
  if (current.kind === "anonymous") redirect("/masuk");
  if (current.kind === "no-access" && current.isAnonymous) redirect("/masuk");

  const supabase = await supabaseServer();
  const { data } = await supabase.rpc("my_account_state");
  const account = (data as { has_password: boolean; application_status: string | null }[] | null)?.[0];
  // An identity verified by email code sets its own password before anything else (DEC-007).
  if (account && !account.has_password) redirect("/daftar/kata-sandi");

  if (current.kind === "ready") redirect("/pengiriman");
  if (current.kind === "choose") redirect("/pilih-gerai");
  if (await loadPlatform()) redirect("/admin");
  const { data: invites } = await supabase.rpc("my_invitations");
  if ((invites ?? []).length > 0) redirect("/undangan");
  if (account?.application_status) redirect("/daftar/gerai");
  redirect("/akses");
}

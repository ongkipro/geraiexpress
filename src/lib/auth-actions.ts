"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { TENANT_COOKIE } from "@/lib/workspace";
import { friendlyError } from "@/lib/errors";

const TENANT_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  secure: process.env.NODE_ENV === "production",
};

export type SignInState = { error?: string; email?: string };

export async function signInAction(_: SignInState, form: FormData): Promise<SignInState> {
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return { error: "Isi email dan kata sandi.", email };
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  // One message for every failure so the form does not reveal which emails exist.
  if (error) return { error: "Email atau kata sandi tidak cocok.", email };
  (await cookies()).delete(TENANT_COOKIE);
  redirect("/pengiriman");
}

export type DemoState = { error?: string };

// PR-21 / IAM-4: each visitor gets an anonymous session and an isolated, seeded demo tenant.
export async function startDemoAction(): Promise<DemoState> {
  const supabase = await supabaseServer();
  const { data: current } = await supabase.auth.getUser();
  // Never silently end a real account's session to start a demo.
  if (current.user && !current.user.is_anonymous) {
    return { error: "Anda sedang masuk dengan akun gerai. Keluar dulu untuk mencoba demo." };
  }
  if (!current.user) {
    const { error } = await supabase.auth.signInAnonymously();
    if (error) return { error: "Demo belum bisa dibuka. Coba lagi sebentar lagi." };
  }
  const { data: tenant, error } = await supabase.rpc("start_demo");
  if (error) return { error: friendlyError(error) };
  (await cookies()).set(TENANT_COOKIE, tenant as string, TENANT_COOKIE_OPTIONS);
  redirect("/pengiriman");
}

export async function resetDemoAction() {
  const supabase = await supabaseServer();
  await supabase.rpc("reset_demo");
  redirect("/pengiriman?reset=1");
}

export async function signOutAction() {
  const supabase = await supabaseServer();
  await supabase.auth.signOut({ scope: "local" });
  (await cookies()).delete(TENANT_COOKIE);
  redirect("/masuk");
}

export async function chooseTenantAction(form: FormData) {
  const tenant = String(form.get("tenant") ?? "");
  const supabase = await supabaseServer();
  // Validate the selector against the caller's own memberships before storing it.
  const { data: auth } = await supabase.auth.getUser();
  const { data } = await supabase.from("memberships").select("tenant_id")
    .eq("tenant_id", tenant).eq("user_id", auth.user?.id ?? "").eq("status", "active");
  if (!data?.length) redirect("/pilih-gerai?galat=1");
  (await cookies()).set(TENANT_COOKIE, tenant, TENANT_COOKIE_OPTIONS);
  redirect("/pengiriman");
}

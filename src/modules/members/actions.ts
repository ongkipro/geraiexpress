"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { friendlyError } from "@/lib/errors";
import { dbServer } from "@/lib/db/server";
import { TENANT_COOKIE, requireWorkspace } from "@/lib/workspace";

export type MemberState = { error?: string; ok?: string; invitedEmail?: string };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// PR-31 / DEC-007: the tenant comes from the verified workspace, never from the form.
export async function inviteAction(_: MemberState, form: FormData): Promise<MemberState> {
  const ws = await requireWorkspace();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const role = String(form.get("role") ?? "operator");
  if (!EMAIL.test(email)) return { error: "Masukkan alamat email yang valid." };
  const db = await dbServer();
  const { error } = await db.rpc("invite_member", { p_tenant: ws.tenant.id, p_email: email, p_role: role });
  if (error) return { error: friendlyError(error) };
  revalidatePath("/anggota");
  return { ok: "Undangan dibuat.", invitedEmail: email };
}

export async function revokeInvitationAction(_: MemberState, form: FormData): Promise<MemberState> {
  await requireWorkspace();
  const db = await dbServer();
  const { error } = await db.rpc("revoke_invitation", {
    p_id: String(form.get("id")), p_expected_revision: Number(form.get("revision")),
  });
  if (error) return { error: friendlyError(error) };
  revalidatePath("/anggota");
  return { ok: "Undangan dicabut." };
}

export async function setRoleAction(_: MemberState, form: FormData): Promise<MemberState> {
  const ws = await requireWorkspace();
  const db = await dbServer();
  const { error } = await db.rpc("set_member_role", {
    p_tenant: ws.tenant.id, p_user: String(form.get("user_id")),
    p_role: String(form.get("role")), p_expected_revision: Number(form.get("revision")),
  });
  if (error) return { error: friendlyError(error) };
  revalidatePath("/anggota");
  return { ok: "Peran diperbarui." };
}

export async function deactivateAction(_: MemberState, form: FormData): Promise<MemberState> {
  const ws = await requireWorkspace();
  const db = await dbServer();
  const { error } = await db.rpc("deactivate_member", {
    p_tenant: ws.tenant.id, p_user: String(form.get("user_id")), p_expected_revision: Number(form.get("revision")),
  });
  if (error) return { error: friendlyError(error) };
  revalidatePath("/anggota");
  return { ok: "Anggota dinonaktifkan." };
}

// The invitee chooses explicitly; acceptance opens that gerai's workspace.
export async function acceptInvitationAction(_: MemberState, form: FormData): Promise<MemberState> {
  const db = await dbServer();
  const { data, error } = await db.rpc("accept_invitation", { p_id: String(form.get("id")) });
  if (error) return { error: friendlyError(error) };
  // The selector cookie holds a tenant id only; an odd RPC answer never becomes a broken cookie.
  if (typeof data !== "string" || !UUID.test(data)) return { error: friendlyError(null) };
  (await cookies()).set(TENANT_COOKIE, data, { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" });
  redirect("/");
}

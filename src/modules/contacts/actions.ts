"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { friendlyError } from "@/lib/errors";
import { requireWorkspace } from "@/lib/workspace";
import { normalizePhone } from "@/modules/shipments/draft";

export type ContactState = { error?: string; ok?: string; fieldErrors?: Record<string, string>; values?: Record<string, string> };

const PHONE = /^\+?[0-9]{8,15}$/;

function readContact(form: FormData) {
  const values = {
    name: String(form.get("name") ?? "").trim(),
    phone: String(form.get("phone") ?? "").trim(),
    is_sender: form.get("is_sender") === "on" ? "on" : "",
    is_recipient: form.get("is_recipient") === "on" ? "on" : "",
  };
  const fieldErrors: Record<string, string> = {};
  if (values.name.length < 2 || values.name.length > 120) fieldErrors.name = "Nama 2–120 karakter.";
  const phone = normalizePhone(values.phone);
  if (!PHONE.test(phone)) fieldErrors.phone = "Nomor HP 8–15 digit, contoh 081234567890.";
  if (!values.is_sender && !values.is_recipient) fieldErrors.role = "Pilih minimal satu: pengirim atau penerima.";
  return { values, phone, fieldErrors };
}

function readAddress(form: FormData) {
  const values = {
    label: String(form.get("label") ?? "").trim(),
    address_line: String(form.get("address_line") ?? "").trim(),
    area: String(form.get("area") ?? "").trim(),
    postal_code: String(form.get("postal_code") ?? "").trim(),
  };
  const fieldErrors: Record<string, string> = {};
  if (values.address_line.length < 5 || values.address_line.length > 500) fieldErrors.address_line = "Alamat 5–500 karakter.";
  if (values.area.length < 3 || values.area.length > 160) fieldErrors.area = "Kecamatan/kota 3–160 karakter.";
  if (values.postal_code && !/^[0-9]{5}$/.test(values.postal_code)) fieldErrors.postal_code = "Kode pos 5 digit.";
  if (values.label.length > 60) fieldErrors.label = "Label maksimal 60 karakter.";
  return { values, fieldErrors };
}

export async function createContactAction(_: ContactState, form: FormData): Promise<ContactState> {
  const ws = await requireWorkspace();
  const c = readContact(form);
  const a = readAddress(form);
  const wantsAddress = Boolean(a.values.address_line || a.values.area);
  const fieldErrors = { ...c.fieldErrors, ...(wantsAddress ? a.fieldErrors : {}) };
  const values = { ...c.values, ...a.values };
  if (Object.keys(fieldErrors).length) return { error: "Periksa isian yang ditandai.", fieldErrors, values };

  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("contacts").insert({
    tenant_id: ws.tenant.id, name: c.values.name, phone: c.phone,
    is_sender: Boolean(c.values.is_sender), is_recipient: Boolean(c.values.is_recipient),
  }).select("id").single();
  if (error || !data) return { error: friendlyError(error), values };
  if (wantsAddress) {
    const { error: addressError } = await supabase.from("contact_addresses").insert({
      tenant_id: ws.tenant.id, contact_id: data.id, label: a.values.label || "Utama", address_line: a.values.address_line,
      area: a.values.area, postal_code: a.values.postal_code || null, is_primary: true,
    });
    // The contact exists now; never report full success when its address was not stored.
    if (addressError) {
      revalidatePath("/kontak");
      redirect(`/kontak/${data.id}?baru=1&alamat=gagal`);
    }
  }
  revalidatePath("/kontak");
  redirect(`/kontak/${data.id}?baru=1`);
}

export async function updateContactAction(_: ContactState, form: FormData): Promise<ContactState> {
  const ws = await requireWorkspace();
  const id = String(form.get("contact_id"));
  const revision = Number(form.get("revision"));
  const c = readContact(form);
  if (Object.keys(c.fieldErrors).length) return { error: "Periksa isian yang ditandai.", fieldErrors: c.fieldErrors, values: c.values };
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("contacts")
    .update({ name: c.values.name, phone: c.phone, is_sender: Boolean(c.values.is_sender), is_recipient: Boolean(c.values.is_recipient) })
    .eq("tenant_id", ws.tenant.id).eq("id", id).eq("revision", revision).select("id").maybeSingle();
  if (error) return { error: friendlyError(error), values: c.values };
  if (!data) return { error: "Kontak ini sudah diubah oleh orang lain. Muat ulang untuk melihat versi terbaru; isian Anda masih ada.", values: c.values };
  revalidatePath(`/kontak/${id}`);
  return { ok: "Kontak tersimpan. Pengiriman yang sudah dikonfirmasi tidak berubah." };
}

export async function addAddressAction(_: ContactState, form: FormData): Promise<ContactState> {
  const ws = await requireWorkspace();
  const contactId = String(form.get("contact_id"));
  const a = readAddress(form);
  if (Object.keys(a.fieldErrors).length) return { error: "Periksa isian yang ditandai.", fieldErrors: a.fieldErrors, values: a.values };
  const supabase = await supabaseServer();
  const { count } = await supabase.from("contact_addresses").select("id", { count: "exact", head: true })
    .eq("tenant_id", ws.tenant.id).eq("contact_id", contactId).is("archived_at", null);
  const { error } = await supabase.from("contact_addresses").insert({
    tenant_id: ws.tenant.id, contact_id: contactId, label: a.values.label || null, address_line: a.values.address_line,
    area: a.values.area, postal_code: a.values.postal_code || null, is_primary: (count ?? 0) === 0,
  });
  if (error) return { error: friendlyError(error), values: a.values };
  revalidatePath(`/kontak/${contactId}`);
  return { ok: "Alamat ditambahkan." };
}

export async function archiveAddressAction(form: FormData) {
  const ws = await requireWorkspace();
  const contactId = String(form.get("contact_id"));
  const supabase = await supabaseServer();
  const { data: archived, error } = await supabase.from("contact_addresses")
    .update({ archived_at: new Date().toISOString(), is_primary: false })
    .eq("tenant_id", ws.tenant.id).eq("contact_id", contactId).eq("id", String(form.get("address_id")))
    .is("archived_at", null).select("id").maybeSingle();
  if (error || !archived) redirect(`/kontak/${contactId}?alamat=arsip-gagal`);
  // Keep exactly one primary address while any active address remains.
  const { data: remaining } = await supabase.from("contact_addresses").select("id, is_primary")
    .eq("tenant_id", ws.tenant.id).eq("contact_id", contactId).is("archived_at", null).order("created_at");
  if (remaining?.length && !remaining.some((r) => r.is_primary)) {
    await supabase.from("contact_addresses").update({ is_primary: true }).eq("tenant_id", ws.tenant.id).eq("id", remaining[0].id);
  }
  revalidatePath(`/kontak/${contactId}`);
  redirect(`/kontak/${contactId}?alamat=diarsipkan`);
}

export async function archiveContactAction(_: ContactState, form: FormData): Promise<ContactState> {
  const ws = await requireWorkspace();
  const contactId = String(form.get("contact_id") ?? "");
  const expectedVersion = Number(form.get("revision"));
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("archive_contact", {
    p_tenant: ws.tenant.id,
    p_contact: contactId,
    p_expected_version: expectedVersion,
  });
  if (error) return { error: friendlyError(error) };
  revalidatePath("/kontak");
  revalidatePath(`/kontak/${contactId}`);
  return { ok: "Kontak diarsipkan. Pengiriman lama tidak berubah." };
}

// PR-18 / PR-26 / IAM-3 / SEC-3 / DEC-006: a tenant admin stores their own Mengantar key; it is
// sealed server-side, never shown again, and readiness stays "not verified".
import { expect, test } from "./fixtures";
import { expectNoHorizontalOverflow, expectTouchTargets, localSql, signIn, signInAdmin } from "./helpers";
import type { Page, Route } from "@playwright/test";

// Server Action POSTs of the page, held (and counted) instead of sent; abort() releases them without a response.
async function holdServerActions(page: Page) {
  const held: Route[] = [];
  await page.route(/\/pengaturan/, async (route) => {
    if (route.request().method() === "POST" && route.request().headers()["next-action"]) held.push(route);
    else await route.continue();
  });
  return { held, abort: async () => { for (const route of held) await route.abort(); } };
}

test("an admin stores a seller key that is never shown again and stays unverified", async ({ page }) => {
  const key = `mk_e2e_${Date.now()}SECRETVALUEWXYZ`;
  await signIn(page, "owner-a@geraiexpress.test");
  await page.goto("/pengaturan");
  const section = page.getByRole("region", { name: "Akun Mengantar (kunci API sendiri)" });
  await section.getByLabel("Kunci API Mengantar").fill("pendek");
  await section.getByRole("button", { name: /Simpan kunci|Ganti kunci/ }).click();
  await expect(section.getByRole("alert")).toHaveText(/Konfirmasi bahwa akun Mengantar ini milik bisnis Anda/);
  await section.getByLabel("Kunci API Mengantar").fill("pendek");
  await section.getByRole("checkbox").check();
  await section.getByRole("button", { name: /Simpan kunci|Ganti kunci/ }).click();
  await expect(section.getByRole("alert")).toHaveText(/Kunci API tidak valid/);

  await section.getByLabel("Kunci API Mengantar").fill(key);
  await section.getByRole("checkbox").check();
  await section.getByRole("button", { name: /Simpan kunci|Ganti kunci/ }).click();
  await expect(page.getByTestId("seller-key-status")).toContainText("…WXYZ");
  await expect(page.getByText(/berakhiran …WXYZ tersimpan terenkripsi/)).toBeVisible();
  await expect(page.getByText("Belum diverifikasi").first()).toBeVisible();
  await page.reload();
  expect(await page.content()).not.toContain("SECRETVALUE");
  await expectNoHorizontalOverflow(page);
  await expectTouchTargets(page);

  // T-053 / UX-13: removal is confirmed first and says that shipping pauses; cancelling keeps the key.
  await page.getByRole("button", { name: "Hapus kunci" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Pengiriman gerai ini berhenti sampai kunci baru disimpan");
  await expect(dialog).toContainText("tidak bisa ditampilkan lagi");
  await dialog.getByRole("button", { name: "Batal" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("seller-key-status")).toContainText("…WXYZ");
  await page.getByRole("button", { name: "Hapus kunci" }).click();
  // A double click on the confirmation removes the key with one request (SubmitButton lock).
  let posts = 0;
  page.on("request", (request) => { if (request.method() === "POST" && request.headers()["next-action"]) posts += 1; });
  await page.getByTestId("remove-key-confirm").dblclick();
  await expect(page.getByTestId("seller-key-status")).toHaveCount(0);
  expect(posts).toBe(1);
});

test("operators see the connection state but cannot change it", async ({ page }) => {
  await signIn(page, "operator-a@geraiexpress.test");
  await page.goto("/pengaturan");
  await expect(page.getByText("Akun Mengantar", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Pendaftaran akun Mengantar baru (Partner)" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Akun Mengantar (kunci API sendiri)" })).toHaveCount(0);
});

test("Partner onboarding links configured provider documents or blocks consent submission when they are unavailable (T-034)", async ({ page }) => {
  await signIn(page, "owner-a@geraiexpress.test");
  await page.goto("/pengaturan");
  const section = page.getByRole("region", { name: "Pendaftaran akun Mengantar baru (Partner)" });
  await expect(section).toBeVisible();
  await expect(section.getByText("Lupa Password")).toBeVisible();

  const terms = section.getByRole("link", { name: "Ketentuan Layanan Mengantar" });
  const privacy = section.getByRole("link", { name: "Kebijakan Privasi Mengantar" });
  const submit = section.getByRole("button", { name: "Daftarkan akun Mengantar baru" });
  expect(await section.locator('input[name="terms_version"], input[name="privacy_version"]').count()).toBe(0);
  if (await terms.count()) {
    await expect(terms).toHaveAttribute("href", /^https:\/\//);
    await expect(privacy).toHaveAttribute("href", /^https:\/\//);
    await terms.focus();
    await expect(terms).toBeFocused();
    await section.getByLabel("Nama pemilik akun Mengantar").fill("Pemilik Gerai Uji A");
    await section.getByLabel("Email pemilik").fill("pemilik-uji-a@geraiexpress.test");
    await section.getByLabel("No. HP pemilik (08...)").fill("081234567890");
    await submit.click();
    await expect(section.getByRole("alert")).toHaveText(/Centang persetujuan kepemilikan akun dan Ketentuan\/Privasi Mengantar/);
  } else {
    await expect(privacy).toHaveCount(0);
    await expect(submit).toBeDisabled();
    await expect(section.getByRole("alert")).toContainText("Dokumen Ketentuan Layanan dan Kebijakan Privasi Mengantar belum dikonfigurasi");
    await expect(section.getByRole("checkbox")).toHaveCount(1);
  }
  await expectNoHorizontalOverflow(page);
});

test("the Super Admin integration page shows readiness without values and sets the Partner ID", async ({ page }) => {
  await signInAdmin(page, "admin-2@geraiexpress.test");
  await page.goto("/admin/integrasi");
  await expect(page.getByTestId("sealing-key-status")).toContainText("Terpasang");
  await expect(page.getByTestId("partner-secret-status")).toContainText("Belum dipasang");
  await expect(page.getByTestId("seller-binding").filter({ hasText: "Gerai Uji A" })).toBeVisible();
  await page.getByText("Ubah Partner ID…").click();
  await page.getByLabel("Partner ID (bukan rahasia)").fill("gx-e2e-partner");
  await page.getByLabel("Alasan (dicatat di audit)").fill("Uji e2e partner");
  await page.getByRole("button", { name: "Simpan Partner ID" }).click();
  await expect(page.getByTestId("partner-id-status")).toContainText("gx-e2e-partner");
  await page.getByLabel("Partner ID (bukan rahasia)").fill("");
  await page.getByLabel("Alasan (dicatat di audit)").fill("Kosongkan lagi");
  await page.getByRole("button", { name: "Simpan Partner ID" }).click();
  await expect(page.getByTestId("partner-id-status")).toContainText("Belum diisi");
  await expectNoHorizontalOverflow(page);
});

// T-039 / PR-19 / UX-2 / UX-8: Partner key regeneration states. The states are seeded with local SQL and
// only rendered: no control is submitted, so no provider call is ever made from this spec.
const TENANT_A = "00000000-0000-4000-b000-00000000000a";
const OWNER_A = "00000000-0000-4000-a000-0000000000a1";

function clearPartner() {
  localSql(`delete from private.tenant_mengantar_onboarding where tenant_id = '${TENANT_A}'`);
  localSql(`update private.seller_credentials set superseded_at = now(), ciphertext = null, iv = null where tenant_id = '${TENANT_A}' and superseded_at is null`);
}

function seedPartner(state: string, opts: { credential: boolean; errorCode?: string; retryAfterSeconds?: number }) {
  clearPartner();
  localSql(`insert into private.tenant_mengantar_onboarding (tenant_id, external_user_id, connection_mode, onboarding_state,
      partner_seller_id, owner_name, owner_email, owner_phone, terms_version, privacy_version, consent_actor_id, last_error_code, retry_after_at)
    values ('${TENANT_A}', 'geraiexpress:tenant:${TENANT_A}', 'partner_managed', '${state}', '66ab1234567890abcdef1234',
      'Budi Santoso', 'budi.santoso@gerai-uji.id', '081234567890', 'terms-1', 'privacy-1', '${OWNER_A}',
      ${opts.errorCode ? `'${opts.errorCode}'` : "null"},
      ${opts.retryAfterSeconds ? `now() + interval '${opts.retryAfterSeconds} seconds'` : "null"})`);
  if (opts.credential) {
    // Placeholder bytes: the page never opens the key, and an unreadable key makes no provider call.
    localSql(`insert into private.seller_credentials (tenant_id, mode, ciphertext, iv, key_version, hint, version)
      select '${TENANT_A}', 'partner', repeat('c', 32), repeat('i', 16), 'v1', 'ab', coalesce(max(version), 0) + 1
      from private.seller_credentials where tenant_id = '${TENANT_A}'`);
  }
}

test("a Partner-managed admin must confirm before the key is regenerated, and cancelling changes nothing", async ({ page }) => {
  seedPartner("connected", { credential: true });
  try {
    await signIn(page, "owner-a@geraiexpress.test");
    await page.goto("/pengaturan");
    const section = page.getByRole("region", { name: "Pendaftaran akun Mengantar baru (Partner)" });
    await expect(section.getByText("Terdaftar melalui Partner Mengantar")).toBeVisible();
    const trigger = section.getByRole("button", { name: "Buat ulang kunci API" });
    await expect(trigger).toBeVisible();
    await expect(section.getByRole("button", { name: "Daftarkan akun Mengantar baru" })).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    await expectTouchTargets(page);

    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Buat ulang kunci API Mengantar?" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Kunci lama berhenti berlaku seketika");
    await expect(dialog).toContainText("dijeda sampai kunci baru");
    await expect(dialog.getByRole("button", { name: "Ya, buat ulang kunci" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await dialog.getByRole("button", { name: "Batal" }).click();
    await expect(dialog).toHaveCount(0);
    await trigger.click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);

    expect(localSql(`select onboarding_state from private.tenant_mengantar_onboarding where tenant_id = '${TENANT_A}'`)).toBe("connected");
    expect(localSql(`select count(*) from private.seller_credentials where tenant_id = '${TENANT_A}' and superseded_at is null`)).toBe("1");
  } finally {
    clearPartner();
  }
});

test("a double click on 'Ya, buat ulang kunci' sends one request", async ({ page }) => {
  seedPartner("connected", { credential: true });
  try {
    await signIn(page, "owner-a@geraiexpress.test");
    await page.goto("/pengaturan");
    const requests = await holdServerActions(page);
    await page.getByRole("region", { name: "Pendaftaran akun Mengantar baru (Partner)" }).getByRole("button", { name: "Buat ulang kunci API" }).click();
    const dialog = page.getByRole("dialog", { name: "Buat ulang kunci API Mengantar?" });
    await dialog.screenshot({ path: test.info().outputPath("regenerate-dialog.png") });
    await page.getByTestId("partner-key-regenerate-confirm").dblclick();
    await page.waitForTimeout(800);
    expect(requests.held).toHaveLength(1);
    await requests.abort();
  } finally {
    clearPartner();
  }
});

test("an unknown rotation shows the paused state and the recovery action, and operators see no control", async ({ page }) => {
  seedPartner("rotation_unknown", { credential: false, errorCode: "RATE_LIMITED", retryAfterSeconds: 300 });
  try {
    await signIn(page, "owner-a@geraiexpress.test");
    await page.goto("/pengaturan");
    const section = page.getByRole("region", { name: "Pendaftaran akun Mengantar baru (Partner)" });
    const panel = section.getByTestId("partner-rotation-unknown");
    await expect(panel).toContainText("Kunci API dijeda: hasil pembuatan ulang belum pasti");
    await expect(panel).toContainText("Pengiriman, cek ongkir, dan penerbitan resi dijeda");
    await expect(panel).toContainText("kunci tidak dibuat ulang lagi");
    await expect(panel).toContainText("Mengantar meminta menunggu sampai");
    await expect(panel.getByRole("button", { name: "Ambil kunci terbaru" })).toBeVisible();
    await expect(section.getByRole("button", { name: "Buat ulang kunci API" })).toHaveCount(0);
    await expect(section.getByRole("button", { name: "Daftarkan akun Mengantar baru" })).toHaveCount(0);
    await expect(page.getByText("Belum tersedia").first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectTouchTargets(page);

    await page.context().clearCookies();
    await signIn(page, "operator-a@geraiexpress.test");
    await page.goto("/pengaturan");
    await expect(page.getByRole("button", { name: "Ambil kunci terbaru" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Buat ulang kunci API" })).toHaveCount(0);
    await expect(page.getByTestId("partner-rotation-unknown")).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  } finally {
    clearPartner();
  }
});

for (const [code, text] of [
  ["API_KEY_DISABLED", "Mengantar menonaktifkan kunci API akun penjual ini."],
  ["SELLER_DEACTIVATED", "Mengantar menonaktifkan akun penjual ini."],
] as const) {
  test(`${code} is a stop state with a clear message and no retry control`, async ({ page }) => {
    seedPartner("provider_restricted", { credential: false, errorCode: code });
    try {
      await signIn(page, "owner-a@geraiexpress.test");
      await page.goto("/pengaturan");
      const section = page.getByRole("region", { name: "Pendaftaran akun Mengantar baru (Partner)" });
      const stopped = section.getByTestId("partner-key-stopped");
      await expect(stopped).toContainText(text);
      await expect(stopped).toContainText("dihentikan dan tidak akan dicoba lagi");
      await expect(section.getByRole("button")).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
      await expectTouchTargets(page);
    } finally {
      clearPartner();
    }
  });
}

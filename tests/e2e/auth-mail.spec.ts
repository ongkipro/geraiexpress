// DEC-009 / PR-29: the one-time-code mail is rendered and sent by the app itself (Mailpit locally).
// Whether a mail goes out is decided in SQL before a code exists: an address that may not register gets
// the very same reply as one that may, and no mail.
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { localSql, mailCode, startDemo } from "./helpers";
import { mailCount } from "../mail";

test.describe.configure({ mode: "serial" });

async function requestCode(page: Page, email: string) {
  await page.goto("/daftar");
  await page.waitForLoadState("networkidle");
  const send = page.getByRole("button", { name: "Kirim kode" });
  await page.getByRole("textbox", { name: "Email", exact: true }).fill(email);
  await expect(send).not.toHaveAttribute("aria-disabled", "true");
  await send.click();
  await expect(page.getByText(`Jika alamat ${email} bisa dipakai, kode 6 digit sudah dikirim ke sana.`)).toBeVisible();
}

test("a requested code is mailed once and signs the visitor in; asking again right away mails nothing more", async ({ page }) => {
  test.setTimeout(60_000);
  const email = `kode-${Date.now()}-${Math.floor(Math.random() * 1e4)}@geraiexpress.test`;
  await requestCode(page, email);
  const code = await mailCode(email);
  expect(code).toMatch(/^\d{6}$/);
  expect(await mailCount(email)).toBe(1);

  // A second request inside the send-frequency window gets the same reply and no second mail.
  const resend = page.getByRole("button", { name: "Kirim ulang kode" });
  await expect(resend).not.toHaveAttribute("aria-disabled", "true");
  await resend.click();
  await expect(page.getByText(/Kode baru diminta untuk/)).toBeVisible();
  expect(await mailCount(email)).toBe(1);

  await page.getByLabel("Kode 6 digit dari email").fill(code);
  await page.getByRole("button", { name: "Verifikasi" }).click();
  await expect(page).toHaveURL(/\/daftar\/kata-sandi$/);
});

test("while registration is closed an unknown address gets the same reply and no mail", async ({ page }) => {
  test.setTimeout(60_000);
  const email = `tertutup-${Date.now()}-${Math.floor(Math.random() * 1e4)}@geraiexpress.test`;
  localSql(`update private.settings set value = 'false' where key = 'registration_open'`);
  try {
    await requestCode(page, email);
    await expect(page.getByText(/Pendaftaran gerai baru belum dibuka/)).toBeVisible();
    await page.waitForTimeout(1500);
    expect(await mailCount(email)).toBe(0);
  } finally {
    localSql(`update private.settings set value = 'true' where key = 'registration_open'`);
  }
});

test("an anonymous demo session requesting a code gets the same reply and no mail", async ({ page }) => {
  test.setTimeout(60_000);
  const email = `demo-anon-${Date.now()}-${Math.floor(Math.random() * 1e4)}@geraiexpress.test`;
  await startDemo(page);
  await requestCode(page, email);
  await page.waitForTimeout(1500);
  expect(await mailCount(email)).toBe(0);
});

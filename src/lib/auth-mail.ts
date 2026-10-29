// DEC-009 / PR-29 / PR-36: the one-time-code mail. This module is pure: it renders the Bahasa Indonesia
// text for a code the auth service issued (src/lib/auth/service.ts `requestEmailCode`). Whether a mail
// may be sent at all (registration gate, anonymous identities, throttles) is decided in SQL before a
// code exists; delivery lives in src/lib/mail-transport.ts.
export type OutgoingMail = { to: string; subject: string; text: string; html: string };

const SUBJECT = "Kode masuk GeraiExpress";
// Matches auth_issue_otp's default time to live (600 seconds).
const VALIDITY = "Kode berlaku 10 menit.";

// Code-only on purpose (PR-36 / T-042): a link would need a per-environment origin taken from
// configuration, never from a request header, so none is rendered.
export function renderCodeMail(to: string, code: string): OutgoingMail {
  if (!/^\d{6}$/.test(code)) throw new Error("one-time code must be six digits");
  const text = [
    `${SUBJECT}: ${code}`,
    "",
    `Masukkan kode ini di halaman GeraiExpress yang sedang Anda buka. ${VALIDITY}`,
    "Jika Anda tidak meminta kode ini, abaikan email ini.",
  ].join("\n");
  const html = `<p>${SUBJECT}:</p><p style="font-size:28px;font-weight:600;letter-spacing:4px">${code}</p>`
    + `<p>Masukkan kode ini di halaman GeraiExpress yang sedang Anda buka. ${VALIDITY}</p>`
    + "<p>Jika Anda tidak meminta kode ini, abaikan email ini.</p>";
  return { to, subject: SUBJECT, text, html };
}

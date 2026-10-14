import { decideMail, verifyHookSignature, type HookPayload } from "@/lib/auth-mail";
import { MailNotConfigured, deliver } from "@/lib/mail-transport";
import { workerSecret } from "@/lib/worker-secret";

// DEC-009: Supabase Auth Send Email Hook. Auth calls this with a signed payload instead of sending
// mail itself. A decision (refusal, delivery failure) is answered with HTTP 200 and an error object,
// which Auth reads and returns to its caller; a non-2xx answer would only become a generic Auth
// error and may be retried (re-sending messages already delivered). Requests that are not valid
// hook calls (bad signature, unreadable body) get a plain non-2xx. Nothing echoes tokens,
// addresses or secrets.
function hookDecision(httpCode: number, message: string) {
  return Response.json({ error: { http_code: httpCode, message } }, { status: 200 });
}
function hookError(status: number, message: string) {
  return Response.json({ error: { http_code: status, message } }, { status });
}

export async function POST(request: Request) {
  const secret = workerSecret("SEND_EMAIL_HOOK_SECRET");
  if (!secret) return hookDecision(503, "Email hook is not configured.");
  const body = await request.text();
  const ok = await verifyHookSignature(body, {
    id: request.headers.get("webhook-id"),
    timestamp: request.headers.get("webhook-timestamp"),
    signature: request.headers.get("webhook-signature"),
  }, secret);
  if (!ok) return hookError(401, "Invalid signature.");

  let payload: HookPayload;
  try {
    payload = JSON.parse(body) as HookPayload;
  } catch {
    return hookError(400, "Malformed payload.");
  }
  if (!payload || typeof payload !== "object") return hookError(400, "Malformed payload.");
  const decision = decideMail(payload);
  if ("refuse" in decision) {
    console.info(JSON.stringify({ event: "auth_mail_refused", reason: decision.refuse, action: payload.email_data?.email_action_type }));
    return hookDecision(403, "Email tidak dapat dikirim untuk akun ini.");
  }
  try {
    await deliver(decision.messages);
  } catch (error) {
    const configured = !(error instanceof MailNotConfigured);
    console.error(JSON.stringify({ event: "auth_mail_failed", configured, action: payload.email_data.email_action_type }));
    return hookDecision(503, "Pengiriman email sedang bermasalah.");
  }
  console.info(JSON.stringify({ event: "auth_mail_sent", action: payload.email_data.email_action_type, count: decision.messages.length }));
  return Response.json({});
}

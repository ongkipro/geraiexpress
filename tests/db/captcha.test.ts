// T-016 / SEC-5: Auth refuses password sign-in, anonymous (demo) sign-in, OTP and signup without a
// Turnstile token, so automated session creation and code mail need a solved challenge each time.
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { DUMMY_CAPTCHA } from "./helpers";

const raw = () => createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

describe("captcha on Auth entry points", () => {
  it("refuses each entry point without a token and accepts it with one", async () => {
    const email = `captcha-${Date.now()}@geraiexpress.test`;
    const missing = [
      await raw().auth.signInWithPassword({ email: "owner-a@geraiexpress.test", password: "geraiexpress-local-dev" }),
      await raw().auth.signInAnonymously(),
      await raw().auth.signInWithOtp({ email, options: { shouldCreateUser: true } }),
      await raw().auth.signUp({ email, password: "captcha-pass-12345" }),
      await raw().auth.resetPasswordForEmail("owner-a@geraiexpress.test"),
      await raw().auth.resend({ type: "signup", email }),
    ];
    for (const r of missing) expect(r.error?.message).toMatch(/captcha/i);
    expect((await raw().auth.signInWithPassword({ email: "owner-a@geraiexpress.test", password: "geraiexpress-local-dev", options: { captchaToken: DUMMY_CAPTCHA } })).error).toBeNull();
    expect((await raw().auth.signInAnonymously({ options: { captchaToken: DUMMY_CAPTCHA } })).error).toBeNull();
  });
});

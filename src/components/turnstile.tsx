"use client";

import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";
import { StatusAlert } from "@/components/auth/auth-shell";
import type { TurnstileAction } from "@/lib/turnstile-actions";

type TurnstileApi = {
  render: (el: HTMLElement, options: Record<string, unknown>) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
};
declare global {
  interface Window { turnstile?: TurnstileApi }
}

// T-016 / SEC-5: Cloudflare Turnstile, rendered explicitly so each form owns its widget. The widget
// adds a hidden `cf-turnstile-response` field to the enclosing form; the server action passes it to
// the auth service, which verifies it. Tokens are single-use, so the widget resets whenever
// `resetSignal` changes (each completed attempt). `onToken(null)` while no valid token exists.
// `action` names the surface; the server refuses a token whose siteverify action differs.
export function Turnstile({ siteKey, action, resetSignal, onToken }: {
  siteKey: string | undefined;
  action: TurnstileAction;
  resetSignal?: unknown;
  onToken: (token: string | null) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);

  useEffect(() => {
    if (!siteKey) return;
    let cancelled = false;
    const mount = () => {
      if (cancelled || !box.current || widget.current || !window.turnstile) return false;
      widget.current = window.turnstile.render(box.current, {
        sitekey: siteKey,
        action,
        language: "id",
        // Shown only when Cloudflare needs the person to interact; otherwise it stays invisible.
        appearance: "interaction-only",
        callback: (token: string) => onToken(token),
        "expired-callback": () => onToken(null),
        "error-callback": () => onToken(null),
      });
      return true;
    };
    const timer = window.setInterval(() => mount() && window.clearInterval(timer), 100);
    mount();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      if (widget.current && window.turnstile) window.turnstile.remove(widget.current);
      widget.current = null;
    };
  }, [siteKey, action, onToken]);

  useEffect(() => {
    if (widget.current && window.turnstile) {
      onToken(null);
      window.turnstile.reset(widget.current);
    }
  }, [resetSignal, onToken]);

  if (!siteKey) {
    return <StatusAlert variant="destructive">Verifikasi keamanan belum dikonfigurasi. Hubungi tim GeraiExpress.</StatusAlert>;
  }
  return (
    <>
      <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" strategy="afterInteractive" />
      <div ref={box} className="flex justify-center" />
    </>
  );
}

// Keeps the submit button focusable while the challenge runs (a disabled button drops out of the
// Tab order): it is aria-disabled and refuses to submit until a token exists, saying why.
export function useCaptchaGate() {
  const [token, setToken] = useState<string | null>(null);
  const [waitHint, setWaitHint] = useState(false);
  const onToken = useCallback((t: string | null) => {
    setToken(t);
    if (t) setWaitHint(false);
  }, []);
  const guard = {
    "aria-disabled": token ? undefined : true,
    className: token ? undefined : "cursor-progress opacity-60",
    onClick: (e: { preventDefault: () => void }) => {
      if (!token) {
        e.preventDefault();
        setWaitHint(true);
      }
    },
  } as const;
  // The live region stays mounted so screen readers announce the text when it appears.
  const hint = (
    <p role="status" className="text-sm empty:hidden">
      {waitHint && !token ? "Tunggu sebentar, verifikasi keamanan sedang berjalan. Jika kotak verifikasi muncul di bawah tombol, selesaikan dulu." : ""}
    </p>
  );
  return { onToken, guard, hint };
}

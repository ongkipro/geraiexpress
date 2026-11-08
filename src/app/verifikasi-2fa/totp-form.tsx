"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { StatusAlert } from "@/components/auth/auth-shell";
import { CodeInput, useResetKey } from "@/components/auth/code-input";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/submit-button";
import { startTotpEnrollAction, verifyTotpAction, type EnrollState } from "@/lib/platform-actions";

export function TotpForm({ enrolled }: { enrolled: boolean }) {
  const [enrolment, setEnrolment] = useState<EnrollState>({});
  const [starting, startTransition] = useTransition();
  // Synchronous guard: `starting` only changes on the next render, so a same-tick double click would enrol twice.
  const startingRef = useRef(false);
  const start = () => {
    if (startingRef.current) return;
    startingRef.current = true;
    startTransition(async () => {
      try {
        setEnrolment(await startTotpEnrollAction());
      } finally {
        startingRef.current = false;
      }
    });
  };
  const [state, verify] = useActionState<EnrollState, FormData>(
    (prev, form) => verifyTotpAction({ ...enrolment, ...prev, factorId: enrolment.factorId }, form),
    {},
  );
  const attempt = useResetKey(state);
  const error = state.error ?? enrolment.error;

  if (!enrolled && !enrolment.factorId) {
    return (
      <div className="flex flex-col gap-4">
        {error ? <StatusAlert variant="destructive">{error}</StatusAlert> : null}
        <Button type="button" className="w-full" disabled={starting} aria-busy={starting || undefined}
          onClick={start}>
          {/* Both labels share one grid cell so the width stays put while the QR code is prepared. */}
          <span className="inline-grid">
            <span className={starting ? "invisible col-start-1 row-start-1" : "col-start-1 row-start-1"}>Mulai pasang autentikator</span>
            <span aria-hidden={!starting} className={starting ? "col-start-1 row-start-1" : "invisible col-start-1 row-start-1"}>Menyiapkan kode QR…</span>
          </span>
        </Button>
      </div>
    );
  }

  return (
    <form action={verify} className="flex flex-col gap-6" noValidate>
      {enrolment.qr ? (
        <section aria-labelledby="totp-scan" className="flex flex-col gap-4">
          <h2 id="totp-scan" className="text-base font-semibold">1. Pindai kode QR</h2>
          <div className="flex justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element -- the server draws the QR code as an inline SVG data URI */}
            <img src={enrolment.qr} alt="Kode QR autentikator" width={192} height={192} className="size-48 rounded-md bg-white p-2 ring-1 ring-border" />
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-[15px] text-muted-foreground">Tidak bisa memindai? Masukkan kunci ini secara manual:</p>
            <code data-testid="totp-secret" className="rounded-sm bg-muted px-3 py-2 font-mono text-[15px] break-all">{enrolment.secret}</code>
          </div>
        </section>
      ) : null}
      {enrolment.qr ? <h2 className="-mb-3 text-base font-semibold">2. Masukkan kode dari aplikasi</h2> : null}
      <CodeInput
        key={attempt}
        id="totp-code"
        label="Kode 6 digit"
        hint="Kode berganti setiap 30 detik. Pakai kode yang sedang tampil."
        error={error}
        // Not on the enrolment screen: focusing the code would scroll the QR code out of view.
        autoFocus={enrolled || attempt > 0}
      />
      <SubmitButton className="w-full" pendingLabel="Memeriksa…">Verifikasi</SubmitButton>
    </form>
  );
}

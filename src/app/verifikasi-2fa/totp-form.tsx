"use client";

import { useActionState, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { startTotpEnrollAction, verifyTotpAction, type EnrollState } from "@/lib/platform-actions";

export function TotpForm({ enrolled }: { enrolled: boolean }) {
  const [enrolment, setEnrolment] = useState<EnrollState>({});
  const [starting, startTransition] = useTransition();
  const [state, verify, pending] = useActionState<EnrollState, FormData>(
    (prev, form) => verifyTotpAction({ ...enrolment, ...prev, factorId: enrolment.factorId }, form),
    {},
  );
  const error = state.error ?? enrolment.error;

  if (!enrolled && !enrolment.factorId) {
    return (
      <div className="flex flex-col gap-3">
        {error ? <p role="alert" className="rounded-md bg-card p-3 ring-1 ring-foreground"><span aria-hidden="true">⚠ </span>{error}</p> : null}
        <Button type="button" disabled={starting} onClick={() => startTransition(async () => setEnrolment(await startTotpEnrollAction()))}>
          Mulai pasang autentikator
        </Button>
      </div>
    );
  }

  return (
    <form action={verify} className="flex flex-col gap-4" noValidate>
      {enrolment.qr ? (
        <div className="flex flex-col items-start gap-3 rounded-lg bg-card p-4 ring-1 ring-border">
          {/* eslint-disable-next-line @next/next/no-img-element -- Auth returns the QR as an SVG data URI */}
          <img src={enrolment.qr} alt="Kode QR autentikator" width={176} height={176} className="rounded-sm bg-white p-2" />
          <p className="text-sm">Tidak bisa memindai? Masukkan kunci ini secara manual:</p>
          <code data-testid="totp-secret" className="break-all rounded-sm bg-muted px-2 py-1 text-sm">{enrolment.secret}</code>
        </div>
      ) : null}
      {error ? <p role="alert" className="rounded-md bg-card p-3 ring-1 ring-foreground"><span aria-hidden="true">⚠ </span>{error}</p> : null}
      <div className="flex flex-col gap-2">
        <Label htmlFor="totp-code">Kode 6 digit</Label>
        <Input id="totp-code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={7}
          aria-invalid={error ? true : undefined} />
      </div>
      <Button type="submit" disabled={pending}>Verifikasi</Button>
    </form>
  );
}

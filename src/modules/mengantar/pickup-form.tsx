"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import type { PickupAddress } from "@/lib/mengantar/public-api";
import { setOutletPickupAction, type PickupState } from "./actions";

// T-023: choose which of the seller's saved Mengantar pickup addresses this outlet ships from.
// Addresses are created and edited in the Mengantar app; contact names/phones stay there.
export function PickupForm({ addresses, current }: { addresses: PickupAddress[]; current: string | null }) {
  const [state, action, pending] = useActionState<PickupState, FormData>(setOutletPickupAction, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      {state.error ? <p role="alert" className="rounded-md bg-card p-3 ring-1 ring-foreground"><span aria-hidden="true">⚠ </span>{state.error}</p> : null}
      {state.ok ? <p role="status" className="rounded-md bg-card p-3 ring-1 ring-border">{state.ok}</p> : null}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm text-muted-foreground">Alamat pickup tersimpan di akun Mengantar</legend>
        {addresses.map((a) => (
          <label key={a.id} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md p-3 ring-1 ring-border has-checked:ring-2 has-checked:ring-ring has-focus-visible:outline-2 has-focus-visible:outline-ring">
            <input type="radio" name="pickup_address_id" value={a.id} defaultChecked={a.id === current} className="mt-1" required />
            <span className="min-w-0">
              <span className="block font-semibold">{a.name || "Tanpa nama"}{a.hidden ? " (disembunyikan di Mengantar)" : ""}</span>
              <span className="block text-sm">{a.address}</span>
              <span className="block text-sm text-muted-foreground">{a.area}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <Button type="submit" disabled={pending} aria-busy={pending} className="self-start">
        {pending ? "Menyimpan…" : "Pakai alamat ini"}
      </Button>
    </form>
  );
}

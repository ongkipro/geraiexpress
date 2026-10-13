"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

// Opening the print dialog is not proof that paper was printed (PR-6 operational boundary).
export function PrintButton() {
  return (
    <Button type="button" onClick={() => window.print()}>
      <Printer data-icon="inline-start" aria-hidden="true" /> Cetak
    </Button>
  );
}

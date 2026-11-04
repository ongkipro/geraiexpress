"use client";

// T-097 / UI-7: the audit "Jenis keputusan" filter on the shared Radix select. The GET form carries
// the choice through its own hidden input so "all" stays `jenis=` (Radix items cannot hold "").
// The page keys the search form by every URL filter, so any filter navigation remounts this state.
import { useState } from "react";
import { ChoiceSelect, type ChoiceOption } from "@/modules/shipments/choice-select";

export function AuditActionSelect({ id, defaultValue, allLabel, options }: {
  id: string; defaultValue: string; allLabel: string; options: ChoiceOption[];
}) {
  const [value, setValue] = useState(defaultValue);
  return (
    <>
      <input type="hidden" name="jenis" value={value} />
      <ChoiceSelect id={id} value={value} onValueChange={setValue} options={options} emptyLabel={allLabel} />
    </>
  );
}

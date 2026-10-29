import { useEffect, useId, useState } from "react";
import { AlertCircle, Check, Loader2, MapPin, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { friendlyError } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { FieldMessage } from "./intake-step";

type Area = { id: string; province: string; city: string; district: string; subdistrict: string; zip: string };

export const areaLabel = (a: Area) => [a.subdistrict, a.district, a.city].filter(Boolean).join(", ");

// T-023 / T-072 (UX-15): the recipient's Mengantar area for a connected gerai, as an ARIA combobox
// (list autocomplete). Typing never calls Mengantar by itself: Enter (or "Cari") searches, because every
// search is a request to the seller's Mengantar account. With results shown, Arrow Down/Up move the active
// option (aria-activedescendant; focus stays in the box), Enter picks it, Escape closes the list and a
// pointer click picks too. The status line announces loading, the result count, no match and errors.
// Choosing a saved contact or address takes that address's saved area (or clears the choice when it has
// none), so a live quote never uses a stale area. Client-only: imported by the intake form.
export function AreaPicker(props: {
  label: string;
  areaId: string;
  areaText: string;
  error?: string;
  onChange: (next: { areaId: string; areaText: string; postalCode?: string }) => void;
}) {
  const id = useId();
  const listId = `${id}-list`;
  const optionId = (i: number) => `${id}-opt-${i}`;
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Area[] | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (active >= 0) document.getElementById(optionId(active))?.scrollIntoView({ block: "nearest" });
    // optionId only depends on the stable id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  async function search() {
    const q = query.trim();
    if (q.length < 3) {
      setStatus("error");
      setMessage("Ketik minimal 3 huruf nama kelurahan, kecamatan atau kota.");
      return;
    }
    setStatus("loading");
    setOpen(false);
    setActive(-1);
    setMessage("Mencari wilayah…");
    try {
      const res = await fetch(`/api/mengantar/area?q=${encodeURIComponent(q)}`, { cache: "no-store" });
      const body = (await res.json()) as { areas?: Area[]; error?: string };
      if (!res.ok || !body.areas) throw new Error(body.error ?? "mengantar_unavailable");
      setResults(body.areas);
      setOpen(body.areas.length > 0);
      setStatus("idle");
      setMessage(body.areas.length
        ? `${body.areas.length} wilayah ditemukan. Pilih dengan panah atas/bawah lalu Enter.`
        : "Tidak ada wilayah yang cocok. Coba nama kecamatan atau kota.");
    } catch (error) {
      setResults(null);
      setStatus("error");
      setMessage(friendlyError({ message: error instanceof Error ? error.message : undefined }));
    }
  }

  function choose(a: Area) {
    props.onChange({ areaId: a.id, areaText: areaLabel(a), postalCode: a.zip || undefined });
    setOpen(false);
    setActive(-1);
    setMessage(`Dipilih: ${areaLabel(a)}.`);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const count = results?.length ?? 0;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!count) return;
      e.preventDefault();
      if (!open) {
        setOpen(true);
        setActive(e.key === "ArrowDown" ? 0 : count - 1);
        return;
      }
      setActive((i) => (e.key === "ArrowDown" ? Math.min(i + 1, count - 1) : Math.max(i - 1, 0)));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (open && active >= 0 && results) choose(results[active]);
      else void search();
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      setOpen(false);
      setActive(-1);
    } else if ((e.key === "Home" || e.key === "End") && open && count) {
      e.preventDefault();
      setActive(e.key === "Home" ? 0 : count - 1);
    }
  }

  const loading = status === "loading";
  const expanded = open && !!results?.length;
  const describedBy = [`${id}-hint`, `${id}-status`, props.error ? `${id}-err` : null].filter(Boolean).join(" ");
  return (
    <div className="flex flex-col gap-2">
      <input type="hidden" name="recipient_area_id" value={props.areaId} />
      <input type="hidden" name="recipient_area" value={props.areaText} />
      <Label htmlFor={`${id}-q`}>{props.label}</Label>
      {props.areaId ? (
        <p className="flex items-start gap-2 rounded-md bg-success-soft px-3 py-2 text-sm" data-testid="area-chosen">
          <MapPin className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
          <span>Dipilih: <span className="font-semibold">{props.areaText}</span></span>
        </p>
      ) : props.areaText ? (
        <p className="text-sm text-muted-foreground">Tersimpan sebagai teks: {props.areaText}. Cari dan pilih wilayahnya untuk cek ongkir.</p>
      ) : null}
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input id={`${id}-q`} type="text" role="combobox" value={query} autoComplete="off" placeholder="Contoh: Sukatani Tapos" className="pl-10"
            aria-autocomplete="list" aria-expanded={expanded} aria-controls={listId}
            aria-activedescendant={expanded && active >= 0 ? optionId(active) : undefined}
            aria-busy={loading || undefined} aria-invalid={props.error ? true : undefined} aria-describedby={describedBy}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            onBlur={() => { setOpen(false); setActive(-1); }} />
        </div>
        <Button type="button" variant="outline" onClick={() => void search()} disabled={loading} aria-busy={loading || undefined}>
          {loading ? <Loader2 data-icon="inline-start" className="animate-spin" aria-hidden="true" /> : <Search data-icon="inline-start" aria-hidden="true" />}
          Cari
        </Button>
      </div>
      <p id={`${id}-hint`} className="text-sm text-muted-foreground">Ketik nama kelurahan, kecamatan atau kota, lalu tekan Enter.</p>
      <p id={`${id}-status`} role="status"
        className={cn("flex items-start gap-1.5 text-sm empty:hidden", status === "error" ? "text-destructive" : "text-muted-foreground")}>
        {message ? (
          <>
            {status === "error" ? <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> : null}
            <span>{message}</span>
          </>
        ) : null}
      </p>
      {props.error ? <FieldMessage id={`${id}-err`}>{props.error}</FieldMessage> : null}
      {loading ? (
        <div aria-hidden="true" className="flex flex-col gap-2 rounded-md p-3 ring-1 ring-border">
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-5 w-1/2" />
        </div>
      ) : null}
      {/* The listbox stays in the DOM (hidden when closed) so aria-controls always points at it. */}
      <ul id={listId} role="listbox" aria-label="Hasil pencarian" hidden={!expanded}
        className="flex max-h-72 min-w-0 flex-col divide-y divide-border overflow-y-auto rounded-md ring-1 ring-border">
        {(results ?? []).map((a, i) => (
          <li key={a.id} id={optionId(i)} role="option" aria-selected={i === active}
            className={cn("flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2",
              i === active ? "bg-info-soft outline-2 -outline-offset-2 outline-ring" : "hover:bg-muted")}
            // Keep focus in the combobox input while the pointer picks.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => choose(a)}>
            <span className="min-w-0 flex-1">
              <span className="block break-words">{areaLabel(a)}</span>
              <span className="block text-sm text-muted-foreground">{a.province}{a.zip ? ` · ${a.zip}` : ""}</span>
            </span>
            {a.id === props.areaId ? <Check className="size-4 shrink-0 text-primary" aria-label="Dipilih" /> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

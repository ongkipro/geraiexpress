import { useId, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { friendlyError } from "@/lib/errors";
import { cn } from "@/lib/utils";

type Area = { id: string; province: string; city: string; district: string; subdistrict: string; zip: string };

export const areaLabel = (a: Area) => [a.subdistrict, a.district, a.city].filter(Boolean).join(", ");

// T-023: the recipient's Mengantar area for a connected gerai. The operator searches, then picks
// one result; choosing a saved contact or address takes that address's saved area (or clears
// the choice when it has none), so a live quote never uses a stale area. Results are a radio group (not a combobox) so keyboard and
// screen-reader use stay simple. Client-only: imported by the intake form.
export function AreaPicker(props: {
  label: string;
  areaId: string;
  areaText: string;
  error?: string;
  onChange: (next: { areaId: string; areaText: string; postalCode?: string }) => void;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Area[] | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [message, setMessage] = useState("");

  async function search() {
    const q = query.trim();
    if (q.length < 3) {
      setStatus("error");
      setMessage("Ketik minimal 3 huruf nama kelurahan, kecamatan atau kota.");
      return;
    }
    setStatus("loading");
    setMessage("");
    try {
      const res = await fetch(`/api/mengantar/area?q=${encodeURIComponent(q)}`, { cache: "no-store" });
      const body = (await res.json()) as { areas?: Area[]; error?: string };
      if (!res.ok || !body.areas) throw new Error(body.error ?? "mengantar_unavailable");
      setResults(body.areas);
      setStatus("idle");
      setMessage(body.areas.length ? `${body.areas.length} wilayah ditemukan.` : "Tidak ada wilayah yang cocok. Coba nama kecamatan atau kota.");
    } catch (error) {
      setStatus("error");
      setMessage(friendlyError({ message: error instanceof Error ? error.message : undefined }));
    }
  }

  const describedBy = [`${id}-status`, props.error ? `${id}-err` : null].filter(Boolean).join(" ");
  return (
    <div className="flex flex-col gap-2">
      <input type="hidden" name="recipient_area_id" value={props.areaId} />
      <input type="hidden" name="recipient_area" value={props.areaText} />
      <Label htmlFor={`${id}-q`}>{props.label}</Label>
      {props.areaId ? (
        <p className="rounded-md bg-muted px-3 py-2 text-sm" data-testid="area-chosen">
          Dipilih: <span className="font-semibold">{props.areaText}</span>
        </p>
      ) : props.areaText ? (
        <p className="text-sm text-muted-foreground">Tersimpan sebagai teks: {props.areaText}. Cari dan pilih wilayahnya untuk cek ongkir.</p>
      ) : null}
      <div className="flex gap-2">
        <Input id={`${id}-q`} value={query} autoComplete="off" placeholder="Contoh: Sukatani Tapos"
          aria-invalid={props.error ? true : undefined} aria-describedby={describedBy}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void search(); } }} />
        <Button type="button" variant="outline" onClick={() => void search()} disabled={status === "loading"} aria-busy={status === "loading"}>
          {status === "loading" ? <Loader2 data-icon="inline-start" className="animate-spin" aria-hidden="true" /> : <Search data-icon="inline-start" aria-hidden="true" />}
          Cari
        </Button>
      </div>
      <p id={`${id}-status`} role="status" className="text-sm text-muted-foreground empty:hidden">{message}</p>
      {props.error ? <p id={`${id}-err`} className="text-sm text-foreground"><span aria-hidden="true">⚠ </span>{props.error}</p> : null}
      {results && results.length > 0 ? (
        <fieldset className="flex max-h-72 flex-col gap-1 overflow-y-auto rounded-md ring-1 ring-border">
          <legend className="sr-only">Pilih wilayah penerima</legend>
          {results.map((a) => (
            <label key={a.id}
              className={cn("flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 has-focus-visible:outline-2 has-focus-visible:outline-ring",
                a.id === props.areaId && "bg-muted")}>
              <input type="radio" name={`${id}-area`} value={a.id} checked={a.id === props.areaId}
                onChange={() => props.onChange({ areaId: a.id, areaText: areaLabel(a), postalCode: a.zip || undefined })} />
              <span className="min-w-0">
                <span className="block">{areaLabel(a)}</span>
                <span className="block text-sm text-muted-foreground">{a.province}{a.zip ? ` · ${a.zip}` : ""}</span>
              </span>
            </label>
          ))}
        </fieldset>
      ) : null}
    </div>
  );
}

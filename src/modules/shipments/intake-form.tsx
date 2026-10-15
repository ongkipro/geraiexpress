"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { courierName, etaLabel, formatIdr } from "@/lib/format";
import { confirmShipmentAction, saveDraftAction, type ConfirmState, type DraftState } from "./actions";
import { AreaPicker } from "./area-picker";
import type { DraftField, DraftValues } from "./draft";

export type ContactOption = {
  id: string;
  name: string;
  phone: string;
  is_sender: boolean;
  is_recipient: boolean;
  addresses: { id: string; label: string | null; address_line: string; area: string; area_id: string | null; postal_code: string | null }[];
};
export type QuoteOption = { id: string; courier: string; service: string; normal_tariff_idr: number; eta_days: string; is_simulated: boolean };

type Props = {
  shipmentId: string;
  reference: string;
  revision: number;
  initial: DraftValues;
  senderContactId: string | null;
  recipientContactId: string | null;
  outlet: { name: string; pickupAddress: string | null; pickupArea: string | null };
  contacts: ContactOption[];
  quotes: QuoteOption[];
  idempotencyKey: string;
  // A connected real gerai: recipient area comes from Mengantar and quotes are live (T-023).
  live: boolean;
};

export function IntakeForm(props: Props) {
  const [state, action, pending] = useActionState<DraftState, FormData>(saveDraftAction, {});
  const [values, setValues] = useState<DraftValues>(state.values ?? props.initial);
  const [senderContact, setSenderContact] = useState(props.senderContactId ?? "");
  const [recipientContact, setRecipientContact] = useState(props.recipientContactId ?? "");
  const [dirty, setDirty] = useState(false);
  const [quoteId, setQuoteId] = useState(props.quotes[0]?.id ?? "");
  const statusRef = useRef<HTMLDivElement>(null);

  // After a successful save the server re-renders with a new revision; adopt its values.
  useEffect(() => {
    if (state.ok) {
      setValues(props.initial);
      setDirty(false);
    } else if (state.values) {
      setValues(state.values);
    }
    if (state.ok || state.error) statusRef.current?.focus();
  }, [state, props.initial]);
  useEffect(() => setQuoteId(props.quotes[0]?.id ?? ""), [props.quotes]);

  const set = (field: DraftField, value: string) => {
    setValues((v) => ({ ...v, [field]: value }));
    setDirty(true);
  };
  const pick = (role: "sender" | "recipient", id: string) => {
    const c = props.contacts.find((x) => x.id === id);
    if (role === "sender") setSenderContact(id);
    else setRecipientContact(id);
    setDirty(true);
    if (!c) return;
    const address = c.addresses[0];
    setValues((v) => ({
      ...v,
      [`${role}_name`]: c.name,
      [`${role}_phone`]: c.phone,
      ...(role === "recipient" && address
        ? { recipient_address: address.address_line, recipient_area: address.area, recipient_area_id: address.area_id ?? "", recipient_postal_code: address.postal_code ?? "" }
        : {}),
    }));
  };
  const pickAddress = (addressId: string) => {
    const a = props.contacts.find((x) => x.id === recipientContact)?.addresses.find((x) => x.id === addressId);
    if (!a) return;
    setValues((v) => ({ ...v, recipient_address: a.address_line, recipient_area: a.area, recipient_area_id: a.area_id ?? "", recipient_postal_code: a.postal_code ?? "" }));
    setDirty(true);
  };

  const err = state.fieldErrors ?? {};
  const field = (name: DraftField, label: string, opts: { type?: string; inputMode?: "numeric" | "tel" | "text"; autoComplete?: string; hint?: string; textarea?: boolean } = {}) => {
    const id = `f-${name}`;
    const described = [opts.hint ? `${id}-hint` : null, err[name] ? `${id}-err` : null].filter(Boolean).join(" ") || undefined;
    const common = {
      id, name, value: values[name],
      "aria-invalid": err[name] ? true : undefined,
      "aria-describedby": described,
    };
    return (
      <div className="flex flex-col gap-2">
        <Label htmlFor={id}>{label}</Label>
        {opts.textarea ? (
          <Textarea {...common} rows={3} onChange={(e) => set(name, e.target.value)} />
        ) : (
          <Input {...common} type={opts.type ?? "text"} inputMode={opts.inputMode} autoComplete={opts.autoComplete ?? "off"}
            onChange={(e) => set(name, e.target.value)} />
        )}
        {opts.hint ? <p id={`${id}-hint`} className="text-sm text-muted-foreground">{opts.hint}</p> : null}
        {err[name] ? <p id={`${id}-err`} className="text-sm text-foreground"><span aria-hidden="true">⚠ </span>{err[name]}</p> : null}
      </div>
    );
  };

  const senders = props.contacts.filter((c) => c.is_sender);
  const recipients = props.contacts.filter((c) => c.is_recipient);
  const recipientAddresses = props.contacts.find((c) => c.id === recipientContact)?.addresses ?? [];
  const quotesCurrent = props.quotes.length > 0 && !dirty;
  const selected = props.quotes.find((q) => q.id === quoteId);
  const selectClass = "min-h-11 w-full rounded-sm border border-input bg-card px-3 text-base";

  return (
    <div className="flex flex-col gap-8">
      <form action={action} className="flex flex-col gap-8" noValidate>
        <input type="hidden" name="shipment_id" value={props.shipmentId} />
        <input type="hidden" name="revision" value={props.revision} />
        <input type="hidden" name="sender_contact_id" value={senderContact} />
        <input type="hidden" name="recipient_contact_id" value={recipientContact} />

        <div ref={statusRef} tabIndex={-1} aria-live="polite" className="outline-none empty:hidden">
          {state.error ? (
            <p role="alert" className="rounded-md bg-card p-4 ring-1 ring-foreground"><span aria-hidden="true">⚠ </span>{state.error}</p>
          ) : state.ok ? (
            <p className="rounded-md bg-card p-4 ring-1 ring-border"><Check className="mr-2 inline size-4" aria-hidden="true" />{state.ok}</p>
          ) : null}
          {state.warning ? (
            <p role="alert" className="mt-3 rounded-md bg-card p-4 ring-1 ring-foreground"><span aria-hidden="true">⚠ </span>{state.warning}</p>
          ) : null}
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          <fieldset className="flex flex-col gap-4 rounded-lg bg-card p-6 ring-1 ring-border">
            <legend className="sr-only">Pengirim</legend>
            <h2 className="text-xl" aria-hidden="true">Pengirim</h2>
            <div className="flex flex-col gap-2">
              <Label htmlFor="pick-sender">Pilih pengirim tersimpan</Label>
              <select id="pick-sender" className={selectClass} value={senderContact} onChange={(e) => pick("sender", e.target.value)}>
                <option value="">— Isi manual —</option>
                {senders.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.phone}</option>)}
              </select>
            </div>
            {field("sender_name", "Nama pengirim", { autoComplete: "off" })}
            {field("sender_phone", "No. HP pengirim", { type: "tel", inputMode: "tel", hint: "Contoh 081234567890" })}
            {!senderContact ? (
              <label className="flex min-h-11 items-center gap-3">
                <Checkbox name="save_sender" /> Simpan sebagai kontak pengirim
              </label>
            ) : null}
          </fieldset>

          <fieldset className="flex flex-col gap-4 rounded-lg bg-card p-6 ring-1 ring-border">
            <legend className="sr-only">Penerima</legend>
            <h2 className="text-xl" aria-hidden="true">Penerima</h2>
            <div className="flex flex-col gap-2">
              <Label htmlFor="pick-recipient">Pilih penerima tersimpan</Label>
              <select id="pick-recipient" className={selectClass} value={recipientContact} onChange={(e) => pick("recipient", e.target.value)}>
                <option value="">— Isi manual —</option>
                {recipients.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.phone}</option>)}
              </select>
            </div>
            {recipientAddresses.length > 1 ? (
              <div className="flex flex-col gap-2">
                <Label htmlFor="pick-address">Alamat tersimpan</Label>
                <select id="pick-address" className={selectClass} onChange={(e) => pickAddress(e.target.value)}>
                  {recipientAddresses.map((a) => <option key={a.id} value={a.id}>{a.label ?? "Alamat"} · {a.address_line}</option>)}
                </select>
              </div>
            ) : null}
            {field("recipient_name", "Nama penerima")}
            {field("recipient_phone", "No. HP penerima", { type: "tel", inputMode: "tel" })}
            {field("recipient_address", "Alamat lengkap", { textarea: true })}
            {props.live ? (
              <>
                <AreaPicker label="Wilayah penerima" areaId={values.recipient_area_id} areaText={values.recipient_area}
                  error={err.recipient_area}
                  onChange={(next) => {
                    setValues((v) => ({ ...v, recipient_area_id: next.areaId, recipient_area: next.areaText,
                      recipient_postal_code: next.postalCode ?? v.recipient_postal_code }));
                    setDirty(true);
                  }} />
                <div className="sm:max-w-[160px]">{field("recipient_postal_code", "Kode pos", { inputMode: "numeric" })}</div>
              </>
            ) : (
              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_140px]">
                {field("recipient_area", "Kecamatan / kota", { hint: "Simulasi: wilayah ditulis bebas" })}
                {field("recipient_postal_code", "Kode pos", { inputMode: "numeric" })}
              </div>
            )}
            {!recipientContact ? (
              <label className="flex min-h-11 items-center gap-3">
                <Checkbox name="save_recipient" /> Simpan sebagai kontak penerima
              </label>
            ) : null}
          </fieldset>
        </div>

        <section aria-labelledby="pickup-heading" className="flex flex-col gap-2 rounded-lg bg-card p-6 ring-1 ring-border">
          <h2 id="pickup-heading" className="text-xl">Pickup</h2>
          <p>{props.outlet.name}</p>
          <p className="text-muted-foreground">{[props.outlet.pickupAddress, props.outlet.pickupArea].filter(Boolean).join(", ") || "Alamat pickup belum diatur"}</p>
          <p className="text-sm text-muted-foreground">Alamat pickup gerai tetap menjadi asal penjemputan, terpisah dari identitas pengirim.</p>
        </section>

        <fieldset className="flex flex-col gap-4 rounded-lg bg-card p-6 ring-1 ring-border">
          <legend className="sr-only">Paket</legend>
          <h2 className="text-xl" aria-hidden="true">Paket</h2>
          {field("item_description", "Isi paket")}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {field("weight_grams", "Berat (gram)", { inputMode: "numeric" })}
            {field("length_cm", "Panjang (cm)", { inputMode: "numeric" })}
            {field("width_cm", "Lebar (cm)", { inputMode: "numeric" })}
            {field("height_cm", "Tinggi (cm)", { inputMode: "numeric" })}
            {field("goods_value_idr", "Nilai barang (Rp)", { inputMode: "numeric" })}
          </div>
        </fieldset>

        <div className="flex flex-wrap gap-3">
          <Button type="submit" name="intent" value="quote" disabled={pending} aria-busy={pending}>
            {pending ? "Memproses…" : "Simpan & cek ongkir"}
          </Button>
          <Button type="submit" name="intent" value="save" variant="outline" disabled={pending}>Simpan draf</Button>
        </div>
      </form>

      <section aria-labelledby="service-heading" className="flex flex-col gap-4 rounded-lg bg-card p-6 ring-1 ring-border">
        <h2 id="service-heading" className="text-xl">Layanan</h2>
        {props.quotes.length === 0 ? (
          <p className="text-muted-foreground">Belum ada estimasi. Lengkapi data lalu pilih “Simpan & cek ongkir”.</p>
        ) : dirty ? (
          <p role="status"><span aria-hidden="true">⚠ </span>Data berubah sejak ongkir dicek. Simpan & cek ongkir lagi sebelum konfirmasi.</p>
        ) : null}
        {props.quotes.length > 0 ? (
          <fieldset disabled={!quotesCurrent} className="flex flex-col gap-3">
            <legend className="sr-only">Pilih layanan</legend>
            <div className="grid gap-3 md:grid-cols-3">
              {props.quotes.map((q) => (
                <label key={q.id}
                  className={cn("flex min-h-11 cursor-pointer flex-col gap-1 rounded-lg bg-card p-4 ring-1 ring-border has-focus-visible:outline-2 has-focus-visible:outline-ring",
                    q.id === quoteId && "ring-2 ring-ring")}>
                  <input type="radio" name="quote" value={q.id} checked={q.id === quoteId} onChange={() => setQuoteId(q.id)} className="sr-only" />
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{q.is_simulated ? q.service : courierName(q.courier)}</span>
                    {q.id === quoteId ? <span className="inline-flex items-center gap-1 text-sm text-primary"><Check className="size-4" aria-hidden="true" />Dipilih</span> : null}
                  </span>
                  <span className="text-sm text-muted-foreground">{q.is_simulated ? q.courier : q.service} · {etaLabel(q.eta_days)}</span>
                  <span className="tabular text-xl">{formatIdr(q.normal_tariff_idr)}</span>
                  {q.is_simulated ? <span className="text-sm text-muted-foreground">Harga contoh (simulasi)</span> : null}
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
        {quotesCurrent && selected ? (
          <ConfirmDialog {...props} quote={selected} values={values} />
        ) : null}
      </section>
    </div>
  );
}

function ConfirmDialog(props: Props & { quote: QuoteOption; values: DraftValues }) {
  const [state, action, pending] = useActionState<ConfirmState, FormData>(confirmShipmentAction, {});
  const v = props.values;
  const rows: [string, string][] = [
    ["Pengirim", `${v.sender_name} · ${v.sender_phone}`],
    ["Penerima", `${v.recipient_name} · ${v.recipient_phone}`],
    ["Alamat tujuan", [v.recipient_address, v.recipient_area, v.recipient_postal_code].filter(Boolean).join(", ")],
    ["Pickup", props.outlet.name],
    ["Paket", `${v.item_description} · ${v.weight_grams} g`],
    ["Layanan", `${courierName(props.quote.courier)} ${props.quote.service} (${etaLabel(props.quote.eta_days)})`],
  ];
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button className="self-start">Periksa & konfirmasi</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Konfirmasi pengiriman {props.reference}</DialogTitle>
          <DialogDescription data-testid={props.quote.is_simulated ? undefined : "live-issuance-warning"}>
            {props.quote.is_simulated
              ? "Ini simulasi: tidak ada pesanan Mengantar, saldo atau resi sungguhan yang dibuat."
              : "Mengonfirmasi membuat pesanan Mengantar sungguhan dari akun gerai ini dan membayarnya dari saldo Mengantar. Pesanan tidak bisa dibatalkan dari GeraiExpress."}
          </DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
          {rows.map(([k, val]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="break-words">{val}</dd>
            </div>
          ))}
          <dt className="font-semibold">Ongkir pelanggan</dt>
          <dd className="tabular font-semibold">{formatIdr(props.quote.normal_tariff_idr)}</dd>
        </dl>
        {state.error ? <p role="alert" className="text-sm"><span aria-hidden="true">⚠ </span>{state.error}</p> : null}
        <form action={action}>
          <input type="hidden" name="shipment_id" value={props.shipmentId} />
          <input type="hidden" name="quote_id" value={props.quote.id} />
          <input type="hidden" name="revision" value={props.revision} />
          <input type="hidden" name="idempotency_key" value={props.idempotencyKey} />
          <DialogFooter className="gap-3">
            <DialogClose asChild><Button type="button" variant="outline">Kembali</Button></DialogClose>
            <Button type="submit" disabled={pending} aria-busy={pending}>{pending ? "Menerbitkan…" : "Konfirmasi & terbitkan resi"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

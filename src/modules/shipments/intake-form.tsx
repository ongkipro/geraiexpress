"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, AlertTriangle, Calculator, Check, CheckCircle2, Info, Lock, MapPin, Search, Users } from "lucide-react";
import { SubmitButton } from "@/components/submit-button";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { courierName, etaLabel, formatIdr } from "@/lib/format";
import { confirmShipmentAction, saveDraftAction, type ConfirmState, type DraftState } from "./actions";
import { AreaPicker } from "./area-picker";
import type { DraftField, DraftValues } from "./draft";
import { FieldMessage, IntakeStep, type StepState } from "./intake-step";
import { goodsValueOf, IntakeSummary, quoteCharge, serviceName, SummaryBar, type QuoteStatus } from "./intake-summary";
import { ChoiceSelect } from "./choice-select";
import { handoverSummary, PickupFields } from "./pickup-fields";

export type ContactOption = {
  id: string;
  name: string;
  phone: string;
  is_sender: boolean;
  is_recipient: boolean;
  addresses: { id: string; label: string | null; address_line: string; area: string; area_id: string | null; postal_code: string | null }[];
};
export type QuoteOption = {
  id: string;
  courier: string;
  service: string;
  normal_tariff_idr: number;
  cod_supported?: boolean;
  cod_fee_idr?: number;
  customer_charge_idr?: number;
  eta_days: string;
  is_simulated: boolean;
};

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
  // SUP-24: the page loads at most CONTACT_PICKER_LIMIT contacts for the pickers. When the list
  // was cut short it says so (`contactsTruncated`), and the search box narrows it on the server
  // through the `kontak` query parameter (`contactQuery` is the value currently applied).
  contactsTruncated?: boolean;
  contactQuery?: string;
  // T-053: the tenant-admin gerai cost panel (a server component), shown under the services.
  costPanel?: React.ReactNode;
};

// Query parameter read by the shipment page (a client module cannot export values to it: the page uses the literal "kontak" and 300) to filter the contact pickers by name or phone.
const CONTACT_QUERY_PARAM = "kontak";
const CONTACT_PICKER_LIMIT = 300;
const STEPS = 5;

const filled = (values: DraftValues, ...fields: DraftField[]) => fields.every((f) => values[f].trim() !== "");

// C4: the create flow as five steps (Pengirim, Penerima, Paket & serah, Ongkir, Konfirmasi) on a
// progress spine, with a sticky summary rail (>= 1280) or a bottom bar with a "Rincian" sheet. Steps
// 1-3 are one draft form (saved as a whole, entered values survive every failed save: UX-1); the
// services and the confirmation sit outside it, exactly as before.
export function IntakeForm(props: Props) {
  const [state, action] = useActionState<DraftState, FormData>(saveDraftAction, {});
  const [values, setValues] = useState<DraftValues>(state.values ?? props.initial);
  const [senderContact, setSenderContact] = useState(props.senderContactId ?? "");
  const [recipientContact, setRecipientContact] = useState(props.recipientContactId ?? "");
  // Every contact the user picked in this form session, by id (see `keep` below).
  const [picked, setPicked] = useState<Record<string, ContactOption>>({});
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
    // props.initial is a new object on every server render (a contact search re-renders the page);
    // adopting it only when the saved revision changes keeps unsaved edits through a search.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, props.revision]);
  useEffect(() => setQuoteId(props.quotes[0]?.id ?? ""), [props.quotes]);

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [contactSearch, setContactSearch] = useState(props.contactQuery ?? "");
  const searchContacts = (term: string) => {
    const next = new URLSearchParams(searchParams.toString());
    const trimmed = term.trim().slice(0, 80);
    if (trimmed) next.set(CONTACT_QUERY_PARAM, trimmed);
    else next.delete(CONTACT_QUERY_PARAM);
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const set = (field: DraftField, value: string) => {
    setValues((v) => ({ ...v, [field]: value }));
    setDirty(true);
  };
  const pick = (role: "sender" | "recipient", id: string) => {
    const c = [...props.contacts, ...Object.values(picked)].find((x) => x.id === id);
    if (role === "sender") setSenderContact(id);
    else setRecipientContact(id);
    setDirty(true);
    if (!c) return;
    setPicked((p) => ({ ...p, [c.id]: c }));
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
  const field = (name: DraftField, label: string, opts: { type?: string; inputMode?: "numeric" | "tel" | "text"; autoComplete?: string; hint?: string; textarea?: boolean; describedBy?: string } = {}) => {
    const id = `f-${name}`;
    const described = [opts.hint ? `${id}-hint` : null, opts.describedBy ?? null, err[name] ? `${id}-err` : null].filter(Boolean).join(" ") || undefined;
    const common = {
      id, name, value: values[name],
      "aria-invalid": err[name] ? true : undefined,
      "aria-describedby": described,
    };
    return (
      <Field className="gap-2" data-invalid={err[name] ? true : undefined}>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        {opts.textarea ? (
          <Textarea {...common} rows={3} onChange={(e) => set(name, e.target.value)} />
        ) : (
          <Input {...common} type={opts.type ?? "text"} inputMode={opts.inputMode} autoComplete={opts.autoComplete ?? "off"}
            onChange={(e) => set(name, e.target.value)} />
        )}
        {opts.hint ? <FieldDescription id={`${id}-hint`}>{opts.hint}</FieldDescription> : null}
        {err[name] ? <FieldMessage id={`${id}-err`}>{err[name]}</FieldMessage> : null}
      </Field>
    );
  };

  // A contact picked from an earlier search result stays selectable (and its id is submitted) after a
  // new search replaced the list: without it the select would show "Isi manual" while the hidden id stays.
  const keep = (id: string, list: ContactOption[]) => (id && !list.some((c) => c.id === id) && picked[id] ? [picked[id]] : []);
  const senders = [...keep(senderContact, props.contacts), ...props.contacts].filter((c) => c.is_sender || c.id === senderContact);
  const recipients = [...keep(recipientContact, props.contacts), ...props.contacts].filter((c) => c.is_recipient || c.id === recipientContact);
  const recipientAddresses = [...keep(recipientContact, props.contacts), ...props.contacts].find((c) => c.id === recipientContact)?.addresses ?? [];
  const quotesCurrent = props.quotes.length > 0 && !dirty;
  const selected = props.quotes.find((q) => q.id === quoteId);
  const quoteStatus: QuoteStatus = props.quotes.length === 0 ? "none" : dirty ? "stale" : "current";

  // Step states are hints that mirror the server's quote requirements (missingForQuote).
  const senderDone = filled(values, "sender_name", "sender_phone");
  const recipientDone = filled(values, "recipient_name", "recipient_phone", "recipient_address", "recipient_area") && (!props.live || values.recipient_area_id !== "");
  const parcelDone = filled(values, "item_description", "weight_grams")
    && (values.handover !== "pickup" || filled(values, "pickup_date", "pickup_slot_hour"))
    && (values.is_cod !== "true" || filled(values, "goods_value_idr"));
  const serviceDone = quotesCurrent && !!selected;
  const steps: StepState[] = [
    senderDone ? "done" : "active",
    recipientDone ? "done" : "active",
    parcelDone ? "done" : "active",
    serviceDone ? "done" : senderDone && recipientDone && parcelDone ? "active" : "locked",
    serviceDone ? "active" : "locked",
  ];
  const outletPlace = [props.outlet.pickupAddress, props.outlet.pickupArea].filter(Boolean).join(", ");
  const summary = { values, quote: selected ?? null, status: quoteStatus };

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start">
      <div className="flex min-w-0 flex-col gap-6">
        <div ref={statusRef} tabIndex={-1} className="flex flex-col gap-3 outline-none empty:hidden">
          {state.error ? (
            <Alert variant="destructive">
              <AlertCircle aria-hidden="true" />
              <AlertTitle>{state.error}</AlertTitle>
            </Alert>
          ) : state.ok ? (
            <Alert role="status" className="*:[svg]:text-success">
              <CheckCircle2 aria-hidden="true" />
              <AlertTitle>{state.ok}</AlertTitle>
            </Alert>
          ) : null}
          {state.warning ? (
            <Alert className="*:[svg]:text-warning">
              <AlertTriangle aria-hidden="true" />
              <AlertTitle>{state.warning}</AlertTitle>
            </Alert>
          ) : null}
        </div>

        <div role="search" className="flex flex-col gap-2">
          <Label htmlFor="contact-search">Cari kontak tersimpan (nama atau nomor HP)</Label>
          <div className="flex gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input id="contact-search" type="search" value={contactSearch} autoComplete="off" className="pl-10"
                onChange={(e) => setContactSearch(e.target.value)}
                onKeyDown={(e) => {
                  // Enter searches; the draft form is not involved.
                  if (e.key === "Enter") {
                    e.preventDefault();
                    searchContacts(contactSearch);
                  }
                }} />
            </div>
            <Button type="button" variant="outline" onClick={() => searchContacts(contactSearch)}>Saring kontak</Button>
          </div>
          {props.contactQuery ? (
            <div className="flex flex-wrap items-center gap-x-3">
              <p role="status" className="text-sm text-muted-foreground" data-testid="contact-search-status">
                Menampilkan kontak yang cocok dengan “{props.contactQuery}”.
              </p>
              <Button type="button" variant="link" className="min-h-11 px-0" onClick={() => { setContactSearch(""); searchContacts(""); }}>Hapus pencarian</Button>
            </div>
          ) : null}
          {props.contactsTruncated ? (
            <p role="status" className="flex items-start gap-2 text-sm" data-testid="contact-truncated-notice">
              <Users className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
              <span>Hanya {CONTACT_PICKER_LIMIT} kontak pertama yang ditampilkan di pilihan pengirim dan penerima. Ketik nama atau nomor HP lalu tekan Saring kontak untuk menemukan kontak lain.</span>
            </p>
          ) : null}
        </div>

        <div className="flex flex-col">
          <form action={action} className="flex flex-col" noValidate>
            <input type="hidden" name="shipment_id" value={props.shipmentId} />
            <input type="hidden" name="revision" value={props.revision} />
            <input type="hidden" name="sender_contact_id" value={senderContact} />
            <input type="hidden" name="recipient_contact_id" value={recipientContact} />

            <IntakeStep n={1} total={STEPS} title="Pengirim" state={steps[0]}>
              <Field className="gap-2">
                <FieldLabel htmlFor="pick-sender">Pilih pengirim tersimpan</FieldLabel>
                <ChoiceSelect id="pick-sender" value={senderContact} emptyLabel="— Isi manual —" onValueChange={(v) => pick("sender", v)}
                  options={senders.map((c) => ({ value: c.id, label: `${c.name} · ${c.phone}` }))} />
              </Field>
              <div className="grid gap-4 @md:grid-cols-2">
                {field("sender_name", "Nama pengirim", { autoComplete: "off" })}
                {field("sender_phone", "No. HP pengirim", { type: "tel", inputMode: "tel", hint: "Contoh 081234567890" })}
              </div>
              {!senderContact ? (
                <label className="flex min-h-11 cursor-pointer items-center gap-3">
                  <Checkbox name="save_sender" /> Simpan sebagai kontak pengirim
                </label>
              ) : null}
            </IntakeStep>

            <IntakeStep n={2} total={STEPS} title="Penerima" state={steps[1]}>
              <Field className="gap-2">
                <FieldLabel htmlFor="pick-recipient">Pilih penerima tersimpan</FieldLabel>
                <ChoiceSelect id="pick-recipient" value={recipientContact} emptyLabel="— Isi manual —" onValueChange={(v) => pick("recipient", v)}
                  options={recipients.map((c) => ({ value: c.id, label: `${c.name} · ${c.phone}` }))} />
              </Field>
              {recipientAddresses.length > 1 ? (
                <Field className="gap-2">
                  <FieldLabel htmlFor="pick-address">Alamat tersimpan</FieldLabel>
                  <ChoiceSelect id="pick-address" placeholder="Pilih alamat" onValueChange={pickAddress}
                    value={recipientAddresses.find((a) => a.address_line === values.recipient_address)?.id ?? ""}
                    options={recipientAddresses.map((a) => ({ value: a.id, label: `${a.label ?? "Alamat"} · ${a.address_line}` }))} />
                </Field>
              ) : null}
              <div className="grid gap-4 @md:grid-cols-2">
                {field("recipient_name", "Nama penerima")}
                {field("recipient_phone", "No. HP penerima", { type: "tel", inputMode: "tel" })}
              </div>
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
                  <div className="@md:max-w-[180px]">{field("recipient_postal_code", "Kode pos", { inputMode: "numeric" })}</div>
                </>
              ) : (
                <div className="grid gap-4 @md:grid-cols-[minmax(0,1fr)_160px]">
                  {field("recipient_area", "Kecamatan / kota", { hint: "Simulasi: wilayah ditulis bebas" })}
                  {field("recipient_postal_code", "Kode pos", { inputMode: "numeric" })}
                </div>
              )}
              {!recipientContact ? (
                <label className="flex min-h-11 cursor-pointer items-center gap-3">
                  <Checkbox name="save_recipient" /> Simpan sebagai kontak penerima
                </label>
              ) : null}
            </IntakeStep>

            <IntakeStep n={3} total={STEPS} title="Paket & serah" state={steps[2]}>
              {field("item_description", "Isi paket")}
              <div className="grid gap-4 @md:grid-cols-2">
                {field("weight_grams", "Berat (gram)", { inputMode: "numeric" })}
                {field("goods_value_idr", "Nilai barang (Rp)", { inputMode: "numeric" })}
              </div>
              <div className="grid grid-cols-3 items-end gap-3">
                {field("length_cm", "Panjang (cm)", { inputMode: "numeric", describedBy: props.live ? "dims-note" : undefined })}
                {field("width_cm", "Lebar (cm)", { inputMode: "numeric", describedBy: props.live ? "dims-note" : undefined })}
                {field("height_cm", "Tinggi (cm)", { inputMode: "numeric", describedBy: props.live ? "dims-note" : undefined })}
              </div>
              {props.live ? (
                <p id="dims-note" className="-mt-2 text-sm text-muted-foreground">
                  Dimensi belum memengaruhi ongkir Mengantar: estimasi memakai berat sebenarnya. Isi dimensi hanya sebagai catatan.
                </p>
              ) : null}
              <input type="hidden" name="is_cod" value={values.is_cod === "true" ? "true" : "false"} />
              <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md p-3 ring-1 ring-border transition-colors has-[[data-state=checked]]:bg-info-soft has-[[data-state=checked]]:ring-primary">
                <Checkbox
                  id="f-is_cod"
                  checked={values.is_cod === "true"}
                  onCheckedChange={(checked) => set("is_cod", checked === true ? "true" : "false")}
                  className="mt-0.5"
                />
                <span className="flex flex-col gap-0.5">
                  <span className="font-semibold">Pengiriman COD (Bayar di Tempat)</span>
                  <span className="text-sm text-muted-foreground">
                    Kurir menagih penerima saat paket tiba (nilai barang + ongkir + biaya COD). Nilai barang wajib diisi minimal Rp1.000.
                  </span>
                </span>
              </label>

              <Separator />
              <p className="flex items-start gap-2 text-sm">
                <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span>
                  <span className="font-semibold">Asal kiriman: {props.outlet.name}</span>
                  <span className="text-muted-foreground"> · {outletPlace || "Alamat pickup belum diatur"}. Alamat pickup gerai tetap menjadi asal penjemputan, terpisah dari identitas pengirim.</span>
                </span>
              </p>
              <PickupFields values={values} errors={err} onChange={set} />

              <Separator />
              <div className="flex flex-col gap-3 @md:flex-row @md:flex-wrap @md:items-center">
                <SubmitButton name="intent" value="quote" pendingLabel="Memproses…" className="w-full @md:w-auto">Simpan & cek ongkir</SubmitButton>
                <SubmitButton name="intent" value="save" variant="outline" className="w-full @md:w-auto">Simpan draf</SubmitButton>
              </div>
              <p className="-mt-2 text-sm text-muted-foreground">Draf tersimpan belum menjadi pesanan.</p>
            </IntakeStep>
          </form>

          <IntakeStep n={4} total={STEPS} title="Ongkir" state={steps[3]}
            description={props.quotes.length > 0 ? "Harga yang ditagih ke pelanggan, termasuk biaya COD bila ada." : undefined}>
            {props.quotes.length === 0 ? (
              <div className="flex items-start gap-3 rounded-md bg-muted p-4">
                <Calculator className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="flex flex-col gap-0.5">
                  <p className="font-semibold">Belum ada ongkir yang berlaku</p>
                  <p className="text-sm text-muted-foreground">Lengkapi langkah 1–3, lalu pilih “Simpan & cek ongkir”.</p>
                </div>
              </div>
            ) : dirty ? (
              <p role="status" className="flex items-start gap-2 rounded-md bg-warning-soft p-3 text-sm">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
                <span>Data berubah sejak ongkir dicek. Simpan & cek ongkir lagi sebelum konfirmasi.</span>
              </p>
            ) : null}
            {props.quotes.length > 0 ? (
              <fieldset disabled={!quotesCurrent} className="min-w-0 disabled:opacity-60">
                <legend className="sr-only">Pilih layanan</legend>
                <div className="flex flex-col divide-y divide-border overflow-hidden rounded-md ring-1 ring-border">
                  {props.quotes.map((q) => {
                    const { normal, codFee, total } = quoteCharge(q);
                    const chosen = q.id === quoteId;
                    return (
                      <label key={q.id}
                        className={cn("flex min-h-16 cursor-pointer items-start gap-3 px-4 py-3 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-ring",
                          chosen ? "bg-info-soft" : "hover:bg-muted")}>
                        <input type="radio" name="quote" value={q.id} checked={chosen} onChange={() => setQuoteId(q.id)} className="sr-only" />
                        <span aria-hidden="true"
                          className={cn("mt-1 size-5 shrink-0 rounded-full bg-card", chosen ? "ring-[6px] ring-inset ring-primary" : "ring-1 ring-inset ring-input")} />
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="flex flex-wrap items-center gap-x-2">
                            <span className="font-semibold">{q.is_simulated ? q.service : courierName(q.courier)}</span>
                            {chosen ? <span className="inline-flex items-center gap-1 text-sm text-primary"><Check className="size-4" aria-hidden="true" />Dipilih</span> : null}
                          </span>
                          <span className="text-sm text-muted-foreground">{q.is_simulated ? q.courier : q.service} · {etaLabel(q.eta_days)}</span>
                          {codFee > 0 ? (
                            <span className="text-sm text-muted-foreground tabular-nums">Ongkir {formatIdr(normal)} + biaya COD {formatIdr(codFee)}</span>
                          ) : null}
                          {q.is_simulated ? <span className="text-sm text-muted-foreground">Harga contoh (simulasi)</span> : null}
                        </span>
                        <span className="tabular shrink-0 text-right text-xl font-semibold">{formatIdr(total)}</span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            ) : null}
            {props.costPanel ? <div className="border-t border-border pt-5 empty:hidden">{props.costPanel}</div> : null}
          </IntakeStep>

          <IntakeStep n={5} total={STEPS} title="Konfirmasi" state={steps[4]} last>
            {quotesCurrent && selected ? (
              <>
                <p className="flex items-start gap-2">
                  <Info className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span>
                    {selected.is_simulated
                      ? "Periksa ringkasan, lalu terbitkan resi contoh. Simulasi tidak membuat pesanan sungguhan."
                      : "Periksa ringkasan, lalu terbitkan resi. Konfirmasi membuat pesanan Mengantar sungguhan dan memotong saldo Mengantar gerai."}
                  </span>
                </p>
                <ConfirmDialog {...props} quote={selected} values={values} />
              </>
            ) : (
              <p className="flex items-start gap-2 text-muted-foreground">
                <Lock className="mt-1 size-4 shrink-0" aria-hidden="true" />
                <span>Pilih layanan yang masih berlaku di langkah 4 untuk melanjutkan.</span>
              </p>
            )}
          </IntakeStep>
        </div>
      </div>

      <aside aria-labelledby="ringkasan-heading" className="hidden flex-col gap-5 rounded-lg bg-card p-6 ring-1 ring-border xl:sticky xl:top-8 xl:flex">
        <h2 id="ringkasan-heading" className="text-xl">Ringkasan</h2>
        <IntakeSummary {...summary} />
      </aside>

      <SummaryBar {...summary} />
    </div>
  );
}

function ConfirmDialog(props: Props & { quote: QuoteOption; values: DraftValues }) {
  const [state, action] = useActionState<ConfirmState, FormData>(confirmShipmentAction, {});
  const v = props.values;
  const isCod = v.is_cod === "true";
  const { normal, codFee, total } = quoteCharge(props.quote);
  const goodsValue = goodsValueOf(v);
  const shipment: [string, string][] = [
    ["Pengirim", `${v.sender_name} · ${v.sender_phone}`],
    ["Penerima", `${v.recipient_name} · ${v.recipient_phone}`],
    ["Alamat tujuan", [v.recipient_address, v.recipient_area, v.recipient_postal_code].filter(Boolean).join(", ")],
    ["Pickup", props.outlet.name],
    ["Penyerahan", handoverSummary(v)],
    ["Paket", `${v.item_description} · ${v.weight_grams} g`],
    ["Layanan", `${serviceName(props.quote)} (${etaLabel(props.quote.eta_days)})`],
  ];
  // UX-5: the normal tariff and the COD fee each appear exactly once, then their sum.
  const money: [string, string, boolean?][] = isCod
    ? [
        ["Metode", "COD (Bayar di Tempat)"],
        ["Ongkir (tarif normal)", formatIdr(normal)],
        ["Biaya COD", formatIdr(codFee)],
        ["Ongkir pelanggan", formatIdr(total), true],
        ["Nilai barang", formatIdr(goodsValue)],
        ["Tagihan COD ke penerima", formatIdr(goodsValue + total), true],
      ]
    : [["Ongkir pelanggan", formatIdr(total), true]];
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button className="w-full sm:w-auto sm:self-start">Periksa & konfirmasi</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader className="pr-12">
          <DialogTitle>Konfirmasi pengiriman <span className="tabular whitespace-nowrap">{props.reference}</span></DialogTitle>
          <DialogDescription data-testid={props.quote.is_simulated ? undefined : "live-issuance-warning"}>
            {props.quote.is_simulated
              ? "Ini simulasi: tidak ada pesanan Mengantar, saldo atau resi sungguhan yang dibuat."
              : "Mengonfirmasi membuat pesanan Mengantar sungguhan dari akun gerai ini dan membayarnya dari saldo Mengantar. Pesanan tidak bisa dibatalkan dari GeraiExpress."}
          </DialogDescription>
        </DialogHeader>
        <dl className="flex flex-col divide-y divide-border text-sm">
          {shipment.map(([k, val]) => (
            <div key={k} className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-4 py-2">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="break-words">{val}</dd>
            </div>
          ))}
        </dl>
        <dl className="flex flex-col gap-2 rounded-md bg-muted p-4 text-sm">
          {money.map(([k, val, strong]) => (
            <div key={k} className="flex items-baseline justify-between gap-4">
              <dt className={strong ? "font-semibold" : "text-muted-foreground"}>{k}</dt>
              <dd className={cn("tabular text-right", strong && "text-base font-semibold")}>{val}</dd>
            </div>
          ))}
        </dl>
        {state.error ? (
          <Alert variant="destructive">
            <AlertCircle aria-hidden="true" />
            <AlertTitle>{state.error}</AlertTitle>
          </Alert>
        ) : null}
        <form action={action}>
          <input type="hidden" name="shipment_id" value={props.shipmentId} />
          <input type="hidden" name="quote_id" value={props.quote.id} />
          <input type="hidden" name="revision" value={props.revision} />
          <input type="hidden" name="idempotency_key" value={props.idempotencyKey} />
          <DialogFooter className="gap-3">
            <DialogClose asChild><Button type="button" variant="outline">Kembali</Button></DialogClose>
            <SubmitButton pendingLabel="Menerbitkan…">Konfirmasi & terbitkan resi</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

import { courierName, formatIdr, formatWeight, formatWib } from "@/lib/format";
import { INVOICE_FOOTER, type InvoiceSnapshot } from "@/modules/invoices/invoice-content";

// Print-first invoice sheet: A4 portrait, black on white, system font, no gradient, shadow or accent
// colour. A4 (not the 100x150 mm label stock) because the invoice is a multi-line document for the
// sender to read and file, printed on the counter's office printer, while the label goes to the thermal
// printer. It sits on its own named page (@page invoice), so it prints on A4 even while the label's
// 100x150 mm default page rule is in the same document; the print view sends each sheet in its own job.
// Everything printed comes from the stored snapshot (DATA-10); it is a
// charge document, never proof of payment, and says so in the footer line.
const dash = (value: string | null | undefined) => (value && value.trim() ? value : "—");

export function InvoiceSheet({ invoice }: { invoice: InvoiceSnapshot }) {
  const service = [invoice.courier ? courierName(invoice.courier) : null, invoice.service].filter(Boolean).join(" ");
  return (
    <>
      <style>{`@page invoice { size: A4 portrait; margin: 0; }`}</style>
      <article
        aria-label="Invoice pengiriman"
        data-testid="invoice-sheet"
        style={{ width: "210mm", fontFamily: "system-ui, sans-serif", page: "invoice" }}
        className="box-border flex shrink-0 flex-col gap-[7mm] border border-black bg-white p-[15mm] text-[10.5pt] leading-[1.4] text-black [overflow-wrap:anywhere] print:m-0 print:break-before-page print:border-0"
      >
        <header className="flex items-start justify-between gap-[8mm] border-b-2 border-black pb-[5mm]">
          <div>
            <p className="text-[16pt] font-bold" data-testid="invoice-gerai-name">{invoice.gerai_name}</p>
            <p className="tabular-nums" data-testid="invoice-gerai-whatsapp">WhatsApp {invoice.gerai_whatsapp}</p>
            <p data-testid="invoice-gerai-address">{dash(invoice.gerai_address)}</p>
          </div>
          <div className="text-right">
            <p className="text-[16pt] font-bold tracking-wide">INVOICE</p>
            <p className="font-semibold tabular-nums" data-testid="invoice-number">{invoice.invoice_number}</p>
            <p className="tabular-nums" data-testid="invoice-issued">{formatWib(invoice.issued_at)}</p>
          </div>
        </header>

        <section aria-label="Pihak" className="grid grid-cols-2 gap-[8mm]">
          <div>
            <p className="text-[8.5pt] font-semibold uppercase tracking-wide">Pengirim</p>
            <p className="font-semibold" data-testid="invoice-sender">{dash(invoice.sender_name)}</p>
          </div>
          <div>
            <p className="text-[8.5pt] font-semibold uppercase tracking-wide">Penerima</p>
            <p className="font-semibold" data-testid="invoice-recipient">{dash(invoice.recipient_name)}</p>
            <p>{dash(invoice.recipient_area)}</p>
          </div>
        </section>

        <table className="w-full border-collapse text-left" data-testid="invoice-lines">
          <caption className="sr-only">Rincian tagihan</caption>
          <thead>
            <tr className="border-b border-black">
              <th scope="col" className="py-[2mm] font-semibold">Rincian</th>
              <th scope="col" className="py-[2mm] text-right font-semibold">Jumlah</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-black/40 align-top">
              <td className="py-[3mm]">
                <p className="font-semibold">Ongkos kirim {dash(service)}</p>
                <p>Resi <span className="tabular-nums" data-testid="invoice-awb">{invoice.awb}</span> · Berat {formatWeight(invoice.weight_grams)}</p>
                {invoice.item_description ? <p>Isi paket: {invoice.item_description}</p> : null}
                <p className="tabular-nums">Ref {invoice.shipment_reference}</p>
              </td>
              <td className="py-[3mm] text-right tabular-nums" data-testid="invoice-line-charge">{formatIdr(invoice.shipping_charge_idr)}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" className="py-[3mm] text-right font-bold">Total ongkos kirim</th>
              <td className="py-[3mm] text-right text-[13pt] font-bold tabular-nums" data-testid="invoice-total">{formatIdr(invoice.shipping_charge_idr)}</td>
            </tr>
          </tfoot>
        </table>

        {invoice.is_cod ? (
          <p className="border border-black px-[3mm] py-[2mm] tabular-nums" data-testid="invoice-cod">
            COD: kurir menagih {formatIdr(invoice.cod_amount_idr)} dari penerima, yaitu nilai barang ditambah total ongkos kirim di atas (sudah termasuk biaya COD).
          </p>
        ) : null}

        <p className="mt-auto border-t border-black pt-[3mm] text-[9pt]" data-testid="invoice-footer">{INVOICE_FOOTER}</p>
      </article>
    </>
  );
}

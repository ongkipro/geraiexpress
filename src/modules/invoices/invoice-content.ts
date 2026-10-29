// The stored invoice snapshot as the print view reads it (a subset of public.invoice_snapshots, DATA-10).
// Everything printed comes from these stored values, never from live shipment, tenant or outlet data, and
// none of them is private: the charge is the sender-facing shipping charge, there is no net cost, discount
// or platform remainder column to select (PR-22).
export type InvoiceSnapshot = {
  id: string;
  invoice_number: string;
  issued_at: string;
  gerai_name: string;
  gerai_whatsapp: string;
  gerai_address: string | null;
  sender_name: string | null;
  recipient_name: string | null;
  recipient_area: string | null;
  item_description: string | null;
  weight_grams: number | null;
  courier: string | null;
  service: string | null;
  shipping_charge_idr: number;
  is_cod: boolean;
  cod_amount_idr: number | null;
  awb: string;
  shipment_reference: string;
};

export const INVOICE_COLUMNS =
  "id, invoice_number, issued_at, gerai_name, gerai_whatsapp, gerai_address, sender_name, recipient_name, recipient_area, item_description, weight_grams, courier, service, shipping_charge_idr, is_cod, cod_amount_idr, awb, shipment_reference";

// The invoice is a charge document, not a receipt: it never claims that money was received.
export const INVOICE_FOOTER =
  "Dokumen ini adalah rincian tagihan ongkos kirim, bukan bukti pembayaran.";

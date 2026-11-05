// Row shapes the shipment detail reads (the query builder is untyped; these name what the page uses).
export type ShipmentRecord = {
  id: string;
  reference: string;
  submission_state: string;
  payment_state?: "not_applicable" | "unpaid" | "paid";
  is_simulated: boolean;
  is_cod: boolean;
  awb: string | null;
  customer_charge_idr: number | null;
  goods_value_idr: number | null;
  cod_amount_idr: number | null;
  sender_name: string | null;
  sender_phone: string | null;
  recipient_name: string | null;
  recipient_phone: string | null;
  recipient_address: string | null;
  recipient_area: string | null;
  recipient_postal_code: string | null;
  item_description: string | null;
  weight_grams: number | null;
  weight_snapshot?: { actual_weight_grams: number | null; volumetric_weight_grams: number | null; billable_weight_grams: number | null; weight_rule_id: string | null } | null;
  provider_weight_grams?: number | null;
  // PR-41: frozen at confirmation; null on shipments confirmed before the declaration existed.
  content_declaration_version?: number | null;
  content_declared_by?: string | null;
  content_declared_by_email?: string | null;
  content_declared_at?: string | null;
  submitted_at: string | null;
  // Provider delivery dimension; 'returned' is set once T-045 ingests return events (UX-20 item 1).
  delivery_state?: string | null;
  selected_quote_id: string | null;
  pickup_snapshot: unknown;
};

// Newest create_order operation of the shipment.
export type OperationRecord = {
  state: string;
  result_code: string | null;
  provider_order_id: string | null;
  provider_batch: string | null;
  provider_error_detail: string | null;
  is_simulated: boolean;
  pickup_phase: string | null;
  dispatched_at: string | null;
  // Last read-back at Mengantar (reconcile or payment check); null when never checked.
  last_checked_at: string | null;
};

export type PickupSnapshot = {
  outlet?: string;
  address?: string;
  area?: string;
  handover?: string;
  pickup_date?: string;
  pickup_slot_hour?: number;
  pickup_volume?: string;
  pickup_note?: string | null;
};

export type BatchReview = {
  batch: string;
  courier: string;
  batch_digest: string;
  member_count: number;
  // Newest payment attempt of the batch (claimed/sent/unknown/paid/rejected/released/closed) or null.
  payment_attempt_state: string | null;
  // The attempt the close command must name (T-056), so a newer one is never closed unreviewed.
  payment_attempt_id: string | null;
  // When the attempt's pay command was sent (null if nothing was sent); the close window starts here.
  payment_attempt_sent_at: string | null;
  total_customer_charge_idr: number;
  members: {
    operation_id: string;
    shipment_id: string;
    reference: string;
    provider_order_id: string;
    recipient_name: string | null;
    customer_charge_idr: number | null;
    is_cod: boolean;
    cod_amount_idr: number | null;
  }[];
};

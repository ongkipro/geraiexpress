// Accept whole rupiah only, optionally with Rp and Indonesian thousands separators. Reject signs,
// decimals and arbitrary text instead of silently changing the amount the operator entered.
export function parsePaymentRupiah(raw: string): number | null {
  const value = raw.trim().replace(/^Rp\s*/i, "");
  if (!/^(?:[0-9]+|[1-9][0-9]{0,2}(?:\.[0-9]{3})+)$/.test(value)) return null;
  const amount = Number(value.replaceAll(".", ""));
  return Number.isSafeInteger(amount) ? amount : null;
}

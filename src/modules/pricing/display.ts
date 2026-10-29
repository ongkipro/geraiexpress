import { formatIdr } from "../../lib/format";

// T-053 / PR-23 / DEC-018 item 1: the gerai-facing cost is a COST BASIS shown to tenant administrators,
// not a charge. Unknown (no assigned discount, no known net cost, no row) is "belum diketahui" and is
// never rendered as Rp0. Operators and sender-facing surfaces never use these strings.
export const GERAI_COST_LABEL = "Biaya gerai (estimasi)";
export const GERAI_COST_UNKNOWN = "belum diketahui";

export const GERAI_COST_NOTE =
  "Biaya gerai mengikuti diskon yang ditetapkan GeraiExpress untuk gerai Anda. Angka ini dasar perhitungan, bukan tagihan: potongan saldo Mengantar yang sebenarnya mengikuti tarif akun penjual Anda di Mengantar dan bisa berbeda.";

// The RPC returns a bigint (JSON number) or null. Anything that is not a non-negative safe integer is unknown.
export function geraiCostText(cost: unknown): string {
  return typeof cost === "number" && Number.isSafeInteger(cost) && cost >= 0 ? formatIdr(cost) : GERAI_COST_UNKNOWN;
}

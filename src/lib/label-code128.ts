// Code128 encoder for the AWB barcode on the local masked label (TD-13, DEC-017, UI-6). No library and no
// external barcode service: the label draws vector bars from the module string this file produces.
//
// The courier AWB character set is Unknown (operations contract §6.3), so the subset is chosen per value
// and the result is proved by a decoder in tests/unit/code128.test.ts rather than by inspection: printable
// ASCII (32 to 126) is encoded in set B, and runs of digits switch to set C where that shortens the symbol.

// Bar and space widths of symbols 0 to 105, then the stop symbol 106 (seven elements). The first element of
// every symbol is a bar. Cross-checked in tests against an independent encoder's output.
export const CODE128_PATTERNS: readonly string[] = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
];

export const CODE128_START_B = 104;
export const CODE128_START_C = 105;
export const CODE128_CODE_B = 100;
export const CODE128_CODE_C = 99;
export const CODE128_STOP = 106;
// Quiet zone each side of the symbol, in modules (the standard asks for at least ten).
export const CODE128_QUIET_MODULES = 10;

export type Code128 = {
  value: string;
  // Symbol values in order: start, data (with set switches), check, stop.
  symbols: number[];
  // Alternating bar and space runs as '1' and '0', without the quiet zones.
  modules: string;
};

const isDigit = (code: number) => code >= 48 && code <= 57;

function assertEncodable(value: string): void {
  if (value.length === 0) throw new Error("code128: empty value");
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c < 32 || c > 126) throw new Error("code128: only printable ASCII can be encoded");
  }
}

// Fewest-symbols segmentation over sets B and C (Viterbi over position and active set). A set switch costs
// one symbol, so digit pairs use C only when that is shorter overall; ties prefer B for readability.
function segment(value: string): number[] {
  const n = value.length;
  const INF = Number.POSITIVE_INFINITY;
  // best[i][s]: cheapest symbols to have encoded value[0..i) and be in set s (0 = B, 1 = C).
  const best: number[][] = Array.from({ length: n + 1 }, () => [INF, INF]);
  const from: { i: number; s: number; sym: number[] }[][] = Array.from({ length: n + 1 }, () => [
    { i: -1, s: -1, sym: [] }, { i: -1, s: -1, sym: [] },
  ]);
  best[0][0] = 1;
  best[0][1] = 1;
  from[0][0] = { i: -1, s: -1, sym: [CODE128_START_B] };
  from[0][1] = { i: -1, s: -1, sym: [CODE128_START_C] };
  for (let i = 0; i <= n; i++) {
    // Switching sets at the same position, B to C and C to B, costs one symbol.
    for (const [s, t, code] of [[0, 1, CODE128_CODE_C], [1, 0, CODE128_CODE_B]] as const) {
      if (best[i][s] + 1 < best[i][t]) {
        best[i][t] = best[i][s] + 1;
        from[i][t] = { i, s, sym: [code] };
      }
    }
    if (i === n) break;
    if (best[i][0] + 1 < best[i + 1][0]) {
      best[i + 1][0] = best[i][0] + 1;
      from[i + 1][0] = { i, s: 0, sym: [value.charCodeAt(i) - 32] };
    }
    if (i + 1 < n && isDigit(value.charCodeAt(i)) && isDigit(value.charCodeAt(i + 1)) && best[i][1] + 1 < best[i + 2][1]) {
      best[i + 2][1] = best[i][1] + 1;
      from[i + 2][1] = { i, s: 1, sym: [Number(value.slice(i, i + 2))] };
    }
  }
  let s = best[n][0] <= best[n][1] ? 0 : 1;
  let i = n;
  const chunks: number[][] = [];
  while (i >= 0) {
    const step = from[i][s];
    chunks.push(step.sym);
    if (step.i === -1) break;
    i = step.i;
    s = step.s;
  }
  return chunks.reverse().flat();
}

function build(value: string, data: number[]): Code128 {
  const symbols = [...data];
  let sum = symbols[0];
  for (let i = 1; i < symbols.length; i++) sum += symbols[i] * i;
  symbols.push(sum % 103, CODE128_STOP);
  const modules = symbols
    .map((sym) => [...CODE128_PATTERNS[sym]].map((w, idx) => (idx % 2 === 0 ? "1" : "0").repeat(Number(w))).join(""))
    .join("");
  return { value, symbols, modules };
}

// The AWB barcode: shortest symbol over sets B and C. Throws for an empty value or a character outside
// printable ASCII, so a value that cannot be drawn is never drawn wrong.
export function encodeCode128(value: string): Code128 {
  assertEncodable(value);
  return build(value, segment(value));
}

// Set B only (the reference form the tests compare against).
export function encodeCode128B(value: string): Code128 {
  assertEncodable(value);
  return build(value, [CODE128_START_B, ...[...value].map((ch) => ch.charCodeAt(0) - 32)]);
}

// Total width in modules including both quiet zones, for the drawing's viewBox.
export const code128Width = (code: Code128) => code.modules.length + 2 * CODE128_QUIET_MODULES;

// Solid runs of the module string as [x, width] pairs, offset by the leading quiet zone.
export function code128Bars(code: Code128): [number, number][] {
  const bars: [number, number][] = [];
  const m = code.modules;
  for (let i = 0; i < m.length; ) {
    let j = i;
    while (j < m.length && m[j] === m[i]) j++;
    if (m[i] === "1") bars.push([CODE128_QUIET_MODULES + i, j - i]);
    i = j;
  }
  return bars;
}
